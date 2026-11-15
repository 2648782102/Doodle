/**
 * Board library public surface.
 *
 * Split so the index format can be validated and reasoned about without any
 * filesystem access, which is what makes the persistence layer testable:
 *
 *   library/schema.ts  index shape, entry projection, strict validation
 *   library/store.ts   atomic reads and writes under a filesystem mutex
 */

export {
  entryFromBoard,
  makeIndex,
  newBoard,
  normalizeBoardSnapshot,
  normalizeName,
  parseIndex,
  safeId,
  MAX_BOARD_NAME,
  MAX_LIBRARY_BOARDS,
} from "./library/schema.js";

export type {
  BoardLibraryAction,
  BoardLibraryDetail,
  BoardLibraryEntry,
  BoardLibraryIndex,
  BoardLibraryMutation,
} from "./library/schema.js";

export { BoardLibrary, boardLibraryIndexText } from "./library/store.js";
