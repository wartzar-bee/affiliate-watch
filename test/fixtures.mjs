// HTML fixtures for offline tests. These imitate the shape of real affiliate
// terms pages: a content region wrapped in nav/script/cookie chrome, plus
// "before"/"after" variants that encode each kind of adverse change. No network.

// A wrapper that adds the kind of churny chrome real pages have, so tests prove
// normalization strips it (and the hash stays stable across chrome-only churn).
export function wrap(inner, token = "csrf-abc123") {
  return `<!DOCTYPE html><html><head>
    <title>Affiliate Terms</title>
    <meta name="csrf" content="${token}">
    <style>.x{color:red}</style>
    <script>window.t=${Math.random()};</script>
  </head>
  <body>
    <nav>Home Programs <a href="/login">Login</a></nav>
    <!-- build ${token} -->
    <main id="terms">${inner}</main>
    <div class="cookie-banner">We use cookies ${token}</div>
    <footer>© Operator ${token}</footer>
    <script>track(${Math.random()});</script>
  </body></html>`;
}

export const COMMISSION_BEFORE = wrap(`
  <h1>Affiliate Terms</h1>
  <p>Revenue Share commission of up to 45% with no negative carryover.</p>
  <p>Minimum payout is €100 paid monthly via Skrill or Neteller.</p>
  <p>This agreement applies to traffic from all jurisdictions.</p>
`);

// RevShare cut 45% -> 25% (the classic silent income hit).
export const COMMISSION_AFTER_CUT = wrap(`
  <h1>Affiliate Terms</h1>
  <p>Revenue Share commission of up to 25% with no negative carryover.</p>
  <p>Minimum payout is €100 paid monthly via Skrill or Neteller.</p>
  <p>This agreement applies to traffic from all jurisdictions.</p>
`);

// Negative carryover clause appears (and the reassurance is removed).
export const NEGCARRY_AFTER = wrap(`
  <h1>Affiliate Terms</h1>
  <p>Revenue Share commission of up to 45%.</p>
  <p>Any negative carryover will be carried forward to the following month.</p>
  <p>Minimum payout is €100 paid monthly via Skrill or Neteller.</p>
`);

// Program closure.
export const CLOSURE_AFTER = wrap(`
  <h1>Affiliate Terms</h1>
  <p>This affiliate program is closed and no longer accepting new partners.</p>
  <p>We are ceasing operations and going direct only.</p>
`);

// Payment change: threshold raised + method dropped.
export const PAYMENT_AFTER = wrap(`
  <h1>Affiliate Terms</h1>
  <p>Revenue Share commission of up to 45% with no negative carryover.</p>
  <p>Minimum payout is €500 paid monthly. We no longer support Skrill.</p>
  <p>This agreement applies to traffic from all jurisdictions.</p>
`);

// GEO restriction added.
export const GEO_AFTER = wrap(`
  <h1>Affiliate Terms</h1>
  <p>Revenue Share commission of up to 45% with no negative carryover.</p>
  <p>Minimum payout is €100 paid monthly via Skrill or Neteller.</p>
  <p>Restricted countries now include Germany and the Netherlands.</p>
`);

// Generic, low-severity wording edit (no money/keyword signal).
export const TOS_EDIT_AFTER = wrap(`
  <h1>Affiliate Terms</h1>
  <p>Revenue Share commission of up to 45% with no negative carryover.</p>
  <p>Minimum payout is €100 paid monthly via Skrill or Neteller.</p>
  <p>This agreement applies to traffic from all jurisdictions. Please read carefully.</p>
`);

// Same content, only chrome/token churn — must NOT alert (hash stable).
export const COMMISSION_BEFORE_CHURN = wrap(COMMISSION_BEFORE_INNER(), "csrf-zzz999");
function COMMISSION_BEFORE_INNER() {
  return `
  <h1>Affiliate Terms</h1>
  <p>Revenue Share commission of up to 45% with no negative carryover.</p>
  <p>Minimum payout is €100 paid monthly via Skrill or Neteller.</p>
  <p>This agreement applies to traffic from all jurisdictions.</p>
`;
}

// A tiny fixture-backed fetchPage: maps url -> { status, body }.
export function fixtureFetch(map) {
  return async function fetchPage(entry) {
    const v = map[entry.url];
    if (v === undefined) return { status: 404, body: "" };
    if (typeof v === "string") return { status: 200, body: v };
    return v; // already a { status, body } record (or an error shape)
  };
}
