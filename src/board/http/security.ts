/**
 * Local-only boundary checks for the HTTP and WebSocket preview server.
 *
 * The standalone preview serves `panelToken` on `GET /` and read-only project
 * excerpts on `GET /api/board/project`, so a remote page reaching the loopback
 * port through DNS rebinding or a cross-site WebSocket must be rejected at the
 * edge before any route runs.
 */

import path from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function hostWithoutPort(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const closing = trimmed.indexOf("]");
    return closing >= 0 ? trimmed.slice(0, closing + 1) : trimmed;
  }
  const colon = trimmed.indexOf(":");
  return colon >= 0 ? trimmed.slice(0, colon) : trimmed;
}

export function isAllowedHost(hostHeader: string | undefined, previewHost: string): boolean {
  if (!hostHeader) return true;
  const host = hostWithoutPort(hostHeader);
  return LOOPBACK_HOSTS.has(host) || host === previewHost.trim().toLowerCase();
}

export function isAllowedOrigin(originHeader: string | undefined, previewHost: string): boolean {
  if (!originHeader) return true;
  try {
    const parsed = new URL(originHeader);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isAllowedHost(parsed.hostname, previewHost);
  } catch {
    return false;
  }
}

/** True only when `target` is inside `assetRoot` (or equals it), never a sibling sharing its prefix. */
export function isPathWithinRoot(assetRoot: string, target: string): boolean {
  const resolvedRoot = path.resolve(assetRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function assetContentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function validationErrorBody(error: {
  message: string;
  code: string;
  path: string;
  expected: string;
  fix: string;
}): Record<string, string> {
  return {
    error: error.message,
    code: error.code,
    path: error.path,
    expected: error.expected,
    fix: error.fix,
  };
}
