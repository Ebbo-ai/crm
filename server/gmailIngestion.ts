import { storage } from "./storage";
import { buildClientRefs } from "./client-context";
import { matchEmailToClients } from "./claude";
import { extractDocumentFields } from "./claude";
import { extractDocumentText, hashBuffer } from "./documentExtraction";
import { resolveFieldMapping } from "./fieldMapping";
import { uploadAttachmentBytes } from "./objectStorage";
import {
  getGmailProfile,
  searchThreadsWithAttachments,
  getMessageFull,
  extractAttachmentRefs,
  getAttachmentBytes,
  getHeader,
} from "./gmail";

const BACKFILL_MONTHS = 12;
/** Bounds one ingestion run so it can't run away on a huge mailbox — call again to continue. */
const MAX_MESSAGES_PER_RUN = 200;

function monthsAgoEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return Math.floor(d.getTime() / 1000);
}

/** Filenames/subjects that suggest a document worth Claude's structured field extraction. */
function looksLikeStructuredDocument(filename: string, subject: string): boolean {
  const s = `${filename} ${subject}`.toLowerCase();
  return /ppr|renewal|rate\s*sheet|rate\s*card|premium|proposal/.test(s);
}

export interface GmailIngestionSummary {
  mailbox: string;
  messagesScanned: number;
  attachmentsDownloaded: number;
  attachmentsSkippedDuplicate: number;
  documentsFiled: number;
  fieldProposalsCreated: number;
  errors: string[];
}

/**
 * Pulls attachments out of a mailbox and files them onto matched clients'
 * documents. Bounded to a rolling backfill window (BACKFILL_MONTHS) and to
 * MAX_MESSAGES_PER_RUN per call so a first run against a large mailbox has a
 * predictable, visible cost instead of silently walking the entire history.
 * Safe to call repeatedly — every dedup check (Gmail ids, content hash) runs
 * before any write.
 */
