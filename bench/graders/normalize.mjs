/**
 * Label normalisation for structural grading.
 *
 * A model writes "校验订单" where the case expects "校验"; another writes
 * "  校验 " or "校验。". Grading exact strings would report a correct drawing as
 * missing nodes, which is the fastest way to make a benchmark untrustworthy.
 *
 * The rule is deliberately conservative: lowercase, strip punctuation and
 * whitespace, then treat a label as matching when one is a prefix of the other.
 * Prefix (not substring) matters — "发货" is a prefix of "发货完成" but not of
 * "确认发货", and accepting the latter would let a wrong node pass.
 */

const PUNCTUATION = /[\s\u3000.,;:!?'"`~()[\]{}<>/\\|+=*&^%$#@。，、；：！？“”‘’（）【】《》〈〉…—–\-_]+/g;

export function normalizeLabel(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(PUNCTUATION, "")
    .trim();
}

/**
 * True when two labels name the same thing for grading purposes.
 *
 * Empty labels never match: a blank card is not a node the case asked for.
 */
export function labelsMatch(left, right) {
  const a = normalizeLabel(left);
  const b = normalizeLabel(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // A one-character prefix is too weak ("会" would match "会议").
  return shorter.length >= 2 && longer.startsWith(shorter);
}
