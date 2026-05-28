// End-to-end run + baseline-compare via an IN-MEMORY store and FIXTURE fetch.
// No network, no disk (house rule L-008).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runWatch } from "../src/runner.mjs";
import { normalizeConfig } from "../src/config.mjs";
import { makeMemoryStore } from "../src/store.mjs";
import * as F from "./fixtures.mjs";

const URL = "https://example.com/terms";
const cfg = normalizeConfig({
  minDelayMs: 0,
  watch: [{ name: "Example Program", url: URL, selector: "#terms" }]
});

test("first run with no baseline records baseline, emits no alerts", async () => {
  const store = makeMemoryStore();
  const fetchPage = F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE });
  const res = await runWatch(cfg, { fetchPage, store }, { updateBaseline: true });
  assert.equal(res.alerts.length, 0);
  assert.equal(res.newBaselines, 1);
  assert.ok(store.get(URL)); // baseline stored
});

test("second run, unchanged content => no alert, counted unchanged", async () => {
  const store = makeMemoryStore();
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE }), store }, { updateBaseline: true });
  const res = await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE }), store }, {});
  assert.equal(res.alerts.length, 0);
  assert.equal(res.unchanged, 1);
});

test("commission cut on second run => one HIGH commission-change alert", async () => {
  const store = makeMemoryStore();
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE }), store }, { updateBaseline: true });
  const res = await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_AFTER_CUT }), store }, {});
  assert.equal(res.alerts.length, 1);
  assert.equal(res.alerts[0].category, "commission-change");
  assert.equal(res.alerts[0].severity, "high");
});

test("baseline is NOT overwritten unless --update-baseline", async () => {
  const store = makeMemoryStore();
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE }), store }, { updateBaseline: true });
  // run #2 sees the cut but we do NOT update -> baseline stays the original
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_AFTER_CUT }), store }, {});
  const stillOld = store.get(URL);
  assert.match(stillOld.text, /up to 45%/);
  // run #3 (no update) STILL alerts because baseline never moved
  const res3 = await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_AFTER_CUT }), store }, {});
  assert.equal(res3.alerts.length, 1);
});

test("--update-baseline accepts the new state (next run is quiet)", async () => {
  const store = makeMemoryStore();
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE }), store }, { updateBaseline: true });
  // accept the cut as the new normal
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_AFTER_CUT }), store }, { updateBaseline: true });
  const res = await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_AFTER_CUT }), store }, {});
  assert.equal(res.alerts.length, 0);
  assert.equal(res.unchanged, 1);
});

test("a failed fetch (404) does NOT overwrite a good baseline", async () => {
  const store = makeMemoryStore();
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE }), store }, { updateBaseline: true });
  const res = await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: { status: 404, body: "" } }), store }, { updateBaseline: true });
  assert.equal(res.alerts[0].category, "unreachable");
  // baseline still holds the good content
  assert.match(store.get(URL).text, /up to 45%/);
});

test("a thrown fetch error is captured as unreachable, not a crash", async () => {
  const store = makeMemoryStore();
  await runWatch(cfg, { fetchPage: F.fixtureFetch({ [URL]: F.COMMISSION_BEFORE }), store }, { updateBaseline: true });
  const boom = async () => { throw new Error("ECONNRESET"); };
  const res = await runWatch(cfg, { fetchPage: boom, store }, {});
  assert.equal(res.alerts.length, 1);
  assert.equal(res.alerts[0].category, "unreachable");
});

test("politeness delay is invoked between (not before) requests", async () => {
  const twoCfg = normalizeConfig({
    minDelayMs: 50,
    watch: [
      { name: "A", url: "https://a/terms", selector: "#terms" },
      { name: "B", url: "https://b/terms", selector: "#terms" }
    ]
  });
  const store = makeMemoryStore();
  let sleeps = 0;
  const sleep = async () => { sleeps++; };
  const fetchPage = F.fixtureFetch({ "https://a/terms": F.COMMISSION_BEFORE, "https://b/terms": F.COMMISSION_BEFORE });
  await runWatch(twoCfg, { fetchPage, store, sleep }, { updateBaseline: true });
  assert.equal(sleeps, 1); // delay between the 2 pages, not before the first
});
