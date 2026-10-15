export const renewalSteps = ["REQUESTED", "PROCESSED", "SENT", "REVISED", "ACCEPTED", "SIGNED_FORM_ATTACHED", "EMAILED_TO_90D"] as const;
export type StepKey = typeof renewalSteps[number];
export type StepRecord = {
  status: "DONE" | "NA";
  date: string | null;
  by: string;
  reason?: string;
  dateQualifier?: string;
};
export type RenewalSteps = Partial<Record<StepKey, StepRecord>>;
export type Handout = { planId: number; planName: string; documentId: number | null; date: string | null; by?: string };
export function renewalIsComplete(r: { steps?: RenewalSteps | null; handouts?: Handout[] | null }): boolean {
  return renewalSteps.every(k => r.steps?.[k]?.status === "DONE" || (r.steps?.[k]?.status === "NA" && !!r.steps[k]?.reason?.trim()))
    && !!r.handouts?.length && r.handouts.every(h => !!h.documentId && !!h.date);
}
export function renewalSummary(steps: RenewalSteps): StepKey | null {
  return [...renewalSteps].reverse().find(k => steps[k]) ?? null;
}
