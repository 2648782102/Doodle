# Public Plugin Submission

This document separates what the repository can prepare from what only an approved OpenAI submitting organization can complete.

## Prepared in this repository

- A desktop-only compatibility plugin at `plugins/doodle/.codex-plugin/plugin.json` with `.mcp.json`, one skill, and local assets.
- A reproducible `npm run build:plugin` output in ignored `.doodle-plugin/doodle/`.
- A review-ready submission ZIP from `npm run build:submission`; the output is ignored and is not committed.
- Published HTTPS listing URLs for website, support, privacy, and terms:
  - `https://github.com/2648782102/Doodle`
  - `https://github.com/2648782102/Doodle/blob/master/SUPPORT.md`
  - `https://github.com/2648782102/Doodle/blob/master/PRIVACY.md`
  - `https://github.com/2648782102/Doodle/blob/master/TERMS.md`
- Explicit `readOnlyHint`, `destructiveHint`, and `openWorldHint` values on every MCP tool.
- An embedded MCP App that uses host capability detection for optional final-state model context updates and one user-initiated short notification, without adding a Doodle chat service or a fifth MCP tool.
- `npm run check`, including repository and plugin guards, MCP integration tests, and package dry-run.
- A clean isolated `CODEX_HOME` marketplace/installation smoke test and a bundled stdio MCP SDK smoke test.
- An idempotent publish workflow that attaches `doodle-<version>.zip` to the matching GitHub Release after `npm run check`.

## Required outside this repository

- Confirmation from an OpenAI representative that the submitting organization is allowlisted for local MCP submissions.
- A verified individual or business identity in the OpenAI Platform organization settings.
- Creation of the plugin draft in the plugin submission portal, selection of **Skills only**, ZIP upload, resolution of automated findings, required policy attestations, and submission for review.
- Reviewer test material, release notes, and any reviewer instructions entered through the secure dashboard form.
- A clean ChatGPT or Codex desktop installation test of the approved ZIP, including the main board workflows and optional MCP App rendering on supported surfaces.
- Approval and publishing from the portal after review.

## Remaining eligibility note

Public local-MCP directory publication is limited to approved partners. Preparing the ZIP and listing materials does not grant submission access, directory approval, or public availability. Do not describe the repository marketplace as public directory publication.
