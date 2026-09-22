import { storage } from "./storage";
import { buildClientRefs } from "./client-context";
import { matchEmailToClients, extractDocumentFields } from "./claude";
import { extractDocumentText, hashBuffer } from "./documentExtraction";
import { resolveFieldMapping } from "./fieldMapping";
import { uploadAttachmentBytes } from "./objectStorage";
import { sanitizeEmailHtml, textToSafeHtml } from "./gmailSanitize";
import { splitQuotedText } from "./gmailQuoteStrip";
import { isVendorCorrespondence } from "./mailAllowlist";
import { isEmbeddedImage } from "./gmailFullSync";
import type { ClientRef } from "./claude";
import type { GmailBackfillThread } from "@shared/schema";
import {
  getThreadFull,
  getAttachmentBytes,
  extractAttachmentRefs,
  getHeader,
  parseAddressList,
  extractMessageBody,
} from "./gmail";

/**
 * The one-time historical import for a label-scoped mailbox backfill: reads
 * every already-censused BUSINESS/FREE_PROVIDER_BUSINESS thread in full
 * (messages, attachments, structured-document typing) into the Gmail-native
 * tables (gmail_threads/gmail_messages/gmail_attachments/gmail_thread_clients),
 * same schema as the rolling full sync.
 *
 * Differences from both existing importers, all deliberate per Steve's
 * explicit sign-off for this run:
 *  - No LLM budget ceiling (isEnrichmentPaused is never checked) — this is a
 *    one-time backfill, not the daily rolling sync.
 *  - No thread summaries, no action-item extraction, no tasks created
 *    (generateThreadSummary/processEmail/classifyMailRelevance are never
 *    called) — historical mail is filed for reference, not triaged.
 *  - Client resolution tries a deterministic address/domain lookup first
 *    (built once from clientRefs, no API call) and only falls back to one
 *    matchEmailToClients LLM call per thread when that comes up empty. The
 *    method actually used is persisted per thread (gmail_backfill_threads.
 *    import_match_method) so the final report can break down lookup vs LLM
 *    vs unmatched without guessing.
 *  - LLM spend for this run is tagged with a synthetic mailbox label
 *    (`${mailbox}:historicalImport`) in llm_usage_log so it can be isolated
 *    from the mailbox's regular sync spend.
 *  - Errors are persisted (gmail_backfill_import_errors), not just kept in an
 *    in-memory summary — a skipped thread is a visible, retryable row.
 */

const BATCH_SIZE = 10;
/** Circuit breaker: if this many consecutive batches produce zero successful imports, stop rather than spin forever re-trying the same broken threads. */
const MAX_CONSECUTIVE_STALLED_BATCHES = 5;

interface DeterministicLookup {
  addressToClientIds: Map<string, Set<number>>;
  domainToClientIds: Map<string, Set<number>>;
}

const FREE_PROVIDER_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com"]);
const OWN_DOMAINS = new Set(["simple.us", "simple.dental"]);

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/** Built once per run from the same client/broker addresses buildClientRefs already exposes — no extra DB query needed. */
function buildDeterministicLookup(clientRefs: ClientRef[]): DeterministicLookup {
  const addressToClientIds = new Map<string, Set<number>>();
  const domainToClientIds = new Map<string, Set<number>>();

  const addAddress = (email: string | null | undefined, clientId: number) => {
    if (!email) return;
    const addr = email.trim().toLowerCase();
    if (!addr.includes("@")) return;
    if (!addressToClientIds.has(addr)) addressToClientIds.set(addr, new Set());
    addressToClientIds.get(addr)!.add(clientId);

    const domain = domainOf(addr);
    if (domain && !FREE_PROVIDER_DOMAINS.has(domain) && !OWN_DOMAINS.has(domain)) {
      if (!domainToClientIds.has(domain)) domainToClientIds.set(domain, new Set());
      domainToClientIds.get(domain)!.add(clientId);
    }
  };

  for (const c of clientRefs) {
    addAddress(c.decisionMakerEmail, c.id);
    addAddress(c.adminContactEmail, c.id);
    for (const e of c.brokerEmails || []) addAddress(e, c.id);
  }

  return { addressToClientIds, domainToClientIds };
}

