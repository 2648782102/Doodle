import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { AppConfig } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import {
  addBoardItem,
  addBoardNote,
  removeBoardItem,
  updateBoardItem,
  type BoardItemInput,
} from "./types.js";
import type { BoardStore } from "./store.js";
import { projectSnapshotText, scanProject, type ProjectScanOptions } from "./project-scan.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const templateCandidates = [
  path.resolve(sourceDir, "../../src/infra/templates/board.html"),
  path.resolve(sourceDir, "../templates/board.html"),
  path.resolve(sourceDir, "../../dist/infra/templates/board.html"),
];

export class BoardHttpServer {
  private app = express();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly panelToken = crypto.randomBytes(24).toString("hex");

  constructor(
    private board: BoardStore,
    private config: AppConfig,
  ) {
    this.app.use(express.json());
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
      res.json(await this.board.snapshot());
    });

    const commit = async (
      res: express.Response,
      change: (board: Awaited<ReturnType<BoardStore["snapshot"]>>) => Awaited<ReturnType<BoardStore["snapshot"]>>,
    ) => {
      let board: Awaited<ReturnType<BoardStore["snapshot"]>>;
      try {
        board = await this.board.mutate(change);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
      this.broadcast({ type: "board_updated", revision: board.revision });
      return res.json({ ok: true, board });
    };

    this.app.post("/api/board/items", async (req, res) => {
      const body = req.body as { item?: BoardItemInput; confirmedBy?: string };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.item) return res.status(400).json({ error: "item is required" });
      await commit(res, (current) => addBoardItem(current, { ...body.item!, author: "human" }));
    });

    this.app.patch("/api/board/items/:id", async (req, res) => {
      const body = req.body as { patch?: Partial<BoardItemInput>; confirmedBy?: string };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (!body.patch) return res.status(400).json({ error: "patch is required" });
      await commit(res, (current) => updateBoardItem(current, req.params.id, body.patch!));
    });

    this.app.delete("/api/board/items/:id", async (req, res) => {
      const body = req.body as { confirmedBy?: string };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      await commit(res, (current) => removeBoardItem(current, req.params.id));
    });

    this.app.post("/api/board/notes", async (req, res) => {
      const body = req.body as { body?: string; itemId?: string; confirmedBy?: string };
      if (body.confirmedBy !== "human") return res.status(403).json({ error: "Human confirmation is required" });
      if (typeof body.body !== "string") return res.status(400).json({ error: "body is required" });
      await commit(res, (current) => addBoardNote(current, {
        body: body.body!,
        author: "human",
        itemId: body.itemId,
      }));
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
  }

  private async serveBoard(res: express.Response): Promise<void> {
    res.set("Cache-Control", "no-store, max-age=0");
    for (const candidate of templateCandidates) {
      try {
        const html = (await fs.readFile(candidate, "utf8"))
          .replace("__DOODLE_PANEL_TOKEN__", this.panelToken)
          .replace("__AI_DRAW_PANEL_TOKEN__", this.panelToken);
        res.type("html").send(html);
        return;
      } catch {}
    }
    res.status(500).send("Board template not found");
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
          logger.error(`Port ${this.config.previewPort} in use. Set PREVIEW_PORT to another port.`);
        }
        reject(error);
      };
      this.server!.once("error", onError);
      this.server!.listen(this.config.previewPort, this.config.previewHost, () => {
        this.server!.removeListener("error", onError);
        logger.info(`Board preview at http://${this.config.previewHost}:${this.config.previewPort}/`);
        resolve();
      });
    });
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
