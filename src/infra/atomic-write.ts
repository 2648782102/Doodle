import fs from "node:fs/promises";

/*
 * Windows refuses a rename onto an existing file when another handle holds it
 * for a moment: an antivirus scan of the file we just wrote, a concurrent
 * reader, a search indexer. It surfaces as EPERM / EACCES / EBUSY and clears on
 * its own within milliseconds, so a write that is otherwise correct fails for
 * no reason the caller can act on.
 *
 * Only the final rename is retried. The temporary file is uniquely named, so
 * nothing contends for it, and the bytes are already on disk by then.
 */
const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);

export async function renameWithRetry(from: string, to: string, attempts = 4): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      const retryable = typeof code === "string" && TRANSIENT_RENAME_ERRORS.has(code);
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}
