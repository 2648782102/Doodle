import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const WELCOME_STORAGE_KEY = "doodle-welcome-dismissed";

describe("welcome card", () => {
  it("retires when a person draws through it, not only via its button", () => {
    const banner = read("src/infra/templates/client/banner.ts");
    const app = read("src/infra/templates/excalidraw-app.tsx");
    expect(banner, "the card has no reusable dismiss action").toMatch(/export function dismissWelcome\(\)/);
    expect(banner, "dismissing the card does not record that it was seen").toContain(WELCOME_STORAGE_KEY);
    expect(banner, "the card has no snapshot gate").toMatch(/function dismissWelcomeFor\(snapshot: \{ items: unknown\[\] \}\): void \{[\s\S]*?snapshot\.items\.length > 0\) dismissWelcome\(\)/);
    expect(app, "creating the first object does not retire the card").toMatch(/dismissWelcomeFor\(projected\);\s*\n\s*sync\.schedule/);
    expect(app, "an agent's first object does not retire the card").toMatch(/dismissWelcomeFor\(data\);/);
  });
});
