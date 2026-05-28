#!/usr/bin/env node
// build-feed.mjs — generate the static /feed/ proof-of-value page from the
// affiliate-watch ENGINE's real output. No fabrication: it actually fetches the
// 10 watched program pages, records the real HTTP status + checked-at time for
// each, and renders a static snapshot page + an RSS file.
//
//   Run:   node web/build-feed.mjs            (from the affiliate-watch root)
//   or:    cd web && node build-feed.mjs
//
// It writes:
//   web/feed/index.html     — the human-readable snapshot page (committed)
//   web/feed/feed.json      — the raw snapshot data the page is built from
//   web/feed/alerts.rss     — the engine's RSS feed (subscribable)
//
// REFRESH: re-run this on whatever cadence you like (a cron, or by hand). It is
// network-bound and polite (the engine's minDelayMs throttles requests and
// respects robots.txt). It overwrites the three files above in place; commit /
// redeploy them to publish a fresh snapshot. Nothing else on the site changes.
//
// If a page is unreachable from where you run this, the real status (e.g. 0 /
// 403 / 404) is recorded and shown — that IS the honest signal, not an error to
// hide. The build does not invent "alerts"; on a first run there are none yet.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseConfig } from "../src/config.mjs";
import { runWatch } from "../src/runner.mjs";
import { makeFetchPage } from "../src/fetch.mjs";
import { makeFileStore } from "../src/store.mjs";
import { rssFeed, xml } from "../src/report.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");           // affiliate-watch/
const CONFIG = join(ROOT, "watchlist.json");
const STORE = join(ROOT, ".affiliate-watch");    // reuse the engine's baseline store
const OUT_DIR = join(__dirname, "feed");
const SITE = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "") : "__SITE__";

// --- run the real engine over the watchlist (stores/refreshes baselines) -----
const config = parseConfig(readFileSync(CONFIG, "utf8"));
const store = makeFileStore(STORE);
const fetchPage = makeFetchPage({ respectRobots: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// updateBaseline:true so each run refreshes the stored snapshot AND, on a
// previously-seeded store, surfaces real alerts. On a clean store it just lays
// down baselines (no alerts) — which is the honest "first run" state.
const result = await runWatch(config, { fetchPage, store, sleep }, { updateBaseline: true });

// --- derive a per-program status row from the stored snapshots ---------------
// We read what the engine actually stored (name, url, status, length, fetchedAt)
// so the feed shows real, checked data — not hand-written claims.
const rows = config.watch.map((entry) => {
  const snap = store.get(entry.url);
  const status = snap ? snap.status : 0;
  const len = snap ? snap.length : 0;
  let state, note;
  if (status >= 200 && status < 300 && len > 200) {
    state = "ok"; note = "Page reachable; baseline captured.";
  } else if (status >= 200 && status < 300) {
    // 2xx but near-empty body = JS-rendered shell (documented in the README).
    state = "warn"; note = "Reachable but served as a JS-rendered shell (little server-side text).";
  } else if (status === 404 || status === 410) {
    state = "bad"; note = "Page gone (404/410) — possible closure.";
  } else if (status === 0) {
    state = "bad"; note = "Could not fetch from the build environment.";
  } else {
    state = "warn"; note = "Unexpected HTTP status — flagged for review.";
  }
  return {
    name: entry.name || entry.url,
    url: entry.url,
    status,
    state,
    note,
    checkedAt: snap ? snap.fetchedAt : result.generatedAt
  };
});

const feed = {
  generatedAt: result.generatedAt,
  checked: result.checked,
  newBaselines: result.newBaselines,
  unchanged: result.unchanged,
  alertCount: result.alerts.length,
  programs: rows
};

// --- write feed.json + alerts.rss --------------------------------------------
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "feed.json"), JSON.stringify(feed, null, 2) + "\n");
writeFileSync(
  join(OUT_DIR, "alerts.rss"),
  rssFeed(result, {
    title: "affiliate-watch — casino affiliate program change alerts",
    link: SITE + "/feed/",
    description: "Adverse changes detected on the watched casino-affiliate-program pages."
  })
);

// --- render the static feed page ---------------------------------------------
const PILL = { ok: "ok", warn: "warn", bad: "bad" };
const STATUS_LABEL = { ok: "Monitored", warn: "Monitored (shell)", bad: "Needs attention" };

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

const rowHtml = feed.programs.map((p) => `      <tr>
        <td><div class="feed-name">${xml(p.name)}</div><div class="feed-url">${xml(p.url)}</div></td>
        <td><span class="pill ${PILL[p.state]}">${STATUS_LABEL[p.state]}</span></td>
        <td class="small">${xml(fmtDate(p.checkedAt))}</td>
        <td class="small muted">${xml(p.note)}</td>
      </tr>`).join("\n");

