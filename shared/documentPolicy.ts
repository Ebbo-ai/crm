/**
 * Which document categories must never leave the company, and which domains
 * count as inside it.
 *
 * Shared because the server and the UI have to agree. The server refuses the
 * send; the UI marks the document so nobody gets that far. If the two lists
 * ever drifted, staff would see a document marked safe that the server then
 * refuses, or — worse — one marked safe that is not.
 *
 * The server check is the control. Everything the UI does with this list is
 * a courtesy: it shows the refusal earlier, in a place where it can still be
 * fixed. A UI that hides the option has not prevented anything.
 */

/**
 * Categories that carry fee detail the company does not show clients or
 * brokers.
 *
 * - PLAN_TRANSMITTAL carries the full administrative fee breakdown. The
 *   client sees one all-in admin fee; the breakdown behind it is internal.
 * - BROKER_COMPENSATION is what a commission sheet is filed as — there is no
 *   separate commission-sheet category. It states what the broker is paid,
 *   which is not the broker's to receive from us and not the client's to see.
 * - INTERNAL_RENEWAL_REPORT is the renewal report this app generates, which
 *   lists every fee component separately, broker compensation included. It
 *   used to be filed as RENEWAL_PROPOSAL, the same category as the proposals
 *   that go to clients and brokers. One category cannot be both restricted
 *   and permitted, so the internal report has its own.
 *
 * Categories are deliberately coarse here. A category is either internal-only
 * or it is not; there is no per-document exception, because an exception is
 * something a person grants under pressure at the moment of sending.
 */
export const INTERNAL_ONLY_DOCUMENT_CATEGORIES: readonly string[] = [
  "PLAN_TRANSMITTAL",
  "BROKER_COMPENSATION",
  "INTERNAL_RENEWAL_REPORT",
];

const INTERNAL_ONLY_SET = new Set(INTERNAL_ONLY_DOCUMENT_CATEGORIES);

export function isInternalOnlyCategory(category: string | null | undefined): boolean {
  return !!category && INTERNAL_ONLY_SET.has(category);
}

/** Shown next to an internal-only document wherever documents are listed. */
export const INTERNAL_ONLY_BADGE_LABEL = "Internal only";

/** Why it is marked, in one line, for a tooltip. */
export const INTERNAL_ONLY_BADGE_REASON =
  "Carries internal fee detail. Cannot be emailed to anyone outside Simple or 90 Degree Benefits.";

/**
 * Domains that count as inside the company: Simple's own domains and the TPA.
 * `simple.dental` pre-dates the move to `simple.us` and is still ours, so it
 * is internal too. Everything else — the client, the broker, a personal
 * address — is outside.
 *
 * The 90 Degree Benefits domain is read from INTERNAL_EMAIL_DOMAIN where an
 * environment is available (the server), so it stays consistent with the rest
 * of the app's idea of "internal". In the browser there is no environment, so
 * the default stands; the UI is only deciding whether to warn early, and the
 * server decides for real.
 */
export function internalEmailDomains(ninetyDegreeDomain?: string): Set<string> {
  const ninetyDb = (ninetyDegreeDomain || "90degreebenefits.com").toLowerCase();
  return new Set([ninetyDb, "simple.us", "simple.dental"]);
}
