// Core run logic. Pure & I/O-free: `fetchPage` and the snapshot store are
// INJECTED, so the whole pipeline unit-tests with fixtures + an in-memory store
// — no network in tests (house rule L-008).
import { makeSnapshot } from "./snapshot.mjs";
import { diffText } from "./diff.mjs";
import { classifyChange } from "./classify.mjs";

// Run the watchlist: for each entry, fetch -> snapshot -> diff vs stored
// baseline -> classify. Collect alerts. Optionally write new baselines.
//
//   config    : normalized config (config.mjs) { userAgent, minDelayMs, watch }
//   deps      : {
//                 fetchPage : async (entry, { userAgent }) => { status, body, fetchedAt? }
//                 store     : { get(url) -> snapshot|null, set(url, snapshot) }
//                 now?      : () => Date
//                 sleep?    : async (ms) => void   (politeness delay; no-op in tests)
//               }
//   opts      : { updateBaseline?: bool }  // persist fresh snapshots as new baseline
//
// Returns a RESULT:
//   { generatedAt, checked, unchanged, newBaselines, alerts: [alertRecord...] }
export async function runWatch(config, deps, opts = {}) {
  const { fetchPage, store } = deps;
  const now = deps.now || (() => new Date());
  const sleep = deps.sleep || (async () => {});
  if (typeof fetchPage !== "function") throw new Error("deps.fetchPage must be a function");
  if (!store || typeof store.get !== "function" || typeof store.set !== "function")
    throw new Error("deps.store must implement get(url) and set(url, snapshot)");

  const alerts = [];
  let unchanged = 0, newBaselines = 0;

  for (let i = 0; i < config.watch.length; i++) {
    const entry = config.watch[i];
    if (i > 0 && config.minDelayMs > 0) await sleep(config.minDelayMs);

    let raw;
    try {
      raw = await fetchPage(entry, { userAgent: config.userAgent });
    } catch (e) {
      raw = { status: 0, body: "", error: e && e.message ? e.message : String(e) };
    }

    const snap = makeSnapshot(entry, raw, now());
    const prev = store.get(entry.url);

    // Diff only when we have a usable prior snapshot AND the fetch succeeded.
    const canDiff = prev && snap.status >= 200 && snap.status < 400;
    const diff = canDiff ? diffText(prev.text, snap.text) : null;

    const alert = classifyChange(snap, diff, prev);

    if (alert) {
      alerts.push(alert);
    } else if (!prev) {
      newBaselines++;
    } else {
      unchanged++;
    }

    // Persist:
    //  - first sighting (prev == null): always store baseline (success only).
    //  - --update-baseline: store the fresh successful snapshot as new baseline.
    // We never overwrite a good baseline with a failed (non-2xx) fetch.
    const fetchedOk = snap.status >= 200 && snap.status < 400;
    if (fetchedOk && (!prev || opts.updateBaseline)) {
      store.set(entry.url, snap);
    }
  }

  return {
    generatedAt: now().toISOString(),
    checked: config.watch.length,
    unchanged,
    newBaselines,
    alerts
  };
}
