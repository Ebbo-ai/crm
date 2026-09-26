import { getValidAccessToken } from "./googleOAuth";
import { checkOutboundDocumentGuard, recordGuardRefusal, type GuardedDocument } from "./documentGuards";

/**
 * Sending through the Gmail API as the authorized identity, so a client
 * sees the message the same way they'd see one Kim or Steve sent by hand —
 * in the sender's own Sent folder, threaded normally on replies. Mailgun
 * (server/mailer.ts) remains for system mail only (digests, notifications)
 * that never needs to look like it came from a person's mailbox.
 */
const GMAIL_API_BASE = "https://gmail.googleapis.com";

/**
 * Strips anything that could end a header line.
 *
 * A carriage return or newline in a subject or a recipient does not produce
 * a broken header — it produces an extra one. `Subject: hi\r\nBcc: someone@
 * outside.com` is a recipient the internal-only guard never saw, because the
 * guard was handed the recipient lists, not the subject. Everything that
 * reaches a header goes through here first.
 */
function sanitizeHeaderValue(value: string): string {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeaderValue(value);
  // Only need this for display names that might carry non-ASCII; MIME encoded-word if so.
  if (/^[\x00-\x7F]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf-8").toString("base64")}?=`;
}

/** Recipient lists: each address sanitized, empties dropped. */
function headerAddressList(values: string[]): string {
  return values.map(sanitizeHeaderValue).filter(Boolean).join(", ");
}

/** A file being attached: bytes already resolved by the caller from a stored record or an upload. */
export interface OutboundAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** base64 in 76-character lines, as MIME requires. */
function base64Lines(buf: Buffer): string {
  return (buf.toString("base64").match(/.{1,76}/g) || []).join("\r\n");
}

function buildRawMessage(opts: {
  fromEmail: string;
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  replyTo?: string;
  bcc?: string | string[];
  /** The parent message's RFC822 Message-ID, so the client's mail app files this reply under the same conversation. */
  inReplyTo?: string | null;
  /** The parent's References chain plus the parent itself, space separated. */
  references?: string | null;
  attachments?: OutboundAttachment[];
}): string {
  const headers = [
    `From: ${encodeHeaderValue(opts.fromName)} <${opts.fromEmail}>`,
    `To: ${headerAddressList(opts.to)}`,
    `Subject: ${encodeHeaderValue(opts.subject)}`,
    `MIME-Version: 1.0`,
  ];
  if (opts.cc && opts.cc.length > 0) headers.push(`Cc: ${headerAddressList(opts.cc)}`);
  if (opts.replyTo) headers.push(`Reply-To: ${sanitizeHeaderValue(opts.replyTo)}`);
  const bccList = Array.isArray(opts.bcc) ? opts.bcc : opts.bcc ? [opts.bcc] : [];
  if (bccList.length > 0) headers.push(`Bcc: ${headerAddressList(bccList)}`);
  // Gmail threads on References/In-Reply-To, not on the threadId parameter
  // alone, and so does every other mail client the recipient might use.
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  // The body is base64 rather than 7bit: an accented name or a smart quote
  // pasted from Word is not 7-bit clean, and declaring it as such produces a
  // message that renders as mojibake in some clients.
  const attachments = opts.attachments || [];
  if (attachments.length === 0) {
    const mime = [
      ...headers,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      "",
      base64Lines(Buffer.from(opts.text, "utf-8")),
    ].join("\r\n");
    return Buffer.from(mime, "utf-8").toString("base64url");
  }

  const boundary = `----crm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    "",
    base64Lines(Buffer.from(opts.text, "utf-8")),
  ];
  for (const att of attachments) {
    const safeName = att.filename.replace(/["\r\n]/g, "_");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType || "application/octet-stream"}; name="${safeName}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${safeName}"`,
      "",
      base64Lines(att.content),
    );
  }
  parts.push(`--${boundary}--`, "");
  return Buffer.from(parts.join("\r\n"), "utf-8").toString("base64url");
}

