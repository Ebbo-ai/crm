import { storage } from "./storage";
import { buildClientRefs } from "./client-context";
import { matchEmailToClients, classifyMailRelevance, generateThreadSummary, processEmail } from "./claude";
import { extractDocumentText, hashBuffer } from "./documentExtraction";
import { uploadAttachmentBytes } from "./objectStorage";
import { sanitizeEmailHtml, textToSafeHtml } from "./gmailSanitize";
import { splitQuotedText } from "./gmailQuoteStrip";
import { checkAllowlist, isVendorCorrespondence } from "./mailAllowlist";
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
function ownerForMailbox(mailbox: string): string {
  return MAILBOX_OWNERS[mailbox.toLowerCase()] || "Kim Anderson";
}

function monthsAgoEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return Math.floor(d.getTime() / 1000);
}

function isEmbeddedImage(ref: { filename: string; mimeType: string; sizeBytes: number }): boolean {
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
  summariesGenerated: number;
  tasksCreated: number;
  errors: string[];
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
 * separate from the original has:attachment-only importer's row so neither
 * overwrites the other's progress marker.
 */
export async function runGmailFullSync(mailbox: string): Promise<GmailFullSyncSummary> {
  const profile = await getGmailProfile(mailbox);
  if (profile.emailAddress.toLowerCase() !== mailbox.toLowerCase()) {
    throw new Error(`Connected account for ${mailbox} authenticates as ${profile.emailAddress} — refusing to sync under a mismatched identity.`);
  }
  const filterForAllowlist = ALLOWLIST_FILTERED_MAILBOXES.has(mailbox.toLowerCase());
  const stateKey = `${mailbox}#full`;
  const summary: GmailFullSyncSummary = {
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
    summariesGenerated: 0,
    tasksCreated: 0,
    errors: [],
  };

  const state = await storage.getGmailImportState(stateKey);
  const backfillFloorEpoch = monthsAgoEpochSeconds(BACKFILL_MONTHS);
  const afterEpoch = state?.backfillStartDate
    ? Math.floor(new Date(state.backfillStartDate).getTime() / 1000)
    : backfillFloorEpoch;

  // No has:attachment restriction — every message, sent and received.
  const query = `after:${afterEpoch}`;
  const clientRefs = await buildClientRefs();
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
  do {
    // Every page fetched is processed in full before the cap is checked
    // again — stopping mid-page would permanently skip whatever's left in
    // it, since Gmail's pageToken only lets you resume at the next page,
    // not partway through one. A little overrun past MAX_MESSAGES_PER_RUN
    // (up to one page's worth) is the trade for never dropping a message.
    const page = await searchMessageIds(mailbox, query, pageToken, 100);
    for (const ref of page.messages || []) {
      summary.messagesScanned++;

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
        if (!thread) {
          thread = await storage.createGmailThread({
            gmailThreadId: full.threadId,
            mailbox,
            subject,
            latestMessageAt: sentAt,
            messageCount: 0,
            businessStatus: "UNASSIGNED",
            isPrivate: false,
          } as any);
        }

        const message = await storage.createGmailMessage({
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
        } as any);
        summary.messagesNew++;
        touchedThreadIds.add(thread.id);
        if (direction === "RECEIVED") {
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

          const matches = await matchEmailToClients(`From: ${fromHeader}\nSubject: ${subject}\n\n${bodyText.slice(0, 1000)}`, clientRefs);
          const clientId = matches[0]?.clientId;

          let filedAsDocumentId: number | null = null;
          if (clientId) {
            const bytes = await getAttachmentBytes(mailbox, ref.id, attRef.attachmentId);
            const contentHash = hashBuffer(bytes);
            const existingDoc = await storage.findDocumentByContentHash(clientId, contentHash);
            if (existingDoc) {
              filedAsDocumentId = existingDoc.id;
              summary.attachmentsSkippedDuplicate++;
            } else {
              const { text: extractedText, ocrUsed } = await extractDocumentText(bytes, attRef.mimeType, attRef.filename);
              const objectKey = `gmail-attachments/${clientId}/${ref.id}-${attRef.attachmentId}-${attRef.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
              await uploadAttachmentBytes(objectKey, bytes);
              const doc = await storage.createDocument({
                clientId,
                renewalId: null,
                planId: null,
                documentName: attRef.filename,
                category: "OTHER",
                filePath: objectKey,
                fileName: attRef.filename,
                notes: "Imported from Gmail inbox sync.",
                uploadedBy: "Gmail sync",
                extractedText: extractedText || null,
                ocrUsed,
                sourceGmailMessageId: ref.id,
                contentHash,
              } as any);
              filedAsDocumentId = doc.id;
              summary.attachmentsFiled++;
            }
          }

          await storage.createGmailAttachment({
            messageId: message.id,
            gmailAttachmentId: attRef.attachmentId,
            filename: attRef.filename,
            mimeType: attRef.mimeType,
            sizeBytes: attRef.sizeBytes,
            isEmbeddedImage: false,
            storagePath: filedAsDocumentId ? `filed:${filedAsDocumentId}` : null,
            filedAsDocumentId,
          } as any);
        }
      } catch (err: any) {
        summary.errors.push(`message ${ref.id}: ${err?.message || String(err)}`);
      }
    }
    finalPageToken = page.nextPageToken; // undefined once the window is fully scanned
    pageToken = page.nextPageToken;
    if (summary.messagesScanned >= MAX_MESSAGES_PER_RUN) break;
  } while (pageToken);

  // ── Classify and (re)summarize every thread touched this run ──
  for (const threadId of Array.from(touchedThreadIds)) {
    try {
      const thread = await storage.getGmailThread(threadId);
      if (!thread) continue;
      const messages = await storage.getGmailMessagesForThread(threadId);
      if (messages.length === 0) continue;

      let existingClientIds = await storage.getGmailThreadClientIds(threadId);
      let businessStatus = thread.businessStatus;
      if (existingClientIds.length === 0) {
        const matches = await matchEmailToClients(
          `Subject: ${thread.subject}\n\n${messages.map((m) => `From: ${m.fromEmail}\n${m.bodyTextNew || m.bodyText || ""}`).join("\n---\n").slice(0, 6000)}`,
          clientRefs,
        );
        if (matches.length > 0) {
          await storage.setGmailThreadClients(threadId, matches.map((m) => ({ clientId: m.clientId, confidence: m.confidence })));
          existingClientIds = matches.map((m) => m.clientId);
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
        const { isBusiness } = await classifyMailRelevance(latest.fromEmail, thread.subject || "", latest.bodyTextNew || latest.bodyText || "");
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
      if (newMsgs.length > 0 && businessStatus !== "NOT_BUSINESS") {
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
            const processed = await processEmail(fullText, []);
            if (processed.actionItems.length === 0) continue;

            const owner = ownerForMailbox(mailbox);
            const clientAssignments = existingClientIds.map((clientId) => ({ clientId, confidence: "medium" }));
            for (const item of processed.actionItems) {
              const dueDate = item.dueDate ? new Date(item.dueDate) : null;
              const created = await storage.createTaskWithClients({
                communicationId: null,
                gmailMessageId: msg.id,
                clientId: existingClientIds[0] ?? null,
                description: item.description,
                dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
                owner,
              } as any, clientAssignments);
              summary.tasksCreated = (summary.tasksCreated ?? 0) + 1;
              void created;
            }
          } catch (err: any) {
            summary.errors.push(`message ${msg.gmailMessageId} action-item extraction: ${err?.message || String(err)}`);
          }
        }
      }

      // Summaries are built from each message's new text only (quoted
      // history/forwards excepted, where bodyTextNew already equals the
      // full body) — otherwise a long reply chain would have the same
      // request counted once per quoted repetition.
      const totalChars = messages.reduce((n, m) => n + (m.bodyTextNew?.length || m.bodyText?.length || 0), 0);
      let summaryUpdate: { summary?: string | null; summaryOneLine?: string | null; summaryGeneratedAt?: Date; summaryForMessageCount?: number } = {};
      if (totalChars >= SUMMARY_MIN_CHARS && thread.summaryForMessageCount !== messages.length) {
        const result = await generateThreadSummary(
          thread.subject || "",
          messages.map((m) => ({ fromName: m.fromName, fromEmail: m.fromEmail, sentAt: m.sentAt.toISOString(), bodyText: m.bodyTextNew || m.bodyText || "" })),
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
      summary.errors.push(`thread ${threadId} classify/summarize: ${err?.message || String(err)}`);
    }
  }
  summary.threadsTouched = touchedThreadIds.size;

  await storage.upsertGmailImportState(stateKey, {
    backfillStartDate: new Date(backfillFloorEpoch * 1000),
    lastProcessedInternalDate: finalPageToken || null,
    lastRunAt: new Date(),
    lastRunSummary: `${summary.messagesScanned} scanned, ${summary.messagesNew} new${filterForAllowlist ? `, ${summary.messagesSkippedNotAllowlisted} skipped (not on allow-list)` : ""}, ${summary.messagesSkippedDuplicateAcrossMailboxes} cross-mailbox duplicates, ${summary.threadsTouched} threads touched (${summary.matched} matched, ${summary.unassigned} unassigned, ${summary.notBusiness} not business, ${summary.filedToVendor} filed to 90 Degree Benefits), ${summary.attachmentsFiled} attachments filed, ${summary.errors.length} errors.`,
  });
  await storage.recordGmailAccountSync(mailbox, summary.errors.length ? `Completed with ${summary.errors.length} error(s)` : "Synced successfully");

  return summary;
}

/** Runs the sync for every currently-connected mailbox, one after another. A failure on one mailbox (e.g. NEEDS_REAUTH) is recorded and does not stop the others. */
export async function runGmailFullSyncAllMailboxes(): Promise<GmailFullSyncSummary[]> {
  const accounts = await storage.getGmailAccounts();
  const results: GmailFullSyncSummary[] = [];
  for (const account of accounts) {
    if (account.status !== "CONNECTED") continue;
    try {
      results.push(await runGmailFullSync(account.mailbox));
    } catch (err: any) {
      results.push({
        mailbox: account.mailbox,
        messagesScanned: 0, messagesNew: 0, messagesSkippedNotAllowlisted: 0, messagesSkippedDuplicateAcrossMailboxes: 0,
        threadsTouched: 0, matched: 0, unassigned: 0, notBusiness: 0, filedToVendor: 0,
        attachmentsFiled: 0, attachmentsSkippedEmbedded: 0, attachmentsSkippedDuplicate: 0, summariesGenerated: 0,
        tasksCreated: 0,
        errors: [err?.message || String(err)],
      });
    }
  }
  return results;
}
