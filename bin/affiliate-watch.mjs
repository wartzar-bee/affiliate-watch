#!/usr/bin/env node
// affiliate-watch — know the moment a casino-affiliate program changes its
// terms, cuts your commission, blocks your GEO, or closes.
//
// Reads a watchlist.json of PUBLIC affiliate-program pages, snapshots + diffs
// each against a stored baseline, classifies adverse changes, and emits the
// alert feed as a human report, JSON, and an RSS file. It respects robots.txt
// and rate-limits politely. No secrets, no accounts, no auth bypass.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseConfig } from "../src/config.mjs";
import { runWatch } from "../src/runner.mjs";
import { makeFetchPage } from "../src/fetch.mjs";
import { makeFileStore } from "../src/store.mjs";
import { renderReport, jsonReport, rssFeed } from "../src/report.mjs";
import { SEVERITY_RANK } from "../src/classify.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : undefined; };

if (has("-h") || has("--help")) {
  console.log(`affiliate-watch — know the moment an affiliate program changes its terms / closes / cuts your commission.

Usage:
  affiliate-watch                  run: snapshot + diff each watched page, alert on adverse changes
  affiliate-watch --init           first run: fetch every page and store baselines (no alerts)
  affiliate-watch --update-baseline run, then accept current pages as the new baseline
  affiliate-watch --config <path>  watchlist file (default: ./watchlist.json)
  affiliate-watch --store <dir>    snapshot store dir (default: ./.affiliate-watch)
  affiliate-watch --json           machine-readable output (stdout)
  affiliate-watch --rss <path>     also write an RSS 2.0 feed of alerts to <path>
  affiliate-watch --fail-on <sev>  exit 1 if any alert >= severity (critical|high|medium|low)
  affiliate-watch --no-robots      do NOT consult robots.txt (use only on pages you own/are permitted)
  affiliate-watch --no-color       plain output

Exit codes: 0 = ok · 1 = alert at/above --fail-on severity · 2 = usage/config error.
Only monitor pages you are permitted to. robots.txt is respected by default.`);
  process.exit(0);
}
if (has("--no-color")) process.env.NO_COLOR = "1";

const configPath = valOf("--config") || "watchlist.json";
const storeDir = valOf("--store") ||
  join(existsSync(configPath) ? dirname(configPath) : ".", ".affiliate-watch");
const rssPath = valOf("--rss");
const failOn = valOf("--fail-on");

if (failOn && !(failOn in SEVERITY_RANK)) {
  console.error(`--fail-on must be one of: critical, high, medium, low`);
  process.exit(2);
}

// --- load watchlist ---
if (!existsSync(configPath)) {
  console.error(`Watchlist not found: ${configPath}\nCreate one (see README / examples/watchlist.json) or pass --config <path>.`);
  process.exit(2);
}
let config;
try { config = parseConfig(readFileSync(configPath, "utf8")); }
catch (e) { console.error("Watchlist error: " + e.message); process.exit(2); }

// --- run ---
const store = makeFileStore(storeDir);
const fetchPage = makeFetchPage({ respectRobots: !has("--no-robots") });
const updateBaseline = has("--init") || has("--update-baseline");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let result;
try {
  result = await runWatch(config, { fetchPage, store, sleep }, { updateBaseline });
} catch (e) {
  console.error("Run failed: " + e.message);
  process.exit(2);
}

// --- RSS side-output ---
if (rssPath) {
  try { writeFileSync(rssPath, rssFeed(result)); }
  catch (e) { console.error("Could not write RSS feed: " + e.message); process.exit(2); }
}

// --- report ---
if (has("--json")) console.log(JSON.stringify(jsonReport(result), null, 2));
else console.log(renderReport(result));

if (has("--init")) {
  if (!has("--json")) console.log(`  Baselines stored in ${storeDir} (${store.count()} page(s)). Re-run later to detect changes.\n`);
}

// --- exit code ---
let exit = 0;
if (failOn) {
  const threshold = SEVERITY_RANK[failOn];
  const hit = result.alerts.some((a) => (SEVERITY_RANK[a.severity] || 0) >= threshold);
  exit = hit ? 1 : 0;
}
process.exit(exit);
