/**
 * Shared renewal-status logic — used by the client list, alert page, and client detail view.
 * All functions are pure (no side-effects) so they can run on the client without extra fetches.
 */

export type RenewalStatus =
  | "NOT_DUE"
  | "PROPOSAL_DUE"
  | "AWAITING_ACCEPTANCE"
  | "ACCEPTED"
  | "OVERDUE";

export const RENEWAL_STATUS_LABELS: Record<RenewalStatus, string> = {
  NOT_DUE:             "Not due",
  PROPOSAL_DUE:        "Proposal due",
  AWAITING_ACCEPTANCE: "Awaiting acceptance",
  ACCEPTED:            "Accepted",
  OVERDUE:             "Overdue",
};

/** Tailwind classes for the status badge */
export const RENEWAL_STATUS_COLORS: Record<RenewalStatus, string> = {
  NOT_DUE:             "bg-gray-100 text-gray-500",
  PROPOSAL_DUE:        "bg-amber-100 text-amber-700",
  AWAITING_ACCEPTANCE: "bg-blue-50 text-blue-700",
  ACCEPTED:            "bg-green-50 text-green-700",
  OVERDUE:             "bg-red-100 text-red-700",
};

/**
 * Derive the current renewal status from client fields.
 * Returns null when no anniversary date is set (renewal tracking not applicable).
 *
 * Priority order:
 *   1. ACCEPTED          — acceptance received, regardless of date
 *   2. OVERDUE           — anniversary passed with no acceptance
 *   3. AWAITING_ACCEPTANCE — proposal sent, no acceptance
 *   4. PROPOSAL_DUE      — proposal due date passed, nothing sent
 *   5. NOT_DUE           — too early to act
 */
export function getRenewalStatus(client: any, today: Date = new Date()): RenewalStatus | null {
  if (!client.anniversaryDate) return null;

  const anniversary = new Date(client.anniversaryDate);
  const leadMonths = client.renewalLeadMonths ?? 3;

  const proposalDue = new Date(anniversary);
  proposalDue.setMonth(proposalDue.getMonth() - leadMonths);

  if (client.acceptanceReceivedDate) return "ACCEPTED";
  if (today > anniversary)           return "OVERDUE";
  if (client.proposalSentDate)       return "AWAITING_ACCEPTANCE";
  if (today >= proposalDue)          return "PROPOSAL_DUE";
  return "NOT_DUE";
}

/** Return the proposal due date (anniversary minus lead months), or null. */
export function getProposalDueDate(client: any): Date | null {
  if (!client.anniversaryDate) return null;
  const anniversary = new Date(client.anniversaryDate);
  const leadMonths = client.renewalLeadMonths ?? 3;
  const due = new Date(anniversary);
  due.setMonth(due.getMonth() - leadMonths);
  return due;
}

/** True when a proposal was sent more than 14 days ago and acceptance is still pending. */
export function isAwaitingTooLong(client: any, today: Date = new Date()): boolean {
  if (!client.proposalSentDate || client.acceptanceReceivedDate) return false;
  const sent = new Date(client.proposalSentDate);
  const daysSince = (today.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > 14;
}

// ── PPR slot logic ─────────────────────────────────────────────────────────────

export interface PprSlot {
  label: string;
  /** 1–12 */
  reportMonth: number;
  reportYear: number;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Compute the four PPR slots that belong in a client's renewal underwriting package.
 *
 * Each slot corresponds to the plan-year ending period: the last month of the plan
 * year, which is the month immediately before the anniversary month.
 *
 * Examples:
 *   Anniversary July 1  → periods end June  30  (months: Jun 2026, Jun 2025, Jun 2024, Jun 2023)
 *   Anniversary Jan  1  → periods end Dec   31  (months: Dec 2025, Dec 2024, Dec 2023, Dec 2022)
 *   Anniversary Sep  1  → periods end Aug   31  (months: Aug 2025, Aug 2024, …)  [if today < Sep 2026]
 */
export function getPprSlots(
  anniversaryDate: string | null | undefined,
  today: Date = new Date(),
): PprSlot[] {
  if (!anniversaryDate) return [];

  const ann = new Date(anniversaryDate);
  const annMonth = ann.getMonth() + 1; // 1–12

  // The plan year ends the month before the anniversary month
  let endMonth = annMonth - 1;
  if (endMonth === 0) endMonth = 12; // January anniversary → December end

  // Find the most recent anniversary that has occurred (or will occur this calendar year)
  const thisYearAnn = new Date(today.getFullYear(), ann.getMonth(), ann.getDate());
  const mostRecentAnnYear = today >= thisYearAnn ? today.getFullYear() : today.getFullYear() - 1;

  // When endMonth > annMonth the period belongs to the year BEFORE the anniversary year
  // (e.g. Jan anniversary: Dec end is in the prior calendar year)
  let currentSlotYear = mostRecentAnnYear;
  if (endMonth > annMonth) {
    currentSlotYear = mostRecentAnnYear - 1;
  }

  return [0, 1, 2, 3].map(i => {
    const slotYear = currentSlotYear - i;
    const label = i === 0
      ? `Current year — ending ${MONTH_NAMES[endMonth - 1]} ${slotYear}`
      : `${i} year${i > 1 ? "s" : ""} prior — ending ${MONTH_NAMES[endMonth - 1]} ${slotYear}`;
    return { label, reportMonth: endMonth, reportYear: slotYear };
  });
}
