# Releasing

Releases are made from `master` by a maintainer. CI verifies; it does not publish to npm or create a Release automatically.

## Pre-release checklist

1. `CHANGELOG.md` has an entry for every user-visible change.
2. `package.json` version follows `VERSIONING.md`.
3. `README.md`, `README.en.md`, `AGENTS.md`, `docs/GOAL_PLUGIN.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/FAQ.md`, `docs/SUBMISSION.md`, and `CONTRIBUTING.md` are current.
4. `npm run check` passes locally, including the versioned submission ZIP.
5. `npm run repo:plugin-check` passes and `npm pack --dry-run` includes `dist/index.js`, `dist/infra/templates/board.html`, `dist/infra/templates/board-app.js`, `scripts/doctor.mjs`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, and `TERMS.md`.
6. CI passes on Node 20, 22, and 24.
7. `plugins/doodle/.codex-plugin/plugin.json` and `docs/LAUNCH_KIT.md` match the package version, GitHub About text, and topics.

## Release steps

1. Merge the reviewed branch into `master`.
2. Push the versioned `vX.Y.Z` tag from `master`.
3. The tag workflow in `.github/workflows/release.yml` runs the full check and package dry-run.
4. After verification, create a GitHub Release from the matching `CHANGELOG.md` section and attach the generated submission ZIP when preparing a public plugin review. Check for an existing release on the tag first; do not recreate or edit published releases.
5. Publish to npm only through an explicit maintainer action with the configured release environment.
6. Verify that `npx doodle-mcp` starts, `npm run doctor` passes, and the changelog version matches the published package.

## Rollback

npm does not allow replacing a published version. Fix forward with a patch release and document security-relevant incidents in `CHANGELOG.md` and `SECURITY.md`.

## Public plugin directory

The repository ZIP and HTTPS policy URLs prepare the package, but public local-MCP directory publication still requires an allowlisted submitting organization, verified developer identity, portal submission, policy attestations, clean desktop testing, and approval. See `docs/SUBMISSION.md`.
