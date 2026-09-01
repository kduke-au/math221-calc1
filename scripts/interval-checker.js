/**
 * interval-checker.js
 *
 * Reusable checker for interval-notation answers (e.g. domain problems).
 * Accepts unions of intervals in the form:  (-3, 2] U [4, inf)
 *
 * Format rules enforced by the parser:
 *   - Union separator: capital "U" only (spaces around it optional)
 *   - Brackets: ( ) [ ]  -- no other bracket styles accepted
 *   - Infinity: "inf" or "-inf" (case-insensitive), written literally --
 *     an expression that merely evaluates to an infinite value (like 1/0)
 *     is NOT accepted as infinity; tell students to write "inf" directly.
 *   - Bounds: any real-valued arithmetic expression math.js can evaluate --
 *     decimals, fractions (1/3), powers (2^5, note "^" not "**"), roots
 *     (sqrt(2)), and constants (pi, e) are all fine. Complex results
 *     (e.g. sqrt(-1)) and undefined symbols are rejected with an error.
 *
 * Any set of equivalent, correctly-formatted intervals is accepted --
 * order doesn't matter, and redundant/overlapping/mergeable pieces are
 * canonicalized before comparison, so there is no "simplest form"
 * requirement.
 *
 * Requires math.js's `evaluate` function to be available as the bare
 * import specifier "mathjs" -- see the accompanying setup notes for how
 * to wire this up for both Node testing (npm install mathjs) and the
 * browser (an import map pointing "mathjs" at a CDN ESM build).
 *
 * Usage:
 *   const result = checkIntervalAnswer(studentInput, correctAnswerString);
 *   // result = { correct: bool, error: string|null }
 *
 * Or, if you already have the correct answer as parsed intervals rather
 * than a string, use checkIntervalAnswerAgainst(studentInput, correctIntervals).
 */

import { evaluate } from "mathjs";

const EPSILON = 1e-6;

// ---------- Parsing ----------

function parseBound(token) {
  const t = token.trim().toLowerCase();
  if (t === "inf" || t === "infinity" || t === "+inf") return Infinity;
  if (t === "-inf" || t === "-infinity") return -Infinity;

  let value;
  try {
    value = evaluate(token);
  } catch {
    return NaN;
  }
  // Reject anything that isn't a plain finite real number: complex
  // results (sqrt(-1)), matrices, units, or accidental infinities from
  // an expression like 1/0 (infinity must be written literally as "inf").
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

/**
 * Parse a single interval token like "(-3, 2]" or "(sqrt(2), 5)".
 * Returns { ok: true, interval } or { ok: false, error }.
 *
 * Brackets are checked directly (rather than with one big regex) so that
 * bound expressions containing their own parentheses -- e.g. sqrt(2) --
 * don't confuse the outer interval structure.
 */
function parseSingleInterval(raw) {
  const s = raw.trim();

  const openBracket = s[0];
  const closeBracket = s[s.length - 1];
  if (!"([".includes(openBracket) || !")]".includes(closeBracket)) {
    return {
      ok: false,
      error: `Could not read "${s}" as an interval. Expected a form like (-3, 2] or [4, inf).`,
    };
  }

  const inner = s.slice(1, -1);
  const commaIndex = inner.indexOf(",");
  if (commaIndex === -1) {
    return {
      ok: false,
      error: `"${s}" needs a comma separating the two endpoints, e.g. (-3, 2].`,
    };
  }

  const lowerTok = inner.slice(0, commaIndex);
  const upperTok = inner.slice(commaIndex + 1);

  const lower = parseBound(lowerTok);
  const upper = parseBound(upperTok);

  if (Number.isNaN(lower) || Number.isNaN(upper)) {
    return { ok: false, error: `Could not read the numbers in "${s}".` };
  }
  if (lower > upper + EPSILON) {
    return {
      ok: false,
      error: `In "${s}", the left endpoint is greater than the right endpoint.`,
    };
  }

  // Infinity is never "included" -- a closed bracket on an infinite
  // bound is a genuine notation error, not something to silently fix.
  if (lower === -Infinity && openBracket === "[") {
    return {
      ok: false,
      error: `Use "(" before -inf.`,
    };
  }
  if (upper === Infinity && closeBracket === "]") {
    return {
      ok: false,
      error: `Use ")" after inf.`,
    };
  }

  return {
    ok: true,
    interval: {
      lower,
      upper,
      lowerClosed: openBracket === "[",
      upperClosed: closeBracket === "]",
    },
  };
}

/**
 * Parse a full answer string, e.g. "(-inf, 2) U [3, inf)".
 * Returns { ok: true, intervals } or { ok: false, error }.
 */
function parseIntervalAnswer(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "Enter an answer." };
  }

  // Reject alternate union symbols explicitly with a clear message,
  // rather than silently failing the regex on the whole string.
  if (/[∪]|(?:\bor\b)|(?:\bu\b)/i.test(raw.replace(/U/g, ""))) {
    return {
      ok: false,
      error: 'Use a capital "U" to join intervals, e.g. (-inf, 2) U [3, inf).',
    };
  }

  const pieces = raw.split("U").map((p) => p.trim()).filter((p) => p !== "");
  if (pieces.length === 0) {
    return { ok: false, error: "Enter an answer." };
  }

  const intervals = [];
  for (const piece of pieces) {
    const result = parseSingleInterval(piece);
    if (!result.ok) return result;
    intervals.push(result.interval);
  }

  return { ok: true, intervals };
}

