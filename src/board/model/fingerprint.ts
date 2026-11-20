/**
 * Stable, key-order-independent fingerprints for change detection.
 *
 * Every writer builds its copy of a board object in its own key order: the
 * stored item comes back from JSON, `parseBoard` rebuilds it, a patch spreads
 * over an existing item, and the canvas projects a fresh one. Comparing those
 * with `JSON.stringify` measured insertion order as much as values, so objects
 * holding identical data read as different.
 *
 * That was not cosmetic. A pan changes no board object, yet the projection's
 * key order differed from the stored one, so every gesture looked like an edit:
 * the canvas saved, the store rewrote the whole board, and the revision moved.
 * Measuring values is what the callers actually mean.
 *
 * This lives in `model/` because the mutation path needs it and `model/` may not
 * import from transport or diff helpers. It is for change detection only; no
 * output is ever produced with it.
 */

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

/** Two board items that differ only in `updatedAt` are the same object. */
export function stableItemFingerprint(item: unknown): string {
  const record = item as Record<string, unknown>;
  const { updatedAt: _updatedAt, ...rest } = record ?? {};
  return stableStringify(rest);
}
