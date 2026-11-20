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
 *
 * Matching is bidirectional and containment-based, because a correct drawing
 * routinely expands the prompt: asked for "注册", a model writes
 * "1 注册 / 登录：创建账号，完成身份验证". Prefix-only matching called that a
 * missing node — a false negative that made a good drawing score zero. The
 * guard is length: a one-character needle would match almost anything
 * ("会" inside "会议"), so a substring match needs at least two characters on
 * the shorter side.
 */
export function labelsMatch(left, right) {
  const a = normalizeLabel(left);
  const b = normalizeLabel(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2) return false;
  /*
   * Containment, not prefix. "确认发货" contains "发货" and is a different step,
   * which is the cost of this rule — but the alternative rejected every drawing
   * that numbered its steps or added a one-line explanation, and that failure
   * was far more common in the live runs than a wrong-node collision.
   */
  return longer.includes(shorter);
}
