import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    /*
     * `browser-contract` needs a Chromium download, so it is opt-in via
     * `npm run test:browser`. Excluding it here keeps `npm run check` and a
     * plain `npm test` working on a machine that has no browser binaries.
     */
    exclude: ["**/node_modules/**", "**/dist/**", "test/browser-contract.test.mjs"],
  },
});
