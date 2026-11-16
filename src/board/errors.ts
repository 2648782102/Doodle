export class BoardRevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Board revision conflict: expected ${expected}, found ${actual}. Reload the board and retry.`);
    this.name = "BoardRevisionConflictError";
  }
}

/**
 * A write would empty a board that still had objects.
 *
 * This is almost always a client state bug (a canvas that has not mounted yet,
 * a stale scene, a race after reload) rather than intent, so it is refused with
 * 409 instead of persisting. Deliberate clearing stays possible through an
 * explicit per-item delete.
 */
export class EmptyWriteRefusedError extends Error {
  constructor() {
    super("Refusing to clear every object from the board; send an explicit delete instead");
    this.name = "EmptyWriteRefusedError";
  }
}

/**
 * A validation error the caller can repair without reading source code.
 *
 * `path` points at the offending field, `expected` states the contract, and
 * `fix` is a concrete next action. Tools serialise these into `ERROR_JSON` so
 * the model gets a machine-readable correction, not just prose.
 */
export class BoardValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly path: string,
    readonly expected: string,
    readonly fix: string,
  ) {
    super(message);
    this.name = "BoardValidationError";
  }
}

export function validationErrorFrom(error: unknown): BoardValidationError | undefined {
  return error instanceof BoardValidationError ? error : undefined;
}
