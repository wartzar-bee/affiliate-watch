// HTML/text normalization. Pure — no I/O, no network.
//
// Affiliate-program terms pages are HTML, often wrapped in nav/cookie/script
// noise that changes on every request (CSRF tokens, timestamps, ad slots).
// To diff *content* and not *chrome*, we strip the obvious noise, optionally
// scope to a CSS-ish selector region, collapse whitespace, and lower-case for
// keyword scanning. The normalized text is what we hash + diff + classify.

// Strip <script>/<style>/<noscript>/<svg>/<head> blocks and HTML comments,
// then remove all remaining tags, decode a few common entities, and collapse
// whitespace. Intentionally dependency-free and conservative: we never execute
// anything, we only reduce a served HTML string to readable text.
export function htmlToText(html) {
  if (typeof html !== "string") return "";
  let s = html;
  // Drop whole non-content blocks (with their contents).
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1>/gi, " ");
  // Turn block boundaries into newlines so structure survives a bit.
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|br)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Remove all remaining tags.
  s = s.replace(/<[^>]+>/g, " ");
  // Decode the handful of entities that actually show up in terms copy.
  s = decodeEntities(s);
  return collapseWhitespace(s);
}

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  euro: "€", pound: "£", cent: "¢", copy: "©",
  reg: "®", trade: "™", hellip: "…", mdash: "—",
  ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", percnt: "%"
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, ent) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X"
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code) : m;
    }
    const k = ent.toLowerCase();
    return k in NAMED ? NAMED[k] : m;
  });
}

function safeFromCodePoint(code) {
  try { return String.fromCodePoint(code); } catch { return ""; }
}

// Collapse runs of spaces/tabs, trim each line, drop blank lines, normalize
// newlines. Deterministic so the same content always hashes the same.
export function collapseWhitespace(s) {
  return String(s)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

// Very small, dependency-free "selector" scoping. We do NOT ship a full CSS
// engine (that would mean a DOM dependency). Instead a selector is treated as
// a hint: if given an `#id` or `.class` or a tag name, we try to extract the
// inner HTML of the FIRST matching element (naive, balanced-ish). If we can't
// find it, we fall back to the whole document (and the caller can be told).
// Returns { html, matched }.
export function scopeToSelector(html, selector) {
  if (!selector || typeof selector !== "string") return { html, matched: false };
  const sel = selector.trim();
  let attr = null, val = null, tag = null;
  if (sel.startsWith("#")) { attr = "id"; val = sel.slice(1); }
  else if (sel.startsWith(".")) { attr = "class"; val = sel.slice(1); }
  else if (/^[a-z][\w-]*$/i.test(sel)) { tag = sel.toLowerCase(); }
  else return { html, matched: false };

  const extracted = attr
    ? extractByAttr(html, attr, val)
    : extractByTag(html, tag);
  return extracted == null ? { html, matched: false } : { html: extracted, matched: true };
}

// Find the first element whose `attr` contains `val` (class is space-separated;
// id is exact-ish via word boundary), then return its inner HTML by matching
// the open/close tags of that element type with simple nesting tracking.
function extractByAttr(html, attr, val) {
  const re = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  let idx = 0;
  while (idx < html.length) {
    const slice = html.slice(idx);
    const m = re.exec(slice);
    if (!m) return null;
    const tag = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    const tokens = attr === "class" ? value.split(/\s+/) : [value];
    if (tokens.includes(val)) {
      const openEnd = idx + m.index + m[0].length;
      const tagOpenEnd = html.indexOf(">", openEnd);
      if (tagOpenEnd === -1) return null;
      return innerHtmlFrom(html, tag, tagOpenEnd + 1);
    }
    idx += m.index + m[0].length;
  }
  return null;
}

function extractByTag(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const m = re.exec(html);
  if (!m) return null;
  return innerHtmlFrom(html, tag, m.index + m[0].length);
}

// Given the index right after an element's opening tag, return inner HTML up to
// the matching close tag, tracking same-tag nesting. Conservative: if we never
// find the close, return the rest of the document.
function innerHtmlFrom(html, tag, start) {
  const open = new RegExp(`<${tag}\\b`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1, pos = start;
  while (pos < html.length) {
    open.lastIndex = pos;
    close.lastIndex = pos;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return html.slice(start);
    if (o && o.index < c.index) { depth++; pos = o.index + o[0].length; }
    else { depth--; if (depth === 0) return html.slice(start, c.index); pos = c.index + c[0].length; }
  }
  return html.slice(start);
}

// The full pipeline: (optionally) scope to a selector, then HTML→text.
// Returns { text, scoped } where `scoped` is true iff the selector matched.
export function normalizePage(html, selector) {
  const { html: region, matched } = scopeToSelector(html, selector);
  return { text: htmlToText(region), scoped: matched };
}
