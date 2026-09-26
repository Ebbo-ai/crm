/**
 * Server-side guard for documents that must never leave the company.
 *
 * Some documents carry fee detail that is ours alone — the administrative
 * fee breakdown behind the single figure a client sees, and what the broker
 * is paid. The categories are listed in shared/documentPolicy.ts, shared
 * with the UI so both ends agree on what is marked.
 *
 * Two things matter about where this sits:
 *
 * 1. It runs on the request, server-side. The UI marks these documents and
 *    shows the block before anyone hits send, but that is a courtesy. A UI
 *    that hides the option has prevented nothing; the server refusing has.
 *
 * 2. It runs inside the send helpers themselves (gmailSend.ts, mailer.ts),
 *    not only at the route. Nothing can attach a document to outgoing mail
 *    yet — the attach flow arrives with the Communications tab. Putting the
 *    check where the message is actually built means that flow inherits it
 *    rather than having to remember it, and so does anything else that sends
 *    later.
 *
 * The refusal is hard. There is no confirm-anyway, because a warning at the
 * moment of sending is a warning at the exact moment someone is in a hurry.
 */

import {
  INTERNAL_ONLY_DOCUMENT_CATEGORIES,
  internalEmailDomains,
  isInternalOnlyCategory,
} from "@shared/documentPolicy";

export { INTERNAL_ONLY_DOCUMENT_CATEGORIES, isInternalOnlyCategory };

export interface RecipientGuardResult {
  allowed: boolean;
  reason?: string;
}

/** A document about to be attached. Only identity and category matter here. */
export interface GuardedDocument {
  id?: number | null;
  documentName?: string | null;
  category: string;
}

/** Where a recipient was listed. Bcc is the one that gets missed, so it is named like the others. */
export type RecipientField = "To" | "Cc" | "Bcc";

export interface BlockedRecipient {
  field: RecipientField;
  address: string;
}

export interface BlockedDocument {
  documentId: number | null;
  documentName: string;
  category: string;
  recipients: BlockedRecipient[];
}

export interface OutboundGuardResult {
  allowed: boolean;
  /** Empty when allowed. One entry per internal-only document that has at least one outside recipient. */
  blocked: BlockedDocument[];
  /** Plain-language refusal naming the documents and the recipients, safe to return to the caller. */
  message?: string;
}

export interface OutboundRecipients {
  to?: string | string[] | null;
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
}

function internalDomains(): Set<string> {
  return internalEmailDomains(process.env.INTERNAL_EMAIL_DOMAIN);
}

/**
 * The address out of a recipient string. Accepts a bare address or the
 * `Display Name <addr@example.com>` form the compose box produces when
 * someone pastes from a mail client.
 *
 * Returns null when there is nothing that looks like an address, and a null
 * is treated as outside the company everywhere below. An unparseable
 * recipient is not a safe recipient: the alternative is skipping the one we
 * could not read.
 */
export function extractEmailAddress(raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const angled = value.match(/<([^<>]+)>\s*$/);
  const candidate = (angled ? angled[1] : value).trim().toLowerCase();
  // Exactly one @, something either side, no whitespace.
  if (!/^[^\s@]+@[^\s@]+$/.test(candidate)) return null;
  return candidate;
}

/**
 * Splits a recipient string into separate recipients on commas and
 * semicolons, leaving separators alone inside a quoted display name
 * (`"Anderson, Kim" <kim.anderson@simple.us>` is one recipient, not two) or
 * inside angle brackets.
 */
function splitAddressList(value: string): string[] {
  const pieces: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngles = false;
  for (const char of value) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "<" && !inQuotes) inAngles = true;
    else if (char === ">" && !inQuotes) inAngles = false;
    if ((char === "," || char === ";") && !inQuotes && !inAngles) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  pieces.push(current);
  return pieces.map((p) => p.trim()).filter(Boolean);
}

/** Address-shaped tokens in one recipient piece. More than one means the piece holds more than one recipient. */
function addressTokens(piece: string): string[] {
  return piece.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? [];
}

/**
 * Every recipient the message will actually reach, each tagged with the
 * field it came from.
 *
 * One entry of a `to` array can hold several addresses — an address list
 * pasted into a single box, or a UI that never split what the user typed.
 * The mail header carries all of them, so the guard has to see all of them:
 * reading only the last address in the entry is how an outside recipient
 * travels alongside an internal one unnoticed. A piece with nothing
 * address-shaped in it is kept as a recipient too, so it fails closed below
 * rather than being silently dropped.
 */
