// Change classification. Pure — no I/O.
//
// Given a diff between two snapshots of an affiliate-program page, decide WHAT
// kind of adverse change happened and HOW BAD it is, using cheap, transparent
// heuristics (keyword presence in added/removed lines + numeric deltas). This
// is intentionally explainable, not ML: an affiliate must be able to see why
// we alerted, and we'd rather over-surface a "tos-edit" than miss a closure.
//
// Categories (most→least severe):
//   closure          program closed / suspended / stopped paying
//   payment-change   payout threshold/method/withdrawal/schedule changed
//   commission-change RevShare/CPA/commission % or amount changed
//   geo-restriction  a market/GEO/country restriction added or changed
//   negative-carryover negative-carryover clause appeared/changed
//   licence-change   licence lost/revoked/suspended
//   tos-edit         generic terms edit (catch-all, low severity)
//   unknown          changed but no keyword/number signal matched
//   unreachable      page failed to fetch / non-2xx (operational alert)
//
// Severity: "critical" | "high" | "medium" | "low" | "info".

// Keyword sets. Kept lower-case; matched against lower-cased added/removed
// lines. Phrases are substrings so we catch them inside longer sentences.
const SIGNALS = [
  {
    category: "closure",
    severity: "critical",
    // appearance of these phrases is the alarm
    appear: [
      "program is closed", "programme is closed", "program has closed",
      "is now closed", "permanently closed", "ceasing operations",
      "cease operations", "no longer accepting", "discontinued",
      "suspended indefinitely", "terminated the program", "shutting down",
      "we are closing", "going direct", "direct deals only",
      "stopped paying", "non-payment", "account has been closed"
    ]
  },
  {
    category: "negative-carryover",
    severity: "high",
    appear: [
      "negative carryover", "negative carry-over", "negative carry over",
      "carryover of negative", "negative balance will be carried",
      "negative balances are carried", "carried forward"
    ],
    // "no negative carryover" is the REASSURING opposite — do not let it trip
    // the appear-match above.
    notAfter: ["no"],
    // ALSO fires if the reassuring "no negative carryover" phrase is REMOVED
    removeReassurance: ["no negative carryover", "no negative carry-over", "no negative carry over"]
  },
  {
    category: "licence-change",
    severity: "high",
    appear: [
      "licence has been revoked", "license has been revoked",
      "licence revoked", "license revoked", "lost its licence",
      "lost its license", "licence suspended", "license suspended",
      "no longer licensed", "licence withdrawn", "license withdrawn"
    ]
  },
  {
    category: "payment-change",
    severity: "high",
    appear: [
      "minimum payout", "minimum withdrawal", "payment threshold",
      "payout threshold", "minimum payment", "payment method",
      "withdrawal method", "payment schedule", "payout schedule",
      "processing fee", "administration fee", "admin fee",
      "no longer support", "we no longer offer", "skrill", "neteller",
      "paypal", "wire transfer", "payment terms"
    ]
  },
  {
    category: "geo-restriction",
    severity: "high",
    appear: [
      "restricted countries", "restricted territories", "prohibited countries",
      "excluded countries", "geo-restriction", "geo restriction",
      "not available in", "no longer accept traffic from",
      "blocked countries", "restricted jurisdictions", "prohibited jurisdictions",
      "we cannot accept", "market is closed", "restricted markets"
    ]
  },
  {
    category: "commission-change",
    severity: "high",
    appear: [
      "revenue share", "revshare", "rev share", "commission rate",
      "commission structure", "cpa", "cost per acquisition",
      "revenue-share", "tiered commission", "hybrid deal",
      "cookie window", "cookie period", "attribution window",
      "qualifying player", "qualified player", "ngr"
    ]
  }
];

// Detect whether a phrase appears in any of the given lines (case-insensitive).
function anyLineHas(lines, phrases) {
  const lc = lines.map((l) => l.toLowerCase());
  for (const p of phrases) {
    for (const line of lc) if (line.includes(p)) return p;
  }
  return null;
}

// Return the first phrase that is GENUINELY NEW: present in `curText` and not
// in `prevText`. `notAfter` is an optional list of immediately-preceding words
// that negate the phrase (e.g. "negative carryover" preceded by "no" is the
// reassuring opposite and must NOT count). Both texts are already lower-cased.
function newlyPresent(prevText, curText, phrases, notAfter) {
  for (const p of phrases) {
    if (presentMeaningfully(curText, p, notAfter) && !presentMeaningfully(prevText, p, notAfter)) {
      return p;
    }
  }
  return null;
}

// Is `phrase` present in `text` in a way that ISN'T immediately negated by one
// of `notAfter` words right before it? (Scans every occurrence.)
function presentMeaningfully(text, phrase, notAfter) {
  let from = 0;
  for (;;) {
    const idx = text.indexOf(phrase, from);
    if (idx === -1) return false;
    if (!notAfter || !notAfter.length) return true;
    const before = text.slice(Math.max(0, idx - 6), idx).trimEnd();
    const negated = notAfter.some((w) => before.endsWith(w));
    if (!negated) return true;
    from = idx + phrase.length;
  }
}

