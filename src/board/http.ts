import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { AppConfig } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import {
  addBoardItem,
  addBoardItems,
  boardVisualDigest,
  diagramToBoardItems,
  layoutBoardItems,
  parseBoard,
  removeBoardItem,
  removeBoardItems,
  replaceBoardContent,
  touchBoard,
  updateBoardItem,
  updateBoardItems,
  type BoardItemInput,
  type BoardLayoutInput,
  type DiagramInput,
  type SimpleBoard,
} from "./types.js";
import { BoardRevisionConflictError, EmptyWriteRefusedError } from "./errors.js";
import { BoardLibrary, boardLibraryIndexText, type BoardLibraryAction } from "./library.js";
import type { BoardRevisionCache } from "./revision-cache.js";
import { isSuspiciousEmptyWrite, type BoardStore } from "./store.js";
import { projectSnapshotText, scanProject, type ProjectScanOptions } from "./project-scan.js";
import { assetCandidates, fillTemplate, findExisting, readTemplate } from "./http/templates.js";
import { expandRecipe } from "./diagram/recipe.js";

function canvasSnapshot(board: SimpleBoard) {
  const { notes: _legacyNotes, ...snapshot } = board;
  return {
    ...snapshot,
    visualDigest: boardVisualDigest(board),
    capabilities: {
      version: 1,
      canvasEngine: "excalidraw",
      layouts: ["grid", "row", "column", "timeline", "cluster", "architecture"],
      connectors: ["startItemId", "endItemId"],
      variants: ["plain", "card", "frame", "pill", "diamond", "callout", "heading"],
      roles: ["normal", "label", "frame", "column", "step", "decision", "annotation"],
      recipes: ["flow", "compare", "cluster", "emphasis", "image-annotation", "architecture", "diagram"],
      sharingExports: ["png", "jpg", "svg"],
      sharingExportOwner: "human-canvas",
    },
  };
}


export class BoardHttpServer {
  private app = express();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  readonly panelToken = crypto.randomBytes(24).toString("hex");
  private readonly assetVersion = crypto.randomBytes(8).toString("hex");
  private appBundle = "";
  private panelUrlValue: string | null = null;
  private readonly library: BoardLibrary;

  constructor(
    private board: BoardStore,
    private config: AppConfig,
    /**
     * Shared with the MCP tools so a browser edit is visible to the next
     * `get_board(since_revision)`. Without it every HTTP write produced a
     * revision the cache had never seen, so the delta path fell back to a full
     * board on exactly the edits a person just made.
     */
    private revisions?: BoardRevisionCache,
  ) {
    this.app.use(express.json({ limit: "2mb" }));
    this.library = new BoardLibrary(config.outputDir);
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use("/api/board", (req, res, next) => {
      if (req.method === "GET") return next();
      if (req.header("X-AI-Draw-Token") !== this.panelToken) {
        return res.status(401).json({ error: "Invalid panel token" });
      }
      next();
    });

    this.app.get("/api/board", async (_req, res) => {
      const current = await this.board.snapshot();
      const index = (await this.library.apply({ type: "list" }, current)).index;
      res.json({ ...canvasSnapshot(current), library: index });
    });

    this.app.get("/api/board/library", async (_req, res) => {
      const result = await this.library.apply({ type: "list" }, await this.board.snapshot());
      res.json(result.index);
    });

    this.app.post("/api/board/library", async (req, res) => {
      const body = req.body as { action?: BoardLibraryAction; confirmedBy?: string };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.action || typeof body.action !== "object") return res.status(400).json({ error: "action is required" });
      const current = await this.board.snapshot();
      const result = await this.library.apply(body.action, current);
      if (result.previousRevision !== undefined || result.board.id !== current.id
        || result.board.revision !== current.revision || result.board.title !== current.title) {
        const next = await this.board.replace(result.previousRevision === undefined
          ? touchBoard(result.board)
          : { ...result.board, revision: current.revision + 1 }, current.revision);
        result.board = next;
      }
      this.revisions?.remember(result.board);
      this.broadcast({ type: "board_library_updated", activeId: result.index.activeId, revision: result.board.revision });
      res.json({
        ok: true,
        index: result.index,
        board: canvasSnapshot(result.board),
        ...(body.action.type === "export" || body.action.type === "get" ? { exportBoard: result.board } : {}),
      });
    });

