import { randomUUID } from "crypto";
import { storage } from "./storage";
import { buildClientRefs } from "./client-context";
import { matchEmailToClients, classifyMailRelevance, generateThreadSummary, processEmail, extractDocumentFields } from "./claude";
import { extractDocumentText, hashBuffer } from "./documentExtraction";
import { uploadAttachmentBytes } from "./objectStorage";
import { sanitizeEmailHtml, textToSafeHtml } from "./gmailSanitize";
import { splitQuotedText } from "./gmailQuoteStrip";
import { checkAllowlist, isVendorCorrespondence } from "./mailAllowlist";
import { isEnrichmentPaused } from "./llmUsage";
import { buildDeterministicLookup, matchDeterministically } from "./emailClientMatching";
import { classifyDocumentType, normalizeDocumentFilename, looksSigned } from "./documentVersioning";
import { resolveFieldMapping } from "./fieldMapping";
import { errorLabel, errorClass, formatErrorClassTally } from "./logRedaction";
import type { GmailMessage } from "@shared/schema";
import {
  getGmailProfile,
  searchMessageIds,
  getMessageFull,
  extractAttachmentRefs,
  getAttachmentBytes,
  getHeader,
  parseAddressList,
  extractMessageBody,
} from "./gmail";

const BACKFILL_MONTHS = 12;
/** Bounds one sync call so a first run against a year of mail (and the recurring poll) both have a predictable cost — call again to continue. */
const MAX_MESSAGES_PER_RUN = 250;
/** Below this, a signature logo / tracking icon / inline bullet graphic — never downloaded or filed. */
const EMBEDDED_IMAGE_MAX_BYTES = 30_000;
/** Threads shorter than this (combined body length) are self-evidently short — skip the AI summary. */
const SUMMARY_MIN_CHARS = 400;
/** How much of a message's body the client-matching prompt sees. From/To/Cc plus this much of the newest text is enough for a match without paying to send a whole thread. */
const MATCH_PROMPT_BODY_CHARS = 1500;
/** Filenames/subjects that suggest a document worth Claude's structured field extraction. */
function looksLikeStructuredDocument(filename: string, subject: string): boolean {
  const s = `${filename} ${subject}`.toLowerCase();
  return /ppr|renewal|rate\s*sheet|rate\s*card|premium|proposal/.test(s);
}

/**
 * Steve's mailbox is the one mailbox that carries decades of personal
 * correspondence alongside business mail — see mailAllowlist.ts. Every other
 * connected mailbox (Kim, clientservice@) is business-only and synced in
 * full, same as before this mailbox became configurable.
 */
const ALLOWLIST_FILTERED_MAILBOXES = new Set(["steve.schultz@simple.us"]);

/** Who a task extracted from a mailbox's mail defaults to. Everything defaults to Kim, the service rep, matching the convention on communication_tasks.owner. */
const MAILBOX_OWNERS: Record<string, string> = {
  "kim.anderson@simple.us": "Kim Anderson",
  "clientservice@simple.us": "Kim Anderson",
  "steve.schultz@simple.us": "Steve Schultz",
};
export function ownerForMailbox(mailbox: string): string {
  return MAILBOX_OWNERS[mailbox.toLowerCase()] || "Kim Anderson";
}

/**
 * One-time, bounded catch-up: extracts action items for RECEIVED messages
 * that were sent after their thread's historical-backfill census timestamp
 * (genuine live mail) but got skipped before the per-message
 * isHistoricalImport fix existed, because whichever pipeline captured them
 * treated the whole thread as historical. See
 * storage.getUnextractedPostCensusMessages for the exact bounded set.
 * Idempotent — once every match has a task, this is a no-op forever.
 */
export async function runPostCensusCatchUpExtraction(): Promise<{ messagesChecked: number; tasksCreated: number }> {
  const messages = await storage.getUnextractedPostCensusMessages();
  const result = { messagesChecked: messages.length, tasksCreated: 0 };
  if (messages.length === 0) return result;

  const enrichmentGate = await isEnrichmentPaused();
  if (enrichmentGate.paused) {
    console.warn(`[gmailFullSync] Post-census catch-up: LLM enrichment paused, skipping ${messages.length} message(s) this boot — will retry next boot.`);
    return result;
  }

  for (const msg of messages) {
    try {
      if (msg.messageIdHeader) {
        const legacyDupe = await storage.getCommunicationByMessageIdHeader(msg.messageIdHeader);
        if (legacyDupe) continue;
      }
      const usageCtx = { mailbox: `${msg.mailbox}:postCensusCatchUp` };
      const fullText = `From: ${msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail}\nSubject: ${msg.subject || ""}\n\n${msg.bodyTextNew || msg.bodyText || ""}`;
      const processed = await processEmail(fullText, [], usageCtx);
      if (processed.actionItems.length === 0) continue;

      const clientIds = await storage.getGmailThreadClientIds(msg.threadId);
      const owner = ownerForMailbox(msg.mailbox);
      const clientAssignments = clientIds.map((clientId) => ({ clientId, confidence: "medium" }));
      for (const item of processed.actionItems) {
        const dueDate = item.dueDate ? new Date(item.dueDate) : null;
        await storage.createTaskWithClients({
          communicationId: null,
          gmailMessageId: msg.id,
          clientId: clientIds[0] ?? null,
          description: item.description,
          dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
          owner,
          aiPriority: item.priority,
        } as any, clientAssignments);
        result.tasksCreated++;
      }
    } catch (err: any) {
      console.error(`[gmailFullSync] Post-census catch-up: message ${msg.gmailMessageId} action-item extraction failed: ${errorLabel(err)}`);
    }
  }
  return result;
}

function monthsAgoEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return Math.floor(d.getTime() / 1000);
}

export function isEmbeddedImage(ref: { filename: string; mimeType: string; sizeBytes: number }): boolean {
  if (!ref.mimeType.startsWith("image/")) return false;
  if (ref.sizeBytes > 0 && ref.sizeBytes < EMBEDDED_IMAGE_MAX_BYTES) return true;
  return /^image\d*\.(png|jpe?g|gif)$/i.test(ref.filename)
    || /^icon\d*\.(png|jpe?g)$/i.test(ref.filename)
    || /^logo/i.test(ref.filename)
    || /warning_triangle/i.test(ref.filename)
    || /^~wrd/i.test(ref.filename);
}

export interface GmailFullSyncSummary {
  mailbox: string;
  messagesScanned: number;
  messagesNew: number;
  messagesSkippedNotAllowlisted: number;
  messagesSkippedDuplicateAcrossMailboxes: number;
  threadsTouched: number;
  matched: number;
  unassigned: number;
  notBusiness: number;
  filedToVendor: number;
  attachmentsFiled: number;
  attachmentsSkippedEmbedded: number;
  attachmentsSkippedDuplicate: number;
  attachmentsQueuedUnfiled: number;
  fieldProposalsCreated: number;
  summariesGenerated: number;
  tasksCreated: number;
  /** True when the daily LLM cost ceiling was already hit at the start of this run — matching, classification, action-item extraction and summaries were all skipped, but message ingestion still ran in full. */
  enrichmentPaused: boolean;
  errors: string[];
  /** One content-free class per error above (AuthTimeout, RateLimit, …), so a recurring upstream failure can be read as a rate rather than hunted for line by line. */
  errorClasses: string[];
  /** True when this call did no work because a run for the same mailbox was already in flight. Not an error — the point of the guard. */
  skipped: boolean;
}

/** What started a sync run. Recorded on the state row so the UI can say "a scheduled sync is already running" rather than just "busy". */
export type GmailSyncTrigger = "POLLER" | "MANUAL" | "SCHEDULED";

/**
 * Identifies this process when claiming a mailbox. Autoscale may run several
 * instances; the claim has to be attributable to one of them so a run can only
 * release or heartbeat its own claim.
 */
const INSTANCE_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

function emptySummary(mailbox: string): GmailFullSyncSummary {
  return {
    mailbox,
    messagesScanned: 0,
    messagesNew: 0,
    messagesSkippedNotAllowlisted: 0,
    messagesSkippedDuplicateAcrossMailboxes: 0,
    threadsTouched: 0,
    matched: 0,
    unassigned: 0,
    notBusiness: 0,
    filedToVendor: 0,
    attachmentsFiled: 0,
    attachmentsSkippedEmbedded: 0,
    attachmentsSkippedDuplicate: 0,
    attachmentsQueuedUnfiled: 0,
    fieldProposalsCreated: 0,
    summariesGenerated: 0,
    tasksCreated: 0,
    enrichmentPaused: false,
    errors: [],
    errorClasses: [],
    skipped: false,
  };
}

/**
 * Raised when this run's claim is no longer its own — taken over as stale, or
 * cleared while the process was blocked. The run stops immediately rather than
 * continuing to walk a mailbox that another run now owns.
 */
class SyncClaimLostError extends Error {
  constructor(mailbox: string) {
    super(`Lost the sync claim on ${mailbox} — another run has taken it over`);
    this.name = "SyncClaimLostError";
  }
}

/**
 * Renews the claim and publishes live counters. Called often enough that a
 * slow stretch (a big page, a long enrichment pass, a rate-limit backoff) can
 * never look abandoned — the takeover window only exists for a process that
 * has actually died.
 */
async function publishProgress(
  mailbox: string,
  stateKey: string,
  runToken: string,
  summary: GmailFullSyncSummary,
  phase: string,
  pages: number,
): Promise<void> {
  const held = await storage.heartbeatGmailSyncRun(stateKey, runToken, {
    scanned: summary.messagesScanned,
    new: summary.messagesNew,
    pages,
    errors: summary.errors.length,
    phase,
  });
  if (!held) throw new SyncClaimLostError(mailbox);
}

/** How many messages (or threads) pass between heartbeats. Small enough to stay well inside the takeover window, large enough not to add a write per message. */
const HEARTBEAT_EVERY = 20;

/** The one-line, content-free description of a run that gets persisted and shown in the UI. */
function describeRun(summary: GmailFullSyncSummary, filterForAllowlist: boolean, interrupted: boolean): string {
  return [
    `${summary.messagesScanned} scanned`,
    `${summary.messagesNew} new`,
    ...(filterForAllowlist ? [`${summary.messagesSkippedNotAllowlisted} skipped (not on allow-list)`] : []),
    `${summary.messagesSkippedDuplicateAcrossMailboxes} cross-mailbox duplicates`,
    `${summary.threadsTouched} threads touched (${summary.matched} matched, ${summary.unassigned} unassigned, ${summary.notBusiness} not business, ${summary.filedToVendor} filed to 90 Degree Benefits)`,
    `${summary.attachmentsFiled} attachments filed`,
    `${summary.attachmentsQueuedUnfiled} queued unfiled`,
    `${summary.errors.length} errors (${formatErrorClassTally(summary.errorClasses)})`,
  ].join(", ") + (interrupted ? " — INTERRUPTED before the run finished." : ".");
}

