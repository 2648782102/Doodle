# Competitive Research

This is a concise product-research note, not a feature list. It explains why the project stays small.

## Adjacent categories

- **Mermaid and diagram generators** produce polished static diagrams but make the diagram artifact the center of the workflow.
- **General whiteboards** provide rich drawing surfaces but usually require accounts, hosted state, or a full visual application.
- **MCP UI apps and approval panels** can expose interactive decisions inside agents, but they often couple a visual surface to a workflow or write-authority protocol.
- **Project-structure visualizers** help explain repositories, yet that capability can easily swallow the whole product.

## Positioning

Doodle keeps one thing from each category and discards the rest:

- from diagram tools: a short, structured visual expression;
- from whiteboards: an infinite canvas with simple free placement;
- from MCP apps: agent-native JSON tools with no mandatory browser window;
- from project visualizers: optional read-only structure context.

The product is not the diagram, the hosted board, the approval workflow, or the repository scanner. It is the shared canvas that lets a person and an AI point at the same visual context.

## Design lessons

1. An AI needs a small, predictable tool surface more than a large catalogue.
2. A human needs an obvious drawing surface more than a dashboard.
3. Visual context should never silently become permission to change files.
4. A connector must connect two coordinates; decorative pseudo-arrows create ambiguity.
5. Optional capabilities must stay optional in code, docs, tests, and dependency count.

## Non-goals reinforced by research

No hosted collaboration, general chat product, mandatory workflow, diagram asset library, source-graph database, or built-in code-change approval system. These remain non-goals even if adjacent products offer them.
