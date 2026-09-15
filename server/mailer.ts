/**
 * Outbound mail, sent through Mailgun's HTTP API on the mg.simple.us sending
 * domain (SPF, DKIM and the tracking CNAME are verified there). From
 * addresses live on simple.us itself (renewals@, kim.anderson@) — Mailgun
 * sends on their behalf the same way any transactional sender does, it does
 * not need to receive mail for that domain.
 *
 * mg.simple.us has no verified receiving MX, so this module is send-only.
 * Replies to renewals@ / kim.anderson@ land in Google Workspace, not here.
 */

const MAILGUN_SENDING_DOMAIN = "mg.simple.us";

function apiKey(): string | undefined {
  return process.env.Mailgun_API_KEY || process.env.MAILGUN_API_KEY;
}

export interface OutboundEmail {
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends one email via Mailgun. Returns { ok: false, error } instead of
 * throwing so a digest run or a send button can report the failure without
 * crashing the caller — a missing key or a Mailgun outage should not take
 * down the process.
 */
export async function sendEmail(email: OutboundEmail): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) {
    return { ok: false, error: "Mailgun API key is not configured (Mailgun_API_KEY)." };
  }

  const to = Array.isArray(email.to) ? email.to.join(",") : email.to;
  const form = new URLSearchParams();
  form.set("from", email.from);
  form.set("to", to);
  form.set("subject", email.subject);
  form.set("text", email.text);
  if (email.html) form.set("html", email.html);

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