/**
 * Full-mailbox sync for one connected mailbox: every message (sent and
 * received, not just attachments), full body stored and sanitized, grouped
 * into threads, classified as matched/unassigned/not-business/vendor, and
 * summarized. Safe to call repeatedly — every dedup check runs on both the
 * Gmail message id and the RFC822 Message-ID header before any write, so a
 * scheduled poll, a manual "sync now", and the same email arriving in two
 * connected mailboxes can never double-file a message.
 *
 * For steve.schultz@ specifically (see ALLOWLIST_FILTERED_MAILBOXES), a
 * message whose counterparty addresses don't resolve against the reviewed
 * allow-list is skipped before anything is read out of its body — no
 * subject, sender, or body is stored, and `messagesSkippedNotAllowlisted` is
 * the only trace it leaves, a plain count with nothing identifying in it.
 *
 * State is tracked under `${mailbox}#full` in gmail_import_state, kept
 * separate from the retired has:attachment-only importer's row (this is now
 * the only importer — see server/documentVersioning.ts and
 * server/emailClientMatching.ts for the filing/matching logic it shares with
 * the one-time historical backfill).
 *
 * Attachment matching, in order: (1) a deterministic group-number match
 * (e.g. "S-379" in the subject or filename), (2) a deterministic address/
 * domain match against known client and broker contacts, (3) only if
 * neither hits, Claude — given From/To/Cc and a slice of the body, not From
 * alone, since outbound renewal mail (Kim/Steve sending) makes the From
 * header useless for matching. A matched document is filed to EVERY client
 * the match identifies, not just the first.
 */
export async function runGmailFullSync(
  mailbox: string,
  options: { trigger?: GmailSyncTrigger } = {},
): Promise<GmailFullSyncSummary> {
  const stateKey = `${mailbox}#full`;
  const trigger = options.trigger ?? "POLLER";
  // Per run, not per process: two runs in one process (a manual sync racing
  // the poller) must not be able to release or overwrite each other's claim.
  const runToken = `${INSTANCE_ID}:${randomUUID().slice(0, 8)}`;

  // ── Single-flight guard ──
  // Claimed before anything else, including the profile check, because the
  // point is to do no Gmail work at all when a run is already in flight.
  // Autoscale can run several web instances, each with its own 5-minute
  // timer, so the claim lives in the database rather than in this process.
  const claimed = await storage.claimGmailSyncRun(stateKey, runToken, trigger);
  if (!claimed) {
    const skipped = emptySummary(mailbox);
    skipped.skipped = true;
    return skipped;
  }

  const summary = emptySummary(mailbox);
  try {
    return await runGmailFullSyncClaimed(mailbox, stateKey, runToken, summary);
  } catch (err: any) {
    if (err instanceof SyncClaimLostError) {
      // Not a failure: another run owns this mailbox now. Write nothing —
      // every state write is owner-guarded anyway — and report it as skipped.
      console.warn(`[gmailFullSync] ${mailbox}: claim taken over mid-run after ${summary.messagesScanned} message(s); stopping so the owning run can finish.`);
      summary.skipped = true;
      return summary;
    }
    // A run that throws still persists what it managed to do. Previously only
    // a run that reached the end wrote its summary, so a mailbox that kept
    // failing mid-run showed "0 errors" from its last successful run and the
    // failures were invisible in the UI.
    summary.errors.push(errorLabel(err));
    summary.errorClasses.push(errorClass(err));
    const filterForAllowlist = ALLOWLIST_FILTERED_MAILBOXES.has(mailbox.toLowerCase());
    await storage.updateGmailSyncStateIfOwner(stateKey, runToken, {
      lastRunAt: new Date(),
      lastRunSummary: describeRun(summary, filterForAllowlist, true),
    });
    await storage.recordGmailAccountSync(mailbox, `Interrupted after ${summary.messagesScanned} message(s): ${errorLabel(err)}`);
    throw err;
  } finally {
    await storage.releaseGmailSyncRun(stateKey, runToken);
  }
}

