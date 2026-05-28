// Output rendering: JSON shape + RSS validity. No I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonReport, rssFeed, renderReport, sortAlerts, xml, rfc822 } from "../src/report.mjs";

function sampleResult() {
  return {
    generatedAt: "2026-05-28T10:00:00.000Z",
    checked: 3,
    unchanged: 1,
    newBaselines: 0,
    alerts: [
      { name: "Low Program", url: "https://low/terms", category: "tos-edit", severity: "low",
        detail: "1 line added", hashBefore: "a", hashAfter: "b", at: "2026-05-28T10:00:00.000Z",
        addedSample: ["Please read carefully."], removedSample: [] },
      { name: "Crit Program", url: "https://crit/terms", category: "closure", severity: "critical",
        detail: 'matched "program is closed"', hashBefore: "c", hashAfter: "d", at: "2026-05-28T10:00:00.000Z",
        addedSample: ["This program is closed."], removedSample: ["We pay 45%."] }
    ]
  };
}

test("sortAlerts puts most severe first", () => {
  const sorted = sortAlerts(sampleResult().alerts);
  assert.equal(sorted[0].severity, "critical");
  assert.equal(sorted[1].severity, "low");
});

test("jsonReport has stable, channel-agnostic shape", () => {
  const j = jsonReport(sampleResult());
  assert.equal(j.alertCount, 2);
  assert.equal(j.checked, 3);
  assert.equal(j.alerts[0].severity, "critical"); // sorted
  for (const k of ["name", "url", "category", "severity", "detail", "hashAfter", "at"])
    assert.ok(k in j.alerts[0], "missing key " + k);
});

test("xml() escapes the five predefined entities", () => {
  assert.equal(xml(`a & b < c > d "e" 'f'`), "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
});

test("rfc822 produces a GMT date string; bad input falls back to now", () => {
  assert.match(rfc822("2026-05-28T10:00:00.000Z"), /28 May 2026 10:00:00 GMT/);
  assert.match(rfc822("nonsense"), /GMT$/);
});

test("rssFeed is well-formed RSS 2.0 with one item per alert", () => {
  const feed = rssFeed(sampleResult());
  assert.match(feed, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(feed, /<rss version="2.0">/);
  assert.match(feed, /<channel>/);
  assert.equal((feed.match(/<item>/g) || []).length, 2);
  assert.equal((feed.match(/<\/item>/g) || []).length, 2);
  // critical item present, GUID deterministic from url#hash
  assert.match(feed, /\[CRITICAL\] Crit Program: closure/);
  assert.match(feed, /<guid isPermaLink="false">https:\/\/crit\/terms#d<\/guid>/);
});

test("rssFeed escapes special chars in titles/descriptions (stays valid XML)", () => {
  const r = sampleResult();
  r.alerts[0].name = "A & B <Co>";
  r.alerts[0].detail = 'matched "x" & <y>';
  const feed = rssFeed(r);
  assert.equal(feed.includes("A & B <Co>"), false); // raw unescaped must NOT appear
  assert.match(feed, /A &amp; B &lt;Co&gt;/);
  // every < that opens content is a real tag; quick balance sanity check
  assert.equal((feed.match(/<item>/g) || []).length, (feed.match(/<\/item>/g) || []).length);
});

test("rssFeed with no alerts still emits a valid empty channel", () => {
  const feed = rssFeed({ generatedAt: "2026-05-28T10:00:00.000Z", checked: 2, unchanged: 2, newBaselines: 0, alerts: [] });
  assert.match(feed, /<rss version="2.0">/);
  assert.equal((feed.match(/<item>/g) || []).length, 0);
});

test("renderReport prints a no-alert summary cleanly", () => {
  const out = renderReport({ generatedAt: "t", checked: 2, unchanged: 2, newBaselines: 0, alerts: [] });
  assert.match(out, /No adverse changes detected/);
});

test("renderReport lists alerts most-severe-first with category + url", () => {
  const out = renderReport(sampleResult());
  assert.match(out, /CRITICAL/);
  assert.match(out, /\[closure\]/);
  assert.ok(out.indexOf("CRITICAL") < out.indexOf("LOW"));
});
