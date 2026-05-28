// HTML normalization + selector scoping. No I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, decodeEntities, collapseWhitespace, scopeToSelector, normalizePage } from "../src/normalize.mjs";
import { hashText } from "../src/snapshot.mjs";
import { wrap, COMMISSION_BEFORE, COMMISSION_BEFORE_CHURN } from "./fixtures.mjs";

test("htmlToText strips scripts/styles/comments and tags", () => {
  const t = htmlToText(`<head><style>.x{}</style></head><body><script>evil()</script><p>Hello <b>World</b></p><!-- c --></body>`);
  assert.equal(t.includes("evil"), false);
  assert.equal(t.includes(".x{}"), false);
  assert.match(t, /Hello World/);
});

test("decodeEntities handles named + numeric", () => {
  assert.equal(decodeEntities("up to 45&percnt; &amp; &euro;100"), "up to 45% & €100");
  assert.equal(decodeEntities("&#169; &#x20AC;"), "© €");
});

test("collapseWhitespace is deterministic (drops blank lines, trims)", () => {
  const a = collapseWhitespace("  a \n\n   b   \n  ");
  const b = collapseWhitespace("a\nb");
  assert.equal(a, b);
});

test("chrome/token churn does NOT change the normalized hash", () => {
  // same content region, different csrf token + random script values
  const r1 = normalizePage(COMMISSION_BEFORE, "#terms");
  const r2 = normalizePage(COMMISSION_BEFORE_CHURN, "#terms");
  assert.equal(r1.scoped, true);
  assert.equal(hashText(r1.text), hashText(r2.text));
});

test("scopeToSelector extracts an #id region, ignoring nav/footer", () => {
  const html = wrap(`<p>CORE CONTENT</p>`);
  const { html: region, matched } = scopeToSelector(html, "#terms");
  assert.equal(matched, true);
  assert.match(htmlToText(region), /CORE CONTENT/);
  assert.equal(htmlToText(region).includes("Login"), false); // nav excluded
  assert.equal(htmlToText(region).includes("cookies"), false); // banner excluded
});

test("scopeToSelector handles .class and nested same-tags", () => {
  const html = `<div class="wrap"><div>inner <div>deep</div> end</div></div><div>outside</div>`;
  const { html: region, matched } = scopeToSelector(html, ".wrap");
  assert.equal(matched, true);
  const text = htmlToText(region);
  assert.match(text, /inner/);
  assert.match(text, /deep/);
  assert.match(text, /end/);
  assert.equal(text.includes("outside"), false); // nesting tracked: stops at matching close
});

test("scopeToSelector falls back to whole doc when selector missing", () => {
  const html = wrap(`<p>x</p>`);
  const { matched } = scopeToSelector(html, "#does-not-exist");
  assert.equal(matched, false);
});

test("normalizePage without selector keeps full body text", () => {
  const r = normalizePage(wrap(`<p>core</p>`));
  assert.equal(r.scoped, false);
  assert.match(r.text, /core/);
});
