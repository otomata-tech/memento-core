/**
 * Pure unit tests for the email templates + config detection (no DB or
 * network). Run with:
 *   deno test --allow-env supabase/functions/_shared/email/templates.test.ts
 */
import { invitationEmail } from "./templates.ts";
import { emailConfigured } from "./resend.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

Deno.test("invitationEmail — org, role and inviter rendered", () => {
  const msg = invitationEmail({
    link: "https://me.mento.cc/callback#token=abc",
    scope: "org",
    targetName: "Otomata",
    role: "curator",
    inviterEmail: "alexis@otomata.tech",
  });
  assert(msg.subject.includes("Otomata"), "subject names the org");
  assert(msg.html.includes("https://me.mento.cc/callback#token=abc"), "link in the HTML");
  assert(msg.text.includes("https://me.mento.cc/callback#token=abc"), "link in the text");
  assert(msg.html.includes("curator"), "role labeled in the HTML");
  assert(msg.html.includes("alexis@otomata.tech"), "inviter mentioned");
  assert(msg.html.includes("the organization"), "org scope");
});

Deno.test("invitationEmail — workspace without role or inviter", () => {
  const msg = invitationEmail({
    link: "https://me.mento.cc/callback",
    scope: "workspace",
    targetName: "4 As — Veille",
  });
  assert(msg.html.includes("the knowledge base"), "KB scope");
  assert(msg.html.includes("You're invited"), "fallback without inviter");
  assert(!msg.html.includes(" as "), "no role line when absent");
});

Deno.test("invitationEmail — HTML escaping of the target name", () => {
  const msg = invitationEmail({
    link: "https://x/y",
    scope: "org",
    targetName: '<script>alert("x")</script>',
  });
  assert(!msg.html.includes("<script>"), "injected tag escaped");
  assert(msg.html.includes("&lt;script&gt;"), "escaped render present");
});

Deno.test("emailConfigured — true only if key AND sender", () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  const prevFrom = Deno.env.get("MEMENTO_EMAIL_FROM");
  try {
    Deno.env.delete("RESEND_API_KEY");
    Deno.env.delete("MEMENTO_EMAIL_FROM");
    assert(!emailConfigured(), "not configured without secrets");

    Deno.env.set("RESEND_API_KEY", "re_test");
    assert(!emailConfigured(), "key alone is not enough");

    Deno.env.set("MEMENTO_EMAIL_FROM", "Memento <no-reply@mento.cc>");
    assert(emailConfigured(), "configured with key + sender");
  } finally {
    prevKey === undefined ? Deno.env.delete("RESEND_API_KEY") : Deno.env.set("RESEND_API_KEY", prevKey);
    prevFrom === undefined ? Deno.env.delete("MEMENTO_EMAIL_FROM") : Deno.env.set("MEMENTO_EMAIL_FROM", prevFrom);
  }
});