export interface GmailSendResult {
  ok: boolean;
  gmailMessageId?: string;
  threadId?: string;
  messageIdHeader?: string | null;
  error?: string;
  /** True when the send was refused by the internal-only document guard rather than by Gmail. */
  guardBlocked?: boolean;
}

/**
 * Sends as `mailbox` (the connected account) and returns Gmail's own message
 * id, so the outbound row can be deduped against later if it's later observed
 * again during sync (e.g. a CC to another connected mailbox).
 *
 * `documents` describes anything being attached. Nothing attaches documents
 * yet — that arrives with the Communications tab — but the guard lives here,
 * at the point the message is built, so the attach flow inherits it instead of
 * having to remember it.
 *
 * The contract when that flow is built: the attachment bytes and the category
 * passed here must come from the same server-side document record. A caller
 * that attaches a file while declaring nothing, or declares a category it
 * chose itself, has stepped around the check — so resolve the category from
 * storage by id, never from the request.
 */
export async function sendViaGmail(mailbox: string, opts: {
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  replyTo?: string;
  bcc?: string | string[];
  documents?: GuardedDocument[];
  /** Who is sending, for the refusal record. The mailbox alone does not say which person pressed send. */
  attemptedBy?: { userId?: number | null; userName?: string | null };
  /** Threading: the parent message's Message-ID header and the chain it belongs to. */
  inReplyTo?: string | null;
  references?: string | null;
  /** Gmail's own thread id, so the copy in our Sent folder sits in the same conversation. */
  gmailThreadId?: string | null;
  /**
   * Files to attach. The caller resolves these from stored records — the
   * bytes here and the category in `documents` must describe the same
   * document, or the guard above is checking something that isn't being sent.
   */
  attachments?: OutboundAttachment[];
}): Promise<GmailSendResult> {
  const guard = checkOutboundDocumentGuard(opts.documents, { to: opts.to, cc: opts.cc, bcc: opts.bcc });
  if (!guard.allowed) {
    await recordGuardRefusal({
      blocked: guard.blocked,
      attemptedByUserId: opts.attemptedBy?.userId ?? null,
      attemptedByName: opts.attemptedBy?.userName || mailbox,
      context: `gmail send as ${mailbox}`,
    });
    return { ok: false, error: guard.message, guardBlocked: true };
  }
  try {
    const token = await getValidAccessToken(mailbox);
    const raw = buildRawMessage({
      fromEmail: mailbox,
      fromName: opts.fromName,
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      text: opts.text,
      replyTo: opts.replyTo,
      bcc: opts.bcc,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
      attachments: opts.attachments,
    });
    const res = await fetch(`${GMAIL_API_BASE}/gmail/v1/users/me/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // threadId keeps our own Sent copy in the same Gmail conversation. It is
      // only honoured when the headers agree, which is why both are sent.
      body: JSON.stringify(opts.gmailThreadId ? { raw, threadId: opts.gmailThreadId } : { raw }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Gmail send failed for ${mailbox}: ${res.status} ${body.slice(0, 500)}` };
    }
    const sent = (await res.json()) as { id: string; threadId: string };
    // Gmail assigns the Message-ID itself, and a later reply to this message
    // needs it. Read it back rather than guessing; a failure here does not
    // undo a send that already happened, so it is best effort.
    let messageIdHeader: string | null = null;
    try {
      const metaRes = await fetch(
        `${GMAIL_API_BASE}/gmail/v1/users/me/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as { payload?: { headers?: { name: string; value: string }[] } };
        const header = (meta.payload?.headers || []).find((h) => h.name.toLowerCase() === "message-id");
        messageIdHeader = header?.value?.trim() || null;
      }
    } catch {
      /* best effort — see above */
    }
    return { ok: true, gmailMessageId: sent.id, threadId: sent.threadId, messageIdHeader };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
