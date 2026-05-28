// Line diff + numeric extraction. No I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffText, extractNumbers } from "../src/diff.mjs";

test("diffText reports added and removed lines", () => {
  const d = diffText("a\nb\nc", "a\nc\nd");
  assert.equal(d.changed, true);
  assert.deepEqual(d.removed, ["b"]);
  assert.deepEqual(d.added, ["d"]);
});

test("diffText: identical text -> not changed", () => {
  const d = diffText("x\ny", "x\ny");
  assert.equal(d.changed, false);
  assert.equal(d.added.length, 0);
  assert.equal(d.removed.length, 0);
});

test("diffText is multiset-aware (duplicate lines)", () => {
  const d = diffText("a\na\nb", "a\nb");
  assert.deepEqual(d.removed, ["a"]); // one of the two 'a' lines removed
  assert.equal(d.added.length, 0);
});

test("extractNumbers: percentages", () => {
  const ns = extractNumbers("up to 45% revshare, was 25%");
  const pcts = ns.filter((n) => n.kind === "percent").map((n) => n.value);
  assert.deepEqual(pcts.sort((a, b) => a - b), [25, 45]);
});

test("extractNumbers: currency before and after the amount", () => {
  const ns = extractNumbers("min €100, CPA $1,500.50, or 200 EUR");
  const money = ns.filter((n) => n.kind === "money").map((n) => n.value).sort((a, b) => a - b);
  assert.deepEqual(money, [100, 200, 1500.5]);
});

test("extractNumbers: european decimal/thousands separators", () => {
  const ns = extractNumbers("€1.500,50 and 45,5%");
  const money = ns.find((n) => n.kind === "money");
  const pct = ns.find((n) => n.kind === "percent");
  assert.equal(money.value, 1500.5);
  assert.equal(pct.value, 45.5);
});

test("diffText surfaces before/after numbers for the classifier", () => {
  const d = diffText("revshare up to 45%", "revshare up to 25%");
  const before = d.numbers.before.filter((n) => n.kind === "percent").map((n) => n.value);
  const after = d.numbers.after.filter((n) => n.kind === "percent").map((n) => n.value);
  assert.deepEqual(before, [45]);
  assert.deepEqual(after, [25]);
});
