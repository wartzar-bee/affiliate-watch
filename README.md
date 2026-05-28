# affiliate-watch

**Know the moment a casino-affiliate program changes its terms, cuts your commission, blocks your GEO, or closes — instead of finding out on payday.**

If you send traffic to casino/sportsbook affiliate programs, your income lives or dies on terms you don't control. A program can quietly cut RevShare 45% → 25%, slip in a **negative-carryover** clause, raise the payout threshold, drop your payment method, block a GEO you rank for, lose its licence, or just close and stop paying. Today you find out **late** — when the payment is short, or when someone posts about it on a forum.

`affiliate-watch` is a small, local CLI that **snapshots a watchlist of public affiliate-program pages, diffs them on a schedule, classifies adverse changes, and alerts you** — as a human report, JSON, or an RSS feed you can pipe to email/Slack/Telegram/a dashboard.

```
$ affiliate-watch

  affiliate-watch  10 page(s) checked
  ──────────────────────────────────────────────
  8 unchanged   0 new   2 alert(s)

  CRITICAL  Acme Partners — Terms  [closure]
        https://acmepartners.example/terms
        matched "program is closed"
        - Revenue Share commission of up to 45% with no negative carryover.
        + This affiliate program is closed and no longer accepting new partners.

  HIGH  Big Slots Affiliates — Terms  [commission-change]
        https://bigslots.example/affiliate-terms
        top % moved 40% -> 25% (down)
        - Revenue Share commission of up to 40%.
        + Revenue Share commission of up to 25%.
```

## The job-to-be-done

> *"When a program I depend on changes its commission, adds negative carryover, raises the payout threshold, drops a payment method, restricts a GEO, loses its licence, or closes — tell me **immediately and specifically for the programs I watch**, so I can re-route traffic, renegotiate, or pull links before it costs me money."*

The €-impact of catching **one** silently-degraded or dead program in time easily exceeds the cost of watching for it. That's the whole pitch.

## Honest positioning (automated vs the manual GPWA forum)

The closest thing that exists today is the **GPWA "Affiliate Program Warnings" forum** — affiliates manually post when a program stops paying or worsens terms. It's valuable, but it's **manual, reactive, unstructured, and not per-affiliate**: someone has to notice, someone has to post, and you have to be reading at the right time. There is **no automated change-detection** that diffs a program's own pages and alerts *you* about *your* programs.

| | GPWA "Program Warnings" forum | affiliate-watch |
| --- | --- | --- |
| How a change is found | a human notices + posts | **automated snapshot + diff** of the program's own pages |
| Coverage | whatever people happen to report | **exactly your watchlist** |
| Latency | whenever someone posts | **every run** (cron) |
| Output | a forum thread to go read | **report / JSON / RSS** → your channel |
| Catches | mostly non-payment scandals | T&C edits, RevShare/CPA cuts, negative-carryover, payment/GEO/licence/closure |

affiliate-watch is **not** a replacement for the community signal of GPWA — human reports catch things a page diff can't (e.g. a program that pays late without changing any page). It's the **complementary automated half**: a diff-and-alert workflow pointed at the public pages, so you learn about a *documented* change the moment it's published, for the specific programs you care about.

> No fabricated claims here. The value is purely the **scheduled snapshot → diff → classify → alert** mechanism over public pages. It cannot see changes that aren't reflected on a public page (affiliate-portal-only terms, silent late payments).

## Quickstart

```
# 1. Edit watchlist.json — list the program terms pages you want to watch
#    (a seed list of ~10 real, public programs ships in examples/watchlist.json)

# 2. First run: fetch every page and store baselines (no alerts yet)
node bin/affiliate-watch.mjs --init

# 3. Later (or on a cron): detect & alert on changes since the baseline
node bin/affiliate-watch.mjs --rss alerts.rss

# 4. When a change is legitimate and you've accepted it, re-baseline:
node bin/affiliate-watch.mjs --update-baseline
```

Zero install/deps: Node ≥ 22, ESM, **no runtime dependencies** (stdlib + built-in `fetch` only).

