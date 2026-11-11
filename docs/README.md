# Documentation Map

Start with [`../README.md`](../README.md) for installation and the product overview. AI coding agents should read [`../AGENTS.md`](../AGENTS.md) first.

| Document | Audience | Purpose |
|---|---|---|
| [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) | Everyone | Product definition, boundaries, and experience principles |
| [`EXPERIENCE_AUDIT.md`](EXPERIENCE_AUDIT.md) | Maintainers | Live AI/human experience friction, priorities, and closure status |
| [`GOAL_PLUGIN.md`](GOAL_PLUGIN.md) | Contributors, reviewers | Objective, scope, acceptance, and evidence for the Codex plugin distribution |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Contributors, reviewers | Source layout, board state, MCP tools, HTTP API, and safety model |
| [`DECISIONS.md`](DECISIONS.md) | Contributors, AI agents | Current decisions in force and the status of historical ADRs |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | Users, maintainers | First-run checks and common failures |
| [`GOAL_MODE.md`](GOAL_MODE.md) | Maintainers, AI agents | How to set a time-boxed autonomous maintenance objective |
| [`GOVERNANCE.md`](GOVERNANCE.md) | Maintainers | Open-source maintenance checklist and public metadata |
| [`COMPETITIVE_RESEARCH.md`](COMPETITIVE_RESEARCH.md) | Maintainers | Product lessons from whiteboards, MCP tools, and visual agent surfaces |
| [`DEPENDENCY_MAINTENANCE.md`](DEPENDENCY_MAINTENANCE.md) | Maintainers | Dependency policy and verification order |
| [`LAUNCH_KIT.md`](LAUNCH_KIT.md) | Maintainers | GitHub description and short launch copy |
| [`FAQ.md`](FAQ.md) | Users, reviewers | Public plugin directory, privacy, local state, and support questions |
| [`SUBMISSION.md`](SUBMISSION.md) | Maintainers, reviewers | Prepared public submission materials and external eligibility gates |
| [`archive/adr-legacy/`](archive/adr-legacy/README.md) | Historians | Read-only ADRs from the removed project-workbench iterations |
| [`../ROADMAP.md`](../ROADMAP.md) | Everyone | Shipped direction and explicit non-goals |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Contributors | Local setup, tests, and PR expectations |
| [`../SECURITY.md`](../SECURITY.md) | Security reviewers | Threat model and private vulnerability reporting |
| [`../PRIVACY.md`](../PRIVACY.md) | Users, reviewers | Local data categories, purposes, recipients, retention, and controls |
| [`../SUPPORT.md`](../SUPPORT.md) | Users | Issue and security-report channels |
| [`../TERMS.md`](../TERMS.md) | Users, reviewers | Open-source license and public project surface terms |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Users | Versioned release notes |
| [`../examples/README.md`](../examples/README.md) | New users | MCP config snippets and a minimal client |

Run `npm run check` before publishing. Documentation is versioned with the source; a change to the MCP tool surface, board protocol, plugin packaging, embedded host context bridge, or security boundary must update the architecture, agent handbook, plugin goal, tests, CI, and offline guards together.
