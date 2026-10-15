export const renewalSteps = ["REQUESTED", "PROCESSED", "SENT", "REVISED", "ACCEPTED", "SIGNED_FORM_ATTACHED", "EMAILED_TO_90D"] as const;
export type StepKey = typeof renewalSteps[number];
export type StepRecord = {
  status: "DONE" | "NA" | "REQUESTED";
  date: string | null;
  by: string;
  reason?: string;
  dateQualifier?: string;
};
export type RenewalSteps = Partial<Record<StepKey, StepRecord>>;
export type Handout = { planId: number; planName: string; documentId: number | null; date: string | null; by?: string };
export function furthestResolvedStep(steps: RenewalSteps = {}): number {
  return renewalSteps.reduce((last, key, i) =>
    steps[key]?.status === "DONE" || (steps[key]?.status === "NA" && !!steps[key]?.reason?.trim()) ? i : last, -1);
}
export function nextRenewalStep(steps: RenewalSteps = {}): StepKey | undefined {
  return renewalSteps.find((key, i) => i > furthestResolvedStep(steps)
    && (key !== "REVISED" || steps.REVISED?.status === "REQUESTED"));
}
export function handoutsNotTracked(r: { planYear: number; anniversaryDate?: string | Date | null; steps?: RenewalSteps }, today: string): boolean {
  if (!r.anniversaryDate || r.steps?.EMAILED_TO_90D?.status !== "DONE") return false;
  const anniversary = new Date(r.anniversaryDate);
  anniversary.setUTCFullYear(r.planYear);
  const day = anniversary.toISOString().slice(0,10);
  return (Date.parse(today) - Date.parse(day)) / 86400000 > 30;
}
export function renewalIsComplete(r: { steps?: RenewalSteps | null; handouts?: Handout[] | null }): boolean {
  return renewalSteps.every(k => r.steps?.[k]?.status === "DONE" || (r.steps?.[k]?.status === "NA" && !!r.steps[k]?.reason?.trim()))
    && !!r.handouts?.length && r.handouts.every(h => !!h.documentId && !!h.date);
}
export function renewalSummary(steps: RenewalSteps): StepKey | null {
  return [...renewalSteps].reverse().find(k => steps[k]) ?? null;
}
