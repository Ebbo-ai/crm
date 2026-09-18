import { ReplitConnectors } from "@replit/connectors-sdk";

/**
 * Read-only Gmail access through the Replit connector. Only ever GETs —
 * ingestion never modifies, labels, or sends mail. See replit.md / the Stage
 * 3 notes for why: this pipeline pulls attachments, it does not touch the
 * mailbox.
 */
const connectors = new ReplitConnectors();

async function gmailGet<T>(path: string): Promise<T> {
  const res = await connectors.proxy("google-mail", path, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API ${path} failed: ${res.status} ${body.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
}

export async function getGmailProfile(): Promise<GmailProfile> {
  return gmailGet<GmailProfile>("/gmail/v1/users/me/profile");
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
  query: string,
  pageToken?: string,
  pageSize = 50,
): Promise<GmailThreadSearchResult> {
  const params = new URLSearchParams({ q: query, pageSize: String(pageSize) });
  if (pageToken) params.set("pageToken", pageToken);
  return gmailGet<GmailThreadSearchResult>(`/gmail/v1/users/me/threads:search?${params.toString()}`);
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

export async function getMessageFull(messageId: string): Promise<GmailMessageFull> {
  return gmailGet<GmailMessageFull>(`/gmail/v1/users/me/messages/${messageId}?format=full`);
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

interface GmailAttachmentBody {
  size: number;
  data: string; // base64url
}

export async function getAttachmentBytes(messageId: string, attachmentId: string): Promise<Buffer> {
  const body = await gmailGet<GmailAttachmentBody>(
    `/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
  );
  return Buffer.from(body.data, "base64url");
}