// Compute a percentage-delta summary: did the set of percentages shift DOWN?
// A downward move in percentages on a commission page is the classic "they
// cut RevShare" signal, so we surface direction.
function percentDelta(numbers) {
  const before = numbers.before.filter((n) => n.kind === "percent").map((n) => n.value);
  const after = numbers.after.filter((n) => n.kind === "percent").map((n) => n.value);
  if (!before.length && !after.length) return null;
  const maxB = before.length ? Math.max(...before) : null;
  const maxA = after.length ? Math.max(...after) : null;
  if (maxB == null || maxA == null) return { before, after, direction: "unknown", maxBefore: maxB, maxAfter: maxA };
  const direction = maxA < maxB ? "down" : maxA > maxB ? "up" : "flat";
  return { before, after, direction, maxBefore: maxB, maxAfter: maxA };
}

// Build a short, human "what changed" detail from the matched signal + numbers.
function detailFor(category, matchedPhrase, pd, diff) {
  const bits = [];
  if (matchedPhrase) bits.push(`matched "${matchedPhrase}"`);
  if (category === "commission-change" && pd && pd.direction !== "flat" && pd.maxBefore != null) {
    bits.push(`top % moved ${pd.maxBefore}% -> ${pd.maxAfter}% (${pd.direction})`);
  }
  if (!bits.length) {
    const n = diff.added.length + diff.removed.length;
    bits.push(`${diff.added.length} line(s) added, ${diff.removed.length} removed`);
  }
  return bits.join("; ");
}

// Classify a single page's change.
//   snapshot : the fresh snapshot (makeSnapshot output)
//   diff     : diffText(prevText, snapshot.text)  (may be null on first run)
//   prev     : previous snapshot or null
//
// Returns an ALERT RECORD or null when nothing alert-worthy happened:
//   { name, url, category, severity, detail, addedSample, removedSample,
//     hashBefore, hashAfter, at }
export function classifyChange(snapshot, diff, prev) {
  const at = snapshot.fetchedAt;
  const base = {
    name: snapshot.name,
    url: snapshot.url,
    hashBefore: prev ? prev.hash : null,
    hashAfter: snapshot.hash,
    at
  };

  // Operational: page unreachable / errored. This is itself a signal an
  // affiliate cares about (a program page that 404s may be a closure).
  if (!snapshot.status || snapshot.status >= 400) {
    return {
      ...base,
      category: "unreachable",
      severity: snapshot.status === 404 || snapshot.status === 410 ? "high" : "medium",
      detail: `fetch returned HTTP ${snapshot.status || "error"}` +
        (snapshot.status === 404 || snapshot.status === 410 ? " (page gone — possible closure)" : ""),
      addedSample: [],
      removedSample: []
    };
  }

  // First time we see this page: record a baseline, not an alert.
  if (!prev || !diff) return null;
  if (!diff.changed) return null;

  // We match against the WHOLE before/after text, not just the changed lines:
  // a line can move or be reworded so a phrase appears in both `added` and
  // `removed` without anything actually changing about it. A phrase counts as
  // an "appear" signal only if it is present in the NEW text and was NOT in the
  // OLD text (genuinely new). A "reassurance removed" counts only if the phrase
  // was in the OLD text and is gone from the NEW. This avoids the classic false
  // positive where a RevShare % line that also carries "no negative carryover"
  // is edited for the % only.
  const prevText = (prev.text || "").toLowerCase();
  const curText = (snapshot.text || "").toLowerCase();
  const pd = percentDelta(diff.numbers);

  // Walk signals in declared (severity) order; first match wins the category.
  for (const sig of SIGNALS) {
    let matched = newlyPresent(prevText, curText, sig.appear, sig.notAfter);
    // special case: reassurance REMOVED (e.g. "no negative carryover" deleted)
    if (!matched && sig.removeReassurance) {
      for (const phrase of sig.removeReassurance) {
        if (prevText.includes(phrase) && !curText.includes(phrase)) {
          matched = `removed reassurance "${phrase}"`;
          break;
        }
      }
    }
    if (matched) {
      // commission-change: only escalate to "high" if a % actually moved down,
      // otherwise it's likely wording — keep it but at medium.
      let severity = sig.severity;
      if (sig.category === "commission-change") {
        severity = pd && pd.direction === "down" ? "high"
          : pd && pd.direction === "up" ? "low"
            : "medium";
      }
      return {
        ...base,
        category: sig.category,
        severity,
        detail: detailFor(sig.category, matched, pd, diff),
        addedSample: diff.added.slice(0, 5),
        removedSample: diff.removed.slice(0, 5)
      };
    }
  }

  // Changed, but no keyword signal matched as genuinely-new. A DOWNWARD move in
  // the headline percentage is itself the strongest commission-cut signal (the
  // highest-pain change for an affiliate), so treat it as a HIGH
  // commission-change even without a keyword hit. An upward move is good news
  // (low). Never silently drop a real content change.
  if (pd && pd.direction === "down") {
    return {
      ...base,
      category: "commission-change",
      severity: "high",
      detail: detailFor("commission-change", null, pd, diff),
      addedSample: diff.added.slice(0, 5),
      removedSample: diff.removed.slice(0, 5)
    };
  }
  if (pd && pd.direction === "up") {
    return {
      ...base,
      category: "commission-change",
      severity: "low",
      detail: detailFor("commission-change", null, pd, diff),
      addedSample: diff.added.slice(0, 5),
      removedSample: diff.removed.slice(0, 5)
    };
  }

  return {
    ...base,
    category: "tos-edit",
    severity: "low",
    detail: detailFor("tos-edit", null, pd, diff),
    addedSample: diff.added.slice(0, 5),
    removedSample: diff.removed.slice(0, 5)
  };
}

// Severity ordering helper (for sorting/threshold use elsewhere).
export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
