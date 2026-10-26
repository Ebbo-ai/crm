import { db } from "./db";
import { maintainableDocument } from "./mailboxMaintenancePolicy";
import { documents } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { classifyDocumentType, normalizeDocumentFilename, looksSigned } from "./documentVersioning";

/**
 * One-time (but safe to re-run — naturally idempotent, since only documents
 * still sitting in OTHER are ever touched) retro-typing pass: applies the
 * same filename-pattern classifier that live Gmail ingestion uses to every
 * pre-existing document filed as OTHER, so historical proposals/acceptances/
 * handouts/supplements get the right category instead of staying generic
 * forever. Ambiguous filenames that don't confidently match anything are
 * left as OTHER — this never guesses.
 *
 * Version/isCurrent for the newly-typed rows is recomputed per
 * client+category+normalizedFileName group, ordered by sentAt (falling back
 * to uploadedAt for documents with no recorded send date, e.g. manual
 * uploads) — the same grouping server/storage.ts's createDocument uses for
 * new filings, so retyped historical documents and newly-filed ones share
 * one consistent version sequence.
 */
export interface RetroTypingResult {
  scanned: number;
  reclassified: { id: number; fileName: string; from: string; to: string }[];
  leftAsOther: number;
}

const VERSIONED_CATEGORIES = new Set(["RENEWAL_PROPOSAL", "EMPLOYER_ACCEPTANCE", "HANDOUT", "SUPPLEMENT"]);

export async function runDocumentRetroTyping(): Promise<RetroTypingResult> {
  const result: RetroTypingResult = { scanned: 0, reclassified: [], leftAsOther: 0 };

  const otherDocs = await db.select().from(documents).where(and(maintainableDocument, eq(documents.category, "OTHER" as any)));
  result.scanned = otherDocs.length;
  if (otherDocs.length === 0) return result;

  const reclassifiedByGroup = new Map<string, { id: number; sortKey: number }[]>();

  for (const doc of otherDocs) {
    const category = classifyDocumentType(doc.fileName, doc.documentName);
    if (!category) {
      result.leftAsOther++;
      continue;
    }
    const normalizedFileName = normalizeDocumentFilename(doc.fileName);
    const isSigned = category === "EMPLOYER_ACCEPTANCE" && looksSigned(doc.fileName);
    await db.update(documents).set({
      category: category as any,
      normalizedFileName,
      isSigned,
    }).where(eq(documents.id, doc.id));
    result.reclassified.push({ id: doc.id, fileName: doc.fileName, from: "OTHER", to: category });

    if (VERSIONED_CATEGORIES.has(category)) {
      const key = `${doc.clientId}::${category}::${normalizedFileName}`;
      const sortKey = (doc.sentAt ? new Date(doc.sentAt as any) : new Date(doc.uploadedAt as any)).getTime();
      if (!reclassifiedByGroup.has(key)) reclassifiedByGroup.set(key, []);
      reclassifiedByGroup.get(key)!.push({ id: doc.id, sortKey });
    }
  }

  // Recompute version/isCurrent for every affected group, including any
  // documents already on file in that category (e.g. a document filed
  // through the normal path after this one was stuck as OTHER).
  for (const key of Array.from(reclassifiedByGroup.keys())) {
    const [clientIdStr, category, normalizedFileName] = key.split("::");
    const clientId = parseInt(clientIdStr);
    const siblings = await db.select().from(documents).where(and(
      maintainableDocument,
      eq(documents.clientId, clientId),
      eq(documents.category, category as any),
      eq(documents.normalizedFileName, normalizedFileName),
    ));
    const ordered = siblings
      .slice()
      .sort((a, b) => {
        const aTime = (a.sentAt ? new Date(a.sentAt as any) : new Date(a.uploadedAt as any)).getTime();
        const bTime = (b.sentAt ? new Date(b.sentAt as any) : new Date(b.uploadedAt as any)).getTime();
        return aTime - bTime;
      });
    for (let i = 0; i < ordered.length; i++) {
      await db.update(documents).set({ version: i + 1, isCurrent: i === ordered.length - 1 }).where(eq(documents.id, ordered[i].id));
    }
  }

  return result;
}
