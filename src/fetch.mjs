// The ONLY module that talks to the network. Everything above it (normalize,
// snapshot, diff, classify, runner, report) is pure and network-free; tests
// inject a fixture-backed fetchPage in its place, so no network is hit in the
// suite (house rule L-008).
//
// G1 (legal/ToS): we ONLY fetch publicly accessible pages, we RESPECT
// robots.txt for our user-agent, we send an honest identifying user-agent, and
// we never follow into auth/paywalls. We do not bypass blocks; a 401/403 is
// reported as unreachable, not worked around.

// Build a fetchPage(entry, { userAgent }) => { status, body, fetchedAt }.
// `fetchImpl` is injectable purely so the HTTP shaping can be tested; defaults
// to global fetch (Node >= 18). `respectRobots` (default true) consults
// robots.txt and refuses disallowed paths (status 0, body "" + robotsBlocked).
export function makeFetchPage({
  fetchImpl = globalThis.fetch,
  respectRobots = true,
  timeoutMs = 25000
} = {}) {
  const robotsCache = new Map(); // origin -> parsed robots (or null)

  return async function fetchPage(entry, { userAgent } = {}) {
    const url = entry.url;
    const ua = userAgent || "affiliate-watch/0.1";

    if (respectRobots) {
      const allowed = await isAllowed(url, ua, fetchImpl, robotsCache, timeoutMs);
      if (!allowed) {
        return { status: 0, body: "", robotsBlocked: true, fetchedAt: new Date().toISOString() };
      }
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" }
      });
      const body = await safeText(res);
      return { status: res.status, body, fetchedAt: new Date().toISOString() };
    } catch (e) {
      return { status: 0, body: "", error: e && e.message ? e.message : String(e), fetchedAt: new Date().toISOString() };
    } finally {
      clearTimeout(t);
    }
  };
}

async function isAllowed(url, ua, fetchImpl, cache, timeoutMs) {
  let origin, pathName;
  try { const u = new URL(url); origin = u.origin; pathName = u.pathname + u.search; }
  catch { return false; }

  if (!cache.has(origin)) {
    cache.set(origin, await loadRobots(origin, fetchImpl, timeoutMs));
  }
  const robots = cache.get(origin);
  if (!robots) return true; // no robots.txt (or unfetchable) => allowed
  return robotsAllows(robots, ua, pathName);
}

async function loadRobots(origin, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 10000));
  try {
    const res = await fetchImpl(origin + "/robots.txt", { redirect: "follow", signal: ctrl.signal });
    if (!res.ok) return null;
    return parseRobots(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}

// --- minimal robots.txt parser + matcher -----------------------------------
// Groups of (agents -> rules). Each rule is { type: "allow"|"disallow", path }.
// Exported for unit testing.
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let sawRuleSinceAgent = false;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines (no rules between) share one group.
      if (!current || sawRuleSinceAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRuleSinceAgent = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow" || field === "allow") {
      if (!current) { current = { agents: ["*"], rules: [] }; groups.push(current); }
      current.rules.push({ type: field, path: value });
      sawRuleSinceAgent = true;
    }
    // ignore sitemap/crawl-delay/host for matching purposes
  }
  return groups;
}

// Does `robots` allow `path` for user-agent `ua`? Picks the most specific
// matching group (exact token match on a UA substring, else "*"), then applies
// longest-match wins between allow/disallow (standard robots semantics).
export function robotsAllows(robots, ua, path) {
  const uaLc = String(ua).toLowerCase();
  const group = pickGroup(robots, uaLc);
  if (!group) return true;

  let best = null; // { type, len }
  for (const rule of group.rules) {
    if (rule.path === "") {
      // "Disallow:" empty == allow all; "Allow:" empty is ignored.
      if (rule.type === "disallow") continue;
      continue;
    }
    if (matchesPath(path, rule.path)) {
      const len = rule.path.length;
      if (!best || len > best.len) best = { type: rule.type, len };
    }
  }
  if (!best) return true;
  return best.type === "allow";
}

function pickGroup(robots, uaLc) {
  let star = null, specific = null, specificLen = -1;
  for (const g of robots) {
    for (const agent of g.agents) {
      if (agent === "*") { star = star || g; continue; }
      // token match: robots agent is a substring of our UA (case-insensitive)
      if (uaLc.includes(agent) && agent.length > specificLen) {
        specific = g; specificLen = agent.length;
      }
    }
  }
  return specific || star;
}

// robots path match: prefix match with `*` wildcard and optional `$` anchor.
function matchesPath(path, pattern) {
  // Build a regex from the robots pattern.
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") re += "[\\s\\S]*";
    else if (ch === "$" && i === pattern.length - 1) re += "$";
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  try { return new RegExp("^" + re).test(path); } catch { return false; }
}
