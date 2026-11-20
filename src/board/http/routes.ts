/**
 * The local HTTP route table.
 *
 * Split out of `server.ts` so that file is lifecycle only (listen, adopt, stop)
 * and this one is the surface a browser talks to. The two change for different
 * reasons: a route changes when the board protocol does, lifecycle changes when
 * the hosting model does.
 */

import type express from "express";
import type { AppConfig } from "../../infra/config.js";
import { logger } from "../../infra/logger.js";
import {
  addBoardItem, addBoardItems, diagramToBoardItems, layoutBoardItems,
  parseBoard, removeBoardItem, removeBoardItems, replaceBoardContent, touchBoard,
  updateBoardItem, updateBoardItems,
  type BoardItemInput, type BoardLayoutInput, type DiagramInput, type SimpleBoard,
} from "../types.js";
import { BoardRevisionConflictError, BoardValidationError, EmptyWriteRefusedError, ObjectConflictError } from "../errors.js";
import { boardLibraryIndexText, type BoardLibrary, type BoardLibraryAction } from "../library.js";
import type { BoardRevisionCache } from "../state/revision-cache.js";
import type { BoardStore } from "../state/store.js";
import { conflictPayload } from "../write/conflict.js";
import { boardToSvg } from "../svg/render.js";
import { isAllowedHost, isAllowedOrigin, validationErrorBody } from "./security.js";
import { commitBoardWrite } from "../write/commit.js";
import { projectSnapshotText, scanProject, type ProjectScanOptions } from "../project/scan.js";
import { readAsset } from "./templates.js";
import { serveAsset } from "./assets.js";
import { expandRecipe } from "../diagram/recipe.js";
import type { canvasSnapshotOf } from "./snapshot.js";

