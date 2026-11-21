/**
 * High-level diagram recipes.
 *
 * Turns a short intent (`flow`, `review`, `decision`, `timeline`,
 * `architecture`) plus human-readable steps into the same semantic node/edge
 * shape `diagram` already accepts. This keeps the geometry engine unchanged:
 * recipes are sugar for authoring, not a second rendering path.
 */

import type { DiagramInput, DiagramMode, ExpandedDiagramInput } from "../model/types.js";
import { BoardValidationError } from "../errors.js";

export type DiagramRecipe = NonNullable<DiagramInput["recipe"]>;

function idFor(index: number): string {
  return `step_${index + 1}`;
}

/**
 * Read the direction words a model writes as the mode they mean.
 *
 * `mode` is a four-value enum, but agents reach for the vocabulary they use
 * when describing a picture: "horizontal", "left-right", "vertical", "linear".
 * Recorded runs sent 42 such values across 305 runs, and every one of them was
 * silently discarded because a recipe was present. Rejecting them once the
 * recipe no longer hides them would trade one silent failure for a loud one, on
 * a field the caller clearly meant something unambiguous by.
 *
 * Only directions with one reading are mapped. `flow` and `timeline` already
 * default to a horizontal axis and a vertical one respectively, so the alias is
 * the same picture the author asked for — never a reinterpretation of content.
 */
const MODE_ALIASES: Record<string, DiagramMode> = {
  horizontal: "flow",
  "left-right": "flow",
  "left to right": "flow",
  lr: "flow",
  linear: "flow",
  sequence: "flow",
  vertical: "timeline",
  vertical_top_down: "timeline",
  "top-down": "timeline",
};

function normalizeMode(mode: string | undefined): DiagramMode | undefined {
  if (!mode) return undefined;
  const key = mode.trim().toLowerCase().replace(/[_\s]+/g, "-");
  const direct = MODE_ALIASES[key] ?? MODE_ALIASES[key.replace(/-/g, " ")];
  return direct ?? (mode as DiagramMode);
}

/**
 * Reject a bad node colour at the field the caller actually wrote.
 *
 * The colour rule lives in `parseBoard`, which sees the generated *items*, so
 * `color: "blue"` on a diagram node was reported as `items[1].color` — a path
 * that does not exist in the request the model sent. The model then has to
 * guess that node 1 was the culprit. Checking here keeps the message, the code,
 * and the repair identical while pointing at `diagram.nodes[].color`.
 *
 * This still rejects rather than guesses: "blue" has no single meaning in a
 * palette, and silently picking one would persist a colour nobody asked for.
 */
function assertNodeColors(nodes: readonly { id: string; color?: string }[]): void {
  for (const node of nodes) {
    if (node.color === undefined) continue;
    if (/^#[0-9a-f]{6}$/i.test(node.color) || node.color === "transparent") continue;
    throw new BoardValidationError(
      `Node ${JSON.stringify(node.id)} has color ${JSON.stringify(node.color)}; expected a six-digit hex value`,
      "INVALID_COLOR",
      `diagram.nodes[${JSON.stringify(node.id)}].color`,
      "#rrggbb or transparent",
      `Use a six-digit hex value such as #f6d365, or transparent for no fill.`,
    );
  }
}

export function expandRecipe(diagram: DiagramInput): ExpandedDiagramInput {
  if (!diagram.recipe) {
    if (!diagram.nodes || diagram.nodes.length === 0) {
      throw new BoardValidationError(
        "diagram has no nodes and no recipe",
        "DIAGRAM_EMPTY",
        "diagram.nodes",
        "at least one node, or recipe + steps",
        `Send nodes: [{ id: "a", label: "Start" }, ...] with optional edges, or use the shortcut recipe: "flow" with steps: ["Start", "Next", ...].`,
      );
    }
    // `edges` is optional in the schema: a node card or a short label sequence
    // is a legitimate diagram. Leaving it undefined reached `generate.ts` as
    // `diagram.edges.some(...)` and surfaced as a bare
    // "Cannot read properties of undefined (reading 'length')", which told the
    // agent nothing about the fix. Normalise the field here so every downstream
    // reader can rely on an array.
    assertNodeColors(diagram.nodes ?? []);
    return {
      ...diagram,
      mode: normalizeMode(diagram.mode),
      edges: diagram.edges ?? [],
    } as ExpandedDiagramInput;
  }
  /*
   * An explicit `nodes` array wins over `steps`.
   *
   * A model routinely sends both: it names a recipe and then spells out the
   * graph it actually wants. The branches below rebuild nodes and edges from
   * `steps` alone, so every such call discarded the declared nodes *and* edges
   * and still replied success. 62 of 305 recorded runs did this, and it is why
   * a branch diagram came back as a straight line with the rollback edge
   * missing — the model had declared all four edges correctly.
   *
   * Silently dropping part of a request is the worst thing a write tool can do,
   * because the caller cannot notice. `nodes` is the field that cannot be
   * ignored: a caller who wants only the recipe omits it.
   */
  if (diagram.nodes?.length) {
    assertNodeColors(diagram.nodes);
    return {
      ...diagram,
      mode: normalizeMode(diagram.mode),
      edges: diagram.edges ?? [],
    } as ExpandedDiagramInput;
  }
  const steps = (diagram.steps ?? []).map((step) => step.trim()).filter(Boolean);
  if (!steps.length) {
    throw new BoardValidationError(
      `recipe "${diagram.recipe}" has no usable steps`,
      "RECIPE_STEPS_REQUIRED",
      "diagram.steps",
      "at least one non-empty string",
      `Send steps: ["收集需求", "实现", "验证"]. Blank and whitespace-only entries are ignored, so an array of them counts as empty.`,
    );
  }
  if (diagram.recipe === "review") {
    const labels = [steps[0], "收集反馈", "修订并完成", ...steps.slice(1)];
    return expandRecipe({ ...diagram, recipe: "flow", steps: labels });
  }
  if (diagram.recipe === "decision") {
    const options = (diagram.options ?? []).map((option) => option.trim()).filter(Boolean);
    const outcome = steps[steps.length - 1];
    const preceding = steps.slice(0, -1);
    const nodes = [
      ...preceding.map((label, index) => ({ id: idFor(index), label, role: "step" as const })),
      ...options.map((label, index) => ({ id: `option_${index + 1}`, label, role: "decision" as const, column: preceding.length })),
      { id: "outcome", label: outcome, role: "step" as const, column: preceding.length + 1, emphasis: "focus" as const },
    ];
    const edges = [
      ...preceding.slice(1).map((_, index) => ({ from: idFor(index), to: idFor(index + 1) })),
      ...(preceding.length && options.length ? [{ from: idFor(preceding.length - 1), to: "option_1" }] : []),
      ...options.map((_, index) => ({ from: `option_${index + 1}`, to: "outcome" })),
    ];
    return { ...diagram, mode: normalizeMode(diagram.mode) ?? "flow", nodes, edges };
  }
  const mode: DiagramMode = diagram.recipe === "timeline" ? "timeline"
    : diagram.recipe === "architecture" ? "flow"
      : "flow";
  const nodes = steps.map((label, index) => ({
    id: idFor(index),
    label,
    ...(mode === "timeline" ? { column: 0, row: index } : {}),
  }));
  const edges = steps.slice(1).map((_, index) => ({ from: idFor(index), to: idFor(index + 1) }));
  return { ...diagram, mode, nodes, edges };
}
