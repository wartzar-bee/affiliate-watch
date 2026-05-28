#!/usr/bin/env bash
# Build the affiliate-watch web surface into ./dist with the real domain injected.
#
#   Usage: ./build.sh https://your-domain.pages.dev
#
# Steps:
#   1. (optional) refresh the live feed snapshot from the real engine:
#        node build-feed.mjs        # re-fetches the 10 programs, regenerates feed/
#      Run this first if you want a fresh snapshot; it's network-bound + polite.
#   2. copy site -> dist, drop build-only files, inject __SITE__ -> your domain.
#   3. deploy:  npx wrangler pages deploy dist --project-name affiliate-watch
#      (KV namespace `WAITLIST` must exist + be bound first — see wrangler.toml.)
set -euo pipefail
SITE_URL="${1:-}"; [[ -z "$SITE_URL" ]] && { echo "Usage: $0 <site-url>" >&2; exit 1; }
SITE_URL="${SITE_URL%/}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

rm -rf "$ROOT/dist"
mkdir -p "$ROOT/dist"
# Copy everything except build tooling and node cruft into dist.
cp -r "$ROOT/index.html" "$ROOT/robots.txt" "$ROOT/sitemap.xml" \
      "$ROOT/assets" "$ROOT/feed" "$ROOT/functions" \
      "$ROOT/casino-affiliate-program-changes-tracker" \
      "$ROOT/affiliate-program-still-paying" \
      "$ROOT/affiliate-terms-commission-monitoring" \
      "$ROOT/negative-carryover-casino-affiliate" \
      "$ROOT/gpwa-affiliate-program-warnings-automated" \
      "$ROOT/dist/"
# wrangler.toml stays at the project root for deploy; it is NOT served.

# Inject the real domain into canonical/OG/sitemap/robots/feed.
find "$ROOT/dist" -type f \( -name '*.html' -o -name '*.xml' -o -name '*.txt' -o -name '*.rss' \) -print0 \
  | xargs -0 sed -i "s#__SITE__#${SITE_URL}#g"

echo "Built for ${SITE_URL} -> ${ROOT}/dist"
echo "Deploy: npx wrangler pages deploy \"${ROOT}/dist\" --project-name affiliate-watch"
echo "Reminder: create + bind the WAITLIST KV namespace first (see wrangler.toml)."
