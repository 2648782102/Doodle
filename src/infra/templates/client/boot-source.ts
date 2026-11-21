/**
 * Which board a cold boot should paint, and what to do when the live one is
 * unreachable.
 *
 * Extracted from the entrypoint so the decision is testable without a DOM. It
 * is small but it is the whole resilience story in one place: the local copy is
 * what makes the page openable when the MCP session that served it has ended,
 * and the remote copy is what makes it *current* when that session is alive.
 *
 * The ordering rule is deliberately "paint local, then reconcile": a person
 * opening the board should never stare at an empty canvas while a request that
 * may never answer is in flight.
 */

import type { BoardSnapshot } from "./types.js";

export type BootPlan =
  /** Nothing cached; wait for the network and paint whatever it returns. */
  | { kind: "network-only" }
  /** Cached board is the first paint; a newer remote one may replace it. */
  | { kind: "cache-first"; cached: BoardSnapshot }
  /** No network and no cache: this is a genuine first load. */
  | { kind: "empty" };

export function planBoot(cached: BoardSnapshot | null): BootPlan {
  if (cached) return { kind: "cache-first", cached };
  return { kind: "network-only" };
}

export type BootOutcome =
  /** The remote board is newer and should replace the cached paint. */
  | { kind: "replace"; snapshot: BoardSnapshot }
  /** The cached paint is already current (or newer); leave it on screen. */
  | { kind: "keep-cached"; reason: "same-revision" | "remote-older" | "different-board" }
  /** The fetch failed but a cached board is on screen: degraded, not broken. */
  | { kind: "detached"; cached: BoardSnapshot }
  /** The fetch failed with nothing cached: a real error the caller must surface. */
  | { kind: "failed" };

/**
 * Reconcile a network result against what is already painted.
 *
 * A *different* board id is never adopted by the boot path: that would silently
 * swap the person's board for another one without their asking. Switching
 * boards is an explicit library action, and the boot only ever fills in the
 * board that was last active.
 */
export function reconcileBoot(cached: BoardSnapshot | null, remote: BoardSnapshot | null): BootOutcome {
  if (!remote) {
    return cached ? { kind: "detached", cached } : { kind: "failed" };
  }
  if (!cached) return { kind: "replace", snapshot: remote };
  if (remote.id !== cached.id) return { kind: "keep-cached", reason: "different-board" };
  if (remote.revision > cached.revision) return { kind: "replace", snapshot: remote };
  if (remote.revision === cached.revision) return { kind: "keep-cached", reason: "same-revision" };
  return { kind: "keep-cached", reason: "remote-older" };
}

/**
 * Register the offline shell, on the standalone page only.
 *
 * An embedded canvas lives inside the host's document, where a service worker
 * of ours has no business controlling fetches — the host already delivers the
 * assets. On the standalone page the worker is what keeps the URL openable once
 * the MCP session that served it has ended.
 */
export function registerOfflineShell(embedded: boolean, scope: Window = window): void {
  if (embedded || !("serviceWorker" in navigator)) return;
  scope.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Unsupported or blocked (private mode): the IndexedDB copy still works.
    });
  });
}

/**
 * Drive a cold boot: paint local, ask the board, reconcile.
 *
 * The decisions live in `planBoot` / `reconcileBoot` above; this is the loop
 * that applies them, kept beside the rules so the entrypoint is a call site
 * rather than a second copy of the ordering. `onWelcome` fires only on a first
 * load — a restored board is not the person's first visit, even if the process
 * that served it is gone.
 */
export interface BootDeps {
  embedded: boolean;
  restoreCached(): Promise<BoardSnapshot | null>;
  loadRemote(): Promise<BoardSnapshot | null>;
  paint(snapshot: BoardSnapshot): void;
  onLoaded(): void;
  onWelcome(snapshot: BoardSnapshot): void;
  onDetached(): void;
}

export async function runBoot(deps: BootDeps): Promise<"painted" | "cached" | "detached"> {
  const plan = planBoot(await deps.restoreCached().catch(() => null));
  const cached = plan.kind === "cache-first" ? plan.cached : null;
  if (plan.kind === "cache-first") {
    deps.paint(plan.cached);
    deps.onLoaded();
    if (!deps.embedded) deps.onWelcome(plan.cached);
  }

  let remote: BoardSnapshot | null = null;
  try {
    remote = await deps.loadRemote();
  } catch (error) {
    if (!cached) throw error;
    remote = null;
  }

  const outcome = reconcileBoot(cached, remote);
  switch (outcome.kind) {
    case "replace":
      deps.paint(outcome.snapshot);
      deps.onLoaded();
      if (!deps.embedded && !cached) deps.onWelcome(outcome.snapshot);
      return "painted";
    case "keep-cached":
      return "cached";
    case "detached":
      deps.onDetached();
      return "detached";
    case "failed":
      throw new Error("Board is unavailable");
  }
}