export function collectRecipients(recipients: OutboundRecipients): { field: RecipientField; address: string }[] {
  const forField = (field: RecipientField, value: string | string[] | null | undefined) => {
    if (value == null) return [];
    const raw = (Array.isArray(value) ? value : [value]).map((v) => String(v ?? ""));
    const out: { field: RecipientField; address: string }[] = [];
    for (const entry of raw) {
      for (const piece of splitAddressList(entry)) {
        const tokens = addressTokens(piece);
        if (tokens.length === 0) out.push({ field, address: piece });
        else for (const token of tokens) out.push({ field, address: token });
      }
    }
    return out;
  };
  return [
    ...forField("To", recipients.to),
    ...forField("Cc", recipients.cc),
    ...forField("Bcc", recipients.bcc),
  ];
}

/** True only for an address we can read that sits on one of our own domains. */
export function isInternalRecipient(raw: string): boolean {
  const address = extractEmailAddress(raw);
  if (!address) return false;
  const domain = address.split("@")[1];
  return !!domain && internalDomains().has(domain);
}

/**
 * The check. Refuses when any internal-only document is going out alongside
 * any recipient outside Simple or 90 Degree Benefits, wherever that
 * recipient is listed.
 *
 * One outside recipient blocks the whole send, not just the offending
 * attachment: a send is one act, and dropping an attachment quietly is not
 * something the server should decide on the sender's behalf. Permitted
 * documents in the same message are blocked with it.
 */
export function checkOutboundDocumentGuard(
  documents: GuardedDocument[] | null | undefined,
  recipients: OutboundRecipients,
): OutboundGuardResult {
  const restricted = (documents ?? []).filter((doc) => isInternalOnlyCategory(doc.category));
  if (restricted.length === 0) return { allowed: true, blocked: [] };

  const outsiders = collectRecipients(recipients).filter((r) => !isInternalRecipient(r.address));
  if (outsiders.length === 0) return { allowed: true, blocked: [] };

  const blocked: BlockedDocument[] = restricted.map((doc) => ({
    documentId: doc.id ?? null,
    documentName: doc.documentName || `Untitled ${doc.category} document`,
    category: doc.category,
    recipients: outsiders.map((r) => ({ field: r.field, address: r.address })),
  }));

  const documentPhrase = blocked.map((b) => `"${b.documentName}" (${b.category})`).join(", ");
  const recipientPhrase = outsiders.map((r) => `${r.address} (${r.field})`).join(", ");
  return {
    allowed: false,
    blocked,
    message:
      `Blocked: ${documentPhrase} carries internal fee detail and cannot be sent outside Simple or 90 Degree Benefits. ` +
      `Outside recipients on this message: ${recipientPhrase}. ` +
      `Remove those recipients or remove the document, then send again.`,
  };
}

/**
 * The original single-category entry point, kept because it reads well at a
 * call site that has one document in hand. Same rule, same refusal.
 */
export function checkDocumentRecipientGuard(category: string, recipientEmails: string[]): RecipientGuardResult {
  const result = checkOutboundDocumentGuard([{ category }], { to: recipientEmails });
  return result.allowed ? { allowed: true } : { allowed: false, reason: result.message };
}

/**
 * Records a refusal: who tried, which document, which recipients.
 *
 * Not for punishment — it is the only way to tell whether the guard fires in
 * normal use. A guard that never fires may be protecting nothing; one that
 * fires weekly means the workflow is asking people to do something the rule
 * forbids, and the workflow is what should change.
 *
 * Logging must never be the reason a send succeeds, so every failure here is
 * swallowed. The refusal has already happened by the time this runs.
 */
export async function recordGuardRefusal(params: {
  blocked: BlockedDocument[];
  attemptedByUserId?: number | null;
  attemptedByName?: string | null;
  /** Where the refusal happened, e.g. the route or send helper. */
  context: string;
}): Promise<void> {
  const { blocked, attemptedByUserId, attemptedByName, context } = params;
  if (blocked.length === 0) return;

  // Nothing in here may throw. The send has already been refused; a failure
  // while writing the record must not turn a clean 403 into a 500.
  try {
    const who = attemptedByName || (attemptedByUserId ? `user ${attemptedByUserId}` : "unknown sender");
    const detail = blocked
      .map((b) => {
        const recipients = b.recipients.map((r) => `${r.address} [${r.field}]`).join(", ");
        return `${b.documentName} (${b.category}${b.documentId ? `, id ${b.documentId}` : ""}) → ${recipients}`;
      })
      .join(" | ");

    console.warn(`[guard:internal-only] Refused at ${context}. Attempted by ${who}. ${detail}`);

    try {
      const { storage } = await import("./storage");
      await storage.createAuditLog({
        userId: attemptedByUserId ?? null,
        userName: who,
        action: "DOCUMENT_SEND_BLOCKED",
        entity: "document",
        entityId: blocked[0].documentId ?? null,
        details: `${context}: ${detail}`,
      } as any);
    } catch (err: any) {
      console.warn(`[guard:internal-only] Refusal recorded in the log only; audit write failed: ${err?.message || err}`);
    }
  } catch {
    // Deliberately silent: the refusal itself is what matters.
  }
}
