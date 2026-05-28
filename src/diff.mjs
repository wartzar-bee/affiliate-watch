// Text diff + numeric-delta extraction. Pure — no I/O.
//
// We keep the diff deliberately simple and dependency-free: a line-level
// set-difference (added lines / removed lines) plus extraction of any
// percentage/currency numbers that changed. That is enough signal for the
// classifier to reason about ("a RevShare % line was removed and a lower one
// added", "a 'negative carryover' clause appeared", "program closed").

// Compare two normalized texts line-by-line.
// Returns:
//   { changed, added: string[], removed: string[],
//     addedText, removedText, numbers: { before:[], after:[] } }
// `added`/`removed` are lines present in one but not the other (multiset-aware:
// a line removed twice shows twice). Order of `added` follows the new text.
export function diffText(beforeText, afterText) {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);

  const beforeCount = multiset(before);
  const afterCount = multiset(after);

  const removed = [];
  for (const line of before) {
    if (consume(afterCount, line) === false) removed.push(line);
  }
  // reset and compute added against original before-counts
  const beforeCount2 = multiset(before);
  const added = [];
  for (const line of after) {
    if (consume(beforeCount2, line) === false) added.push(line);
  }

  const numbers = {
    before: extractNumbers(beforeText),
    after: extractNumbers(afterText)
  };

  return {
    changed: added.length > 0 || removed.length > 0,
    added,
    removed,
    addedText: added.join("\n"),
    removedText: removed.join("\n"),
    numbers
  };
}

function splitLines(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function multiset(lines) {
  const m = new Map();
  for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
  return m;
}

// Decrement a count if present; returns true if it consumed an occurrence
// (i.e. the line also exists on the other side), false if not present.
function consume(map, line) {
  const n = map.get(line);
  if (!n) return false;
  if (n === 1) map.delete(line); else map.set(line, n - 1);
  return true;
}

// Pull out the numbers that matter on a terms page: percentages and money.
// Returns a de-duplicated, sorted array of { raw, kind, value } where kind is
// "percent" | "money" and value is the numeric magnitude.
//   "45%"        -> { raw: "45%", kind: "percent", value: 45 }
//   "€100"       -> { raw: "€100", kind: "money", value: 100 }
//   "$1,500.50"  -> { raw: "$1,500.50", kind: "money", value: 1500.5 }
export function extractNumbers(text) {
  const out = [];
  const s = String(text || "");

  const pct = /(\d+(?:[.,]\d+)?)\s*%/g;
  let m;
  while ((m = pct.exec(s))) {
    out.push({ raw: m[0].trim(), kind: "percent", value: toNum(m[1]) });
  }

  // currency symbol before OR after the amount. The amount must START and END
  // on a digit so trailing punctuation ("$1,500.50,") is not swallowed into it.
  const amount = "\\d(?:[\\d.,]*\\d)?";
  const money = new RegExp(`(?:([€£$])\\s*(${amount})|(${amount})\\s*([€£$]|eur|usd|gbp)\\b)`, "gi");
  while ((m = money.exec(s))) {
    const rawAmount = m[2] != null ? m[2] : m[3];
    out.push({ raw: m[0].trim(), kind: "money", value: toNum(rawAmount) });
  }

  return dedupeNumbers(out);
}

function toNum(str) {
  // Treat the LAST separator as decimal if it has 1–2 trailing digits,
  // otherwise treat all separators as thousands. Handles "1,500.50",
  // "1.500,50", "1,500", "45,5".
  let s = String(str).trim();
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const decPos = Math.max(lastDot, lastComma);
  if (decPos > -1) {
    const decimals = s.length - decPos - 1;
    const sep = s[decPos];
    const looksDecimal = decimals >= 1 && decimals <= 2 &&
      // only treat as decimal if it's the only separator of its kind trailing
      s.indexOf(sep) === decPos;
    if (looksDecimal) {
      const intPart = s.slice(0, decPos).replace(/[.,]/g, "");
      const fracPart = s.slice(decPos + 1);
      s = intPart + "." + fracPart;
    } else {
      s = s.replace(/[.,]/g, "");
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function dedupeNumbers(list) {
  const seen = new Set();
  const out = [];
  for (const n of list) {
    const key = n.kind + ":" + n.raw + ":" + n.value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.sort((a, b) =>
    a.kind === b.kind ? a.value - b.value : a.kind < b.kind ? -1 : 1
  );
}
