// robots.txt parsing + matching, and the fetchPage I/O shaping with a MOCK
// fetch (no network). Proves we respect robots and never bypass blocks (G1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, robotsAllows, makeFetchPage } from "../src/fetch.mjs";

test("parseRobots groups agents with their rules", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /admin\nAllow: /admin/public`);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].agents, ["*"]);
  assert.equal(r[0].rules.length, 2);
});

test("empty Disallow means allow-all", () => {
  const r = parseRobots(`User-agent: *\nDisallow:`);
  assert.equal(robotsAllows(r, "anybot", "/terms"), true);
});

test("Disallow: / blocks everything for the matched agent", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /`);
  assert.equal(robotsAllows(r, "anybot", "/terms"), false);
});

test("named-agent group is more specific than * (real Galaxy-style file)", () => {
  // * is allowed; only named AI bots are blocked
  const r = parseRobots(`User-agent: *\nAllow: /\nUser-agent: ClaudeBot\nDisallow: /\nUser-agent: GPTBot\nDisallow: /`);
  assert.equal(robotsAllows(r, "affiliate-watch/0.1", "/terms"), true);
  assert.equal(robotsAllows(r, "ClaudeBot/1.0", "/terms"), false);
});

test("longest-match wins between allow and disallow", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /members/\nAllow: /members/public`);
  assert.equal(robotsAllows(r, "x", "/members/secret"), false);
  assert.equal(robotsAllows(r, "x", "/members/public/list"), true);
});

test("wildcard + $ anchors in paths", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /*/visit_casino\nDisallow: /go$`);
  assert.equal(robotsAllows(r, "x", "/redirects/123/visit_casino"), false);
  assert.equal(robotsAllows(r, "x", "/go"), false);
  assert.equal(robotsAllows(r, "x", "/gone"), true); // $ anchored
});

// ---- fetchPage with a mock fetch (robots + page), zero network ----
function mockFetch(routes) {
  return async (url) => {
    const r = routes[url];
    if (!r) return { ok: false, status: 404, async text() { return ""; } };
    return { ok: r.status < 400, status: r.status, async text() { return r.body || ""; } };
  };
}

test("fetchPage returns status+body for an allowed page", async () => {
  const fetchImpl = mockFetch({
    "https://ex.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow:" },
    "https://ex.com/terms": { status: 200, body: "<p>hi</p>" }
  });
  const fetchPage = makeFetchPage({ fetchImpl });
  const res = await fetchPage({ url: "https://ex.com/terms" }, { userAgent: "affiliate-watch/0.1" });
  assert.equal(res.status, 200);
  assert.match(res.body, /hi/);
});

test("fetchPage REFUSES a robots-disallowed page (G1: no bypass)", async () => {
  const fetchImpl = mockFetch({
    "https://ex.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" },
    "https://ex.com/terms": { status: 200, body: "<p>secret</p>" }
  });
  const fetchPage = makeFetchPage({ fetchImpl });
  const res = await fetchPage({ url: "https://ex.com/terms" }, { userAgent: "affiliate-watch/0.1" });
  assert.equal(res.robotsBlocked, true);
  assert.equal(res.status, 0);
  assert.equal(res.body, "");
});

test("missing robots.txt => allowed", async () => {
  const fetchImpl = mockFetch({
    "https://ex.com/terms": { status: 200, body: "ok" }
    // no robots route -> 404 -> treated as allowed
  });
  const fetchPage = makeFetchPage({ fetchImpl });
  const res = await fetchPage({ url: "https://ex.com/terms" }, { userAgent: "x" });
  assert.equal(res.status, 200);
});

test("--no-robots equivalent: respectRobots:false skips robots fetch", async () => {
  let robotsRequested = false;
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) robotsRequested = true;
    return { ok: true, status: 200, async text() { return "page"; } };
  };
  const fetchPage = makeFetchPage({ fetchImpl, respectRobots: false });
  const res = await fetchPage({ url: "https://ex.com/terms" }, { userAgent: "x" });
  assert.equal(res.status, 200);
  assert.equal(robotsRequested, false);
});
