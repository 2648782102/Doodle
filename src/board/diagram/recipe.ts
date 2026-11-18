/**
 * High-level diagram recipes.
 *
 * Turns a short intent (`flow`, `review`, `decision`, `timeline`,
 * `architecture`) plus human-readable steps into the same semantic node/edge
 * shape `diagram` already accepts. This keeps the geometry engine unchanged:
 * recipes are sugar for authoring, not a second rendering path.
 */

import type { DiagramInput, DiagramMode, ExpandedDiagramInput } from "../model/types.js";

export type DiagramRecipe = NonNullable<DiagramInput["recipe"]>;

function idFor(index: number): string {
  return `step_${index + 1}`;
}

export function expandRecipe(diagram: DiagramInput): ExpandedDiagramInput {
  if (!diagram.recipe) {
    if (!diagram.nodes || diagram.nodes.length === 0) {
      throw new Error("diagram requires nodes/edges or a recipe with steps");
    }
    // `edges` is optional in the schema: a node card or a short label sequence
    // is a legitimate diagram. Leaving it undefined reached `generate.ts` as
    // `diagram.edges.some(...)` and surfaced as a bare
    // "Cannot read properties of undefined (reading 'length')", which told the
    // agent nothing about the fix. Normalise the field here so every downstream
    // reader can rely on an array.
    return { ...diagram, edges: diagram.edges ?? [] } as ExpandedDiagramInput;
  }
  const steps = (diagram.steps ?? []).map((step) => step.trim()).filter(Boolean);
  if (!steps.length) throw new Error(`recipe: ${diagram.recipe} requires at least one non-empty step`);
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
    return { ...diagram, mode: diagram.mode ?? "flow", nodes, edges };
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
