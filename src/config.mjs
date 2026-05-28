// Watchlist parsing + validation. Pure: raw text -> normalized config.
// JSON-only by design (no YAML dependency) — keeps deps at zero.
//
// Watchlist shape:
// {
//   "userAgent"?: "affiliate-watch/0.1 (+you@example.com)",  // sent on fetch
//   "minDelayMs"?: 1500,        // polite delay between requests (default 1500)
//   "watch": [
//     { "name": "LeoVegas Affiliates",
//       "url": "https://www.leovegasaffiliates.com/terms-and-conditions",
//       "selector"?: "#terms"  // optional region hint
//     }
//   ]
// }

// Parse raw watchlist text (JSON) into a normalized, validated config.
// Throws Error with a clear message on any structural problem.
export function parseConfig(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch (e) { throw new Error("Watchlist is not valid JSON: " + e.message); }
  return normalizeConfig(raw);
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Watchlist must be a JSON object");

  // accept "watch" (preferred) or legacy "watchlist"
  const list = raw.watch ?? raw.watchlist;
  if (!Array.isArray(list) || list.length === 0)
    throw new Error('Watchlist must have a non-empty "watch" array');

  const watch = list.map((e, i) => normalizeEntry(e, i));

  // duplicate-URL guard (a common copy/paste mistake that breaks the store)
  const seen = new Set();
  for (const w of watch) {
    if (seen.has(w.url)) throw new Error(`Duplicate url in watchlist: ${w.url}`);
    seen.add(w.url);
  }

  let minDelayMs = 1500;
  if (raw.minDelayMs !== undefined) {
    if (typeof raw.minDelayMs !== "number" || raw.minDelayMs < 0)
      throw new Error('"minDelayMs" must be a non-negative number');
    minDelayMs = raw.minDelayMs;
  }

  const userAgent = typeof raw.userAgent === "string" && raw.userAgent
    ? raw.userAgent
    : "affiliate-watch/0.1 (+https://github.com/; set userAgent in watchlist.json)";

  return { userAgent, minDelayMs, watch };
}

function normalizeEntry(e, i) {
  if (!e || typeof e !== "object" || Array.isArray(e))
    throw new Error(`watch[${i}] must be an object`);
  if (typeof e.url !== "string" || !/^https?:\/\//i.test(e.url))
    throw new Error(`watch[${i}].url must be an http(s) URL`);
  if (e.selector !== undefined && typeof e.selector !== "string")
    throw new Error(`watch[${i}].selector must be a string if present`);

  return {
    name: typeof e.name === "string" && e.name ? e.name : e.url,
    url: e.url,
    selector: typeof e.selector === "string" && e.selector ? e.selector : undefined
  };
}