async function runGmailFullSyncClaimed(
  mailbox: string,
  stateKey: string,
  runToken: string,
  summary: GmailFullSyncSummary,
): Promise<GmailFullSyncSummary> {
  const profile = await getGmailProfile(mailbox);
  if (profile.emailAddress.toLowerCase() !== mailbox.toLowerCase()) {
    throw new Error(`Connected account for ${mailbox} authenticates as ${profile.emailAddress} — refusing to sync under a mismatched identity.`);
  }
  const filterForAllowlist = ALLOWLIST_FILTERED_MAILBOXES.has(mailbox.toLowerCase());

  // Checked once per run, not once per call: cheap, and stable behaviour
  // across a single sync rather than flipping mid-run. Only gates the four
  // LLM calls below — message/attachment ingestion always proceeds.
  const enrichmentGate = await isEnrichmentPaused();
  if (enrichmentGate.paused) {
    summary.enrichmentPaused = true;
    console.warn(`[gmailFullSync] LLM enrichment paused for ${mailbox}: today's spend $${enrichmentGate.todaySpend.toFixed(2)} has reached the $${enrichmentGate.ceiling.toFixed(2)} daily ceiling. Ingesting mail without matching/classifying/summarizing until the ceiling resets or is raised.`);
  }
  const usageCtx = { mailbox };

  const state = await storage.getGmailImportState(stateKey);
  // The backfill floor is set exactly once, the first time this mailbox is
  // ever synced, and never recomputed after that. Recomputing "12 months
  // before now" on every run (the original bug) crept the floor forward a
  // little each day, quietly shrinking the retained window and eventually
  // dropping mail that had never actually been synced yet.
  const backfillFloorEpoch = state?.backfillStartDate
    ? Math.floor(new Date(state.backfillStartDate).getTime() / 1000)
    : monthsAgoEpochSeconds(BACKFILL_MONTHS);
  const afterEpoch = backfillFloorEpoch;

  // No has:attachment restriction — every message, sent and received.
  const query = `after:${afterEpoch}`;
  const clientRefs = await buildClientRefs();
  const deterministicLookup = buildDeterministicLookup(clientRefs);
  const internalDomain = (process.env.INTERNAL_EMAIL_DOMAIN || "90degreebenefits.com").toLowerCase();
  const touchedThreadIds = new Set<number>();
  // Newly-created RECEIVED messages this run, grouped by thread, so the
  // classify pass below can extract AI action items/tasks against them once
  // the thread's client and vendor links are known. SENT messages never get
  // action-item extraction — a message never generates a task off its own
  // sender's outgoing mail.
  const newReceivedMessagesByThread = new Map<number, GmailMessage[]>();

  // Resume from where the last run's page cursor left off (stored in
  // lastProcessedInternalDate, repurposed here to hold a Gmail pageToken
  // rather than a date) so a mailbox bigger than one run's cap doesn't
  // re-scan the same already-imported messages every single run — that
  // would burn the whole per-run budget on dedup checks and the sync would
  // never reach new mail once the backlog passed MAX_MESSAGES_PER_RUN.
  // Once the mailbox is exhausted (no nextPageToken), the cursor resets to
  // undefined so the next run starts a fresh pass to pick up brand-new mail.
  let pageToken: string | undefined = state?.lastProcessedInternalDate || undefined;
  let finalPageToken: string | undefined = pageToken;
  let pagesCompleted = 0;
  do {
    // Every page fetched is processed in full before the cap is checked
    // again — stopping mid-page would permanently skip whatever's left in
    // it, since Gmail's pageToken only lets you resume at the next page,
    // not partway through one. A little overrun past MAX_MESSAGES_PER_RUN
    // (up to one page's worth) is the trade for never dropping a message.
    const page = await searchMessageIds(mailbox, query, pageToken, 100);
    for (const ref of page.messages || []) {
      summary.messagesScanned++;
      // Renewed inside the page, not just between pages: a page of 100
      // messages with attachments to download, OCR and match can easily run
      // past the takeover window, and a run that stops heartbeating looks
      // dead to every other instance.
      if (summary.messagesScanned % HEARTBEAT_EVERY === 0) {
        await publishProgress(mailbox, stateKey, runToken, summary, "reading mail", pagesCompleted);
      }

      try {
        const already = await storage.getGmailMessageByGmailId(ref.id);
        if (already) continue; // already synced this message

        const full = await getMessageFull(mailbox, ref.id);
        const fromHeader = getHeader(full.payload, "From") || "";
        const fromParsed = parseAddressList(fromHeader)[0] || { name: null, email: "unknown@unknown.com" };
        const toEmails = parseAddressList(getHeader(full.payload, "To")).map((a) => a.email);
        const ccEmails = parseAddressList(getHeader(full.payload, "Cc")).map((a) => a.email);
        const messageIdHeader = getHeader(full.payload, "Message-ID") || getHeader(full.payload, "Message-Id");

        // Steve's mailbox: decide purely from headers, before the body is
        // ever read, whether this message's counterparties are a known
        // business contact. Anything else is skipped with zero trace.
        if (filterForAllowlist) {
          const { allowed } = await checkAllowlist([fromParsed.email, ...toEmails, ...ccEmails]);
          if (!allowed) {
            summary.messagesSkippedNotAllowlisted++;
            continue;
          }
        }

        // Cross-mailbox dedupe: the same email can land in two connected
        // mailboxes (Steve CC'd on his own send to clientservice@, or a
        // message forwarded historically into another inbox). Gmail's
        // per-mailbox id differs each time; the Message-ID header does not.
        if (messageIdHeader) {
          const existingByHeader = await storage.getGmailMessageByMessageIdHeader(messageIdHeader);
          if (existingByHeader) {
            summary.messagesSkippedDuplicateAcrossMailboxes++;
            continue;
          }
        }

        const subject = getHeader(full.payload, "Subject") || "(no subject)";
        const dateHeader = getHeader(full.payload, "Date");
        const sentAt = dateHeader ? new Date(dateHeader) : new Date(Number(full.internalDate));
        const direction = fromParsed.email.toLowerCase() === mailbox.toLowerCase() ? "SENT" : "RECEIVED";

        const { text, html } = extractMessageBody(full.payload);
        const bodyText = (text || (html ? html.replace(/<[^>]+>/g, " ") : "") || "").trim();
        const bodyHtmlSafe = html ? sanitizeEmailHtml(html) : textToSafeHtml(bodyText || "(no content)");
        const quoteSplit = splitQuotedText(bodyText, subject);

        const attachmentRefs = extractAttachmentRefs(full.payload);
        const realAttachmentRefs = attachmentRefs.filter((a) => !isEmbeddedImage(a));

        // ── Thread bookkeeping ──
        let thread = await storage.getGmailThreadByGmailId(full.threadId);
        // A thread the label-scoped historical backfill has ever put in
        // census scope is reference-only for messages that existed AT
        // census time — regardless of which pipeline reaches a given
        // message first. The rolling sync runs every 5 minutes, far more
        // often than the batch backfill, and can reach a scoped thread's
        // older-but-recent messages before the backfill does; without this
        // check those got filed as brand-new live mail and ran full task
        // extraction on months-old correspondence. This is a per-MESSAGE
        // check, not per-thread: a message sent after the census timestamp
        // is a genuine new reply on that thread and must flow through
        // extraction/triage normally, even though the thread itself was
        // censused. See gmailMessages.isHistoricalImport.
        const censusTimestamp = await storage.getBackfillCensusTimestamp(mailbox, full.threadId);
        if (!thread) {
          thread = await storage.createGmailThreadTolerant({
            gmailThreadId: full.threadId,
            mailbox,
            subject,
            latestMessageAt: sentAt,
            messageCount: 0,
            businessStatus: "UNASSIGNED",
            isPrivate: false,
          } as any);
        }

        // Insert is conflict-tolerant (see storage.createGmailMessage). The
        // cross-mailbox case is a duplicate, not an error, so it is counted
        // and skipped rather than logged as a failure.
        let message: GmailMessage;
        try {
          const inserted = await storage.createGmailMessage({
            gmailMessageId: ref.id,
            threadId: thread.id,
            mailbox,
            fromEmail: fromParsed.email,
            fromName: fromParsed.name,
            toEmails,
            ccEmails,
            subject,
            bodyText,
            bodyHtmlSafe,
            bodyTextNew: quoteSplit.newText,
            hasQuotedText: quoteSplit.hasQuotedText,
            isForward: quoteSplit.isForward,
            snippet: (quoteSplit.newText || bodyText).slice(0, 200),
            sentAt,
            direction,
            hasAttachments: realAttachmentRefs.length > 0,
            messageIdHeader,
            isHistoricalImport: censusTimestamp !== null && sentAt <= censusTimestamp,
          } as any);
          if (!inserted.created) continue; // another run stored it first; it owns the filing and extraction
          message = inserted.message;
        } catch (err: any) {
          if (err?.name === "DuplicateMessageHeaderError") {
            summary.messagesSkippedDuplicateAcrossMailboxes++;
            continue;
          }
          throw err;
        }
        summary.messagesNew++;
        touchedThreadIds.add(thread.id);
        // Historical (pre-census) messages are still filed (for
        // search/reference) and count toward messagesNew, but never enter
        // the action-item extraction pool. A message sent AFTER the census
        // timestamp is live mail even in a censused thread — see the
        // censusTimestamp comment above.
        if (direction === "RECEIVED" && message.isHistoricalImport === false) {
          const bucket = newReceivedMessagesByThread.get(thread.id);
          if (bucket) bucket.push(message);
          else newReceivedMessagesByThread.set(thread.id, [message]);
        }

        if (sentAt > thread.latestMessageAt) {
          await storage.updateGmailThread(thread.id, { latestMessageAt: sentAt, subject: thread.subject || subject });
        }
        await storage.updateGmailThread(thread.id, { messageCount: thread.messageCount + 1 });

        // ── Attachments: file real ones, skip embedded logos/icons ──
        for (const attRef of attachmentRefs) {
          if (isEmbeddedImage(attRef)) {
            summary.attachmentsSkippedEmbedded++;
            await storage.createGmailAttachment({
              messageId: message.id,
              gmailAttachmentId: attRef.attachmentId,
              filename: attRef.filename,
              mimeType: attRef.mimeType,
              sizeBytes: attRef.sizeBytes,
              isEmbeddedImage: true,
              storagePath: null,
              filedAsDocumentId: null,
            } as any);
            continue;
          }

          // Deterministic matching first (group number, then known contact
          // address/domain) — only falls through to Claude when neither
          // hits. To/Cc are included: outbound renewal mail (Kim or Steve
          // sending) makes the From header useless on its own.
          const deterministic = matchDeterministically(deterministicLookup, {
            subject,
            filename: attRef.filename,
            fromEmail: fromParsed.email,
            toEmails,
            ccEmails,
          });
          let matchedClientIds: number[] = deterministic.clientIds;
          if (matchedClientIds.length === 0 && !enrichmentGate.paused) {
            const matches = await matchEmailToClients(
              `From: ${fromHeader}\nTo: ${toEmails.join(", ")}\nCc: ${ccEmails.join(", ")}\nSubject: ${subject}\n\n${bodyText.slice(0, MATCH_PROMPT_BODY_CHARS)}`,
              clientRefs,
              usageCtx,
            );
            matchedClientIds = matches.map((m) => m.clientId);
          }

          if (matchedClientIds.length === 0) {
            // Nothing matched even after Claude — queue it instead of
            // silently dropping it. Bytes are downloaded and stored now so
            // assignment later never needs to re-fetch from Gmail.
            const bytes = await getAttachmentBytes(mailbox, ref.id, attRef.attachmentId);
            const objectKey = `unfiled-attachments/${ref.id}-${attRef.attachmentId}-${attRef.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            await uploadAttachmentBytes(objectKey, bytes);
            await storage.createUnfiledAttachment({
              mailbox,
              gmailMessageId: ref.id,
              gmailAttachmentId: attRef.attachmentId,
              filename: attRef.filename,
              mimeType: attRef.mimeType,
              sizeBytes: attRef.sizeBytes,
              storagePath: objectKey,
              subject,
              fromEmail: fromParsed.email,
              toEmails: [...toEmails, ...ccEmails].join(", "),
              sentAt,
              status: "PENDING",
            } as any);
            summary.attachmentsQueuedUnfiled++;
            await storage.createGmailAttachment({
              messageId: message.id,
              gmailAttachmentId: attRef.attachmentId,
              filename: attRef.filename,
              mimeType: attRef.mimeType,
              sizeBytes: attRef.sizeBytes,
              isEmbeddedImage: false,
              storagePath: null,
              filedAsDocumentId: null,
            } as any);
            continue;
          }

          // File to every matched client, not just the first — a message can
          // legitimately cover more than one group (a shared broker contact
          // CC'd on several renewals, a multi-division account).
          const bytes = await getAttachmentBytes(mailbox, ref.id, attRef.attachmentId);
          const contentHash = hashBuffer(bytes);
          const detectedCategory = classifyDocumentType(attRef.filename, subject);
          const normalizedFileName = normalizeDocumentFilename(attRef.filename);
          const sentToList = [...toEmails, ...ccEmails].join(", ");
          let firstFiledDocumentId: number | null = null;

          for (const clientId of matchedClientIds) {
            const existingDoc = await storage.findDocumentByContentHash(clientId, contentHash);
            let filedDocumentId: number;
            if (existingDoc) {
              filedDocumentId = existingDoc.id;
              summary.attachmentsSkippedDuplicate++;
              // Identical bytes sent again — a resend, not a new document.
              // Record the new send date instead of filing a duplicate row.
              await storage.createDocumentSend({
                documentId: existingDoc.id,
                sentAt,
                sentTo: sentToList,
                gmailMessageId: ref.id,
              });
            } else {
              const { text: extractedText, ocrUsed } = await extractDocumentText(bytes, attRef.mimeType, attRef.filename);
              const objectKey = `gmail-attachments/${clientId}/${ref.id}-${attRef.attachmentId}-${attRef.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
              await uploadAttachmentBytes(objectKey, bytes);
              const category = detectedCategory || "OTHER";
              const doc = await storage.createDocument({
                clientId,
                renewalId: null,
                planId: null,
                documentName: attRef.filename,
                category: category as any,
                filePath: objectKey,
                fileName: attRef.filename,
                normalizedFileName,
                notes: "Imported from Gmail inbox sync.",
                uploadedBy: "Gmail sync",
                extractedText: extractedText || null,
                ocrUsed,
                sourceGmailMessageId: ref.id,
                contentHash,
                sentAt,
                sentBy: fromParsed.email,
                sentTo: sentToList,
                isSigned: category === "EMPLOYER_ACCEPTANCE" && looksSigned(attRef.filename),
              } as any);
              filedDocumentId = doc.id;
              summary.attachmentsFiled++;
              await storage.createDocumentSend({
                documentId: doc.id,
                sentAt,
                sentTo: sentToList,
                gmailMessageId: ref.id,
              });

              // Structured-document field extraction (PPR/renewal/rate
              // sheet from an internal sender) — folded in from the retired
              // has:attachment-only importer, which was the only place this
              // ran before.
              if (fromParsed.email.split("@")[1]?.toLowerCase() === internalDomain
                && looksLikeStructuredDocument(attRef.filename, subject)
                && extractedText && !enrichmentGate.paused) {
                try {
                  const client = clientRefs.find((c) => c.id === clientId);
                  const fields = await extractDocumentFields(extractedText, "RENEWAL_PROPOSAL", client?.clientName || "");
                  if (fields.length > 0) {
                    await storage.createDocumentFieldProposals(
                      fields.map((f) => {
                        const mapping = resolveFieldMapping(f.fieldKey, f.proposedValue, "RENEWAL_PROPOSAL", clientId, doc.planId ?? null);
                        return {
                          documentId: doc.id,
                          clientId,
                          fieldKey: f.fieldKey,
                          fieldLabel: f.fieldLabel,
                          proposedValue: f.proposedValue,
                          sourceLocation: f.sourceLocation,
                          targetTable: mapping.targetTable,
                          targetId: mapping.targetId,
                          targetField: mapping.targetField,
                          currentValue: null,
                          mappingStatus: mapping.mappingStatus,
                          confidence: mapping.confidence,
                          isPlanDesignField: mapping.isPlanDesignField,
                        };
                      }),
                    );
                    summary.fieldProposalsCreated += fields.length;
                  }
                } catch (err: any) {
                  summary.errors.push(`message ${ref.id} field extraction: ${errorLabel(err)}`);
                  summary.errorClasses.push(errorClass(err));
                }
              }
            }
            if (firstFiledDocumentId === null) firstFiledDocumentId = filedDocumentId;
          }

          await storage.createGmailAttachment({
            messageId: message.id,
            gmailAttachmentId: attRef.attachmentId,
            filename: attRef.filename,
            mimeType: attRef.mimeType,
            sizeBytes: attRef.sizeBytes,
            isEmbeddedImage: false,
            storagePath: firstFiledDocumentId ? `filed:${firstFiledDocumentId}` : null,
            filedAsDocumentId: firstFiledDocumentId,
          } as any);
        }
      } catch (err: any) {
        // Gmail's message id and the error's class only. The error text is
        // routed through errorLabel because an upstream failure will happily
        // quote the payload that caused it, and that payload is client mail.
        const detail = `message ${ref.id}: ${errorLabel(err)}`;
        summary.errors.push(detail);
        summary.errorClasses.push(errorClass(err));
        console.error(`[gmailFullSync] ${mailbox}: ${detail}`);
      }
    }
    finalPageToken = page.nextPageToken; // undefined once the window is fully scanned
    pageToken = page.nextPageToken;

    // Cursor advances per page, not once at the end of the run. A run that
    // takes over an hour used to lose its entire position if it was cut short
    // (deploy, instance reclaimed, crash), so the next run re-walked pages it
    // had already ingested. Whatever pages completed are now banked.
    //
    // The same write carries the heartbeat and the live counters the sync
    // button polls, so progress and liveness cost no extra round trip.
    //
    // Owner-guarded: a run that has already lost its claim must not write a
    // cursor over the run that took it, which would send that run back across
    // pages it had finished.
    await storage.updateGmailSyncStateIfOwner(stateKey, runToken, { lastProcessedInternalDate: finalPageToken || null });
    pagesCompleted++;
    await publishProgress(mailbox, stateKey, runToken, summary, "reading mail", pagesCompleted);

    if (summary.messagesScanned >= MAX_MESSAGES_PER_RUN) break;
  } while (pageToken);

  // ── Classify and (re)summarize every thread touched this run ──
  let threadsProcessed = 0;
  for (const threadId of Array.from(touchedThreadIds)) {
    // This pass is LLM-heavy and can run for many minutes on a big page's
    // worth of threads, so it heartbeats too — otherwise a healthy run looks
    // abandoned here and gets taken over.
    if (threadsProcessed++ % HEARTBEAT_EVERY === 0) {
      await publishProgress(mailbox, stateKey, runToken, summary, "sorting threads", pagesCompleted);
    }
    try {
      const thread = await storage.getGmailThread(threadId);
      if (!thread) continue;
      const messages = await storage.getGmailMessagesForThread(threadId);
      if (messages.length === 0) continue;

      let existingClientIds = await storage.getGmailThreadClientIds(threadId);
      let businessStatus = thread.businessStatus;
      if (existingClientIds.length === 0) {
        const latestForMatch = messages[messages.length - 1];
        const deterministic = matchDeterministically(deterministicLookup, {
          subject: thread.subject,
          fromEmail: latestForMatch.fromEmail,
          toEmails: (latestForMatch.toEmails as string[] | null) || [],
          ccEmails: (latestForMatch.ccEmails as string[] | null) || [],
        });
        let matchedIds: { clientId: number; confidence: string }[] = deterministic.clientIds.map((id) => ({ clientId: id, confidence: "high" }));
        if (matchedIds.length === 0 && !enrichmentGate.paused) {
          const matches = await matchEmailToClients(
            `Subject: ${thread.subject}\n\n${messages.map((m) => `From: ${m.fromEmail}\nTo: ${((m.toEmails as string[] | null) || []).join(", ")}\nCc: ${((m.ccEmails as string[] | null) || []).join(", ")}\n${m.bodyTextNew || m.bodyText || ""}`).join("\n---\n").slice(0, 6000)}`,
            clientRefs,
            usageCtx,
          );
          matchedIds = matches;
        }
        if (matchedIds.length > 0) {
          await storage.setGmailThreadClients(threadId, matchedIds.map((m) => ({ clientId: m.clientId, confidence: m.confidence })));
          existingClientIds = matchedIds.map((m) => m.clientId);
          businessStatus = "MATCHED";
        }
      } else {
        businessStatus = "MATCHED";
      }

      // 90 Degree Benefits involvement is tracked independently of client
      // matches — Steve's decision: a thread can be linked to one or more
      // clients AND flagged as 90DB correspondence at the same time (broker/
      // vendor mail routinely spans multiple groups), not either/or.
      const allAddresses = messages.flatMap((m) => [m.fromEmail, ...((m.toEmails as string[] | null) || []), ...((m.ccEmails as string[] | null) || [])]);
      const filesToVendor = await isVendorCorrespondence(allAddresses);

      if (existingClientIds.length === 0 && !filesToVendor && businessStatus !== "MATCHED") {
        const latest = messages[messages.length - 1];
        const { isBusiness } = enrichmentGate.paused
          ? { isBusiness: true }
          : await classifyMailRelevance(latest.fromEmail, thread.subject || "", latest.bodyTextNew || latest.bodyText || "", usageCtx);
        businessStatus = isBusiness ? "UNASSIGNED" : "NOT_BUSINESS";
      } else if (existingClientIds.length === 0 && businessStatus !== "MATCHED") {
        businessStatus = "UNASSIGNED";
      }

      // ── AI action-item extraction on newly-synced inbound mail ──
      // Only for RECEIVED messages this run, and only once the thread's
      // client/vendor context is known so a resulting task can be linked
      // correctly. Skipped entirely for NOT_BUSINESS threads (newsletters,
      // personal mail on steve.schultz@) so no task work is spent on them.
      const newMsgs = newReceivedMessagesByThread.get(threadId) || [];
      if (newMsgs.length > 0 && businessStatus !== "NOT_BUSINESS" && !enrichmentGate.paused) {
        for (const msg of newMsgs) {
          try {
            // Guard against ever double-creating a task for the same email.
            // The legacy Mailgun inbound webhook (the only other place that
            // ran this same extraction on inbound mail) has been removed, so
            // this should never actually find a match — kept as a defensive
            // check on the shared Message-ID key rather than an assumption.
            if (msg.messageIdHeader) {
              const legacyDupe = await storage.getCommunicationByMessageIdHeader(msg.messageIdHeader);
              if (legacyDupe) continue;
            }
            const fullText = `From: ${msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail}\nSubject: ${msg.subject || ""}\n\n${msg.bodyTextNew || msg.bodyText || ""}`;
            const processed = await processEmail(fullText, [], usageCtx);
            if (processed.actionItems.length === 0) continue;

            const owner = ownerForMailbox(mailbox);
            const clientAssignments = existingClientIds.map((clientId) => ({ clientId, confidence: "medium" }));
            for (const item of processed.actionItems) {
              const dueDate = item.dueDate ? new Date(item.dueDate) : null;
              // Every extracted item is stored regardless of priority — the
              // triage dashboard's tunable threshold (app_settings) filters
              // at read time, so raising/lowering the bar later doesn't
              // require re-running extraction against old mail.
              const created = await storage.createTaskWithClients({
                communicationId: null,
                gmailMessageId: msg.id,
                clientId: existingClientIds[0] ?? null,
                description: item.description,
                dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
                owner,
                aiPriority: item.priority,
              } as any, clientAssignments);
              summary.tasksCreated = (summary.tasksCreated ?? 0) + 1;
              void created;
            }
          } catch (err: any) {
            summary.errors.push(`message ${msg.gmailMessageId} action-item extraction: ${errorLabel(err)}`);
            summary.errorClasses.push(errorClass(err));
          }
        }
      }

      // Summaries are built from each message's new text only (quoted
      // history/forwards excepted, where bodyTextNew already equals the
      // full body) — otherwise a long reply chain would have the same
      // request counted once per quoted repetition.
      const totalChars = messages.reduce((n, m) => n + (m.bodyTextNew?.length || m.bodyText?.length || 0), 0);
      let summaryUpdate: { summary?: string | null; summaryOneLine?: string | null; summaryGeneratedAt?: Date; summaryForMessageCount?: number } = {};
      if (totalChars >= SUMMARY_MIN_CHARS && thread.summaryForMessageCount !== messages.length && !enrichmentGate.paused) {
        const result = await generateThreadSummary(
          thread.subject || "",
          messages.map((m) => ({ fromName: m.fromName, fromEmail: m.fromEmail, sentAt: m.sentAt.toISOString(), bodyText: m.bodyTextNew || m.bodyText || "" })),
          usageCtx,
        );
        if (result) {
          summaryUpdate = {
            summary: result.summary,
            summaryOneLine: result.oneLine,
            summaryGeneratedAt: new Date(),
            summaryForMessageCount: messages.length,
          };
          summary.summariesGenerated++;
        }
      }

      await storage.updateGmailThread(threadId, { businessStatus, filesToVendor, ...summaryUpdate } as any);
      if (businessStatus === "MATCHED") summary.matched++;
      else if (businessStatus === "NOT_BUSINESS") summary.notBusiness++;
      else summary.unassigned++;
      if (filesToVendor) summary.filedToVendor++;
    } catch (err: any) {
      const detail = `thread ${threadId} classify/summarize: ${errorLabel(err)}`;
      summary.errors.push(detail);
      summary.errorClasses.push(errorClass(err));
      console.error(`[gmailFullSync] ${mailbox}: ${detail}`);
    }
  }
  summary.threadsTouched = touchedThreadIds.size;

  await storage.updateGmailSyncStateIfOwner(stateKey, runToken, {
    backfillStartDate: new Date(backfillFloorEpoch * 1000),
    lastProcessedInternalDate: finalPageToken || null,
    lastRunAt: new Date(),
    lastRunSummary: describeRun(summary, filterForAllowlist, false),
  });
  await storage.recordGmailAccountSync(mailbox, summary.errors.length ? `Completed with ${summary.errors.length} error(s)` : "Synced successfully");

  return summary;
}

/** Runs the sync for every currently-connected mailbox, one after another. A failure on one mailbox (e.g. NEEDS_REAUTH) is recorded and does not stop the others. */
export async function runGmailFullSyncAllMailboxes(
  options: { trigger?: GmailSyncTrigger } = {},
): Promise<GmailFullSyncSummary[]> {
  const accounts = await storage.getGmailAccounts();
  const results: GmailFullSyncSummary[] = [];
  for (const account of accounts) {
    if (account.status !== "CONNECTED") continue;
    try {
      results.push(await runGmailFullSync(account.mailbox, options));
    } catch (err: any) {
      const failed = emptySummary(account.mailbox);
      failed.errors.push(errorLabel(err));
      failed.errorClasses.push(errorClass(err));
      results.push(failed);
    }
  }
  return results;
}
