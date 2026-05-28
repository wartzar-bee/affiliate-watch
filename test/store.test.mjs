// File-backed snapshot store. Uses an OS temp dir (cleaned up); the only test
// that touches disk — purely to prove persistence + the get/set contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFileStore, makeMemoryStore, slugFor } from "../src/store.mjs";

test("slugFor is deterministic, fs-safe, and url-specific", () => {
  const a = slugFor("https://www.example.com/terms-and-conditions/");
  const b = slugFor("https://www.example.com/terms-and-conditions/");
  const c = slugFor("https://www.example.com/other");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-z0-9.-]+\.json$/);
});

test("memory store get/set/count contract", () => {
  const s = makeMemoryStore();
  assert.equal(s.get("u"), null);
  s.set("u", { hash: "h", text: "t" });
  assert.equal(s.get("u").hash, "h");
  assert.equal(s.count(), 1);
});

test("file store persists a snapshot and reads it back", () => {
  const dir = mkdtempSync(join(tmpdir(), "affwatch-"));
  try {
    const s = makeFileStore(dir);
    assert.equal(s.get("https://x/terms"), null);
    assert.equal(s.count(), 0);
    s.set("https://x/terms", { hash: "abc", text: "hello", url: "https://x/terms" });
    // a fresh store instance over the same dir must read it (no cache cheat)
    const s2 = makeFileStore(dir);
    const got = s2.get("https://x/terms");
    assert.equal(got.hash, "abc");
    assert.equal(got.text, "hello");
    assert.equal(s2.count(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file store returns null on corrupt snapshot file (no throw)", () => {
  const dir = mkdtempSync(join(tmpdir(), "affwatch-"));
  try {
    const url = "https://x/terms";
    makeFileStore(dir).set(url, { hash: "h", text: "t" });
    // overwrite the snapshot file with garbage, then read with a fresh store
    writeFileSync(join(dir, slugFor(url)), "{ not json");
    const s2 = makeFileStore(dir);
    assert.equal(s2.get(url), null); // graceful, no throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
