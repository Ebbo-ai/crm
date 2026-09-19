import { getValidAccessToken } from "./googleOAuth";

/**
 * Gmail access through the CRM's own OAuth app (server/googleOAuth.ts), one
 * mailbox at a time, selected by the caller. Replaces the Replit connector,
 * which only ever held one Google account — these mailboxes (Kim,
 * clientservice@, Steve) are authorized concurrently, each with a fresh
 * access token minted per call so a request never uses a stale one.
 *
 * Every ingestion path here only ever GETs. Sending lives in
 * server/gmailSend.ts, kept separate so it's obvious at a glance which
 * module can write to a mailbox and which only reads.
 */
const GMAIL_API_BASE = "https://gmail.googleapis.com";

async function gmailGet<T>(mailbox: string, path: string): Promise<T> {
  const token = await getValidAccessToken(mailbox);
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API ${path} failed for ${mailbox}: ${res.status} ${body.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
}

export async function getGmailProfile(mailbox: string): Promise<GmailProfile> {
  return gmailGet<GmailProfile>(mailbox, "/gmail/v1/users/me/profile");
}

export interface GmailThreadSearchResult {
  threads: {
    id: string;
    messages: {
      id: string;
      threadId: string;
      labelIds?: string[];
      date: string;
      sender: string;
      subject: string;
      snippet: string;
    }[];
    messagesTruncated?: boolean;
    error?: string;
  }[];
  nextPageToken?: string;
  resultCountEstimate?: number;
}

/**
 * The fused search endpoint: one call per page instead of list-then-hydrate.
 * Always scoped to has:attachment by the caller's query since ingestion only
 * cares about messages carrying files.
 */
export async function searchThreadsWithAttachments(
  mailbox: string,
  query: string,
  pageToken?: string,
  pageSize = 50,
): Promise<GmailThreadSearchResult> {
  const params = new URLSearchParams({ q: query, pageSize: String(pageSize) });
  if (pageToken) params.set("pageToken", pageToken);
  return gmailGet<GmailThreadSearchResult>(mailbox, `/gmail/v1/users/me/threads:search?${params.toString()}`);
}

interface MimePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MimePart[];
}

export interface GmailMessageFull {
  id: string;
  threadId: string;
  internalDate: string;
  payload?: MimePart;
}

export async function getMessageFull(mailbox: string, messageId: string): Promise<GmailMessageFull> {
  return gmailGet<GmailMessageFull>(mailbox, `/gmail/v1/users/me/messages/${messageId}?format=full`);
}

export interface GmailAttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  sizeBytes: number;
}

/** Walks the MIME tree and returns every part that is a real (named) attachment. */
export function extractAttachmentRefs(payload: MimePart | undefined): GmailAttachmentRef[] {
  const refs: GmailAttachmentRef[] = [];
  function walk(part?: MimePart) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      refs.push({
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        attachmentId: part.body.attachmentId,
        sizeBytes: part.body.size || 0,
      });
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  return refs;
}

export function getHeader(payload: MimePart | undefined, name: string): string | null {
  const header = payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || null;
}

/** "Alexis Stein <alexis.stein@hubinternational.com>, foo@bar.com" -> [{name, email}]. */
export function parseAddressList(headerValue: string | null): { name: string | null; email: string }[] {
  if (!headerValue) return [];
  // Split on commas that are not inside a quoted display name.
  const parts = headerValue.match(/"[^"]*"\s*<[^>]+>|[^,]+/g) || [];
  return parts
    .map((raw) => {
      const s = raw.trim();
      const m = s.match(/^"?([^"<]*)"?\s*<([^>]+)>$/) || s.match(/^([^<]*)<([^>]+)>$/);
      if (m) {
        const name = m[1].trim();
        return { name: name || null, email: m[2].trim().toLowerCase() };
      }
      if (s.includes("@")) return { name: null, email: s.toLowerCase() };
      return null;
    })
    .filter((x): x is { name: string | null; email: string } => !!x);
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

/** Walks the MIME tree and returns the best plain-text and HTML bodies found (multipart/alternative prefers the last one seen at each level, matching Gmail's own convention of listing plain text before HTML). */
export function extractMessageBody(payload: MimePart | undefined): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;
  function walk(part?: MimePart) {
    if (!part) return;
    const mime = (part.mimeType || "").toLowerCase();
    if (mime === "text/plain" && part.body?.data && !part.filename) {
      text = decodeBase64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data && !part.filename) {
      html = decodeBase64Url(part.body.data);
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  return { text, html };
}

export interface GmailMessageListResult {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/** Plain message listing across the whole mailbox — no has:attachment restriction, sent and received both, newest first. */
export async function searchMessageIds(
  mailbox: string,
  query: string,
  pageToken?: string,
  pageSize = 100,
): Promise<GmailMessageListResult> {
  const params = new URLSearchParams({ q: query, maxResults: String(pageSize) });
  if (pageToken) params.set("pageToken", pageToken);
  return gmailGet<GmailMessageListResult>(mailbox, `/gmail/v1/users/me/messages?${params.toString()}`);
}

interface GmailAttachmentBody {
  size: number;
  data: string; // base64url
}

export async function getAttachmentBytes(mailbox: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const body = await gmailGet<GmailAttachmentBody>(
    mailbox,
    `/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
  );
  return Buffer.from(body.data, "base64url");
}
