/**
 * Outbound mail, sent through Mailgun's HTTP API on the mg.simple.us sending
 * domain (SPF, DKIM and the tracking CNAME are verified there). From
 * addresses live on simple.us itself (clientservice@ — the shared general
 * client-service identity, kim.anderson@, steve.schultz@) — Mailgun sends on
 * their behalf the same way any transactional sender does, it does not need
 * to receive mail for that domain.
 *
 * mg.simple.us has no verified receiving MX, so this module is send-only.
 * Replies land in Google Workspace, not here: kim.anderson@ and
 * steve.schultz@ are each read by their own person, and clientservice@ is a
 * real Workspace mailbox delegated to both, picked up by the Gmail sync like
 * any other mailbox once it is connected.
 */

import { checkOutboundDocumentGuard, recordGuardRefusal, type GuardedDocument } from "./documentGuards";

const MAILGUN_SENDING_DOMAIN = "mg.simple.us";

function apiKey(): string | undefined {
  return process.env.Mailgun_API_KEY || process.env.MAILGUN_API_KEY;
}

export interface OutboundEmail {
  from: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text: string;
  html?: string;
  /**
   * Anything being attached, for the internal-only document guard. Mailgun
   * carries system mail (digests, notifications) which attaches nothing
   * today; the guard sits here anyway so a future caller cannot send an
   * internal-only document out through this path either.
   */
  documents?: GuardedDocument[];
  /** Set when the sender is covering for another identity, so a reply lands on the shared mailbox instead of one person's alone. */
  replyTo?: string;
  /**
   * Delivers a copy to the sending mailbox itself. Sending through Mailgun's
   * API (rather than through Gmail's own SMTP relay) leaves no Sent-folder
   * copy in Gmail, so a shared identity like clientservice@ would otherwise
   * have no record of its own outbound mail once Gmail sync starts reading
   * it — the CRM's own communication log is the only trace. BCC-ing the
   * mailbox closes that gap.
   */
  bcc?: string;
}

/**
 * Sends one email via Mailgun. Returns { ok: false, error } instead of
 * throwing so a digest run or a send button can report the failure without
 * crashing the caller — a missing key or a Mailgun outage should not take
 * down the process.
 */
export async function sendEmail(email: OutboundEmail): Promise<{ ok: true } | { ok: false; error: string; guardBlocked?: boolean }> {
  const guard = checkOutboundDocumentGuard(email.documents, { to: email.to, cc: email.cc, bcc: email.bcc });
  if (!guard.allowed) {
    await recordGuardRefusal({ blocked: guard.blocked, attemptedByName: email.from, context: "mailgun send" });
    return { ok: false, error: guard.message!, guardBlocked: true };
  }

  const key = apiKey();
  if (!key) {
    return { ok: false, error: "Mailgun API key is not configured (Mailgun_API_KEY)." };
  }

  const to = Array.isArray(email.to) ? email.to.join(",") : email.to;
  const cc = Array.isArray(email.cc) ? email.cc.join(",") : email.cc;
  const form = new URLSearchParams();
  form.set("from", email.from);
  form.set("to", to);
  if (cc) form.set("cc", cc);
  form.set("subject", email.subject);
  form.set("text", email.text);
  if (email.html) form.set("html", email.html);
  if (email.replyTo) form.set("h:Reply-To", email.replyTo);
  if (email.bcc) form.set("bcc", email.bcc);

  try {
    const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_SENDING_DOMAIN}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Mailgun ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}
