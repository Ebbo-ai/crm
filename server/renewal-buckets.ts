export const RENEWAL_SEND_DEADLINE_DAYS_BEFORE_ANNIVERSARY = 14;
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
    if (assignedClientIds.has(item.clientId)) {
      throw new Error(`Client ${item.clientId} was assigned to more than one renewal bucket`);
    }
    assignedClientIds.add(item.clientId);
    bucket.push(item);
  };

  for (const { client, renewal } of sources) {
    if (!client.anniversaryDate) continue;

    const anniversary = getAnniversaryForPlanYear(client.anniversaryDate, renewal.planYear);
    const daysOut = Math.round((calendarDay(anniversary) - calendarDay(today)) / DAY_MS);
    const step = renewal.pipelineStep || null;
    const completeStep = step === FINAL_STEP;
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
      if (daysOut >= -COMPLETE_RENEWAL_VISIBLE_DAYS_AFTER_ANNIVERSARY) {
        add(complete, item);
      }
    } else if (step !== null || daysOut < 0) {
      item.late = lateCandidate;
      add(current, item);
    } else if (daysOut <= 30) {
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