## Watchlist (`watchlist.json`)

```json
{
  "userAgent": "affiliate-watch/0.1 (+set-your-contact@example.com)",
  "minDelayMs": 2000,
  "watch": [
    { "name": "LeoVegas Affiliates — Terms", "url": "https://www.leovegasaffiliates.com/terms-and-conditions" },
    { "name": "Betsson Group Affiliates — Terms", "url": "https://www.betssongroupaffiliates.com/terms-and-conditions/", "selector": "#terms" }
  ]
}
```

- **`url`** — a **public** affiliate-program page (terms / commission / status). Required, must be `http(s)`.
- **`name`** — label for reports (defaults to the URL).
- **`selector`** *(optional)* — a CSS-ish hint (`#id`, `.class`, or a tag name) to scope the diff to the real content region and ignore nav/cookie/footer chrome. Best-effort and dependency-free (no DOM engine); if it doesn't match, the whole page is used.
- **`userAgent`** — sent on every request. **Set an honest, identifying UA with a contact** (see Legal/ToS).
- **`minDelayMs`** — polite delay between requests (default 1500ms).

A starter list of ~10 real, public casino-affiliate-program terms pages ships in [`examples/watchlist.json`](examples/watchlist.json).

## What it detects (and how)

Each change is classified by transparent heuristics (keyword presence in *newly-added* text + numeric deltas) so you can always see *why* it alerted:

| Category | Severity | Triggered by (examples) |
| --- | --- | --- |
| `closure` | critical | "program is closed", "no longer accepting", "ceasing operations", "going direct" |
| `negative-carryover` | high | a negative-carryover clause appearing, or a "**no** negative carryover" reassurance being removed |
| `commission-change` | high / low | RevShare/CPA/commission wording changes; a **downward** headline % move = high, upward = low |
| `payment-change` | high | payout threshold/method/schedule, dropped payment provider, new fees |
| `geo-restriction` | high | "restricted countries", "not available in", "no longer accept traffic from" |
| `licence-change` | high | "licence revoked/suspended/withdrawn", "no longer licensed" |
| `tos-edit` | low | any other content change (catch-all — never silently dropped) |
| `unreachable` | high / medium | page 404/410 (possible closure) → high; other fetch errors → medium |

Cosmetic HTML churn (CSRF tokens, ad slots, whitespace) is normalized away **before** hashing, so chrome changes don't false-alarm.

## Channel-agnostic output (delivery is pluggable)

affiliate-watch **never talks to Telegram/Slack/email itself.** It emits artifacts and lets a thin delivery layer consume them — so you can route alerts anywhere:

