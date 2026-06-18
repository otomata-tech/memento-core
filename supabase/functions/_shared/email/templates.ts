/**
 * Transactional email templates — inline HTML + plain text, rendered to strings
 * server-side (no React Email build in the Deno edge runtime). Sober, a single
 * action per email (CTA → invitation / sign-in link).
 */
import type { EmailMessage } from "./resend.ts";

const BRAND = "Memento";
const ACCENT = "#4338ca";
const INK = "#1f2937";
const MUTED = "#6b7280";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

function roleLabel(role?: string): string {
  switch (role) {
    case "admin": return "administrator";
    case "curator": return "curator (read + write)";
    case "member": return "reader";
    default: return "";
  }
}

/** Shared HTML shell: centered container, CTA, footer. */
function layout(intro: string, ctaLabel: string, link: string, outro: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:18px;font-weight:700;color:${ACCENT};letter-spacing:-0.01em;">${BRAND}</div>
        </td></tr>
        <tr><td style="padding:8px 32px 4px;color:${INK};font-size:15px;line-height:1.55;">${intro}</td></tr>
        <tr><td style="padding:24px 32px;">
          <a href="${escapeHtml(link)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${ctaLabel}</a>
        </td></tr>
        <tr><td style="padding:0 32px 28px;color:${MUTED};font-size:13px;line-height:1.5;">${outro}</td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f0f0f0;color:${MUTED};font-size:12px;">
          ${BRAND} — a structured, sourced and auditable knowledge base.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export interface InviteEmailContext {
  link: string;
  scope: "org" | "workspace";
  targetName: string;
  role?: string;
  inviterEmail?: string | null;
}

/**
 * Invitation / sign-in email: you've been added to an org or a KB, the CTA
 * points to the GoTrue action link (invite or magic link) that provisions the
 * session then redirects to the app.
 */
export function invitationEmail(ctx: InviteEmailContext): EmailMessage {
  const scopeWord = ctx.scope === "org" ? "the organization" : "the knowledge base";
  const name = escapeHtml(ctx.targetName);
  const inviter = ctx.inviterEmail
    ? `<strong>${escapeHtml(ctx.inviterEmail)}</strong> invites you`
    : "You're invited";
  const role = roleLabel(ctx.role);
  const roleLine = role ? ` as <strong>${role}</strong>` : "";

  const subject = `Invitation to join ${ctx.targetName} on ${BRAND}`;
  const intro = `${inviter} to join ${scopeWord} <strong>${name}</strong>${roleLine} on ${BRAND}.`;
  const outro = "This link signs you in and redirects you to the application. If you weren't expecting this invitation, ignore this message.";
  const html = layout(intro, "Join " + name, ctx.link, outro);

  const roleText = role ? ` as ${role}` : "";
  const inviterText = ctx.inviterEmail ? `${ctx.inviterEmail} invites you` : "You're invited";
  const text = [
    `${inviterText} to join ${scopeWord} "${ctx.targetName}"${roleText} on ${BRAND}.`,
    "",
    "Open this link to sign in:",
    ctx.link,
    "",
    "If you weren't expecting this invitation, ignore this message.",
  ].join("\n");

  return { to: "", subject, html, text };
}
