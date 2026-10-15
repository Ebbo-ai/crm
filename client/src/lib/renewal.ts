/**
 * Shared renewal logic — pipeline steps, timing warnings, and PPR slot computation.
 *
 * TWO INDEPENDENT CONCEPTS:
 *
 *   1. RenewalPipelineStep  — manually advanced by staff through the CRM.
 *      Never derived from dates. Represents where the renewal actually is.
 *
 *   2. RenewalTimingWarning — derived from dates alone.
 *      A separate flag that can coexist with any pipeline step.
 *      Shows when things are running late without overriding the step.
 *
 * Example: a client can be at step SENT (the proposal went out) and also carry
 * a LATE_RESPONSE warning (it went out 20 days ago and nobody replied).
 * These are two different facts and both should be visible at the same time.
 */

// ── Seven-step renewal pipeline ────────────────────────────────────────────────

export type RenewalPipelineStep =
  | "REQUESTED"           // 1. We have asked for the renewal analysis
  | "PROCESSED"           // 2. Analysis and proposal produced
  | "SENT"                // 3. Proposal went to client or broker
  | "REVISED"             // 4. Updated version sent after pushback (optional step)
  | "ACCEPTED"            // 5. Client chose an option
  | "SIGNED_FORM_ATTACHED"// 6. Signed acceptance form is on file
  | "EMAILED_TO_90D";     // 7. 90 Degree Benefits notified — renewal complete

export const RENEWAL_PIPELINE_STEPS: RenewalPipelineStep[] = [
  "REQUESTED",
  "PROCESSED",
  "SENT",
  "REVISED",
  "ACCEPTED",
  "SIGNED_FORM_ATTACHED",
  "EMAILED_TO_90D",
];

export const RENEWAL_PIPELINE_STEP_LABELS: Record<RenewalPipelineStep, string> = {
  REQUESTED:            "Requested",
  PROCESSED:            "Processed",
  SENT:                 "Sent",
  REVISED:              "Revised",
  ACCEPTED:             "Accepted",
  SIGNED_FORM_ATTACHED: "Signed Form Attached",
  EMAILED_TO_90D:       "Emailed to 90 Degree",
};

/** Tailwind classes for the pipeline step badge */
export const RENEWAL_PIPELINE_STEP_COLORS: Record<RenewalPipelineStep, string> = {
  REQUESTED:            "bg-gray-100 text-gray-600",
  PROCESSED:            "bg-blue-50 text-blue-600",
  SENT:                 "bg-indigo-50 text-indigo-700",
  REVISED:              "bg-purple-50 text-purple-700",
  ACCEPTED:             "bg-green-50 text-green-700",
  SIGNED_FORM_ATTACHED: "bg-teal-50 text-teal-700",
  EMAILED_TO_90D:       "bg-brand/10 text-brand",
};

/** Returns the next step, or null if already at the final step. */
export function getNextPipelineStep(
  current: RenewalPipelineStep | null | undefined,
): RenewalPipelineStep | null {
  if (!current) return "REQUESTED";
  const idx = RENEWAL_PIPELINE_STEPS.indexOf(current);
  if (idx === -1 || idx === RENEWAL_PIPELINE_STEPS.length - 1) return null;
  return RENEWAL_PIPELINE_STEPS[idx + 1];
}

/** 0-based index of the step, or -1 for null (not started). */
export function pipelineStepIndex(
  step: RenewalPipelineStep | null | undefined,
): number {
  if (!step) return -1;
  return RENEWAL_PIPELINE_STEPS.indexOf(step);
}

// ── Timing warnings (date-derived, separate from the pipeline) ─────────────────

export type RenewalTimingWarning =
  | "OVERDUE"       // anniversary has passed; renewal not complete
  | "PROPOSAL_DUE"  // proposal due date passed; still at early pipeline step
  | "LATE_RESPONSE";// proposal sent >14 days ago; client hasn't responded

export const RENEWAL_TIMING_WARNING_LABELS: Record<RenewalTimingWarning, string> = {
  OVERDUE:       "Overdue",
  PROPOSAL_DUE:  "Proposal past due",
  LATE_RESPONSE: "No response in 14+ days",
};

/** Tailwind classes for the timing warning chip */
export const RENEWAL_TIMING_WARNING_COLORS: Record<RenewalTimingWarning, string> = {
  OVERDUE:       "bg-red-100 text-red-700",
  PROPOSAL_DUE:  "bg-amber-100 text-amber-700",
  LATE_RESPONSE: "bg-orange-50 text-orange-700",
};

/**
 * Derive the timing warning from date fields only.
 * Returns null when the renewal is complete or there is no timing issue.
 *
 * Takes the renewal record and the client separately: timing data lives on the
 * renewal (pipeline step, proposal sent date) while the schedule that defines
 * "late" lives on the client (anniversary date, lead months).
 *
 * This is independent of the pipeline step — a client at SENT can still have
 * a LATE_RESPONSE warning.
 */
