/**
 * Transactional email sending via Resend (HTTP API, no SMTP).
 *
 * Secrets (read from the env — PUBLIC repo, never hardcoded):
 *   - RESEND_API_KEY     : Resend API key
 *   - MEMENTO_EMAIL_FROM : sender, e.g. "Memento <no-reply@mento.cc>"
 *
 * Memento sends its own emails (invitations) rather than delegating to the GoTrue
 * SMTP: controlled template, action link generated server-side. If the provider
 * is not configured or fails, the caller falls back to a link to be relayed
 * manually (cf. ensureAccount) — no loss of functionality.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** True if the provider is usable (key + sender present). */
export function emailConfigured(): boolean {
  return !!Deno.env.get("RESEND_API_KEY") && !!Deno.env.get("MEMENTO_EMAIL_FROM");
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends an email via Resend. Throws if not configured or if the API refuses. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MEMENTO_EMAIL_FROM");
  if (!key || !from) throw new Error("email provider not configured (RESEND_API_KEY / MEMENTO_EMAIL_FROM)");

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[email] Resend failure:", res.status, detail);
    throw new Error("email sending failed");
  }
}
