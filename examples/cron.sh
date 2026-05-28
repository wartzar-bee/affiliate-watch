#!/usr/bin/env bash
# Example cron driver for affiliate-watch. There is NO built-in scheduler — you
# run the CLI on whatever cadence you like. This script runs the watch, writes
# an RSS feed of any alerts, and (optionally) pings a webhook on alerts. The
# delivery step is deliberately yours: the tool is channel-agnostic.
#
# Crontab (every 6 hours), e.g.:
#   0 */6 * * *  /path/to/affiliate-watch/examples/cron.sh >> /path/to/aw.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root (where watchlist.json lives)

# First time only: build baselines (no alerts). Comment out after the first run.
# node bin/affiliate-watch.mjs --init

# Run, capture JSON, and write an RSS feed of alerts.
JSON="$(node bin/affiliate-watch.mjs --json --rss alerts.rss)"
echo "$JSON"

# Count alerts and (optionally) deliver. Pick ONE channel — all read the same
# JSON/RSS, so swap freely (email, Slack, Telegram, dashboard, RSS reader…).
ALERTS="$(printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).alertCount||0)}catch{console.log(0)}})')"

if [ "${ALERTS:-0}" -gt 0 ]; then
  echo ">> $ALERTS alert(s) — deliver via your channel of choice."
  # Example: post the RSS to a Slack/Telegram-RSS bridge, or:
  # curl -fsS -X POST -H 'content-type: application/json' \
  #   --data "$JSON" "$AFFILIATE_WATCH_WEBHOOK_URL"
fi
