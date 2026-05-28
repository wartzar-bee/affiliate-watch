// Cloudflare Pages Function — POST /api/subscribe
//
// THE demand metric for affiliate-watch (V035). Appends one waitlist entry to
// the KV namespace bound as `WAITLIST`. Each signup is stored under its own key
// so nothing is overwritten and the list is enumerable:
//
//   key:   sub:<ISO-timestamp>:<random>
//   value: { email, programs_of_interest, ts, ua, country }
//
// We also keep a stable de-dupe key (email:<lowercased-email>) so the same
// address re-submitting doesn't inflate the count — the metric stays honest.
//
// No third-party calls. No PII beyond the email the user typed (+ coarse CF geo
// for context). The site makes exactly this one network request.

const MAX_EMAIL = 254;
const MAX_PROGRAMS = 500;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function validEmail(v) {
  return typeof v === "string" && v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.WAITLIST) {
    // Misconfiguration (KV binding not created yet) — fail loudly, don't drop signups silently.
    return json({ error: "Waitlist storage is not configured yet." }, 503);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const email = (data && typeof data.email === "string" ? data.email : "").trim().toLowerCase();
  let programs = data && typeof data.programs_of_interest === "string" ? data.programs_of_interest.trim() : "";
  if (programs.length > MAX_PROGRAMS) programs = programs.slice(0, MAX_PROGRAMS);

  if (!validEmail(email)) {
    return json({ error: "Please provide a valid email address." }, 400);
  }

  const ts = new Date().toISOString();
  const entry = {
    email,
    programs_of_interest: programs,
    ts,
    ua: request.headers.get("user-agent") || "",
    country: (request.cf && request.cf.country) || ""
  };

  try {
    // De-dupe by email so re-submits don't inflate the signup count. We keep the
    // FIRST timestamp on the canonical record; still store a per-submit row for audit.
    const dedupeKey = "email:" + email;
    const existing = await env.WAITLIST.get(dedupeKey);
    if (!existing) {
      await env.WAITLIST.put(dedupeKey, JSON.stringify(entry));
    }
    // Append-only audit row (unique key — never overwrites).
    const rand = Math.random().toString(36).slice(2, 10);
    await env.WAITLIST.put("sub:" + ts + ":" + rand, JSON.stringify(entry));
  } catch (e) {
    return json({ error: "Could not save your signup. Please try again." }, 500);
  }

  return json({ ok: true });
}

// Anything other than POST gets a clear 405 (no silent 404s on the API path).
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "Use POST." }, 405);
}
