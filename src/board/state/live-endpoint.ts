/**
 * Which process is currently serving the human canvas for this board directory.
 *
 * The board's URL used to be private to the process that opened the port. That
 * is why every session started its own server (eight were running during one
 * afternoon of work) and why the panel link died the moment a session ended
 * even though `board.json` was untouched.
 *
 * It does **not** make `state-watch.ts` redundant. A second process that adopts
 * a sibling's endpoint has no WebSocket server of its own, so its `broadcast()`
 * reaches nobody — the watcher is what lets the *owning* process learn about a
 * write made through MCP in the adopting one. Removing it would leave the open
 * canvas showing a board that no longer matches the file.
 *
 * The file is the board directory's own answer to "where is the canvas". It is
 * written after `listen` succeeds, read before deciding to listen, and removed
 * on shutdown. `pid` is what makes a crashed process recoverable: a record
 * whose pid is gone is stale, exactly like the mutex's lock file, and gets
 * replaced rather than trusted.
 *
 * It is deliberately *not* another source of truth for the board: it names an
 * endpoint, nothing else. Losing it costs one extra `listen`, never data.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../../infra/logger.js";
import { renameWithRetry } from "../../infra/atomic-write.js";

export interface LiveEndpoint {
  pid: number;
  port: number;
  host: string;
  /** Identifies the board this endpoint serves, so a reused port cannot lie. */
  boardId: string | null;
  startedAt: string;
  version: string;
}

export const LIVE_ENDPOINT_FILE = "live.json";

export function liveEndpointPath(outputDir: string): string {
  return path.join(outputDir, ".doodle", LIVE_ENDPOINT_FILE);
}

function isValidEndpoint(value: unknown): value is LiveEndpoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LiveEndpoint>;
  return typeof candidate.pid === "number"
    && Number.isInteger(candidate.pid)
    && candidate.pid > 0
    && typeof candidate.port === "number"
    && Number.isInteger(candidate.port)
    && candidate.port > 0
    && typeof candidate.host === "string";
}

/**
 * Whether a pid is still running.
 *
 * `process.kill(pid, 0)` sends no signal and only reports whether the process
 * exists. `EPERM` means it exists but belongs to someone else, which for our
 * purposes is still "alive" — we must not steal its endpoint.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Read the record, or null when there is none or it is unreadable. */
export async function readLiveEndpoint(outputDir: string): Promise<LiveEndpoint | null> {
  try {
    const raw = await fs.readFile(liveEndpointPath(outputDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isValidEndpoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write the record atomically; a half-written file must never be read as an endpoint. */
export async function writeLiveEndpoint(outputDir: string, endpoint: LiveEndpoint): Promise<void> {
  const target = liveEndpointPath(outputDir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(endpoint, null, 2)}\n`, "utf8");
  await renameWithRetry(temporary, target);
}

/**
 * Remove the record, but only if it is still ours.
 *
 * Two sessions can race: A is shutting down while B has already taken over the
 * endpoint. Deleting unconditionally would erase B's record and leave the board
 * undiscoverable until B exits.
 *
 * "Ours" is pid *or liveness*, not pid equality alone. A record left by a
 * crashed process has a pid nobody holds any more, so the next process must be
 * able to reclaim that path; requiring an exact pid match would leak the stale
 * record forever. A record whose owner is still running is somebody else's.
 */
export async function clearLiveEndpoint(outputDir: string, pid = process.pid): Promise<void> {
  const current = await readLiveEndpoint(outputDir);
  if (current && current.pid !== pid && isProcessAlive(current.pid)) return;
  await fs.rm(liveEndpointPath(outputDir), { force: true }).catch((error: unknown) => {
    logger.warn(`Could not remove live endpoint record: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/**
 * A record worth reusing: the process lives, and it is not us.
 *
 * Never returns our own pid — a second server in the same process is a mistake,
 * not a reusable endpoint.
 */
export function isReusable(endpoint: LiveEndpoint | null, currentPid = process.pid): endpoint is LiveEndpoint {
  if (!endpoint) return false;
  if (endpoint.pid === currentPid) return false;
  return isProcessAlive(endpoint.pid);
}
