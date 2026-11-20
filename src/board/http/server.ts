import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { AppConfig } from "../../infra/config.js";
import { logger } from "../../infra/logger.js";
import { SERVER_VERSION } from "../../infra/version.js";
import type { SimpleBoard } from "../types.js";

import { BoardLibrary } from "../library.js";
import type { BoardRevisionCache } from "../state/revision-cache.js";
import type { BoardStore } from "../state/store.js";
import { watchBoardState, type StateWatch } from "../state/state-watch.js";
import { clearLiveEndpoint, isReusable, readLiveEndpoint, writeLiveEndpoint } from "../state/live-endpoint.js";


import { isAllowedHost, isAllowedOrigin } from "./security.js";


import { fillTemplate, readTemplate } from "./templates.js";
import { registerBoardRoutes } from "./routes.js";



export class BoardHttpServer {
  private app = express();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  readonly panelToken = crypto.randomBytes(24).toString("hex");
  private readonly assetVersion = crypto.randomBytes(8).toString("hex");
  private appBundle = "";
  private panelUrlValue: string | null = null;
  /** True when this process reused another process's canvas instead of opening one. */
  private adopted = false;
  private readonly library: BoardLibrary;
  /** Highest revision this process has announced, so an external write is not announced twice. */
  private lastBroadcastRevision = -1;
  private stateWatch: StateWatch | null = null;

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
    registerBoardRoutes({
      app: this.app,
      board: this.board,
      config: this.config,
      library: this.library,
      revisions: this.revisions,
      panelToken: this.panelToken,
      broadcast: (message) => this.broadcast(message),
      serveBoard: (res) => this.serveBoard(res),
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
    /*
     * One board directory, one canvas server.
     *
     * Every MCP session used to open its own port. That is what made the panel
     * link unstable (a new random port each session), left stale servers behind,
     * and forced `state-watch` to re-broadcast writes across processes. If a
     * live record names a reachable sibling, adopt its address instead of
     * listening again — the board is the same file either way.
     */
    const existing = await readLiveEndpoint(this.config.outputDir);
    if (isReusable(existing) && existing.boardId === (await this.board.snapshot()).id) {
      /*
       * Adopt the sibling's address, and say plainly that this process cannot
       * mint a token for it.
       *
       * A token is per-process and is the write credential for the page that
       * process serves; this process cannot know it. Rather than pretend, the
       * adopted state reports no token: the page at that URL was already handed
       * the owner's token, so it keeps working, and this process only needs the
       * address for `PANEL_URL`. Any write it makes goes through MCP or the
       * store, never through that page's token.
       */
      this.panelUrlValue = `http://${existing.host}:${existing.port}/`;
      this.adopted = true;
      logger.info(`Board preview reused at ${this.panelUrlValue} (pid ${existing.pid})`);
      return;
    }
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({
      server: this.server,
      path: "/ws",
      verifyClient: ({ req }: { req: http.IncomingMessage }) =>
        isAllowedHost(req.headers.host, this.config.previewHost)
        && isAllowedOrigin(req.headers.origin, this.config.previewHost),
    });
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
      this.server!.listen(this.config.previewPort ?? 0, this.config.previewHost, async () => {
        this.server!.removeListener("error", onError);
        const address = this.server!.address();
        const activePort = typeof address === "object" && address ? address.port : this.config.previewPort ?? 0;
        this.panelUrlValue = `http://${this.config.previewHost}:${activePort}/`;
        logger.info(`Board preview at ${this.panelUrlValue}`);
        void writeLiveEndpoint(this.config.outputDir, {
          pid: process.pid,
          port: activePort,
          host: this.config.previewHost,
          boardId: (await this.board.snapshot().catch(() => null))?.id ?? null,
          startedAt: new Date().toISOString(),
          version: SERVER_VERSION,
        }).catch((error: unknown) => {
          logger.warn(`Could not record the panel endpoint: ${error instanceof Error ? error.message : String(error)}`);
        });
        /*
         * Another process can own the same board file — `npm run preview:board`
         * beside an MCP host is documented — and its writes never reached these
         * sockets. Skip revisions this process wrote itself: they were already
         * announced by `broadcast`, and re-announcing them would cost every open
         * canvas an extra fetch per edit.
         */
        this.stateWatch = watchBoardState(this.board.statePath, (revision) => {
          if (revision <= this.lastBroadcastRevision) return;
          logger.debug(`Board state changed outside this process (revision ${revision})`);
          this.broadcast({ type: "board_updated", revision });
        });
        resolve();
      });
    });
  }

  get panelUrl(): string | null {
    return this.panelUrlValue;
  }

  broadcast(message: Record<string, unknown>): void {
    const revision = message.type === "board_updated" && typeof message.revision === "number"
      ? message.revision : null;
    if (revision !== null) this.lastBroadcastRevision = Math.max(this.lastBroadcastRevision, revision);
    const data = JSON.stringify(message);
    this.wss?.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  }

  async stop(): Promise<void> {
    /*
     * Only the process that registered the endpoint may remove it.
     *
     * `clearLiveEndpoint` re-reads the record and compares pids, so a process
     * that merely adopted a sibling's address cannot erase the record belonging
     * to the sibling that is still serving.
     */
    if (!this.adopted) await clearLiveEndpoint(this.config.outputDir);
    this.stateWatch?.close();
    this.stateWatch = null;
    this.wss?.close();
    return new Promise((resolve) => this.server?.close(() => resolve()));
  }
}