export async function runGmailIngestion(): Promise<GmailIngestionSummary> {
  const profile = await getGmailProfile();
  const mailbox = profile.emailAddress;
  const summary: GmailIngestionSummary = {
    mailbox,
    messagesScanned: 0,
    attachmentsDownloaded: 0,
    attachmentsSkippedDuplicate: 0,
    documentsFiled: 0,
    fieldProposalsCreated: 0,
    errors: [],
  };

  const state = await storage.getGmailImportState(mailbox);
  const backfillFloorEpoch = monthsAgoEpochSeconds(BACKFILL_MONTHS);
  const afterEpoch = state?.backfillStartDate
    ? Math.floor(new Date(state.backfillStartDate).getTime() / 1000)
    : backfillFloorEpoch;

  const query = `has:attachment after:${afterEpoch}`;
  const clientRefs = await buildClientRefs();
  const internalDomain = (process.env.INTERNAL_EMAIL_DOMAIN || "90degreebenefits.com").toLowerCase();

  let pageToken: string | undefined;
  let newestInternalDate: string | undefined;

  do {
    const page = await searchThreadsWithAttachments(query, pageToken, 50);
    for (const thread of page.threads) {
      for (const msg of thread.messages) {
        if (summary.messagesScanned >= MAX_MESSAGES_PER_RUN) break;
        summary.messagesScanned++;
        if (!newestInternalDate || msg.date > newestInternalDate) newestInternalDate = msg.date;

        try {
          const full = await getMessageFull(msg.id);
          const attachmentRefs = extractAttachmentRefs(full.payload);
          if (attachmentRefs.length === 0) continue;

          const fromHeader = getHeader(full.payload, "From") || msg.sender || "";
          const senderEmailMatch = fromHeader.match(/<([^>]+)>/);
          const senderEmail = (senderEmailMatch ? senderEmailMatch[1] : fromHeader).trim().toLowerCase();
          const senderDomain = senderEmail.split("@")[1] || "";
          const subject = getHeader(full.payload, "Subject") || msg.subject || "(no subject)";

          const matches = await matchEmailToClients(`From: ${fromHeader}\nSubject: ${subject}\n\n${msg.snippet}`, clientRefs);
          if (matches.length === 0) continue; // unmatched mail is not filed — nowhere safe to put it
          const clientId = matches[0].clientId;

          // One communications row per message for provenance/audit, same as inbound webhook mail.
          const comm = await storage.createCommunication({
            subject,
            senderEmail: senderEmail || "unknown@unknown.com",
            senderName: null,
            senderDomain,
            bodyText: msg.snippet.slice(0, 5000),
            bodyHtml: "",
            claudeSummary: "Imported from Gmail attachment ingestion.",
            claudeActionItems: "[]",
            isInternal: senderDomain === internalDomain,
            isUnmatched: false,
            source: "gmail_import",
            rawPayload: null,
          });
          await storage.assignCommunicationToClients(comm.id, matches);

          for (const ref of attachmentRefs) {
            const already = await storage.findAttachmentByGmailIds(msg.id, ref.attachmentId);
            if (already) {
              summary.attachmentsSkippedDuplicate++;
              continue;
            }

            const bytes = await getAttachmentBytes(msg.id, ref.attachmentId);
            summary.attachmentsDownloaded++;
            const contentHash = hashBuffer(bytes);

            const existingDoc = await storage.findDocumentByContentHash(clientId, contentHash);
            if (existingDoc) {
              // Same bytes Kim already has on file (manual upload or a prior import) — record the
              // Gmail source for traceability without filing a duplicate document.
              await storage.createCommunicationAttachment({
                communicationId: comm.id,
                filename: ref.filename,
                mimeType: ref.mimeType,
                sizeBytes: ref.sizeBytes,
                storagePath: existingDoc.filePath,
                claudeAnalysis: null,
                storageBackend: "object_storage",
                gmailMessageId: msg.id,
                gmailAttachmentId: ref.attachmentId,
                gmailMailbox: mailbox,
                filedAsDocumentId: existingDoc.id,
              } as any);
              summary.attachmentsSkippedDuplicate++;
              continue;
            }

            const { text: extractedText, ocrUsed } = await extractDocumentText(bytes, ref.mimeType, ref.filename);
            const objectKey = `gmail-attachments/${clientId}/${msg.id}-${ref.attachmentId}-${ref.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            await uploadAttachmentBytes(objectKey, bytes);

            const attachmentRow = await storage.createCommunicationAttachment({
              communicationId: comm.id,
              filename: ref.filename,
              mimeType: ref.mimeType,
              sizeBytes: ref.sizeBytes,
              storagePath: objectKey,
              claudeAnalysis: extractedText || null,
              storageBackend: "object_storage",
              gmailMessageId: msg.id,
              gmailAttachmentId: ref.attachmentId,
              gmailMailbox: mailbox,
            } as any);

            const doc = await storage.createDocument({
              clientId,
              renewalId: null,
              planId: null,
              documentName: ref.filename,
              category: "OTHER",
              filePath: objectKey,
              fileName: ref.filename,
              notes: "Imported from Gmail attachment ingestion.",
              uploadedBy: "Gmail import",
              extractedText: extractedText || null,
              ocrUsed,
              sourceGmailMessageId: msg.id,
              contentHash,
            } as any);
            await storage.markAttachmentFiled(attachmentRow.id, doc.id);
            summary.documentsFiled++;

            if (senderDomain === internalDomain && looksLikeStructuredDocument(ref.filename, subject) && extractedText) {
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
            }
          }
        } catch (err: any) {
          summary.errors.push(`message ${msg.id}: ${err?.message || String(err)}`);
        }
      }
      if (summary.messagesScanned >= MAX_MESSAGES_PER_RUN) break;
    }
    pageToken = summary.messagesScanned < MAX_MESSAGES_PER_RUN ? page.nextPageToken : undefined;
  } while (pageToken);

  await storage.upsertGmailImportState(mailbox, {
    backfillStartDate: new Date(backfillFloorEpoch * 1000),
    lastProcessedInternalDate: newestInternalDate || state?.lastProcessedInternalDate || null,
    lastRunAt: new Date(),
    lastRunSummary: `${summary.messagesScanned} messages scanned, ${summary.documentsFiled} documents filed, ${summary.attachmentsSkippedDuplicate} duplicates skipped, ${summary.fieldProposalsCreated} field proposals, ${summary.errors.length} errors.`,
  });

  return summary;
}

/** A bounded, read-only count so the UI can show an estimate before running a real ingestion. */
export async function estimateGmailIngestionVolume(): Promise<{ mailbox: string; matchingThreadsEstimate: number; windowMonths: number }> {
  const profile = await getGmailProfile();
  const query = `has:attachment after:${monthsAgoEpochSeconds(BACKFILL_MONTHS)}`;
  const page = await searchThreadsWithAttachments(query, undefined, 1);
  return { mailbox: profile.emailAddress, matchingThreadsEstimate: page.resultCountEstimate || 0, windowMonths: BACKFILL_MONTHS };
}