export interface BoardRoutesContext {
  app: express.Express;
  board: BoardStore;
  config: AppConfig;
  library: BoardLibrary;
  revisions?: BoardRevisionCache;
  panelToken: string;
  broadcast(message: Record<string, unknown>): void;
  serveBoard(res: express.Response): void | Promise<void>;
  snapshot(board: SimpleBoard): ReturnType<typeof canvasSnapshotOf>;
}

  export function registerBoardRoutes(ctx: BoardRoutesContext): void {
    ctx.app.use((req, res, next) => {
      if (!isAllowedHost(req.header("host"), ctx.config.previewHost)) {
        return res.status(403).json({ error: "Forbidden host" });
      }
      if (req.method !== "GET" && !isAllowedOrigin(req.header("origin"), ctx.config.previewHost)) {
        return res.status(403).json({ error: "Forbidden origin" });
      }
      next();
    });

    ctx.app.use("/api/board", (req, res, next) => {
      if (req.method === "GET") return next();
      if (req.header("X-AI-Draw-Token") !== ctx.panelToken) {
        return res.status(401).json({ error: "Invalid panel token" });
      }
      next();
    });

    ctx.app.get("/api/board", async (_req, res) => {
      const current = await ctx.board.snapshot();
      // Remember what a browser just read: the canvas pins this revision and
      // sends it back as If-Match-Revision, and merge needs the board as that
      // caller saw it. Without this, every racing canvas edit was a 409.
      ctx.revisions?.remember(current);
      const index = (await ctx.library.apply({ type: "list" }, current)).index;
      res.json({ ...ctx.snapshot(current), library: index });
    });

    /*
     * The board as an image, for readers with no browser.
     *
     * A README screenshot goes stale the moment the board changes; a CI job that
     * wants to attach "what the board looked like" has nowhere to get it. This
     * renders the current board with plain shapes. Read-only: no revision bump,
     * no write, and `capabilities.svgPreview` tells the agent it exists.
     */
    ctx.app.get("/api/board.svg", async (req, res) => {
      const current = await ctx.board.snapshot();
      const maxSize = Number(req.query.max);
      const svg = boardToSvg(current, {
        maxSize: Number.isFinite(maxSize) && maxSize > 0 ? maxSize : undefined,
        background: req.query.background !== "false",
      });
      res.type("image/svg+xml");
      // The board changes on every edit, so the preview must not be cached
      // beyond the response like the content-hashed client assets are.
      res.setHeader("Cache-Control", "no-cache");
      res.send(svg);
    });

    ctx.app.get("/api/board/library", async (_req, res) => {
      const result = await ctx.library.apply({ type: "list" }, await ctx.board.snapshot());
      res.json(result.index);
    });

    ctx.app.post("/api/board/library", async (req, res) => {
      const body = req.body as { action?: BoardLibraryAction; confirmedBy?: string };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.action || typeof body.action !== "object") return res.status(400).json({ error: "action is required" });
      /*
       * A library action is validated too, so it needs the same rejection shape
       * as a write. This route had no handler at all: switching to an unknown
       * board surfaced as 500 "Internal server error" and the specific message
       * -- which board ids do exist -- reached stderr and nowhere else.
       */
      try {
        const current = await ctx.board.snapshot();
        const result = await ctx.library.apply(body.action, current);
        if (result.previousRevision !== undefined || result.board.id !== current.id
          || result.board.revision !== current.revision || result.board.title !== current.title) {
          const next = await ctx.board.replace(result.previousRevision === undefined
            ? touchBoard(result.board)
            : { ...result.board, revision: current.revision + 1 }, current.revision);
          result.board = next;
        }
        ctx.revisions?.remember(result.board);
        ctx.broadcast({ type: "board_library_updated", activeId: result.index.activeId, revision: result.board.revision });
        res.json({
          ok: true,
          index: result.index,
          board: ctx.snapshot(result.board),
          ...(body.action.type === "export" || body.action.type === "get" ? { exportBoard: result.board } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof BoardValidationError) return res.status(400).json(validationErrorBody(error));
        if (error instanceof BoardRevisionConflictError) return res.status(409).json({ error: message });
        if (message.toLowerCase().includes("timed out waiting")) return res.status(503).json({ error: message });
        if ((error as NodeJS.ErrnoException).code) {
          logger.error(`Board library persistence failed: ${message}`);
          return res.status(500).json({ error: "Unable to persist board changes" });
        }
        return res.status(400).json({ error: message });
      }
    });

    const commit = async (
      res: express.Response,
      change: (board: Awaited<ReturnType<BoardStore["snapshot"]>>) => Awaited<ReturnType<BoardStore["snapshot"]>>,
      options: { allowEmpty?: boolean; wholeBoard?: boolean; conflictScope?: unknown } = {},
    ) => {
      let board: Awaited<ReturnType<BoardStore["snapshot"]>>;
      let mergedFrom: number | undefined;
      try {
        const revisionHeader = res.req.header("If-Match-Revision");
        const committed = await commitBoardWrite({
          store: ctx.board,
          revisions: ctx.revisions,
          author: "human",
          expectedRevision: revisionHeader === undefined ? undefined : Number(revisionHeader),
          guardEmptyWrite: true,
          allowEmpty: options.allowEmpty,
          wholeBoard: options.wholeBoard,
          conflictScope: options.conflictScope ?? res.req.body,
          uncachedMode: "conflict-error",
          change,
        });
        board = committed.board;
        mergedFrom = committed.mergedFrom;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof EmptyWriteRefusedError) {
          return res.status(409).json({ error: "Refusing to clear every object from the board; send an explicit delete instead" });
        }
        if (error instanceof ObjectConflictError) {
          return res.status(409).json(conflictPayload(error.baseRevision, error.currentRevision, error.conflicts));
        }
        if (error instanceof BoardRevisionConflictError) return res.status(409).json({ error: message });
        if (message.toLowerCase().includes("timed out waiting")) return res.status(503).json({ error: message });
        /*
         * A validation error carries a `code` too, and it is not an errno.
         *
         * `(error as NodeJS.ErrnoException).code` treated `INVALID_COLOR` as a
         * filesystem failure, so a canvas sending a bad colour got a 500 with
         * "Unable to persist board changes" — a server error for a client
         * mistake, and no field to fix. Check the class first and return the
         * same structured payload the MCP tools use.
         */
        if (error instanceof BoardValidationError) return res.status(400).json(validationErrorBody(error));
        if ((error as NodeJS.ErrnoException).code) {
          logger.error(`Board persistence failed: ${message}`);
          return res.status(500).json({ error: "Unable to persist board changes" });
        }
        return res.status(400).json({ error: message });
      }
      ctx.broadcast({ type: "board_updated", revision: board.revision });
      return res.json({ ok: true, board: ctx.snapshot(board), ...(typeof mergedFrom === "number" ? { mergedFrom } : {}) });
    };

    ctx.app.post("/api/board/items", async (req, res) => {
      const body = req.body as { item?: BoardItemInput; confirmedBy?: string };
      if (!body || typeof body !== "object") return res.status(400).json({ error: "JSON object is required" });
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.item) return res.status(400).json({ error: "item is required" });
      await commit(res, (current) => addBoardItem(current, { ...body.item!, author: "human" }));
    });

    ctx.app.patch("/api/board/items/:id", async (req, res) => {
      const body = req.body as { patch?: Partial<BoardItemInput>; confirmedBy?: string };
      if (!body || typeof body !== "object") return res.status(400).json({ error: "JSON object is required" });
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.patch) return res.status(400).json({ error: "patch is required" });
      await commit(res, (current) => updateBoardItem(current, req.params.id, body.patch!), {
        conflictScope: { id: req.params.id },
      });
    });

    ctx.app.delete("/api/board/items/:id", async (req, res) => {
      const body = req.body as { confirmedBy?: string };
      if (!body || typeof body !== "object") return res.status(400).json({ error: "JSON object is required" });
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      await commit(res, (current) => removeBoardItem(current, req.params.id), {
        allowEmpty: true,
        conflictScope: { id: req.params.id },
      });
    });

    ctx.app.post("/api/board/batch", async (req, res) => {
      const body = req.body as {
        confirmedBy?: string;
        items?: BoardItemInput[];
        updates?: Array<{ id: string; patch: Partial<BoardItemInput> }>;
        remove_ids?: string[];
        layout?: BoardLayoutInput;
      };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      await commit(res, (current) => {
        let next = current;
        if (body.items?.length) next = addBoardItems(next, body.items.map((item) => ({ ...item, author: "human" })));
        if (body.updates?.length) next = updateBoardItems(next, body.updates, "human");
        if (body.remove_ids?.length) next = removeBoardItems(next, body.remove_ids);
        if (body.layout) next = layoutBoardItems(next, body.layout, "human");
        return next;
      }, { allowEmpty: Boolean(body.remove_ids?.length) });
    });

    ctx.app.post("/api/board/replace", async (req, res) => {
      const body = req.body as { confirmedBy?: string; board?: unknown };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (body.board === undefined) return res.status(400).json({ error: "board is required" });
      await commit(res, (current) => replaceBoardContent(current, body.board), { wholeBoard: true });
    });

    ctx.app.post("/api/board/diagram", async (req, res) => {
      const body = req.body as { confirmedBy?: string; diagram?: DiagramInput };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.diagram || typeof body.diagram !== "object") return res.status(400).json({ error: "diagram is required" });
      let expanded;
      try {
        expanded = expandRecipe(body.diagram);
        diagramToBoardItems(expanded, "human");
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
      await commit(res, (current) => {
        const generated = diagramToBoardItems(
          expanded!,
          "human",
          body.diagram!.replace ? [] : current.items.map((item) => item.id),
        );
        const candidate = touchBoard({
          ...current,
          title: expanded!.title ?? current.title,
          items: body.diagram!.replace ? generated : [...current.items, ...generated],
        });
        parseBoard(candidate);
        return candidate;
      }, { wholeBoard: Boolean(body.diagram.replace) });
    });

    ctx.app.get("/api/board/project", async (req, res) => {
      const options: ProjectScanOptions = {
        maxDepth: req.query.max_depth ? Number(req.query.max_depth) : undefined,
        maxFiles: req.query.max_files ? Number(req.query.max_files) : undefined,
        includeEvidence: req.query.evidence !== "0",
      };
      try {
        const snapshot = await scanProject(ctx.config.workspaceRoot, options);
        res.json(snapshot);
      } catch (error) {
        if (error instanceof BoardValidationError) return res.status(400).json(validationErrorBody(error));
        throw error;
      }
    });

    ctx.app.get("/api/board/project/text", async (_req, res) => {
      const snapshot = await scanProject(ctx.config.workspaceRoot);
      res.type("text/plain").send(projectSnapshotText(snapshot));
    });

    ctx.app.get("/", (_req, res) => ctx.serveBoard(res));
    /*
     * The service worker must live at the origin root to control `/`.
     *
     * It is served from the package instead of a public/ directory because the
     * plugin bundle has no public/ directory; `assetCandidates` already knows
     * how to find a template next to the compiled server in both layouts.
     * `no-cache` is required by the spec's update check — a cached worker can
     * never pick up a fix.
     */
    ctx.app.get("/sw.js", async (_req, res) => {
      const source = await readAsset(ctx.config, "sw.js");
      if (!source) return void res.status(404).type("text/plain").send("service worker not built");
      res.set("Cache-Control", "no-cache");
      res.type("application/javascript").send(source);
    });
    ctx.app.use("/excalidraw", (req, res, next) => serveAsset(req, res, next, ctx.config));

    ctx.app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const parserError = (error as { type?: string }).type;
      if (parserError === "entity.parse.failed" || parserError === "entity.too.large") {
        return res.status(parserError === "entity.too.large" ? 413 : 400)
          .json({ error: "Invalid or oversized JSON request" });
      }
      logger.error(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(500).json({ error: "Internal server error" });
    });
  }
