import { defineConfig } from "vitest/config";

/**
 * Browser-only config: includes just the canvas contract suite, which the
 * default `vitest.config.ts` excludes so a machine without Chromium can still
 * run `npm run check`.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 60_000,
    include: ["test/browser-contract.test.mjs"],
  },
});