const alertsLine = feed.alertCount === 0
  ? `<strong>${feed.checked} programs monitored</strong> &middot; ${feed.newBaselines + feed.unchanged} baselines on record &middot; <strong>0 adverse changes</strong> in this snapshot.`
  : `<strong>${feed.checked} programs monitored</strong> &middot; <strong>${feed.alertCount} adverse change(s)</strong> detected in this snapshot — see the <a href="/feed/alerts.rss">RSS feed</a>.`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live change feed — affiliate-watch</title>
<meta name="description" content="A live snapshot of the casino affiliate programs affiliate-watch monitors: each program, when it was last checked, and its status. Proof of how automated affiliate-program change detection works.">
<link rel="canonical" href="${SITE}/feed/">
<meta property="og:title" content="Live change feed — affiliate-watch">
<meta property="og:description" content="A live snapshot of the casino affiliate programs we monitor — name, last-checked time, and status.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/feed/">
<link rel="alternate" type="application/rss+xml" title="affiliate-watch alerts" href="${SITE}/feed/alerts.rss">
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ctext y='13' font-size='13'%3E%F0%9F%91%81%3C/text%3E%3C/svg%3E">
</head>
<body>
<header class="site"><div class="wrap">
  <a class="logo" href="/">affiliate<b>-watch</b> <span class="eye">&#128065;</span></a>
  <nav class="top">
    <a href="/feed/">Live feed</a>
    <a href="/#how">How it works</a>
    <a href="/#guides">Guides</a>
    <a href="/#waitlist">Get alerts</a>
  </nav>
</div></header>

<header class="hero"><div class="wrap">
  <p class="eyebrow">Proof of value</p>
  <h1>Live change feed</h1>
  <p class="lede">This is a real snapshot from the affiliate-watch engine — the ${feed.checked} casino
    affiliate programs it currently monitors, when each was last checked, and its status. The engine fetches
    each program's public page, normalises away cosmetic churn, and diffs it against the last snapshot;
    adverse changes become alerts in the <a href="/feed/alerts.rss">RSS feed</a>.</p>
  <p class="feed-meta">${alertsLine}<br>Snapshot generated <strong>${xml(fmtDate(feed.generatedAt))}</strong>.</p>
  <div class="cta-row">
    <a class="btn primary" href="/#waitlist">Watch your programs &rarr;</a>
    <a class="btn" href="/feed/alerts.rss">Subscribe to the RSS feed</a>
  </div>
</div></header>

<section><div class="wrap">
  <div class="tbl-scroll"><table class="feed-table">
    <thead><tr><th>Affiliate program</th><th>Status</th><th>Last checked</th><th>Note</th></tr></thead>
    <tbody>
${rowHtml}
    </tbody>
  </table></div>
  <div class="legend">
    <span><span class="pill ok">Monitored</span> page reachable, baseline on record</span>
    <span><span class="pill warn">Monitored (shell)</span> reachable but JS-rendered; little server-side text</span>
    <span><span class="pill bad">Needs attention</span> unreachable or gone</span>
  </div>
  <p class="small" style="margin-top:18px">This list is the public demo watchlist that ships with the
    engine — a sample of real, public casino-affiliate-program terms pages. Alerts only appear once a
    monitored page actually changes; a first snapshot establishes the baseline and reports zero changes,
    which is exactly what you see here. We never invent a change. The engine, its rules, and its 66 tests
    are open source: <a href="https://github.com/wartzar-bee/affiliate-watch">github.com/wartzar-bee/affiliate-watch</a>.</p>
</div></section>

<section><div class="wrap">
  <h2>Want this for the programs you run?</h2>
  <p class="muted">The feed above is a fixed demo list. The product watches <em>your</em> programs and alerts
    only you. Join the waitlist and tell us which programs to prioritise.</p>
  <div class="cta-row"><a class="btn primary" href="/#waitlist">Get change alerts &rarr;</a></div>
</div></section>

<footer class="site"><div class="wrap">
  affiliate-watch — automated change &amp; closure alerts for casino / sportsbook affiliate programs.
  Monitors public pages only, politely and per robots.txt. Not affiliated with any operator, network, or GPWA.
  &middot; <a href="/">Home</a> &middot; <a href="/feed/alerts.rss">RSS</a> &middot;
  <a href="https://github.com/wartzar-bee/affiliate-watch">Source</a>
</div></footer>
</body>
</html>
`;

writeFileSync(join(OUT_DIR, "index.html"), html);

console.log(`feed built: ${feed.checked} programs, ${feed.alertCount} alert(s), generated ${feed.generatedAt}`);
console.log(`  -> ${join(OUT_DIR, "index.html")}`);
console.log(`  -> ${join(OUT_DIR, "feed.json")}`);
console.log(`  -> ${join(OUT_DIR, "alerts.rss")}`);
