// Output rendering: human report, JSON, and a valid RSS feed. Pure (returns
// strings/objects). Channel-AGNOSTIC by design — affiliate-watch never talks to
// Telegram/Slack/email itself; it emits these artifacts and a delivery layer
// (cron + curl, a webhook, an RSS reader, a mail script) consumes them. This
// keeps delivery pluggable.
import { SEVERITY_RANK } from "./classify.mjs";

const NC = process.env.NO_COLOR || !process.stdout.isTTY;
const c = (code, s) => (NC ? s : `\x1b[${code}m${s}\x1b[0m`);
const bold = (s) => c("1", s), dim = (s) => c("2", s);
const red = (s) => c("31", s), ylw = (s) => c("33", s),
  grn = (s) => c("32", s), cyn = (s) => c("36", s);

const SEV_COLOR = { critical: red, high: red, medium: ylw, low: cyn, info: dim };

// Sort alerts most-severe first, then by name (stable, human-friendly order).
export function sortAlerts(alerts) {
  return [...alerts].sort((a, b) => {
    const d = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    return d !== 0 ? d : String(a.name).localeCompare(String(b.name));
  });
}

// --- (a) human report -------------------------------------------------------
export function renderReport(result) {
  const L = [];
  const alerts = sortAlerts(result.alerts);
  L.push("");
  L.push(bold("  affiliate-watch") + dim(`  ${result.checked} page(s) checked`));
  L.push(dim("  ──────────────────────────────────────────────"));
  L.push(`  ${grn(String(result.unchanged))} unchanged   ` +
    `${result.newBaselines ? cyn(result.newBaselines + " new baseline") : "0 new"}   ` +
    `${alerts.length ? red(alerts.length + " alert(s)") : grn("0 alerts")}`);
  L.push("");

  if (!alerts.length) {
    L.push(grn("  No adverse changes detected."));
    L.push("");
    return L.join("\n");
  }

  for (const a of alerts) {
    const color = SEV_COLOR[a.severity] || dim;
    L.push("  " + color(bold(a.severity.toUpperCase())) + "  " +
      bold(a.name) + dim(`  [${a.category}]`));
    L.push(dim("        " + a.url));
    L.push("        " + a.detail);
    for (const line of a.removedSample || []) L.push(red("        - " + truncate(line, 100)));
    for (const line of a.addedSample || []) L.push(grn("        + " + truncate(line, 100)));
    L.push("");
  }
  return L.join("\n");
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// --- (b) JSON ---------------------------------------------------------------
export function jsonReport(result) {
  return {
    generatedAt: result.generatedAt,
    checked: result.checked,
    unchanged: result.unchanged,
    newBaselines: result.newBaselines,
    alertCount: result.alerts.length,
    alerts: sortAlerts(result.alerts).map((a) => ({
      name: a.name,
      url: a.url,
      category: a.category,
      severity: a.severity,
      detail: a.detail,
      hashBefore: a.hashBefore,
      hashAfter: a.hashAfter,
      at: a.at,
      addedSample: a.addedSample || [],
      removedSample: a.removedSample || []
    }))
  };
}

// --- (c) RSS 2.0 feed -------------------------------------------------------
// One <item> per alert. Valid RSS 2.0 so any reader / Slack-RSS / IFTTT /
// email-digest tool can subscribe. GUIDs are deterministic (url+hashAfter) so
// the same alert is not re-notified. Channel layer = "subscribe to this file".
export function rssFeed(result, opts = {}) {
  const title = opts.title || "affiliate-watch — affiliate-program change alerts";
  const link = opts.link || "https://github.com/";
  const desc = opts.description ||
    "Adverse changes detected on watched casino-affiliate-program pages.";
  const now = result.generatedAt || new Date().toISOString();
  const items = sortAlerts(result.alerts).map((a) => itemXml(a)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(link)}</link>
    <description>${xml(desc)}</description>
    <lastBuildDate>${rfc822(now)}</lastBuildDate>
    <generator>affiliate-watch</generator>
${items}
  </channel>
</rss>
`;
}

function itemXml(a) {
  const guid = `${a.url}#${a.hashAfter || a.at}`;
  const titleStr = `[${a.severity.toUpperCase()}] ${a.name}: ${a.category}`;
  const body = [
    a.detail,
    ...(a.removedSample || []).map((l) => "- " + l),
    ...(a.addedSample || []).map((l) => "+ " + l)
  ].join("\n");
  return `    <item>
      <title>${xml(titleStr)}</title>
      <link>${xml(a.url)}</link>
      <guid isPermaLink="false">${xml(guid)}</guid>
      <category>${xml(a.category)}</category>
      <pubDate>${rfc822(a.at)}</pubDate>
      <description>${xml(body)}</description>
    </item>`;
}

// XML-escape text content. Covers the five predefined entities.
export function xml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// RFC-822 date for RSS pubDate. Falls back to "now" on a bad input.
export function rfc822(iso) {
  const d = new Date(iso);
  return (isNaN(d.getTime()) ? new Date() : d).toUTCString();
}
