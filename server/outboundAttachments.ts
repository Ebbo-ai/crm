/**
 * Turning "attach this document" into actual bytes plus the category the
 * send guard will judge.
 *
 * The rule this file exists to enforce: the file and its category are both
 * read from the stored record, by id. A caller that hands over a category it
 * chose itself has stepped around the internal-only guard — it could attach
 * the internal renewal report while declaring it a handout. So nothing here
 * accepts a category from the request; every resolver returns the pair
 * together, and the send path passes that same pair to both the guard and
 * the MIME builder.
 */

import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { downloadAttachmentBytes, uploadAttachmentBytes } from "./objectStorage";
import { classifyDocumentType } from "./documentVersioning";
import type { GuardedDocument } from "./documentGuards";
import type { OutboundAttachment } from "./gmailSend";

/** One attachment, resolved: the bytes to send and the record they came from. */
export interface ResolvedAttachment {
  attachment: OutboundAttachment;
  guarded: GuardedDocument;
  /** For the audit line on the sent message. */
  label: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".zip": "application/zip",
};

export function mimeTypeForFilename(filename: string): string {
  return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

/**
 * Reads a stored file whether it lives in Object Storage or on local disk.
 *
 * Gmail-sourced documents and everything written since the Object Storage
 * migration keep a bucket key in filePath; older hand-uploaded rows keep an
 * absolute disk path, and the container wipes that disk on every deploy. A
 * missing file is reported as such rather than sending a message with a
 * silently empty attachment.
 */
async function readStoredFile(filePath: string, preferObjectStorage: boolean, label: string): Promise<Buffer> {
  const looksLikeDiskPath = filePath.startsWith("/") || filePath.startsWith("uploads/") || fs.existsSync(filePath);
  if (!preferObjectStorage && looksLikeDiskPath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`${label} is no longer on disk (uploaded before the last deploy). Re-upload it and try again.`);
    }
    return fs.promises.readFile(filePath);
  }
  try {
    return await downloadAttachmentBytes(filePath);
  } catch (err: any) {
    if (fs.existsSync(filePath)) return fs.promises.readFile(filePath);
    throw new Error(`${label} could not be read from storage: ${err?.message || String(err)}`);
  }
}

/** A document on a client's Documents tab. Category comes from the row, never from the caller. */
export async function resolveClientDocumentAttachment(documentId: number): Promise<ResolvedAttachment> {
  const doc = await storage.getDocument(documentId);
  if (!doc) throw new Error(`Document ${documentId} not found`);
  const filename = doc.fileName || doc.documentName || `document-${doc.id}`;
  const content = await readStoredFile(doc.filePath, !!doc.sourceGmailMessageId, filename);
  return {
    attachment: { filename, mimeType: mimeTypeForFilename(filename), content },
    guarded: { id: doc.id, documentName: doc.documentName, category: doc.category as string },
    label: `${doc.documentName || filename} (${doc.category})`,
  };
}

/** A fixed document that belongs to no client — the marketing PDFs sent with most proposals. */
export async function resolveGlobalDocumentAttachment(globalDocumentId: number): Promise<ResolvedAttachment> {
  const doc = await storage.getGlobalDocument(globalDocumentId);
  if (!doc) throw new Error(`Global document ${globalDocumentId} not found`);
  const filename = doc.fileName || doc.name;
  const content = await readStoredFile(doc.filePath, true, filename);
  return {
    // Global documents carry a free-text category of their own (they are not
    // client records), so the guard sees that text. None of the internal-only
    // categories can appear here, which is correct: these are the documents
    // whose whole purpose is being sent out.
    attachment: { filename, mimeType: mimeTypeForFilename(filename), content },
    guarded: { id: null, documentName: doc.name, category: `GLOBAL:${doc.category}` },
    label: `${doc.name} (shared document)`,
  };
}

/**
 * A file picked off the sender's own computer.
 *
 * It has no stored record, so there is no category to read — which means the
 * guard has nothing to judge it by. Rather than waving it through, the
 * filename goes through the same classifier the Gmail importer uses, and a
 * name that reads as an internal-only document is refused. That is the same
 * conservative direction as everywhere else: an unrecognised file is a
 * normal attachment, a recognisable internal report is not.
 */
export function resolveUploadedFileAttachment(file: { originalname: string; buffer?: Buffer; path?: string }): ResolvedAttachment {
  const filename = file.originalname;
  const content = file.buffer ?? fs.readFileSync(file.path!);
  const classified = classifyDocumentType(filename);
  return {
    attachment: { filename, mimeType: mimeTypeForFilename(filename), content },
    guarded: { id: null, documentName: filename, category: classified || "UNCLASSIFIED_UPLOAD" },
    label: `${filename} (from this computer)`,
  };
}

/** Where a global document's bytes live. Local disk is wiped on every deploy, so these go to the bucket. */
export async function storeGlobalDocumentBytes(filename: string, content: Buffer): Promise<string> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `global-documents/${Date.now()}-${safeName}`;
  await uploadAttachmentBytes(key, content);
  return key;
}