- **(a) Human report** — default stdout, colorized, most-severe-first (`--no-color` for plain).
- **(b) JSON** — `--json` emits a stable machine-readable feed (`alertCount`, per-alert `category`/`severity`/`detail`/`hashBefore`/`hashAfter`/samples). Pipe to a webhook, a mailer, a Slack/Telegram bot, a dashboard.
- **(c) RSS 2.0 feed** — `--rss <path>` writes a valid feed (one `<item>` per alert, deterministic GUIDs so the same alert isn't re-notified). Subscribe with any RSS reader, or a Slack-RSS / IFTTT / email-digest bridge.

Same data, three shapes — pick (or stack) whatever channel you want.

## CLI

```
affiliate-watch                  run: snapshot + diff each watched page, alert on adverse changes
affiliate-watch --init           first run: fetch every page and store baselines (no alerts)
affiliate-watch --update-baseline run, then accept current pages as the new baseline
affiliate-watch --config <path>  watchlist file (default: ./watchlist.json)
affiliate-watch --store <dir>    snapshot store dir (default: ./.affiliate-watch)
affiliate-watch --json           machine-readable output
affiliate-watch --rss <path>     also write an RSS 2.0 feed of alerts
affiliate-watch --fail-on <sev>  exit 1 if any alert >= severity (critical|high|medium|low)
affiliate-watch --no-robots      skip robots.txt (ONLY for pages you own / are permitted to fetch)
affiliate-watch --no-color       plain output
```

Exit codes: **0** = ok · **1** = alert at/above `--fail-on` severity · **2** = usage/config error.

Snapshots are stored one JSON file per URL under the store dir (default `./.affiliate-watch/`), each containing the stored normalized text — so a diff shows the **real** before/after, not just "the hash moved."

## Scheduling (cron — there is no built-in scheduler)

V1 has no daemon. Run it on whatever cadence you like. An example driver is in [`examples/cron.sh`](examples/cron.sh):

```cron
# every 6 hours: run, write an RSS feed of alerts, deliver via your channel
0 */6 * * *  /path/to/affiliate-watch/examples/cron.sh >> /path/to/aw.log 2>&1
```

## Legal / ToS — monitor responsibly

This tool is for **public** pages only. By design it:

- **Only fetches publicly accessible pages.** It never logs in, and never bypasses auth or paywalls. A `401`/`403` is reported as `unreachable`, **not** worked around.
- **Respects `robots.txt`** for your user-agent by default (most-specific group wins; longest-match allow/disallow). If a page is disallowed for you, it is skipped (`robotsBlocked`), not fetched. `--no-robots` exists only for pages **you own or are explicitly permitted** to fetch.
- **Rate-limits politely** (`minDelayMs`, default 1500ms between requests) and sends an honest, identifying user-agent — **set yours with a contact** in `watchlist.json`.

**You are responsible for only monitoring pages you are permitted to.** Check each target's Terms of Service and `robots.txt`. Some programs disallow automated access (e.g. via `robots.txt`, an aggressive bot-wall, or ToS) — **skip those.**

Notes on the seeded list (verified 2026-05-28, all returned HTTP 200 and `robots.txt` allows a generic agent on the terms path):
- Some pages are JS-rendered shells served as small HTML (e.g. LeoVegas/Betway) — affiliate-watch monitors the served HTML; for SPA-only content you may need a page that renders server-side, or a future headless-render mode.
- **Dropped during seeding:**
  - **Royal Partners** (`royal.partners`) — returned **HTTP 403** behind a Cloudflare bot-wall; treat as not-permitted, skip.
  - **888 / Videoslots Affiliates** — could not confirm public reachability from the build environment (connection failures); left out until verifiable.
  - **Gambling-Affiliation** (`gambling-affiliation.com`) — its terms page is public and `robots.txt`-allowed, but it consistently rejects Node's `fetch` (TLS/HTTP2 fingerprint) while serving `curl` fine; dropped to keep the seed list clean. (It's also a network aggregator, not an operator program.)
- **Galaxy Affiliates** is included: its `robots.txt` allows `User-agent: *` (`Allow: /`) and only blocks named AI-training crawlers — a generic monitoring agent is permitted.

## Design / how to verify

- Node 22, ESM, **zero runtime dependencies**.
- A **pure, network-free core** — `normalize`, `snapshot`, `diff`, `classify`, `config`, `report`, `runner` — with the **only network I/O** (`src/fetch.mjs`) and the **only disk I/O** (`src/store.mjs`) behind injectable interfaces. So the whole pipeline **unit-tests with HTML fixtures + an in-memory store — no network in tests.**

```
npm test     # node --test — 66 tests, all offline
```

Tests cover: HTML normalization + chrome-churn stability, line diff + numeric (percent/currency, EU separators) extraction, every change classification, baseline compare (alert / no-alert / no-overwrite / accept), config parsing, RSS validity + XML escaping, robots.txt parsing/matching, and the file store.

## Status / roadmap

- **v0.1 (this build):** watchlist snapshot + diff + heuristic classification, baseline compare, human/JSON/RSS output, robots-respecting polite fetch, file store, cron example. 66 unit tests. This is a tight **demand-test MVP**, not the full product.
- **Not built (deliberately, V1):** web UI, multi-tenant, built-in scheduler/daemon, headless JS rendering, affiliate-portal (logged-in) terms, new-program/SERP radar, hosted alerting.

## License

MIT
