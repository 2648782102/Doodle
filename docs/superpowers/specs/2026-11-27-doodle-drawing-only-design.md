# Doodle Drawing Only

## Intent

Doodle is only a shared drawing board for a person and an AI. It must not inspect a repository, enumerate project files, read source excerpts, or expose project-scanning APIs. A host coding agent may inspect its project using its own capabilities, then use Doodle to draw and discuss the resulting visual context together with the person.

## Goals

- Keep exactly three MCP tools: `get_board`, `show_board`, and `draw_board`.
- Remove repository scanning from MCP, HTTP, server configuration, source modules, plugin guidance, examples, and current product documentation.
- Keep local board persistence working. The process may resolve a directory for board data, but it must not read project files to build context.
- Keep the shared architecture-discussion scenario as a drawing workflow: the host agent supplies its own repository understanding; Doodle only presents the diagram and receives human edits.
- Add regression coverage proving project-scan MCP and HTTP surfaces are absent while normal board reads, rendering, drawing, and handoff still work.

## Non-goals

- Do not change Board v1, canvas behavior, diagram authoring, board library, MCP Apps context sync, or local board storage format.
- Do not remove the host coding agent's own ability to inspect a repository.
- Do not remove historical release notes that accurately describe earlier versions; current guidance must make the active product boundary unambiguous.

## Approaches

1. **Recommended — remove scanning at every Doodle boundary.** Delete the scanner and draft generator; unregister the MCP tool; remove both HTTP routes, scan-only configuration and tests; update guards and current docs. Keep architecture discussion as host-provided drawing material. This leaves Doodle with no project-reading code path and makes the boundary easy to audit.
2. Hide only `scan_project` from MCP. This leaves the HTTP scan endpoints and scanner implementation available to clients, so the product would still read repositories and the boundary would be incomplete.
3. Keep scanning as an undocumented internal helper. This has no user benefit and leaves unwanted file-reading capability in the product package.

## Constraints and implementation calls

- The MCP surface has exactly the three drawing-board tools above.
- `/api/board/project` and `/api/board/project/text` must no longer return project contents.
- Remove `DOODLE_WORKSPACE_ROOT` and its legacy scanning alias from runtime behavior and published environment metadata. Preserve plugin-safe default selection for the board data directory, but name and document it as board-storage resolution.
- Rework the architecture discussion example so its prompt tells the host coding agent to inspect the repository with its own tools and use Doodle only to draw, receive edits, and continue.
- Preserve history as history; append a current changelog entry recording that project scanning was removed.

## Acceptance

- MCP lists exactly `get_board`, `show_board`, and `draw_board`; initialization guidance does not describe repository scanning.
- Project scan HTTP paths return 404 and no source paths or excerpts.
- Board read, show, draw, human edits, and HANDOFF remain functional.
- No scanner, project scan route, or scan-specific runtime configuration remains under `src/` or in active plugin/user guidance.
- `npm run check` and `npm run test:browser` pass.
