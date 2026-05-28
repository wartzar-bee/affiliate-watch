// Waitlist signup — the ONLY network call this site makes. POSTs {email,
// programs_of_interest} to the /api/subscribe Pages Function, which appends to
// the WAITLIST KV namespace. No analytics, no third-party scripts, no beacons.
(function () {
  "use strict";
  var form = document.getElementById("waitlist-form");
  if (!form) return;
  var msg = document.getElementById("form-msg");
  var btn = document.getElementById("submit-btn");

  function setMsg(text, kind) {
    msg.textContent = text;
    msg.className = "formmsg" + (kind ? " " + kind : "");
  }

  // Basic, permissive email check — the server validates authoritatively.
  function looksLikeEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = (document.getElementById("email").value || "").trim();
    var programs = (document.getElementById("programs").value || "").trim();

    if (!looksLikeEmail(email)) {
      setMsg("Please enter a valid email address.", "err");
      return;
    }

    btn.disabled = true;
    setMsg("Adding you…", "");

    fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, programs_of_interest: programs })
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (r.ok) {
          setMsg("You're on the list. We'll email you when alerts are ready — nothing else.", "ok");
          form.reset();
        } else {
          setMsg((r.body && r.body.error) || "Something went wrong. Please try again.", "err");
          btn.disabled = false;
        }
      })
      .catch(function () {
        setMsg("Couldn't reach the server. Please try again in a moment.", "err");
        btn.disabled = false;
      });
  });
})();
