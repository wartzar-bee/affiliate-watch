// Snapshot creation + hashing. Pure — no I/O (the persisting of snapshots to
// disk happens in the CLI/store; here we only build the in-memory record).
import { createHash } from "node:crypto";
import { normalizePage } from "./normalize.mjs";

// Stable SHA-256 of a string, hex. The hash is over the NORMALIZED text, so
// cosmetic HTML churn (tokens, ad slots, whitespace) does not move it.
export function hashText(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

// Build a snapshot record from a raw fetched page.
//   entry : { name, url, selector? } from the watchlist
//   raw   : { status, body, fetchedAt? } as returned by fetchPage
//   now   : Date (injectable for deterministic tests)
//
// Returns:
//   { name, url, status, hash, text, length, scoped, fetchedAt }
// `text` is the normalized content we store so we can show a real diff later
// (not just "the hash changed"). Storing content is what lets us CLASSIFY.
export function makeSnapshot(entry, raw, now = new Date()) {
  const status = raw && typeof raw.status === "number" ? raw.status : 0;
  const body = raw && typeof raw.body === "string" ? raw.body : "";
  const { text, scoped } = normalizePage(body, entry && entry.selector);
  return {
    name: entry && entry.name ? entry.name : (entry && entry.url) || "(unnamed)",
    url: entry && entry.url ? entry.url : "",
    status,
    hash: hashText(text),
    text,
    length: text.length,
    scoped,
    fetchedAt: (raw && raw.fetchedAt) || now.toISOString()
  };
}