    const commit = async (
      res: express.Response,
      change: (board: Awaited<ReturnType<BoardStore["snapshot"]>>) => Awaited<ReturnType<BoardStore["snapshot"]>>,
    ) => {
      let board: Awaited<ReturnType<BoardStore["snapshot"]>>;
      try {
        const revisionHeader = res.req.header("If-Match-Revision");
        /*
         * The empty-write guard must not depend on an optional header.
         *
         * The guarded path only ran when `If-Match-Revision` was present, so a
         * client that omitted the header (every caller that does not track
         * revisions, including a stale canvas after a reload) could replace a
         * full board with zero items and erase it. Both paths now compute the
         * candidate first, refuse a suspicious clear, then persist.
         */
        if (revisionHeader === undefined) {
          board = await this.board.mutate((current) => {
            const candidate = change(current);
            if (isSuspiciousEmptyWrite(current, candidate)) {
              throw new EmptyWriteRefusedError();
            }
            return candidate;
          });
        } else {
          const expectedRevision = Number(revisionHeader);
          if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
            throw new BoardRevisionConflictError(-1, expectedRevision);
          }
          const current = await this.board.snapshot();
          if (current.revision !== expectedRevision) {
            throw new BoardRevisionConflictError(expectedRevision, current.revision);
          }
          const candidate = change(current);
          // A client bug must not look like a deliberate clear.
          if (isSuspiciousEmptyWrite(current, candidate)) {
            throw new EmptyWriteRefusedError();
          }
          board = await this.board.replaceIfRevision(candidate, expectedRevision);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof EmptyWriteRefusedError) {
          return res.status(409).json({ error: "Refusing to clear every object from the board; send an explicit delete instead" });
        }
        if (error instanceof BoardRevisionConflictError) return res.status(409).json({ error: message });
        if (message.toLowerCase().includes("timed out waiting")) return res.status(503).json({ error: message });
        if ((error as NodeJS.ErrnoException).code) {
          logger.error(`Board persistence failed: ${message}`);
          return res.status(500).json({ error: "Unable to persist board changes" });
        }
        return res.status(400).json({ error: message });
      }
      this.broadcast({ type: "board_updated", revision: board.revision });
      this.revisions?.remember(board);
      return res.json({ ok: true, board: canvasSnapshot(board) });
    };

    this.app.post("/api/board/items", async (req, res) => {
      const body = req.body as { item?: BoardItemInput; confirmedBy?: string };
      if (!body || typeof body !== "object") return res.status(400).json({ error: "JSON object is required" });
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.item) return res.status(400).json({ error: "item is required" });
      await commit(res, (current) => addBoardItem(current, { ...body.item!, author: "human" }));
    });

    this.app.patch("/api/board/items/:id", async (req, res) => {
      const body = req.body as { patch?: Partial<BoardItemInput>; confirmedBy?: string };
      if (!body || typeof body !== "object") return res.status(400).json({ error: "JSON object is required" });
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.patch) return res.status(400).json({ error: "patch is required" });
      await commit(res, (current) => updateBoardItem(current, req.params.id, body.patch!));
    });

    this.app.delete("/api/board/items/:id", async (req, res) => {
      const body = req.body as { confirmedBy?: string };
      if (!body || typeof body !== "object") return res.status(400).json({ error: "JSON object is required" });
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      await commit(res, (current) => removeBoardItem(current, req.params.id));
    });

    this.app.post("/api/board/batch", async (req, res) => {
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
      });
    });

    this.app.post("/api/board/replace", async (req, res) => {
      const body = req.body as { confirmedBy?: string; board?: unknown };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (body.board === undefined) return res.status(400).json({ error: "board is required" });
      await commit(res, (current) => replaceBoardContent(current, body.board));
    });

    this.app.post("/api/board/diagram", async (req, res) => {
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
        const generated = diagramToBoardItems(expanded!, "human");
        const candidate = touchBoard({
          ...current,
          title: expanded!.title ?? current.title,
          items: body.diagram!.replace ? generated : [...current.items, ...generated],
        });
        parseBoard(candidate);
        return candidate;
      });
    });

    this.app.get("/api/board/project", async (req, res) => {
      const options: ProjectScanOptions = {
        maxDepth: req.query.max_depth ? Number(req.query.max_depth) : undefined,
        maxFiles: req.query.max_files ? Number(req.query.max_files) : undefined,
        includeEvidence: req.query.evidence !== "0",
      };
      const snapshot = await scanProject(this.config.workspaceRoot, options);
      res.json(snapshot);
    });

    this.app.get("/api/board/project/text", async (_req, res) => {
      const snapshot = await scanProject(this.config.workspaceRoot);
      res.type("text/plain").send(projectSnapshotText(snapshot));
    });

    this.app.get("/", (_req, res) => this.serveBoard(res));
    this.app.use("/excalidraw", async (req, res, next) => {
      const assetRoot = await findExisting(assetCandidates(this.config));
      if (!assetRoot) return res.status(404).send("Excalidraw assets not found");
      const relative = req.path === "/" ? "index.html" : req.path.replace(/^\/+/, "");
      const target = path.resolve(assetRoot, relative);
      if (!target.startsWith(assetRoot)) return res.status(403).send("Forbidden");
      try {
        const data = await fs.readFile(target);
        const extension = path.extname(target).toLowerCase();
        const contentType = extension === ".js" || extension === ".mjs" ? "text/javascript; charset=utf-8"
          : extension === ".css" ? "text/css; charset=utf-8"
            : extension === ".woff2" ? "font/woff2"
              : extension === ".html" ? "text/html; charset=utf-8"
                : extension === ".json" ? "application/json; charset=utf-8"
                  : extension === ".svg" ? "image/svg+xml"
                    : extension === ".png" ? "image/png"
                      : "application/octet-stream";
        res.set("Cache-Control", "no-store, max-age=0");
        res.type(contentType);
        return res.send(data);
      } catch {
        return next();
      }
    });

    this.app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const parserError = (error as { type?: string }).type;
      if (parserError === "entity.parse.failed" || parserError === "entity.too.large") {
        return res.status(parserError === "entity.too.large" ? 413 : 400)
          .json({ error: "Invalid or oversized JSON request" });
      }
      logger.error(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(500).json({ error: "Internal server error" });
    });
  }

  private async serveBoard(res: express.Response): Promise<void> {
    res.set("Cache-Control", "no-store, max-age=0");
    const template = await readTemplate(this.config);
    if (!template) return void res.status(500).send("Excalidraw template not found");
    res.type("html").send(fillTemplate(template, {
      assetVersion: this.assetVersion,
      token: this.panelToken,
      embedded: false,
    }));
  }

  async getAppHtml(bundle?: string): Promise<string> {
    if (bundle !== undefined) this.appBundle = bundle;
    const template = await readTemplate(this.config);
    if (!template) throw new Error("Excalidraw template not found");
    return fillTemplate(template, {
      assetVersion: this.assetVersion,
      token: this.panelToken,
      embedded: true,
    });
  }

  async start(): Promise<void> {
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });
    this.wss.on("connection", (socket) => {
      logger.debug("Board WebSocket client connected");
      socket.on("close", () => logger.debug("Board WebSocket client disconnected"));
    });
    return new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        this.server!.removeListener("error", onError);
        if (error.code === "EADDRINUSE") {
          logger.error(`Port ${this.config.previewPort ?? "auto"} in use. Set PREVIEW_PORT to another port.`);
        }
        reject(error);
      };
      this.server!.once("error", onError);
      this.server!.listen(this.config.previewPort ?? 0, this.config.previewHost, () => {
        this.server!.removeListener("error", onError);
        const address = this.server!.address();
        const activePort = typeof address === "object" && address ? address.port : this.config.previewPort ?? 0;
        this.panelUrlValue = `http://${this.config.previewHost}:${activePort}/`;
        logger.info(`Board preview at ${this.panelUrlValue}`);
        resolve();
      });
    });
  }

  get panelUrl(): string | null {
    return this.panelUrlValue;
  }

  broadcast(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    this.wss?.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  }

  async stop(): Promise<void> {
    this.wss?.close();
    return new Promise((resolve) => this.server?.close(() => resolve()));
  }
}