// ---------- Canonicalization ----------

/**
 * Sort and merge a list of {lower, upper, lowerClosed, upperClosed}
 * intervals into the minimal equivalent set.
 */
function canonicalize(intervals) {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.lower - b.lower);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];

    const overlaps = cur.lower < prev.upper - EPSILON;
    const touchesClosed =
      Math.abs(cur.lower - prev.upper) <= EPSILON &&
      (prev.upperClosed || cur.lowerClosed);
    const prevIsUnbounded = prev.upper === Infinity;

    if (prevIsUnbounded || overlaps || touchesClosed) {
      // Merge cur into prev
      if (cur.upper > prev.upper) {
        prev.upper = cur.upper;
        prev.upperClosed = cur.upperClosed;
      } else if (
        Math.abs(cur.upper - prev.upper) <= EPSILON &&
        cur.upperClosed
      ) {
        prev.upperClosed = true;
      }
    } else {
      merged.push({ ...cur });
    }
  }

  return merged;
}

// ---------- Comparison ----------

function boundsEqual(a, b) {
  if (a === Infinity && b === Infinity) return true;
  if (a === -Infinity && b === -Infinity) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= EPSILON;
}

/**
 * Compare two lists of intervals for mathematical equivalence,
 * independent of order, redundant splits, or overlapping input.
 */
function intervalSetsEqual(listA, listB) {
  const a = canonicalize(listA);
  const b = canonicalize(listB);

  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (
      !boundsEqual(a[i].lower, b[i].lower) ||
      !boundsEqual(a[i].upper, b[i].upper) ||
      a[i].lowerClosed !== b[i].lowerClosed ||
      a[i].upperClosed !== b[i].upperClosed
    ) {
      return false;
    }
  }
  return true;
}

// ---------- Public API ----------

/**
 * Check a student's raw string answer against a correct answer given
 * as a string in the same notation.
 */
function checkIntervalAnswer(studentInput, correctAnswerString) {
  const correctParsed = parseIntervalAnswer(correctAnswerString);
  if (!correctParsed.ok) {
    // This indicates a problem-authoring bug, not a student error.
    throw new Error(
      `Internal error: correct answer "${correctAnswerString}" failed to parse: ${correctParsed.error}`
    );
  }
  return checkIntervalAnswerAgainst(studentInput, correctParsed.intervals);
}

/**
 * Check a student's raw string answer against a correct answer already
 * given as parsed intervals (useful if you build the correct answer
 * programmatically rather than as a string).
 */
function checkIntervalAnswerAgainst(studentInput, correctIntervals) {
  const parsed = parseIntervalAnswer(studentInput);
  if (!parsed.ok) {
    return { correct: false, error: parsed.error };
  }
  const correct = intervalSetsEqual(parsed.intervals, correctIntervals);
  return { correct, error: null };
}

// ---------- Exports ----------
// Works as an ES module import, and also attaches to `window` for
// use in a plain <script> tag inside a Quarto .qmd page.

export {
  parseIntervalAnswer,
  parseSingleInterval,
  canonicalize,
  intervalSetsEqual,
  checkIntervalAnswer,
  checkIntervalAnswerAgainst,
};

if (typeof window !== "undefined") {
  window.IntervalChecker = {
    parseIntervalAnswer,
    parseSingleInterval,
    canonicalize,
    intervalSetsEqual,
    checkIntervalAnswer,
    checkIntervalAnswerAgainst,
  };
}
