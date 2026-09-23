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

/**
 * Every Gmail call in this app routes through gmailGet, so retry/backoff and
 * pacing live here once rather than at each call site (label census,
 * free-provider classify, the 5-minute rolling sync, attachment ingestion,
 * and the future message-body import job all inherit this automatically).
 */

/** Spaces consecutive calls per-mailbox so a hot loop (e.g. label census) rarely hits Gmail's per-user-per-minute quota in the first place. */
const MIN_CALL_SPACING_MS = 150;
const MAX_RETRIES = 8;
const BASE_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 60_000;

const lastCallAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace(mailbox: string): Promise<void> {
  const last = lastCallAt.get(mailbox) || 0;
  const wait = last + MIN_CALL_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(mailbox, Date.now());
}

/** Gmail's rate-limit errors come back as 429, or 403 with a JSON body naming reason rateLimitExceeded / userRateLimitExceeded — both are transient, everything else (400s, 404s, auth failures) is not. */
function isRetryableGmailError(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status === 403) return /rateLimitExceeded|userRateLimitExceeded/i.test(body);
  return false;
}

/**
 * Last-seen rate-limit pause, process-wide, so the (admin-only, browser-
 * driven) label backfill page can poll and show "Rate limited by Gmail,
 * waiting Ns" instead of the request just hanging silently. Cleared once a
 * call succeeds without needing a retry.
 */
let lastRateLimitStatus: { message: string; mailbox: string; at: number } | null = null;

export function getGmailRateLimitStatus(): { message: string; mailbox: string; at: number } | null {
  return lastRateLimitStatus;
}

async function gmailGet<T>(mailbox: string, path: string): Promise<T> {
  let attempt = 0;
  for (;;) {
    await pace(mailbox);
    const token = await getValidAccessToken(mailbox);
    const res = await fetch(`${GMAIL_API_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      lastRateLimitStatus = null;
      return res.json() as Promise<T>;
    }

    const body = await res.text().catch(() => "");
    if (isRetryableGmailError(res.status, body) && attempt < MAX_RETRIES) {
      attempt++;
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      const jitter = Math.random() * backoff * 0.3;
      const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : backoff + jitter;
      const message = `Rate limited by Gmail (${mailbox}), waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_RETRIES})`;
      lastRateLimitStatus = { message, mailbox, at: Date.now() };
      console.warn(`[gmail] ${message} — ${path}`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Gmail API ${path} failed for ${mailbox}: ${res.status} ${body.slice(0, 500)}`);
  }
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
}

export interface GmailFilter {
  id: string;
  criteria?: Record<string, unknown>;
  action?: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

/** Every user-configured Gmail filter (Settings → Filters and Blocked Addresses) for this mailbox — used to check whether a label is applied automatically to incoming mail rather than only ever set by hand. */
export async function listGmailFilters(mailbox: string): Promise<GmailFilter[]> {
  const res = await gmailGet<{ filter?: GmailFilter[] }>(mailbox, "/gmail/v1/users/me/settings/filters");
  return res.filter || [];
}

/** Maps a Gmail labelId (as referenced by a filter's addLabelIds) back to its human-readable name, so a filter can be matched against a label name like "90 Degree Benefits". */
export async function listGmailLabels(mailbox: string): Promise<{ id: string; name: string }[]> {
  const res = await gmailGet<{ labels?: { id: string; name: string }[] }>(mailbox, "/gmail/v1/users/me/labels");
  return res.labels || [];
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

export interface GmailThreadFull {
  id: string;
  historyId?: string;
  messages: GmailMessageFull[];
}

/** The whole thread — every message, full body/attachments — in one call. Used by the historical import, which already knows (from the census pass) that a thread is worth reading in full, unlike the rolling sync's one-message-at-a-time walk. */
export async function getThreadFull(mailbox: string, threadId: string): Promise<GmailThreadFull> {
  return gmailGet<GmailThreadFull>(mailbox, `/gmail/v1/users/me/threads/${threadId}?format=full`);
}

/** Headers only, no body/attachments — for passes that only need From/To/Cc/Subject (label domain census) and would otherwise pull megabytes of body text they never look at. */
export async function getMessageMetadata(mailbox: string, messageId: string): Promise<GmailMessageFull> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Cc", "Subject"]) params.append("metadataHeaders", h);
  return gmailGet<GmailMessageFull>(mailbox, `/gmail/v1/users/me/messages/${messageId}?${params.toString()}`);
}

/** Lists every Gmail message id carrying the given label (any mailbox folder), newest first — the entry point for the one-time label-scoped historical backfill. */
export async function searchMessageIdsByLabel(
  mailbox: string,
  labelQuery: string,
  pageToken?: string,
  pageSize = 100,
): Promise<GmailMessageListResult> {
  return searchMessageIds(mailbox, labelQuery, pageToken, pageSize);
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
