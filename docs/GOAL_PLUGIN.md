# Goal: Doodle as a Codex Plugin

This document defines the product boundary and completion criteria for packaging Doodle as a desktop-only Codex plugin. It is a maintained design record, not an active automation instruction.

## Objective

Keep **one simple shared infinite board** and distribute it through an installable local Codex plugin with one-command setup. The plugin wraps the same four-tool MCP stdio server used by direct MCP configurations. MCP Apps rendering remains an optional host enhancement, not a second product or a requirement for text-only hosts.

```text
one-command install → new session → first prompt → plugin manifest → bundled stdio MCP server → four board tools → one local canvas
```

## Product boundary

Doodle is a local-first board. A person and an AI place notes, text, rectangles, ellipses, and directed arrows on one canvas. The AI normally uses MCP tools inside an agent; a person uses the standalone local canvas or the optional embedded MCP App. Conversation stays in the host chat. Project structure is only one subject that `scan_project` can inspect and `draw_board` can visualize.

The plugin is a distribution layer around this product. It must not turn Doodle into a hosted service, general chat product, approval workflow, project dashboard, code-change authority, or a different MCP server with a different tool set.

## In scope

- Add one Codex-compatible `.codex-plugin/plugin.json` and `.mcp.json` layout with a `${PLUGIN_ROOT}` server entrypoint, a concise agent skill, presentation metadata, and simple local-only assets.
- Add a repository-scoped marketplace at `.agents/plugins/marketplace.json` that points at the generated `.doodle-plugin/doodle` package.
- Add `npm run setup:codex` as the recommended install path. It installs dependencies when needed, builds the plugin, adds the local marketplace, installs the plugin, and prints one first-use prompt. Official OpenAI documentation treats local marketplaces as separate from the public directory and recommends a new session after installation.
- Build a self-contained `server/index.mjs` with the same four tools, the shared `board.html`, the MCP App `board-app.js`, and an injected package version.
- Keep the direct npm CLI and direct MCP host examples as supported development paths.
- Connect MCP stdio before the optional local HTTP preview; a preview failure must not disable MCP.
- Use a free loopback port when `PREVIEW_PORT` is unset and report the active `PANEL_URL` through `get_board`, without opening a browser.
- Prefer explicit `OUTPUT_DIR`, then plugin data, then workspace-local `.doodle-data` for board state. Resolve bounded project scanning against the launched workspace without exposing plugin-internal paths.
- Preserve version 1 board state, the four-tool contract, drawing guide, HTTP authorization, stderr-only logging, tokenized human edits, revision-safe writes, and read-only project-scan safety.
- Synchronize the agent handbook, READMEs, product direction, architecture, decisions, changelog, release notes, examples, tests, CI, and offline repository/plugin guards.
- Prepare review-facing publication materials: explicit tool annotations, a published privacy policy, support and terms URLs, a versioned submission ZIP, and a maintained record of OpenAI-side eligibility gates.
- Automate idempotent GitHub Release publication and submission-ZIP attachment after the full check, using the built-in `GITHUB_TOKEN`.

## Out of scope

- Public universal plugin directory submission, partner allowlisting, organization verification, portal review actions, or publication approval. Repository-side submission materials are in scope; account eligibility is not.
- Hosted accounts, multi-user SaaS, OAuth, public HTTPS endpoints, remote state, telemetry, or cloud storage.
- A new board protocol, a fifth MCP tool, a second session/graph/proposal model, or a project-write approval protocol.
- Browser, IDE, editor, or panel auto-opening from normal MCP tools.
- npm publish, GitHub repository metadata changes, external promotion, or external mass messaging.
- Lifecycle hooks, duplicate portable manifests, or plugin-created project files.

## Authority

- Read and edit files in the repository.
- Run local install/build/test/doctor/package and Codex plugin CLI validation commands.
- Add source, tests, docs, generated build scripts, plugin manifests, small SVG assets, and repository guards.
- Use local Git commits and pushes only when explicitly requested by the user in the active turn.
- Use an isolated `CODEX_HOME` for plugin installation smoke tests; do not modify the user's active Codex configuration without explicit need.

## Red lines

- No force push, history rewrite, tag movement, reset, or deletion of user data.
- No committed secrets, `.env` files, generated `dist/`, generated plugin runtime bundles, local `output/` board state, or local `.codex/` config.
- No project-file write triggered by a board drawing, note, or scan.
- No normal MCP tool that opens a browser, IDE, editor, or external app.
- No stdout output outside MCP JSON-RPC; logs stay on stderr.
- No hosted endpoint, public tunnel, remote MCP server, or change to the local-only `127.0.0.1` default.
- No automatic restart, kill, or destructive modification of the Codex/ChatGPT desktop app.

## Acceptance

1. `docs/GOAL_PLUGIN.md` remains accurate at completion.
2. A fresh checkout installs with one command, builds the normal npm CLI and the plugin package without hand-written absolute paths, and uses zero-configuration direct MCP snippets. The 30-second guide presents the plugin and direct-MCP paths side by side.
3. Direct MCP startup and plugin MCP startup expose exactly `get_board`, `show_board`, `draw_board`, and `scan_project`.
4. The marketplace entry can be discovered by `codex plugin list` or an equivalent local CLI check.
5. `get_board` returns progressive guidance, `BOARD_JSON`, and the active loopback `PANEL_URL`; it does not open a browser.
6. The plugin uses isolated writable board state and a free loopback port by default; explicit `OUTPUT_DIR` and `PREVIEW_PORT` continue to override defaults.
7. `show_board` remains the explicit render tool, and successful `draw_board` results also advertise the optional MCP App so compatible hosts show completed AI drawings; all tools remain usable in text-only hosts.
8. `scan_project` stays bounded, read-only, workspace-relative, and secret-conservative.
9. `npm run check` passes, including lint, build, tests, example syntax, offline guards, plugin guard, doctor, and package dry-run.
10. CI runs the same plugin guard and a dry-run setup guard, builds the versioned submission ZIP, and the publish workflow creates a Release only when the current version is missing; the guard rejects conflicting portable manifests, missing policy URLs, missing tool annotations, and uncommitted generated artifacts.
11. `git status` contains only intended tracked changes; no generated runtime, submission ZIP, or private board state is staged.
12. Final audit lists changed files, validation evidence, known limitations, public-directory eligibility gates, and any manual desktop-app reload required for the current session.

## Evidence

- `npm run check` output.
- Direct MCP SDK startup output with four tools and a successful `get_board`.
- Plugin bundle MCP SDK startup output with four tools, `BOARD_JSON`, a loopback `PANEL_URL`, and a 200 human board response.
- `npm run setup:codex -- --dry-run`, `codex plugin marketplace add . --json`, `codex plugin list --marketplace doodle --available --json`, and an isolated `CODEX_HOME` installation smoke test.
- `git status --short --branch`, exact diff inspection, and `npm pack --dry-run` contents.
- Annotated `listTools` output from both runtime paths, a built submission ZIP, and `docs/SUBMISSION.md`.
- A final note on whether reloading Codex/ChatGPT is needed for an already-running session.

## Stopping condition

Stop when all acceptance criteria pass, or when a blocking condition cannot be resolved without user input or an external account action. Do not declare partial work complete.
