import fs from "node:fs/promises";
import path from "node:path";

const LOCK_TIMEOUT_MS = 15000;
const LOCK_STALE_MS = 10000;
const LOCK_RETRY_MS = 20;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export class AsyncMutex {
  private readonly lockFile: string;
  private readonly localTail = new LocalTail();

  constructor(filePath: string) {
    this.lockFile = `${filePath}.lock`;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    return this.localTail.run(async () => {
      const release = await this.acquire();
      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  private async acquire(): Promise<() => Promise<void>> {
    const startedAt = Date.now();
    await fs.mkdir(path.dirname(this.lockFile), { recursive: true });
    for (;;) {
      try {
        const handle = await fs.open(this.lockFile, "wx");
        try {
          await handle.writeFile(`${process.pid}\n`, "utf8");
        } finally {
          await handle.close();
        }
        return async () => {
          try {
            await fs.unlink(this.lockFile);
          } catch (error) {
            if (!isNodeError(error) || error.code !== "ENOENT") throw error;
          }
        };
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        if (await this.removeStaleLock()) continue;
        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for board lock: ${this.lockFile}`);
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  }

  private async removeStaleLock(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.lockFile);
      if (Date.now() - stats.mtimeMs < LOCK_STALE_MS) return false;
      await fs.unlink(this.lockFile);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return true;
      throw error;
    }
  }
}

class LocalTail {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
