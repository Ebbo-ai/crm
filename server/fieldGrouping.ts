/**
 * Derives a document's "effective date" — the plan year / report period the
 * document's content actually describes — as distinct from documents.uploadedAt,
 * which only records when Gmail ingestion happened to file it. Renewal season
 * means the same plan gets re-proposed, re-accepted, and re-reported multiple
 * times a year; ordering by upload time instead of content date would treat a
 * late-arriving copy of an old proposal as "newer" than this year's signed
 * acceptance.
 *
 * Priority: a date/year-bearing field already proposed off this same document
 * (most reliable, since Claude read it straight from the text) beats a guess
 * from the filename, which beats nothing at all.
 */

const DATE_FIELD_PRIORITY = [
  "renewalEffectiveDate",
  "planYearStartDate",
  "planYearStart",
  "proposalPreparedDate",
  "anniversaryDate",
  "planYearEndDate",
];
const YEAR_FIELD_PRIORITY = ["currentPlanYear", "planYear"];

function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function yearToJan1(raw: string): Date | null {
  const m = raw.match(/\d{4}/);
  if (!m) return null;
  const year = parseInt(m[0], 10);
  if (year < 1990 || year > 2100) return null;
  return new Date(Date.UTC(year, 0, 1));
}

/** Best-effort year guess from a filename like "...2027 Acceptance.pdf" or "ppr24-25.pdf". */
function yearFromFilename(documentName: string): Date | null {
  const rangeMatch = documentName.match(/(\d{2})[-_](\d{2})(?!\d)/);
  if (rangeMatch) {
    const secondYear = 2000 + parseInt(rangeMatch[2], 10);
    if (secondYear >= 1990 && secondYear <= 2100) return new Date(Date.UTC(secondYear, 0, 1));
  }
  const fullYearMatch = documentName.match(/20\d{2}/);
  if (fullYearMatch) {
    const year = parseInt(fullYearMatch[0], 10);
    return new Date(Date.UTC(year, 0, 1));
  }
  return null;
}

export function deriveDocumentEffectiveDate(
  documentName: string,
  proposalsOnDocument: { fieldKey: string; proposedValue: string }[],
): Date | null {
  for (const fieldKey of DATE_FIELD_PRIORITY) {
    const p = proposalsOnDocument.find((x) => x.fieldKey === fieldKey);
    if (p) {
      const d = parseDate(p.proposedValue);
      if (d) return d;
    }
  }
  for (const fieldKey of YEAR_FIELD_PRIORITY) {
    const p = proposalsOnDocument.find((x) => x.fieldKey === fieldKey);
    if (p) {
      const d = yearToJan1(p.proposedValue);
      if (d) return d;
    }
  }
  return yearFromFilename(documentName);
}

export type QueueState = "CONFLICT" | "NEEDS_REVIEW" | "SUPERSEDED" | "MATCHED" | "UNMAPPED";

export interface GroupedCandidate {
  proposalId: number;
  proposedValue: string;
  coercedValue: string | null;
  documentId: number;
  documentName: string;
  effectiveDate: string | null;
  sourceLocation: string | null;
}

export interface GroupedField {
  key: string;
  clientId: number;
  targetTable: string;
  targetId: number | null;
  targetField: string;
  fieldKey: string;
  fieldLabel: string;
  mappingStatus: "MAPPED" | "UNMAPPED";
  confidence: "normal" | "low";
  isPlanDesignField: boolean;
  state: QueueState;
  currentValue: string | null;
  /** The candidate(s) still relevant: one for NEEDS_REVIEW/MATCHED/UNMAPPED, two+ for CONFLICT. */
  candidates: GroupedCandidate[];
  /** Older same-field proposals pushed out of the review count, newest first. */
  superseded: GroupedCandidate[];
}

export interface GroupedClient {
  clientId: number;
  clientName: string;
  clientCode: string;
  needsReviewCount: number;
  conflictCount: number;
  unmappedCount: number;
  fields: GroupedField[];
}

export interface GroupedFieldProposalsResult {
  clients: GroupedClient[];
  totals: {
    totalProposals: number;
    superseded: number;
    matched: number;
    needsReview: number;
    conflicts: number;
    unmapped: number;
  };
}
