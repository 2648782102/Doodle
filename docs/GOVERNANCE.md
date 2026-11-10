# Governance

Doodle is a small MIT-licensed open-source project. The repository is the canonical source of product copy, architecture decisions, release notes, and automation.

## Maintainer checklist

- Keep the default product small; reject changes that make project structure, dashboards, or approval workflows the product again.
- Keep exactly four MCP tools unless a product decision in `DECISIONS.md` says otherwise; keep MCP App rendering optional for text-only hosts and keep the plugin as a distribution layer around the same server.
- Keep the board state versioned, bounded, and independent of project files.
- Keep normal MCP calls free of browser, IDE, and project-write side effects.
- Keep dependencies minimal and verify with `npm run check`.
- Keep the README, English quickstart, `AGENTS.md`, architecture, plugin goal, tests, examples, CI, and offline guards synchronized.
- Preserve tool-only workflows for MCP hosts that do not render Apps.
- Never commit `dist/`, `.doodle-plugin/`, `.doodle-data/`, `output/.doodle/`, `.env`, credentials, or private board state.
- Keep `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/FAQ.md`, `docs/SUBMISSION.md`, tool annotations, and the versioned submission ZIP synchronized with plugin metadata.

## Public surfaces

- GitHub repository: `https://github.com/2648782102/Doodle`
- Issues: bug reports, feature requests, and private security advisories.
- Releases: version tags and changelog sections; already published tags and releases are immutable.
- Plugin review: a versioned submission ZIP may be attached to a release, but public directory eligibility stays an external approved-partner process.
- npm: published only through an explicit maintainer action, never by CI automatically.

## Metadata drift

`docs/LAUNCH_KIT.md` contains the canonical short description. If GitHub About/topics differ, a maintainer may update them manually. CI does not require an administration-capable token for verification.

## Historical records

`docs/archive/adr-legacy/` keeps the `0.3.x` workbench ADRs for context. They are not current contracts. Earlier CI run IDs, release notes, and UI iteration logs are preserved in Git history and the changelog; they do not imply that removed features remain active.
