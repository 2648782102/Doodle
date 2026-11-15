/**
 * Time and identity generation.
 *
 * A single source for both keeps timestamps consistent across construction,
 * validation, and diagram generation, and makes them trivial to stub in tests.
 */

export function now(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
