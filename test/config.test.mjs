// Watchlist parsing + validation. No I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, normalizeConfig } from "../src/config.mjs";

test("parses a valid watchlist with defaults", () => {
  const c = parseConfig(JSON.stringify({
    watch: [{ name: "P", url: "https://x.com/terms" }]
  }));
  assert.equal(c.watch.length, 1);
  assert.equal(c.minDelayMs, 1500);
  assert.match(c.userAgent, /affiliate-watch/);
  assert.equal(c.watch[0].selector, undefined);
});

test("accepts legacy 'watchlist' key as well as 'watch'", () => {
  const c = normalizeConfig({ watchlist: [{ url: "https://x.com/a" }] });
  assert.equal(c.watch.length, 1);
  assert.equal(c.watch[0].name, "https://x.com/a"); // name defaults to url
});

test("keeps optional selector and custom userAgent/minDelay", () => {
  const c = normalizeConfig({
    userAgent: "mybot/1.0",
    minDelayMs: 3000,
    watch: [{ name: "P", url: "https://x.com/t", selector: "#terms" }]
  });
  assert.equal(c.userAgent, "mybot/1.0");
  assert.equal(c.minDelayMs, 3000);
  assert.equal(c.watch[0].selector, "#terms");
});

test("rejects invalid JSON", () => {
  assert.throws(() => parseConfig("{not json"), /not valid JSON/);
});

test("rejects non-object / empty watch", () => {
  assert.throws(() => normalizeConfig([]), /must be a JSON object/);
  assert.throws(() => normalizeConfig({ watch: [] }), /non-empty "watch"/);
  assert.throws(() => normalizeConfig({}), /non-empty "watch"/);
});

test("rejects non-http url and bad selector type", () => {
  assert.throws(() => normalizeConfig({ watch: [{ url: "ftp://x/y" }] }), /http\(s\) URL/);
  assert.throws(() => normalizeConfig({ watch: [{ url: "https://x/y", selector: 5 }] }), /selector must be a string/);
});

test("rejects duplicate URLs", () => {
  assert.throws(() => normalizeConfig({
    watch: [{ url: "https://x/y" }, { url: "https://x/y" }]
  }), /Duplicate url/);
});

test("rejects negative minDelayMs", () => {
  assert.throws(() => normalizeConfig({ minDelayMs: -1, watch: [{ url: "https://x/y" }] }), /non-negative/);
});
