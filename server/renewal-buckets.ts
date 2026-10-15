import { renewalIsComplete, type RenewalSteps, type Handout } from "../shared/renewal-progress";
/**
 * The send deadline, and the boundary between Upcoming and Current. Exclusive on
 * both sides: an unstarted renewal at exactly this many days out is already in
 * Current, but is not yet LATE, because this is the deadline rather than past it.
 */
export const RENEWAL_SEND_DEADLINE_DAYS_BEFORE_ANNIVERSARY = 14;
export const UPCOMING_RENEWAL_HORIZON_DAYS = 30;
export const COMPLETE_RENEWAL_VISIBLE_DAYS_AFTER_ANNIVERSARY = 45;

const FINAL_STEP = "EMAILED_TO_90D";
const SENT_STEP_INDEX = 2;
const PIPELINE_STEPS = [
  "REQUESTED",
  "PROCESSED",
  "SENT",
  "REVISED",
  "ACCEPTED",
  "SIGNED_FORM_ATTACHED",
  FINAL_STEP,
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RenewalBucketSource {
  client: {
    id: number;
    clientCode: string;
    clientName: string;
    anniversaryDate: Date | string | null;
  };
  renewal: {
    id: number;
    planYear: number;
    pipelineStep: string | null;
    completedAt: Date | string | null;
    updatedAt: Date | string;
    steps?: RenewalSteps;
    handouts?: Handout[];
    suppressed?: boolean;
  };
}

export interface RenewalBucketItem {
  renewalId: number;
  clientId: number;
  clientCode: string;
  clientName: string;
  planYear: number;
  anniversaryDate: string;
  pipelineStep: string | null;
  completedAt: string | null;
  daysOut: number;
  late: boolean;
}

export interface RenewalBuckets {
  upcoming: RenewalBucketItem[];
  current: RenewalBucketItem[];
  complete: RenewalBucketItem[];
  lateCount: number;
}

function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Projects the client's anniversary onto the renewal's plan year, matching the
 * projection used by ensureOpenRenewal and renewal alerts.
 */
export function getAnniversaryForPlanYear(anniversaryDate: Date | string, planYear: number): Date {
  const anniversary = new Date(anniversaryDate);
  anniversary.setFullYear(planYear);
  return anniversary;
}

export function computeRenewalBuckets(
  sources: readonly RenewalBucketSource[],
  today: Date = new Date(),
): RenewalBuckets {
  const upcoming: RenewalBucketItem[] = [];
  const current: RenewalBucketItem[] = [];
  const complete: RenewalBucketItem[] = [];
  const assignedClientIds = new Set<number>();

  const add = (bucket: RenewalBucketItem[], item: RenewalBucketItem) => {
    if (assignedClientIds.has(item.renewalId)) {
      throw new Error(`Renewal ${item.renewalId} was assigned to more than one renewal bucket`);
    }
    assignedClientIds.add(item.renewalId);
    bucket.push(item);
  };

  for (const { client, renewal } of sources) {
    if (renewal.suppressed) continue;

    const anniversary = getAnniversaryForPlanYear(client.anniversaryDate ?? `${renewal.planYear}-01-01`, renewal.planYear);
    const daysOut = Math.round((calendarDay(anniversary) - calendarDay(today)) / DAY_MS);
    const step = renewal.pipelineStep || null;
    const completeStep = renewalIsComplete(renewal);
    const stepIndex = step ? PIPELINE_STEPS.indexOf(step as typeof PIPELINE_STEPS[number]) : -1;
    const lateCandidate = !completeStep
      && stepIndex < SENT_STEP_INDEX
      && daysOut < RENEWAL_SEND_DEADLINE_DAYS_BEFORE_ANNIVERSARY;

    const item: RenewalBucketItem = {
      renewalId: renewal.id,
      clientId: client.id,
      clientCode: client.clientCode,
      clientName: client.clientName,
      planYear: renewal.planYear,
      anniversaryDate: anniversary.toISOString(),
      pipelineStep: step,
      completedAt: renewal.completedAt ? new Date(renewal.completedAt).toISOString() : null,
      daysOut,
      late: false,
    };

    if (completeStep) {
      add(complete, item);
    } else if (step !== null || daysOut <= RENEWAL_SEND_DEADLINE_DAYS_BEFORE_ANNIVERSARY) {
      // Current is everything actionable: work already started at any distance,
      // plus anything unstarted that has reached the send deadline, plus
      // anything overdue (which is unstarted-and-past-deadline by definition).
      item.late = lateCandidate;
      add(current, item);
    } else {
      // Pure heads-up queue: unstarted and still comfortably ahead of the
      // deadline, so nothing in here is ever badged.
      add(upcoming, item);
    }
  }

  const anniversaryAscending = (a: RenewalBucketItem, b: RenewalBucketItem) =>
    new Date(a.anniversaryDate).getTime() - new Date(b.anniversaryDate).getTime();
  upcoming.sort(anniversaryAscending);
  current.sort(anniversaryAscending);
  complete.sort((a, b) =>
    new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());

  return {
    upcoming,
    current,
    complete,
    lateCount: current.filter(item => item.late).length,
  };
}