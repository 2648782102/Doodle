export class BoardRevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Board revision conflict: expected ${expected}, found ${actual}. Reload the board and retry.`);
    this.name = "BoardRevisionConflictError";
  }
}
