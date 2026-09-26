/**
 * Filename-pattern classification and version-grouping for documents filed
 * from Gmail. The same FILENAME_CATEGORY_PATTERNS map drives both live
 * ingestion (server/gmailFullSync.ts) and the one-time retro-typing pass
 * (server/index.ts startup migration) so a filename is always classified the
 * same way regardless of when it runs.
 */

/**
 * Ordered filename/subject patterns -> document category. Checked in order;
 * first match wins. Deliberately conservative — an ambiguous filename that
 * matches nothing here is left as OTHER rather than guessed at.
 */
const FILENAME_CATEGORY_PATTERNS: { pattern: RegExp; category: string; filenameOnly?: boolean }[] = [
  // This app's own generated renewal report, recognised by the two filenames
  // it actually emits and nothing looser: `<client>-renewal-report-<plan
  // year>.pdf` when downloaded, and the same with a save timestamp appended
  // when filed. Anchored to the end of the filename, and matched against the
  // filename alone — an email subject that happens to quote a filename must
  // not reclassify the attachment.
  //
  // It is internal-only, so a false match blocks a legitimate client send —
  // the mirror-image failure, and just as bad. A renewal report from anyone
  // else, named any other way, stays a proposal. Must come before the
  // /\brenewal\b/ pattern below, which would otherwise claim it.
  {
    pattern: /(^|[\/\\])[^\/\\]*-renewal-report-\d{4}(-\d{10,})?\.pdf$/i,
    category: "INTERNAL_RENEWAL_REPORT",
    filenameOnly: true,
  },
  // Renewal / proposal material
  { pattern: /renewal[_\s-]*proposal/i, category: "RENEWAL_PROPOSAL" },
  { pattern: /\bproposal\b/i, category: "RENEWAL_PROPOSAL" },
  { pattern: /\brenewal\b/i, category: "RENEWAL_PROPOSAL" },
  // Acceptance
  { pattern: /acceptance/i, category: "EMPLOYER_ACCEPTANCE" },
  { pattern: /signature[_\s-]*page/i, category: "SUPPLEMENT" },
  // Handout / benefit summary
  { pattern: /\bhandout\b/i, category: "HANDOUT" },
  { pattern: /benefit[_\s-]*summary/i, category: "HANDOUT" },
  // Supplemental renewal material
  { pattern: /\bsupplement/i, category: "SUPPLEMENT" },
  { pattern: /funding[_\s-]*option/i, category: "SUPPLEMENT" },
  { pattern: /rate[_\s-]*bridge/i, category: "SUPPLEMENT" },
  { pattern: /glide[_\s-]*path/i, category: "SUPPLEMENT" },
];

/** True when this filename looks like a scanned/executed copy rather than the original. */
const SIGNED_FILENAME_PATTERN = /\bsigned\b|\bexecuted\b|\bscanned\b/i;

/**
 * Classifies a document by filename (and optionally the email subject as a
 * secondary signal) into one of the document categories this pass owns.
 * Returns null — meaning "leave as OTHER" — for anything that doesn't
 * confidently match, rather than guessing.
 */
export function classifyDocumentType(filename: string, subject?: string): string | null {
  const haystack = `${filename} ${subject || ""}`;
  for (const { pattern, category, filenameOnly } of FILENAME_CATEGORY_PATTERNS) {
    // A pattern marked filenameOnly ignores the subject. The subject is a
    // useful hint for "is this a proposal", but it is written by whoever sent
    // the mail, so it must not be able to move a document into a category
    // that changes who may receive it.
    if (pattern.test(filenameOnly ? filename : haystack)) return category;
  }
  return null;
}

/** Whether a filename indicates a signed/executed copy of an acceptance form. */
export function looksSigned(filename: string): boolean {
  return SIGNED_FILENAME_PATTERN.test(filename);
}

/**
 * Strips resend artifacts and the extension from a filename so
 * "Loudon_Renewal_2027.pdf", "Loudon_Renewal_2027 (1).pdf" and
 * "Loudon_Renewal_2027_v2.pdf" all normalize to the same group key. Case is
 * lowered for comparison; the original casing is never shown to the user —
 * this value is a grouping key, not a display name.
 */
export function normalizeDocumentFilename(filename: string): string {
  let name = filename.trim();
  // Strip extension.
  name = name.replace(/\.[a-zA-Z0-9]{1,5}$/, "");
  // Strip " (1)", " (2)", etc.
  name = name.replace(/\s*\(\d+\)\s*$/g, "");
  // Strip _v2/_v3/-v2/ v2 style version suffixes.
  name = name.replace(/[_\-\s]v\d+\s*$/i, "");
  // Strip _rev2/-rev2/ rev2 and _revised/-revised/ revised style suffixes.
  name = name.replace(/[_\-\s]rev(?:ised)?\d*\s*$/i, "");
  return name.trim().toLowerCase();
}