export interface HistoricalImportBatchResult {
  threadsProcessed: number;
  threadsImported: number;
  threadsErrored: number;
  messagesImported: number;
  attachmentsFiled: number;
  matchedByLookup: number;
  matchedByLlm: number;
  unmatched: number;
  filedToVendor: number;
  remaining: number;
}

/** Processes up to BATCH_SIZE not-yet-imported eligible threads, newest first. Safe to call repeatedly — every write is guarded by the same dedup checks the rolling full sync uses. */
export async function runHistoricalImportBatch(mailbox: string, label: string): Promise<HistoricalImportBatchResult> {
  const result: HistoricalImportBatchResult = {
    threadsProcessed: 0, threadsImported: 0, threadsErrored: 0, messagesImported: 0,
    attachmentsFiled: 0, matchedByLookup: 0, matchedByLlm: 0, unmatched: 0, filedToVendor: 0, remaining: 0,
  };

  const batch = await storage.getImportEligibleThreadsBatch(mailbox, label, BATCH_SIZE);
  if (batch.length === 0) {
    result.remaining = 0;
    return result;
  }

  const clientRefs = await buildClientRefs();
  const lookup = buildDeterministicLookup(clientRefs);
  const usageCtx = { mailbox: `${mailbox}:historicalImport` };
  const internalDomain = (process.env.INTERNAL_EMAIL_DOMAIN || "90degreebenefits.com").toLowerCase();

  for (const backfillRow of batch) {
    result.threadsProcessed++;
    try {
      await importOneThread(backfillRow, mailbox, clientRefs, lookup, usageCtx, internalDomain, result);
      result.threadsImported++;
    } catch (err: any) {
      result.threadsErrored++;
      const message = err?.message || String(err);
      console.error(`[gmailHistoricalImport] ${mailbox}/${label} thread ${backfillRow.gmailThreadId}: ${message}`);
      await storage.createBackfillImportError({
        mailbox, label, gmailThreadId: backfillRow.gmailThreadId, errorMessage: message.slice(0, 2000),
      });
    }
  }

  result.remaining = await storage.countImportEligibleRemaining(mailbox, label);
  return result;
}

