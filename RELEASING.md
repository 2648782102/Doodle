# Releasing

Releases are made from `master` by a maintainer. CI and the publish workflow verify the package; the publish workflow creates an idempotent GitHub Release with the versioned submission ZIP. npm publishing remains an explicit maintainer action.

## Pre-release checklist

1. `CHANGELOG.md` has an entry for every user-visible change.
2. `package.json` version follows `VERSIONING.md`.
3. `README.md`, `README.en.md`, `AGENTS.md`, `docs/GOAL_PLUGIN.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/FAQ.md`, `docs/SUBMISSION.md`, and `CONTRIBUTING.md` are current.
4. `npm run check` passes locally, including the versioned submission ZIP.
5. `npm run repo:plugin-check` passes and `npm pack --dry-run` includes `dist/index.js`, `dist/infra/templates/board.html`, `dist/infra/templates/board-app.js`, `scripts/doctor.mjs`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, and `TERMS.md`.
6. CI passes on Node 20, 22, and 24.
7. `plugins/doodle/.codex-plugin/plugin.json` and `docs/LAUNCH_KIT.md` match the package version, GitHub About text, and topics.

## Release steps

1. Merge the reviewed release changes into `master`.
2. Push the versioned `vX.Y.Z` tag from `master`.
3. The tag workflow in `.github/workflows/release.yml` runs the full check and package dry-run.
4. `.github/workflows/publish-release.yml` runs on `master` after a full `npm run check`, creates the GitHub Release from the matching `CHANGELOG.md` section when absent, and attaches the versioned submission ZIP. It leaves existing releases unchanged; `workflow_dispatch` can retry with an explicit tag.
5. Publish to npm only through an explicit maintainer action with the configured release environment. A bypass-2FA token can stage the package but `npm stage approve` still requires one OTP or web proof of presence; keep the `npx -y doodle-mcp` documentation honest until `npm view doodle-mcp@<version> version` resolves. Version `0.6.3` closed this gate through a maintainer security-key confirmation and a clean `npm exec --yes doodle-mcp` startup. The exact `0.7.0` tarball is staged and remains gated on the same form of maintainer confirmation; it must be verified separately after approval.
6. Verify that `npm run setup:codex -- --dry-run`, `npm view doodle-mcp@<version> version`, one `npx -y doodle-mcp` startup, `npm run doctor`, the release asset, and the changelog version all pass or match the published package.

## Rollback

npm does not allow replacing a published version. Fix forward with a patch release and document security-relevant incidents in `CHANGELOG.md` and `SECURITY.md`.

## Public plugin directory

The repository ZIP and HTTPS policy URLs prepare the package, but public local-MCP directory publication still requires an allowlisted submitting organization, verified developer identity, portal submission, policy attestations, clean desktop testing, and approval. See `docs/SUBMISSION.md`.