export function getRenewalTimingWarning(
  renewal: any,
  client: any,
  today: Date = new Date(),
): RenewalTimingWarning | null {
  if (!client?.anniversaryDate) return null;
  // No open renewal for this cycle — nothing to warn about
  if (!renewal) return null;
  // Completed — no warning needed
  if (renewal.completedAt || renewal.suppressed) return null;

  // Measured against the renewal's own plan year. Using the upcoming
  // anniversary would make OVERDUE unreachable, since that date is always
  // in the future by construction.
  const anniversary = getAnniversaryForPlanYear(client.anniversaryDate, renewal.planYear);
  if (!anniversary) return null;
  if (today > anniversary) return "OVERDUE";

  const leadMonths = (client.renewalLeadMonths ?? 3) as number;
  const proposalDue = new Date(anniversary);
  proposalDue.setMonth(proposalDue.getMonth() - leadMonths);

  // Proposal due date passed but we haven't sent anything yet
  const earlySteps: Array<RenewalPipelineStep | null> = [null, "REQUESTED", "PROCESSED"];
  const step = (renewal.pipelineStep ?? null) as RenewalPipelineStep | null;
  if (today >= proposalDue && earlySteps.includes(step)) return "PROPOSAL_DUE";

  // Proposal was sent but client hasn't responded in 14+ days
  if (renewal.proposalSentDate) {
    const sent = new Date(renewal.proposalSentDate);
    const days = (today.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24);
    const preAcceptance: Array<RenewalPipelineStep | null> = [null, "REQUESTED", "PROCESSED", "SENT", "REVISED"];
    if (days > 14 && preAcceptance.includes(step)) return "LATE_RESPONSE";
  }

  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The anniversary date stores an original effective date, so its year is
 * historical. This projects it onto the next occurrence from today — the cycle
 * the current renewal work actually applies to.
 */
export function getUpcomingAnniversary(
  anniversaryDate: string | Date | null | undefined,
  today: Date = new Date(),
): Date | null {
  if (!anniversaryDate) return null;
  const upcoming = new Date(anniversaryDate);
  upcoming.setFullYear(today.getFullYear());
  if (upcoming < today) upcoming.setFullYear(today.getFullYear() + 1);
  return upcoming;
}

/**
 * The anniversary a specific renewal cycle is measured against — the stored
 * month and day, projected onto that renewal's plan year.
 */
export function getAnniversaryForPlanYear(
  anniversaryDate: string | Date | null | undefined,
  planYear: number | null | undefined,
): Date | null {
  if (!anniversaryDate || !planYear) return null;
  const d = new Date(anniversaryDate);
  d.setFullYear(planYear);
  return d;
}

/**
 * Return the proposal due date (anniversary minus lead months), or null.
 * Pass the renewal's planYear to measure against that cycle; without it the
 * upcoming anniversary is used, which is the right basis for a client that has
 * no open renewal yet.
 */
export function getProposalDueDate(
  client: any,
  planYear?: number | null,
  today: Date = new Date(),
): Date | null {
  const anniversary = planYear
    ? getAnniversaryForPlanYear(client?.anniversaryDate, planYear)
    : getUpcomingAnniversary(client?.anniversaryDate, today);
  if (!anniversary) return null;
  const leadMonths = (client.renewalLeadMonths ?? 3) as number;
  const due = new Date(anniversary);
  due.setMonth(due.getMonth() - leadMonths);
  return due;
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
 *   Anniversary July 1  → periods end June  (Jun 2026, Jun 2025, Jun 2024, Jun 2023)
 *   Anniversary Jan  1  → periods end Dec   (Dec 2025, Dec 2024, Dec 2023, Dec 2022)
 *   Anniversary Sep  1  → periods end Aug   (Aug 2025, Aug 2024, …) [if today < Sep 2026]
 */
export function getPprSlots(
  anniversaryDate: string | null | undefined,
  today: Date = new Date(),
): PprSlot[] {
  if (!anniversaryDate) return [];

  const ann = new Date(anniversaryDate);
  const annMonth = ann.getMonth() + 1; // 1–12

  let endMonth = annMonth - 1;
  if (endMonth === 0) endMonth = 12;

  const thisYearAnn = new Date(today.getFullYear(), ann.getMonth(), ann.getDate());
  const mostRecentAnnYear = today >= thisYearAnn ? today.getFullYear() : today.getFullYear() - 1;

  let currentSlotYear = mostRecentAnnYear;
  if (endMonth > annMonth) currentSlotYear = mostRecentAnnYear - 1;

  return [0, 1, 2, 3].map(i => {
    const slotYear = currentSlotYear - i;
    const label = i === 0
      ? `Current year — ending ${MONTH_NAMES[endMonth - 1]} ${slotYear}`
      : `${i} year${i > 1 ? "s" : ""} prior — ending ${MONTH_NAMES[endMonth - 1]} ${slotYear}`;
    return { label, reportMonth: endMonth, reportYear: slotYear };
  });
}