async function importOneThread(
  backfillRow: GmailBackfillThread,
  mailbox: string,
  clientRefs: ClientRef[],
  lookup: DeterministicLookup,
  usageCtx: { mailbox: string },
  internalDomain: string,
  result: HistoricalImportBatchResult,
): Promise<void> {
  const full = await getThreadFull(mailbox, backfillRow.gmailThreadId);

  let thread = await storage.getGmailThreadByGmailId(backfillRow.gmailThreadId);
  const newlyCreatedMessageIds: number[] = [];
  const allMessages: { fromEmail: string; toEmails: string[]; ccEmails: string[]; bodyTextNew: string | null; bodyText: string | null; subject: string | null }[] = [];
  let latestMessageAt: Date | null = null;
  let firstSubject: string | null = null;

  for (const msg of full.messages || []) {
    const fromHeader = getHeader(msg.payload, "From") || "";
    const fromParsed = parseAddressList(fromHeader)[0] || { name: null, email: "unknown@unknown.com" };
    const toEmails = parseAddressList(getHeader(msg.payload, "To")).map((a) => a.email);
    const ccEmails = parseAddressList(getHeader(msg.payload, "Cc")).map((a) => a.email);
    const subject = getHeader(msg.payload, "Subject") || "(no subject)";
    if (!firstSubject) firstSubject = subject;
    const messageIdHeader = getHeader(msg.payload, "Message-ID") || getHeader(msg.payload, "Message-Id");
    const dateHeader = getHeader(msg.payload, "Date");
    const sentAt = dateHeader ? new Date(dateHeader) : new Date(Number(msg.internalDate));
    if (!latestMessageAt || sentAt > latestMessageAt) latestMessageAt = sentAt;

    // Dedupe against anything already stored — the rolling full sync, or a
    // prior interrupted run of this same import — before creating anything.
    let existing = await storage.getGmailMessageByGmailId(msg.id);
    if (!existing && messageIdHeader) existing = await storage.getGmailMessageByMessageIdHeader(messageIdHeader);
    if (existing) {
      allMessages.push({ fromEmail: existing.fromEmail, toEmails: (existing.toEmails as string[]) || [], ccEmails: (existing.ccEmails as string[]) || [], bodyTextNew: existing.bodyTextNew, bodyText: existing.bodyText, subject: existing.subject });
      continue; // already fully handled (messages + its own attachments) by whichever pass created it
    }

    if (!thread) {
      thread = await storage.createGmailThread({
        gmailThreadId: backfillRow.gmailThreadId,
        mailbox,
        subject,
        latestMessageAt: sentAt,
        messageCount: 0,
        businessStatus: "UNASSIGNED",
        isPrivate: false,
      } as any);
    }

    const direction = fromParsed.email.toLowerCase() === mailbox.toLowerCase() ? "SENT" : "RECEIVED";
    const { text, html } = extractMessageBody(msg.payload);
    const bodyText = (text || (html ? html.replace(/<[^>]+>/g, " ") : "") || "").trim();
    const bodyHtmlSafe = html ? sanitizeEmailHtml(html) : textToSafeHtml(bodyText || "(no content)");
    const quoteSplit = splitQuotedText(bodyText, subject);
    const attachmentRefs = extractAttachmentRefs(msg.payload);

    const created = await storage.createGmailMessage({
      gmailMessageId: msg.id,
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
      hasAttachments: attachmentRefs.length > 0,
      messageIdHeader,
    } as any);
    newlyCreatedMessageIds.push(created.id);
    result.messagesImported++;
    allMessages.push({ fromEmail: fromParsed.email, toEmails, ccEmails, bodyTextNew: quoteSplit.newText, bodyText, subject });

    // Attachments/document filing deferred until the thread's client is
    // resolved below — filed against whichever client the thread as a whole
    // matches, not re-matched per attachment.
    (created as any).__attachmentRefs = attachmentRefs;
    (created as any).__fromHeader = fromHeader;
    (created as any).__fromDomain = domainOf(fromParsed.email);
  }

  if (!thread) return; // every message in this thread was already stored elsewhere — nothing left to do

  // ── Resolve client(s) ──
  let clientIds: number[] = [];
  let matchMethod: "LOOKUP" | "LLM" | "UNMATCHED";

  if (backfillRow.category === "FREE_PROVIDER_BUSINESS" && backfillRow.counterpartyEmail) {
    const hit = lookup.addressToClientIds.get(backfillRow.counterpartyEmail.trim().toLowerCase());
    if (hit && hit.size > 0) clientIds = Array.from(hit);
  } else if (backfillRow.domain) {
    const hit = lookup.domainToClientIds.get(backfillRow.domain.trim().toLowerCase());
    if (hit && hit.size > 0) clientIds = Array.from(hit);
  }

  if (clientIds.length > 0) {
    matchMethod = "LOOKUP";
    result.matchedByLookup++;
  } else {
    const text = `Subject: ${firstSubject}\n\n${allMessages.map((m) => `From: ${m.fromEmail}\n${m.bodyTextNew || m.bodyText || ""}`).join("\n---\n").slice(0, 6000)}`;
    const matches = await matchEmailToClients(text, clientRefs, usageCtx);
    if (matches.length > 0) {
      clientIds = matches.map((m) => m.clientId);
      matchMethod = "LLM";
      result.matchedByLlm++;
    } else {
      matchMethod = "UNMATCHED";
      result.unmatched++;
    }
  }

  const allAddresses = allMessages.flatMap((m) => [m.fromEmail, ...m.toEmails, ...m.ccEmails]);
  const filesToVendor = await isVendorCorrespondence(allAddresses);
  if (filesToVendor) result.filedToVendor++;

  if (clientIds.length > 0) {
    await storage.setGmailThreadClients(thread.id, clientIds.map((id) => ({ clientId: id, confidence: matchMethod === "LOOKUP" ? "high" : "medium" })));
  }
  const messageCount = (await storage.getGmailMessagesForThread(thread.id)).length;
  await storage.updateGmailThread(thread.id, {
    businessStatus: clientIds.length > 0 ? "MATCHED" : "UNASSIGNED",
    filesToVendor,
    latestMessageAt: latestMessageAt || thread.latestMessageAt,
    subject: thread.subject || firstSubject,
    messageCount,
  } as any);

  // ── File attachments + structured-document typing, only for messages we just created ──
  const primaryClientId = clientIds[0];
  const messages = await storage.getGmailMessagesForThread(thread.id);
  for (const message of messages) {
    if (!newlyCreatedMessageIds.includes(message.id)) continue;
    const refs: ReturnType<typeof extractAttachmentRefs> = (message as any).__attachmentRefs || [];
    const fromDomain: string | null = (message as any).__fromDomain ?? domainOf(message.fromEmail);

    for (const attRef of refs) {
      if (isEmbeddedImage(attRef)) {
        await storage.createGmailAttachment({
          messageId: message.id, gmailAttachmentId: attRef.attachmentId, filename: attRef.filename,
          mimeType: attRef.mimeType, sizeBytes: attRef.sizeBytes, isEmbeddedImage: true, storagePath: null, filedAsDocumentId: null,
        } as any);
        continue;
      }

      let filedAsDocumentId: number | null = null;
      if (primaryClientId) {
        const bytes = await getAttachmentBytes(mailbox, message.gmailMessageId, attRef.attachmentId);
        const contentHash = hashBuffer(bytes);
        const existingDoc = await storage.findDocumentByContentHash(primaryClientId, contentHash);
        if (existingDoc) {
          filedAsDocumentId = existingDoc.id;
        } else {
          const { text: extractedText, ocrUsed } = await extractDocumentText(bytes, attRef.mimeType, attRef.filename);
          const objectKey = `gmail-attachments/${primaryClientId}/${message.gmailMessageId}-${attRef.attachmentId}-${attRef.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          await uploadAttachmentBytes(objectKey, bytes);
          const doc = await storage.createDocument({
            clientId: primaryClientId, renewalId: null, planId: null, documentName: attRef.filename,
            category: "OTHER", filePath: objectKey, fileName: attRef.filename,
            notes: "Imported from Gmail historical backfill.", uploadedBy: "Gmail historical import",
            extractedText: extractedText || null, ocrUsed, sourceGmailMessageId: message.gmailMessageId, contentHash,
          } as any);
          filedAsDocumentId = doc.id;
          result.attachmentsFiled++;

          if (fromDomain === internalDomain && extractedText && /ppr|renewal|rate\s*sheet|rate\s*card|premium|proposal/i.test(`${attRef.filename} ${message.subject || ""}`)) {
            const client = clientRefs.find((c) => c.id === primaryClientId);
            const fields = await extractDocumentFields(extractedText, "RENEWAL_PROPOSAL", client?.clientName || "");
            if (fields.length > 0) {
              await storage.createDocumentFieldProposals(
                fields.map((f) => {
                  const mapping = resolveFieldMapping(f.fieldKey, f.proposedValue, "RENEWAL_PROPOSAL", primaryClientId, doc.planId ?? null);
                  return {
                    documentId: doc.id, clientId: primaryClientId, fieldKey: f.fieldKey, fieldLabel: f.fieldLabel,
                    proposedValue: f.proposedValue, sourceLocation: f.sourceLocation, targetTable: mapping.targetTable,
                    targetId: mapping.targetId, targetField: mapping.targetField, currentValue: null,
                    mappingStatus: mapping.mappingStatus, confidence: mapping.confidence, isPlanDesignField: mapping.isPlanDesignField,
                  };
                }),
              );
            }
          }
        }
      }

      await storage.createGmailAttachment({
        messageId: message.id, gmailAttachmentId: attRef.attachmentId, filename: attRef.filename,
        mimeType: attRef.mimeType, sizeBytes: attRef.sizeBytes, isEmbeddedImage: false,
        storagePath: filedAsDocumentId ? `filed:${filedAsDocumentId}` : null, filedAsDocumentId,
      } as any);
    }
  }

  await storage.markBackfillThreadImported(backfillRow.id, matchMethod);
}

/**
 * Drives runHistoricalImportBatch to completion for one mailbox+label,
 * looping in-process until no eligible threads remain (or the circuit
 * breaker trips). Intended to be fired once at server startup, not tied to
 * any HTTP request or browser tab — a restart mid-run simply picks up where
 * the last completed batch left off, via the same importedAt-is-null query.
 */
export async function runHistoricalImportToCompletion(mailbox: string, label: string): Promise<void> {
  const stateKey = `${mailbox}#historicalImport:${label}`;
  const existingState = await storage.getGmailImportState(stateKey);
  if (!existingState) {
    await storage.upsertGmailImportState(stateKey, { backfillStartDate: new Date(), lastRunAt: new Date(), lastRunSummary: "Started." });
  }

  let totals = { threadsImported: 0, threadsErrored: 0, messagesImported: 0, attachmentsFiled: 0, matchedByLookup: 0, matchedByLlm: 0, unmatched: 0, filedToVendor: 0 };
  let consecutiveStalledBatches = 0;
  let batchNumber = 0;

  for (;;) {
    const batch = await runHistoricalImportBatch(mailbox, label);
    batchNumber++;
    totals.threadsImported += batch.threadsImported;
    totals.threadsErrored += batch.threadsErrored;
    totals.messagesImported += batch.messagesImported;
    totals.attachmentsFiled += batch.attachmentsFiled;
    totals.matchedByLookup += batch.matchedByLookup;
    totals.matchedByLlm += batch.matchedByLlm;
    totals.unmatched += batch.unmatched;
    totals.filedToVendor += batch.filedToVendor;

    if (batch.threadsProcessed === 0) break; // nothing left to do

    if (batch.threadsImported === 0) {
      consecutiveStalledBatches++;
      if (consecutiveStalledBatches >= MAX_CONSECUTIVE_STALLED_BATCHES) {
        console.error(`[gmailHistoricalImport] ${mailbox}/${label}: stopping after ${consecutiveStalledBatches} consecutive all-error batches — ${batch.remaining} threads remain, see gmail_backfill_import_errors.`);
        await storage.upsertGmailImportState(stateKey, {
          lastRunAt: new Date(),
          lastRunSummary: `STALLED after ${consecutiveStalledBatches} consecutive failing batches. ${JSON.stringify(totals)}. ${batch.remaining} threads still remain — see gmail_backfill_import_errors.`,
        });
        return;
      }
    } else {
      consecutiveStalledBatches = 0;
    }

    if (batchNumber % 20 === 0) {
      console.log(`[gmailHistoricalImport] ${mailbox}/${label}: progress — ${JSON.stringify(totals)}, ${batch.remaining} remaining.`);
      await storage.upsertGmailImportState(stateKey, { lastRunAt: new Date(), lastRunSummary: `In progress. ${JSON.stringify(totals)}. ${batch.remaining} remaining.` });
    }
  }

  console.log(`[gmailHistoricalImport] ${mailbox}/${label}: COMPLETE — ${JSON.stringify(totals)}.`);
  await storage.upsertGmailImportState(stateKey, { lastRunAt: new Date(), lastRunSummary: `COMPLETE. ${JSON.stringify(totals)}.` });
}
