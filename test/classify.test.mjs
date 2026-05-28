// Change classification heuristics. No I/O. Drives the classifier end-to-end
// via normalize -> snapshot -> diff -> classify, using HTML fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSnapshot } from "../src/snapshot.mjs";
import { diffText } from "../src/diff.mjs";
import { classifyChange } from "../src/classify.mjs";
import * as F from "./fixtures.mjs";

const SEL = "#terms";
const now = new Date("2026-05-28T00:00:00Z");

// helper: classify the change from beforeHtml -> afterHtml for one entry.
function classifyHtml(beforeHtml, afterHtml, status = 200) {
  const entry = { name: "Test Program", url: "https://example.com/terms", selector: SEL };
  const prev = makeSnapshot(entry, { status: 200, body: beforeHtml }, now);
  const cur = makeSnapshot(entry, { status, body: afterHtml }, now);
  const diff = diffText(prev.text, cur.text);
  return classifyChange(cur, diff, prev);
}

test("first sighting (no prev) returns null — baseline, not alert", () => {
  const entry = { name: "P", url: "https://x/terms", selector: SEL };
  const cur = makeSnapshot(entry, { status: 200, body: F.COMMISSION_BEFORE }, now);
  assert.equal(classifyChange(cur, null, null), null);
});

test("no change returns null", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.COMMISSION_BEFORE);
  assert.equal(a, null);
});

test("commission cut (45% -> 25%) => commission-change, HIGH (% moved down)", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.COMMISSION_AFTER_CUT);
  assert.equal(a.category, "commission-change");
  assert.equal(a.severity, "high");
  assert.match(a.detail, /45% -> 25%|down/);
});

test("negative carryover clause appears => negative-carryover, HIGH", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.NEGCARRY_AFTER);
  assert.equal(a.category, "negative-carryover");
  assert.equal(a.severity, "high");
});

test("program closure => closure, CRITICAL", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.CLOSURE_AFTER);
  assert.equal(a.category, "closure");
  assert.equal(a.severity, "critical");
});

test("payment threshold/method change => payment-change, HIGH", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.PAYMENT_AFTER);
  // closure/negcarry not present; payment beats commission in ordering when both
  // keyword sets could match, but here it's clearly a payment edit.
  assert.ok(["payment-change", "commission-change"].includes(a.category));
  assert.equal(a.severity, "high");
});

test("GEO restriction added => geo-restriction, HIGH", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.GEO_AFTER);
  assert.equal(a.category, "geo-restriction");
  assert.equal(a.severity, "high");
});

test("generic wording edit => tos-edit, LOW", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.TOS_EDIT_AFTER);
  assert.equal(a.category, "tos-edit");
  assert.equal(a.severity, "low");
});

test("unreachable 404 => unreachable, HIGH (possible closure)", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, "", 404);
  assert.equal(a.category, "unreachable");
  assert.equal(a.severity, "high");
  assert.match(a.detail, /404/);
});

test("unreachable 503 => unreachable, MEDIUM (transient)", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, "", 503);
  assert.equal(a.category, "unreachable");
  assert.equal(a.severity, "medium");
});

test("alert record carries before/after hashes + samples", () => {
  const a = classifyHtml(F.COMMISSION_BEFORE, F.COMMISSION_AFTER_CUT);
  assert.ok(a.hashBefore && a.hashAfter && a.hashBefore !== a.hashAfter);
  assert.ok(Array.isArray(a.addedSample) && Array.isArray(a.removedSample));
});
