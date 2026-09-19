import { getValidAccessToken } from "./googleOAuth";

/**
 * Sending through the Gmail API as the authorized identity, so a client
 * sees the message the same way they'd see one Kim or Steve sent by hand —
 * in the sender's own Sent folder, threaded normally on replies. Mailgun
 * (server/mailer.ts) remains for system mail only (digests, notifications)
 * that never needs to look like it came from a person's mailbox.
 */
const GMAIL_API_BASE = "https://gmail.googleapis.com";

function encodeHeaderValue(value: string): string {
  // Only need this for display names that might carry non-ASCII; MIME encoded-word if so.
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function buildRawMessage(opts: {
  fromEmail: string;
  fromName: string;
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
  bcc?: string;
}): string {
  const headers = [
    `From: ${encodeHeaderValue(opts.fromName)} <${opts.fromEmail}>`,
    `To: ${opts.to.join(", ")}`,
    `Subject: ${encodeHeaderValue(opts.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
  ];
  if (opts.replyTo) headers.push(`Reply-To: ${opts.replyTo}`);
  if (opts.bcc) headers.push(`Bcc: ${opts.bcc}`);
  const mime = `${headers.join("\r\n")}\r\n\r\n${opts.text}`;
  return Buffer.from(mime, "utf-8").toString("base64url");
}

export interface GmailSendResult {
  ok: boolean;
  gmailMessageId?: string;
  threadId?: string;
  messageIdHeader?: string | null;
  error?: string;
}

/** Sends as `mailbox` (the connected account) and returns Gmail's own message id, so the outbound row can be deduped against later if it's later observed again during sync (e.g. a CC to another connected mailbox). */
export async function sendViaGmail(mailbox: string, opts: {
  fromName: string;
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
  bcc?: string;
}): Promise<GmailSendResult> {
  try {
    const token = await getValidAccessToken(mailbox);
    const raw = buildRawMessage({ fromEmail: mailbox, fromName: opts.fromName, to: opts.to, subject: opts.subject, text: opts.text, replyTo: opts.replyTo, bcc: opts.bcc });
    const res = await fetch(`${GMAIL_API_BASE}/gmail/v1/users/me/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Gmail send failed for ${mailbox}: ${res.status} ${body.slice(0, 500)}` };
    }
    const sent = (await res.json()) as { id: string; threadId: string };
    return { ok: true, gmailMessageId: sent.id, threadId: sent.threadId };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
