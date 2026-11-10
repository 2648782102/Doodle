# Versioning

Doodle follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

During the `0.x` series:

- Breaking changes increment the minor version: `0.4.0` → `0.5.0`.
- Backward-compatible features increment the minor version.
- Fixes and documentation-only corrections increment the patch version.

A breaking change includes, but is not limited to:

- Adding, renaming, or removing an MCP tool, or changing required tool parameters.
- Changing machine-readable `BOARD_JSON`, `PROJECT_JSON`, or `JSON:` response fields consumed by models.
- Changing `SimpleBoard` version 1 persistence, revision semantics, or compatibility rules.
- Changing environment variable names, defaults, ports, or output directories.
- Changing the local REST/WebSocket contract in a way an active panel cannot ignore.
- Raising the minimum supported Node.js version.

The MCP server reports its version from `package.json`. Keep package version, `CHANGELOG.md`, and release tags in sync. Only the latest `0.5.x` release receives fixes.
