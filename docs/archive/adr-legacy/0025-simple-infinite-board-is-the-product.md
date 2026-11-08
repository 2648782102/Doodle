# ADR 0025 — The simple infinite board is the product

## Status

Accepted. Refines the product hierarchy in ADR 0022 and ADR 0024.

## Decision

AI Draw MCP is a simple, practical shared infinite board. A person and an AI both use the same canvas to draw, move, label, and discuss visual objects. The default human interface is a small drawing surface; the default AI interface is the MCP tool trio `get_board`, `draw_board`, and `reply_on_board`.

Project scanning, source evidence, graph diffs, proposals, and approval-gated writes remain available through `/workbench` and the existing MCP tools. They are optional capabilities, not the definition of the product and not the first-run experience.

The board has one independent version 1 state file, `output/.ai-draw/board.json`, with bounded simple objects and notes. It does not reuse `SessionSnapshot` or `VisualGraph`, so the canvas stays free of project-structure semantics.

## Consequences

- The root URL serves the simple board. The dense project UI is available at `/workbench`.
- `get_board` is the agent's normal first call. `scan_project` is no longer the default start.
- Human board writes require `PANEL_TOKEN` and `confirmedBy: "human"`; board writes never write project files.
- The existing proposal, full diff, approval, one-time receipt, path safety, and rollback boundary is unchanged.
- Earlier ADRs about project-centric board workflows remain useful historical records, but their product hierarchy is superseded by this decision.

## Safety

Simple board items and notes are communication context only. They never grant write authority, never contain approval credentials, and never bypass `apply_visual_proposal`. The preview server remains localhost-only and logs remain on stderr.
