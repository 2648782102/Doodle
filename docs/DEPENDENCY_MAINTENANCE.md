# Dependency Maintenance

The `0.4.0` cleanup removed Mermaid CLI, Mermaid, sharp, open, nanoid, the VS Code extension, and all browser-rendering dependencies. The runtime dependency set is intentionally small: the MCP SDK, Express, WebSocket, and Zod. Development uses TypeScript, tsx, Vitest, and type packages.

## Verification order

1. Read the Dependabot diff and identify whether it changes runtime behavior, MCP protocol, or package size.
2. Run `npm install` to regenerate `package-lock.json`.
3. Run `npm run check`.
4. Start the MCP server and verify `listTools` returns exactly four tools.
5. Confirm that no dependency reintroduces browser launching, image rendering, or a second state model.

## Current audit note

`npm audit` may report two moderate advisories in Vitest 3's mock runner. Vitest 5 requires Node.js 22.12+, while this package supports Node.js 20; upgrading would break the supported runtime. Other transitive advisories are constrained with npm `overrides` without raising the Node.js floor. Review this note when the minimum Node.js version changes.

The npm package name is `doodle-mcp`; the bare `doodle` name on npm belongs to another project and is not used here.

## Decision rules

- Prefer no new runtime dependency for a small pure function.
- Do not accept a dependency that requires a browser, native image pipeline, or hosted service for the default board loop.
- Major runtime upgrades require an entry in `DECISIONS.md`, a changelog note, and MCP integration verification.
- Security fixes may be fast-tracked, but still require the full check command.
- Never commit credentials, generated `dist/`, or private `output/` state.

The historical `0.3.x` vulnerability snapshot described a much larger Mermaid/Puppeteer toolchain and is retained only as Git history; it is no longer a current dependency inventory.
