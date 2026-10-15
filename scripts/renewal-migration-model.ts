import { renewalSteps, renewalSummary, renewalIsComplete, type RenewalSteps } from "../shared/renewal-progress";

// Pure projection shared by dev apply and read-only production review.
// No fictitious actor/date is assigned to historical actions.
export function projectRenewal(r: any, client: any, plans: any[], progress: any[]) {
  if (Object.keys(r.steps ?? {}).length || r.handouts?.length) return r; // one-time, never overwrite staff's subsequent work
  const code = client.client_code.replace(/^S-0*/, "S-");
  const steps: RenewalSteps = {};
  const relevant = plans.filter(p => p.client_id === r.client_id &&
    !p.is_archived && !p.termination_date && (p.plan_year === r.plan_year || p.plan_year === r.plan_year - 1));
  // Legacy progress tracks renewal of that plan into its following plan year.
  // Do not copy the same milestones into both the old and new client/year.
  const old = progress.filter(p => relevant.some(plan => plan.id === p.plan_id && plan.plan_year + 1 === r.plan_year));
  let furthest = renewalSteps.indexOf(r.pipeline_step);
  const dates: (string | null)[] = [null, null, r.proposal_sent_date, null, r.acceptance_received_date, null, r.completed_at];
  for (let i = 0; i < 7; i++) {
    const found = old.flatMap(p => i === 3 ? (p.step4_revisions ?? []) : [p[`step${i + 1}_date`]]).filter(Boolean);
    if (dates[i]) found.push(dates[i]);
    if (found.length) {
      furthest = Math.max(furthest, i);
      dates[i] = found.sort()[0].slice(0, 10);
    }
  }
  for (let i = 0; i <= furthest; i++) {
    if (i === 3 && !dates[i]) continue; // optional historically; never invent an N/A decision
    steps[renewalSteps[i]] = { status: "DONE", date: dates[i] ?? null, by: "Historical record — actor unknown", ...(!dates[i] ? {dateQualifier: "Date not recorded"} : {}) };
  }
  const confirmed = (key: typeof renewalSteps[number], date: string, qualifier?: string) => {
    steps[key] = { status: "DONE", date, by: "Steve-confirmed mail — performer unknown", ...(qualifier ? { dateQualifier: qualifier } : {}) };
  };
  // Confirmed mail overrides apply only to the specified 2026 cycle.
  if (r.plan_year === 2026) {
    if (code === "S-459") {
      confirmed("ACCEPTED", "2026-09-01"); confirmed("SIGNED_FORM_ATTACHED", "2026-09-01"); confirmed("EMAILED_TO_90D", "2026-09-02");
    }
    if (code === "S-174") {
      for (const k of renewalSteps.filter(k => k !== "REVISED")) steps[k] ??= { status: "DONE", date: null, by: "Steve-confirmed mail — performer unknown", dateQualifier: "Earlier step done; exact date unknown" };
      confirmed("EMAILED_TO_90D", "2026-08-26");
    }
    if (code === "S-200") {
      confirmed("SENT", "2026-09-16", "On or before");
      for (const k of ["ACCEPTED", "SIGNED_FORM_ATTACHED"] as const) steps[k] = { status: "NA", date: null, by: "Steve-confirmed mail", reason: "Client proceeded without signing" };
      confirmed("EMAILED_TO_90D", "2026-09-23");
    }
    if (code === "S-480") {
      if (!steps.EMAILED_TO_90D?.date || steps.EMAILED_TO_90D.date > "2026-09-30") confirmed("EMAILED_TO_90D", "2026-09-30", "On or before");
    }
    if (code === "S-465") { confirmed("ACCEPTED", "2026-10-07"); confirmed("EMAILED_TO_90D", "2026-10-14"); }
  }
  // One expected handout per coverage/name, taking the newest applicable plan.
  const unique = new Map<string, any>();
  for (const p of relevant.sort((a,b) => b.plan_year - a.plan_year)) {
    const key = JSON.stringify([p.coverage_type, p.plan_name]);
    if (!unique.has(key)) unique.set(key, p);
  }
  const handouts = [...unique.values()].map(p => ({planId: p.id, planName: `${p.coverage_type ?? ""} ${p.plan_name}`.trim(), documentId: null, date: null}));
  const result = { ...r, steps, handouts, suppressed: code === "S-216" || !!client.termination_date, pipeline_step: renewalSummary(steps), completed_at: null };
  return { ...result, completed_at: renewalIsComplete(result) ? r.completed_at : null };
}
