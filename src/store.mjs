// Local snapshot store. The ONLY filesystem-writing module besides the CLI.
// One JSON file per watched URL (keyed by a slug of the URL) under a store dir,
// plus an index. Kept dead-simple and human-inspectable (you can open a
// snapshot file and read the stored normalized text).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Deterministic, filesystem-safe filename for a URL.
export function slugFor(url) {
  const h = createHash("sha1").update(String(url)).digest("hex").slice(0, 12);
  const readable = String(url)
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `${readable}.${h}.json`;
}

// A file-backed store implementing the { get, set } interface runWatch wants.
// All snapshots live in `dir` (created on first write). Reads are lazy + cached.
export function makeFileStore(dir) {
  const cache = new Map(); // url -> snapshot|null

  function pathFor(url) { return join(dir, slugFor(url)); }

  return {
    dir,
    get(url) {
      if (cache.has(url)) return cache.get(url);
      const p = pathFor(url);
      if (!existsSync(p)) { cache.set(url, null); return null; }
      try {
        const snap = JSON.parse(readFileSync(p, "utf8"));
        cache.set(url, snap);
        return snap;
      } catch {
        cache.set(url, null);
        return null;
      }
    },
    set(url, snapshot) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(pathFor(url), JSON.stringify(snapshot, null, 2) + "\n");
      cache.set(url, snapshot);
    },
    // how many baselines are stored (for the CLI to report on --init)
    count() {
      if (!existsSync(dir)) return 0;
      return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
    }
  };
}

// An in-memory store with the same interface — used by tests (no disk I/O).
export function makeMemoryStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get(url) { return map.has(url) ? map.get(url) : null; },
    set(url, snapshot) { map.set(url, snapshot); },
    count() { return map.size; },
    _map: map
  };
}
