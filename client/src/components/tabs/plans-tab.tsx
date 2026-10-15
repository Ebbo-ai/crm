import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { PLAN_BASIS_LABELS, PLAN_COVERAGE_TYPE_LABELS, PLAN_COVERAGE_TYPE_OPTIONS, STANDARD_TIER_DESCRIPTIONS, STANDARD_TIER_LABELS, TIER_LABELS, formatCurrency, parseLocalDate } from "@/lib/constants";
import {
  Plus, ChevronDown, ChevronUp, Edit, RefreshCw, FileText, CalendarDays,
  CheckCircle2, Clock, Upload, Download, Trash2, Users, AlertTriangle
} from "lucide-react";
import { format, addMonths, subMonths } from "date-fns";

// ---------- helpers ----------
function getNextRenewalDate(effectiveDate: Date): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = effectiveDate.getMonth();
  let candidate = new Date(today.getFullYear(), month, 1);
  if (candidate <= today) candidate = new Date(today.getFullYear() + 1, month, 1);
  return candidate;
}

function getRenewalDueDate(effectiveDate: Date, monthsBefore: number): Date {
  return subMonths(getNextRenewalDate(effectiveDate), monthsBefore);
}

const RECIPIENT_LABELS: Record<string, string> = {
  CLIENT: "Client",
  BROKER: "Broker",
  BOTH: "Broker & Client",
};

// Sort plan documents: extract version number, sort descending (v2 > v1 > no version)
function sortDocsByVersion(docs: any[]) {
  return [...docs].sort((a, b) => {
    const va = parseInt((a.version || "v0").replace(/[^0-9]/g, "")) || 0;
    const vb = parseInt((b.version || "v0").replace(/[^0-9]/g, "")) || 0;
    return vb - va;
  });
}

// ---------- main tab ----------
export default function PlansTab({ clientId, client }: { clientId: number; client: any }) {
  const { toast } = useToast();
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [showRateForm, setShowRateForm] = useState<number | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: plans = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", String(clientId), "plans"],
  });

  // isArchived (superseded by a later plan year) and terminationDate (mid-lifecycle
  // cancellation) are different concepts. A terminated plan is never hidden here —
  // it stays in the current list, clearly marked with its date, just sorted below
  // the still-active ones.
  const currentPlans = plans
    .filter((p: any) => !p.isArchived)
    .sort((a: any, b: any) => (a.terminationDate ? 1 : 0) - (b.terminationDate ? 1 : 0));
  const archivedPlans = plans.filter((p: any) => p.isArchived);

  const renewMutation = useMutation({
    mutationFn: async (planId: number) => {
      const res = await apiRequest("POST", `/api/plans/${planId}/renew`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "plans"] });
      toast({ title: "Plan renewed successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div data-testid="plans-tab">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-brand">Current Plans</h2>
        <Button
          onClick={() => { setEditingPlan(null); setShowPlanForm(true); }}
          disabled={currentPlans.length >= 6}
          className="bg-brand text-brand-foreground gap-2"
          title={currentPlans.length >= 6 ? "Maximum of 6 active plans reached" : ""}
          data-testid="button-add-plan"
        >
          <Plus className="w-4 h-4" /> Add New Plan
        </Button>
      </div>

      {(!client.brokerStatus || client.brokerStatus === "NOT_SET") && <p className="border border-destructive rounded p-3 mb-4 text-destructive">Broker status is not set. Choose Direct or Broker before configuring fees or sending a renewal.</p>}
      {!currentPlans.length && !isLoading && (
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No plans configured for this client yet</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3 mb-6">
        {currentPlans.map((plan: any) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            expanded={expandedPlan === plan.id}
            onToggle={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
            onEdit={() => { setEditingPlan(plan); setShowPlanForm(true); }}
            onEditRates={() => setShowRateForm(plan.id)}
            onRenew={() => renewMutation.mutate(plan.id)}
            client={client}
          />
        ))}
      </div>

      {archivedPlans.length > 0 && (
        <Collapsible open={showArchived} onOpenChange={setShowArchived}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3 hover:text-foreground transition-colors" data-testid="button-toggle-archived">
              {showArchived ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Archived Plans ({archivedPlans.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 opacity-75">
              {archivedPlans.map((plan: any) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  expanded={expandedPlan === plan.id}
                  onToggle={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                  onRenew={() => renewMutation.mutate(plan.id)}
                  client={client}
                  archived
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <PlanFormDialog
        key={editingPlan?.id ?? "new"}
        open={showPlanForm}
        onClose={() => setShowPlanForm(false)}
        clientId={clientId}
        plan={editingPlan}
      />

      {showRateForm !== null && (
        <RateFormDialog
          open={true}
          onClose={() => setShowRateForm(null)}
          planId={showRateForm}
          clientId={clientId}
          client={client}
          plan={plans.find((p: any) => p.id === showRateForm)}
          existingRates={plans.find((p: any) => p.id === showRateForm)?.rateCards || []}
        />
      )}
    </div>
  );
}

// ---------- renewal pipeline ----------
const RENEWAL_STEP_DEFS = [
  { key: "step1Date", label: "Renewal Requested",           desc: "Request submitted to 90 Degree Benefits" },
  { key: "step2Date", label: "Renewal Processed",           desc: "90 Degree has processed the renewal" },
  { key: "step3Date", label: "Renewal Sent",                desc: "Renewal proposal sent to recipient" },
  // step4 (optional, multiple revisions) is rendered inline after step3
  { key: "step5Date", label: "Renewal Accepted",            desc: "Client or broker has accepted the terms" },
  { key: "step6Date", label: "Signed Form Attached",        desc: "Upload the signed renewal form", hasUpload: true },
  { key: "step7Date", label: "Form Emailed to 90 Degree",  desc: "Final step — signed form sent to 90 Degree" },
] as const;

function RenewalPipeline({ planId, onStep7Change }: {
  planId: number;
  onStep7Change: (done: boolean) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const today = format(new Date(), "yyyy-MM-dd");
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  const [markDate, setMarkDate] = useState(today);
  const [addingRevision, setAddingRevision] = useState(false);
  const [revisionDate, setRevisionDate] = useState(today);

  const { data: prog = {} as any } = useQuery<any>({
    queryKey: ["/api/plans", String(planId), "renewal-progress"],
    queryFn: () =>
      fetch(`/api/plans/${planId}/renewal-progress`, { credentials: "include" }).then(r => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/plans/${planId}/renewal-progress`, data);
      return res.json();
    },
    onSuccess: (_: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans", String(planId), "renewal-progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stalled"] });
      if ("step7Date" in vars) onStep7Change(!!vars.step7Date);
      setMarkingKey(null);
      setAddingRevision(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const step6UploadMutation = useMutation({
    mutationFn: async (fd: FormData) => {
      const res = await fetch(`/api/plans/${planId}/renewal-progress/step6-upload`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans", String(planId), "renewal-progress"] });
      toast({ title: "Signed form uploaded" });
    },
    onError: (err: any) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const revisions: string[] = Array.isArray(prog?.step4Revisions) ? prog.step4Revisions : [];
  const currentIdx = RENEWAL_STEP_DEFS.findIndex(s => !prog?.[s.key]);
  const isComplete = !!prog?.step7Date;
  const markingStep = markingKey ? RENEWAL_STEP_DEFS.find(s => s.key === markingKey) ?? null : null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    step6UploadMutation.mutate(fd);
    e.target.value = "";
  }

  return (
    <div>
      {isComplete && (
        <div className="mb-3 px-3 py-2 bg-success/10 rounded text-xs text-success font-semibold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Renewal complete — all steps done.
        </div>
      )}

      <div>
        {RENEWAL_STEP_DEFS.map((step, idx) => {
          const isDone = !!prog?.[step.key];
          const isActive = idx === currentIdx;
          const isFuture = !isDone && !isActive;
          const stepDate = isDone ? new Date(prog[step.key]) : null;

          return (
            <div key={step.key}>
              <div className={`flex items-start gap-2.5 py-2 ${isFuture ? "opacity-40" : ""}`}>
                <div className="flex-shrink-0 mt-0.5">
                  {isDone
                    ? <CheckCircle2 className="w-4 h-4 text-success" />
                    : isActive
                      ? <div className="w-4 h-4 rounded-full border-2 border-brand-accent bg-card" />
                      : <div className="w-4 h-4 rounded-full border-2 border-border bg-card" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <div>
                      <span className={`text-xs font-medium ${isDone ? "text-success" : isActive ? "text-brand" : "text-muted-foreground"}`}>
                        {step.label}
                      </span>
                      {!isDone && <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isDone && (
                        <>
                          <span className="text-xs text-muted-foreground">{format(stepDate!, "MMM d, yyyy")}</span>
                          {"hasUpload" in step && step.hasUpload && (
                            <>
                              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.png,.jpg" onChange={handleFileChange} />
                              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs text-brand-accent" onClick={() => fileRef.current?.click()}>
                                {prog?.step6DocumentId ? "Re-upload" : "Upload"}
                              </Button>
                            </>
                          )}
                          {!isComplete && (
                            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs text-muted-foreground hover:text-danger"
                              onClick={() => updateMutation.mutate({ [step.key]: null, ...(step.key === "step3Date" && revisions.length > 0 ? { step4Revisions: [] } : {}) })}>
                              Undo
                            </Button>
                          )}
                        </>
                      )}
                      {isActive && (
                        <Button size="sm" className="h-6 px-2.5 text-xs bg-brand-accent text-brand-foreground hover:bg-brand"
                          onClick={() => { setMarkingKey(step.key); setMarkDate(today); }}>
                          Mark Done
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 4 revisions — shown after step3 (idx 2) */}
              {idx === 2 && (
                <div className={`ml-6 mb-1 ${!prog?.step3Date ? "opacity-30 pointer-events-none" : ""}`}>
                  <div className="border-l-2 border-dashed border-border pl-3 pb-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Revisions (optional)</p>
                      {prog?.step3Date && !isComplete && (
                        <Button size="sm" variant="ghost" className="h-4 px-1.5 text-xs text-brand-accent"
                          onClick={() => { setAddingRevision(true); setRevisionDate(today); }}>
                          + Add
                        </Button>
                      )}
                    </div>
                    {revisions.length === 0 && <p className="text-xs text-muted-foreground italic">None</p>}
                    {revisions.map((rev: string, i: number) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs py-0.5">
                        <RefreshCw className="w-3 h-3 text-warning-strong" />
                        <span className="text-foreground">Revised {format(new Date(rev), "MMM d, yyyy")}</span>
                        {!isComplete && (
                          <button className="text-xs text-danger hover:underline ml-0.5"
                            onClick={() => updateMutation.mutate({ step4Revisions: revisions.filter((_: any, j: number) => j !== i) })}>
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {addingRevision && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input type="date" value={revisionDate} onChange={e => setRevisionDate(e.target.value)}
                          className="text-xs border rounded px-1.5 py-0.5 h-6 bg-card" />
                        <Button size="sm" className="h-6 px-2 text-xs bg-brand-accent text-brand-foreground"
                          onClick={() => updateMutation.mutate({ step4Revisions: [...revisions, revisionDate || today] })}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                          onClick={() => setAddingRevision(false)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mark-step dialog */}
      {markingStep && (
        <Dialog open={true} onOpenChange={() => setMarkingKey(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Mark: {markingStep.label}</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Label className="text-xs">Date completed</Label>
              <Input type="date" value={markDate} onChange={e => setMarkDate(e.target.value)} className="mt-1 h-8 text-sm" />
              {"hasUpload" in markingStep && markingStep.hasUpload && (
                <p className="text-xs text-muted-foreground mt-2">
                  You can upload the signed form after marking this step done.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setMarkingKey(null)}>Cancel</Button>
              <Button size="sm" className="bg-brand-accent text-brand-foreground"
                onClick={() => updateMutation.mutate({ [markingStep.key]: markDate || today })}
                disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Mark Done"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------- plan card ----------
function PlanCard({ plan, expanded, onToggle, onEdit, onEditRates, onRenew, client, archived }: any) {
  const { toast } = useToast();
  const [showRenewalDocs, setShowRenewalDocs] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);

  const effectiveDate = parseLocalDate(plan.effectiveDate);
  const nextRenewal = getNextRenewalDate(effectiveDate);
  const monthsBefore = plan.renewalDueMonthsBefore ?? 3;
  const renewalDueDate = getRenewalDueDate(effectiveDate, monthsBefore);
  const isDueSoon = !plan.isRenewalComplete && renewalDueDate <= addMonths(new Date(), 2);

  const { data: planDocs = [] } = useQuery<any[]>({
    queryKey: ["/api/plans", String(plan.id), "documents"],
    enabled: showRenewalDocs || expanded,
  });

  const renewalMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", `/api/plans/${plan.id}/renewal`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(plan.clientId), "plans"] });
      toast({ title: "Renewal updated" });
      setShowCompleteDialog(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: number) => {
      await apiRequest("DELETE", `/api/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans", String(plan.id), "documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const sortedDocs = sortDocsByVersion(planDocs);

  return (
    <Card className={`border-0 shadow-sm ${archived ? "bg-surface-subtle" : ""}`} data-testid={`plan-card-${plan.id}`}>
      {/* header row */}
      <div className="px-5 py-4 cursor-pointer flex items-center justify-between gap-4" onClick={onToggle}>
        <div className="flex items-center gap-3 min-w-0">
          <CalendarDays className="w-5 h-5 text-brand-accent flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{plan.planName}</p>
            <p className="text-xs text-muted-foreground">
              {format(effectiveDate, "MMM d, yyyy")} | {PLAN_BASIS_LABELS[plan.planBasis]}{plan.coverageType ? ` | ${PLAN_COVERAGE_TYPE_LABELS[plan.coverageType] ?? plan.coverageType}` : ""} | Renews {format(nextRenewal, "MMM d, yyyy")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!archived && (
            plan.isRenewalComplete
              ? <span className="text-xs px-2 py-1 rounded-full font-medium bg-success/10 text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Renewal Done</span>
              : isDueSoon
                ? <span className="text-xs px-2 py-1 rounded-full font-medium bg-gold/10 text-warning-strong flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Due Soon</span>
                : null
          )}
          {plan.terminationDate ? (
            <span className="text-xs px-2 py-1 rounded-full font-medium bg-danger/10 text-danger">
              Terminated {format(parseLocalDate(plan.terminationDate), "MMM d, yyyy")}
            </span>
          ) : (
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${archived ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>
              {archived ? "Archived" : "Current"}
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="px-5 pb-5 pt-0 border-t">
          {/* plan details grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
            <div><p className="text-xs text-muted-foreground">Plan Basis</p><p className="text-sm font-medium">{PLAN_BASIS_LABELS[plan.planBasis]}</p></div>
            <div><p className="text-xs text-muted-foreground">Annual Limit</p><p className="text-sm font-medium">{formatCurrency(plan.annualLimit)}</p></div>
            {plan.deductible && <div><p className="text-xs text-muted-foreground">Deductible</p><p className="text-sm font-medium">{formatCurrency(plan.deductible)}</p></div>}
            {plan.planBasis === "PROCEDURE_BASED" && (
              <>
                <div><p className="text-xs text-muted-foreground">Preventive</p><p className="text-sm font-medium">{plan.preventivePercent}%</p></div>
                <div><p className="text-xs text-muted-foreground">Corrective</p><p className="text-sm font-medium">{plan.correctivePercent}%</p></div>
                <div><p className="text-xs text-muted-foreground">Restorative</p><p className="text-sm font-medium">{plan.restorativePercent}%</p></div>
              </>
            )}
            {plan.planBasis === "DOLLAR_BASED" && plan.dollarTier1Percent != null && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-xs text-muted-foreground mb-1">Coverage Tiers</p>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{plan.dollarTier1Percent}% of the first {formatCurrency(plan.dollarTier1Limit)}</p>
                  {plan.dollarTier2Percent != null && plan.dollarTier2Limit && (
                    <p className="text-sm font-medium">{plan.dollarTier2Percent}% of the next {formatCurrency(plan.dollarTier2Limit)}</p>
                  )}
                  {plan.dollarTier3Percent != null && (
                    <p className="text-sm font-medium">{plan.dollarTier3Percent}% of the balance</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* orthodontia details */}
          <div className="pt-2 pb-2">
            <p className="text-xs font-semibold text-brand mb-2">Orthodontia</p>
            {(!plan.orthoEligibility || plan.orthoEligibility === "NONE") ? (
              <p className="text-sm text-muted-foreground">Not covered</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Eligible</p>
                  <p className="text-sm font-medium">
                    {plan.orthoEligibility === "CHILDREN" ? "Children only" : "All enrollees"}
                  </p>
                </div>
                {plan.orthoCoinsurancePercent != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Coinsurance</p>
                    <p className="text-sm font-medium">{plan.orthoCoinsurancePercent}%</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Maximum</p>
                  <p className="text-sm font-medium">
                    {plan.orthoMaxType === "SEPARATE_LIFETIME"
                      ? `Separate lifetime${plan.orthoLifetimeMax ? ` — ${formatCurrency(plan.orthoLifetimeMax)}` : ""}`
                      : "Shares annual max"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* assignment of benefits */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${plan.assignmentOfBenefits !== false ? "bg-success-tint text-success-strong" : "bg-surface-subtle text-muted-foreground"}`}>
                {plan.assignmentOfBenefits !== false ? "✓ Assignment of Benefits" : "✗ No Assignment of Benefits"}
              </span>
            </div>
          </div>
          {plan.planNotes && (
            <div className="mt-1 mb-3 p-3 bg-warning-tint border border-warning/40 rounded-md">
              <p className="text-xs font-semibold text-warning-strong uppercase tracking-wider mb-1">Plan Design Notes</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{plan.planNotes}</p>
            </div>
          )}

          {/* rate card table */}
          {plan.rateCards?.length > 0 && (() => {
            const sortedCards: any[] = [...plan.rateCards].sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
            const hasBroker = plan.brokerMode && plan.brokerMode !== "NONE";
            const isFixedMonthly = plan.feeBasis === "FIXED_MONTHLY";
            const flatFee = parseFloat(plan.flatMonthlyFee ?? "0") || 0;
            const flatBroker = isFixedMonthly && plan.brokerMode === "FIXED_MONTHLY"
              ? (parseFloat(plan.brokerValue ?? "0") || 0) : 0;

            const pepmRows = [
              { key: "baseAdminFee", label: "Base Admin Fee" },
              { key: "cobraFee", label: "COBRA Fee" },
              { key: "simpleFee", label: "Simple Fee" },
              ...(client?.networkActive ? [{ key: "networkFee", label: "Network Fee" }] : []),
              ...(hasBroker && !isFixedMonthly ? [{ key: "brokerFee", label: "Broker Fee" }] : []),
              { key: "totalAdminFee", label: "Total Admin Fee", subtotal: true },
              { key: "expectedClaims", label: "Expected Claims" },
              { key: "monthlyPremium", label: "Monthly Premium", highlight: true },
            ];

            return (
              <div className="mt-2 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-brand">Rate Card</h4>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {isFixedMonthly && (
                      <span className="bg-warning-tint text-warning-strong border border-warning/40 rounded px-1.5 py-0.5">
                        {(() => {
                          const db90n    = parseFloat(plan.flat90DBFee    ?? "0") || 0;
                          const simplen  = parseFloat(plan.flatSimpleFee  ?? "0") || 0;
                          const networkn = parseFloat(plan.flatNetworkFee ?? "0") || 0;
                          const hasComp  = db90n > 0 || simplen > 0 || networkn > 0;
                          if (hasComp) {
                            const parts = [];
                            if (db90n)    parts.push(`90DB $${db90n.toFixed(2)}`);
                            if (simplen)  parts.push(`Simple $${simplen.toFixed(2)}`);
                            if (networkn) parts.push(`Network $${networkn.toFixed(2)}`);
                            return <>Fixed Monthly — {parts.join(" + ")}{flatBroker > 0 ? ` + $${flatBroker.toFixed(2)} broker` : ""} = ${(flatFee + flatBroker).toFixed(2)}/mo</>;
                          }
                          return <>Fixed Monthly — ${flatFee.toFixed(2)}/mo{flatBroker > 0 ? ` + $${flatBroker.toFixed(2)} broker` : ""}</>;
                        })()}
                      </span>
                    )}
                    {!isFixedMonthly && hasBroker && (
                      <span>
                        Broker: {plan.brokerMode === "PERCENT_OF_PREMIUM"
                          ? `${(parseFloat(plan.brokerValue || "0") * 100).toFixed(0)}% of premium`
                          : plan.brokerMode === "FLAT_PEPM"
                            ? `$${parseFloat(plan.brokerValue || "0").toFixed(2)}/ee/mo`
                            : `$${parseFloat(plan.brokerValue || "0").toFixed(2)}/mo fixed`}
                      </span>
                    )}
                  </div>
                </div>

                {isFixedMonthly ? (
                  /* Fixed Monthly: tier table shows enrollment tiers + expected claims only.
                     The flat admin fee is displayed as a plan-level annotation, not per tier. */
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid={`rate-table-${plan.id}`}>
                      <thead>
                        <tr className="bg-brand text-brand-foreground">
                          <th className="px-3 py-2 text-left text-xs font-medium">Tier</th>
                          {sortedCards.map((rc: any) => (
                            <th key={rc.id} className="px-3 py-2 text-right text-xs font-medium">
                              {rc.tierLabel ?? TIER_LABELS[rc.tier] ?? rc.tier ?? `Tier ${rc.planTierId}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-card">
                          <td className="px-3 py-2 text-xs">Expected Claims (PEPM)</td>
                          {sortedCards.map((rc: any) => (
                            <td key={rc.id} className="px-3 py-2 text-right text-xs">{formatCurrency(rc.expectedClaims ?? 0)}</td>
                          ))}
                        </tr>
                        <tr className="bg-warning-tint">
                          <td colSpan={sortedCards.length + 1} className="px-3 py-1.5 text-xs text-warning-strong">
                            Administration fee: <strong>${flatFee.toFixed(2)}/month</strong> for the group
                            {flatBroker > 0 && <> · Broker: <strong>${flatBroker.toFixed(2)}/month</strong> for the group</>}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* PEPM: full per-tier breakdown */
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid={`rate-table-${plan.id}`}>
                      <thead>
                        <tr className="bg-brand text-brand-foreground">
                          <th className="px-3 py-2 text-left text-xs font-medium">Fee Type</th>
                          {sortedCards.map((rc: any) => (
                            <th key={rc.id} className="px-3 py-2 text-right text-xs font-medium">
                              {rc.tierLabel ?? TIER_LABELS[rc.tier] ?? rc.tier ?? `Tier ${rc.planTierId}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pepmRows.map((row, i) => (
                          <tr key={row.key} className={`${i % 2 === 0 ? "bg-card" : "bg-surface-subtle"} ${(row as any).highlight ? "font-bold" : ""}`}>
                            <td className={`px-3 py-2 text-xs ${(row as any).highlight ? "border-l-4 border-warning-strong" : ""} ${(row as any).subtotal ? "font-semibold text-brand" : ""}`}>
                              {row.label}
                            </td>
                            {sortedCards.map((rc: any) => (
                              <td key={rc.id} className={`px-3 py-2 text-right text-xs ${(row as any).highlight ? "font-bold text-brand" : ""} ${(row as any).subtotal ? "font-semibold text-brand" : ""}`}>
                                {formatCurrency((rc as any)[row.key] ?? 0)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* renewal tracking section — 7-step pipeline */}
          {!archived && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-brand flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Renewal Tracking
                </h4>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Next renewal: <span className="font-medium text-foreground">{format(nextRenewal, "MMM d, yyyy")}</span></span>
                  <span>Proposal due: <span className={`font-medium ${isDueSoon && !plan.isRenewalComplete ? "text-warning-strong" : "text-foreground"}`}>{format(renewalDueDate, "MMM d, yyyy")}</span></span>
                </div>
              </div>

              <RenewalPipeline
                planId={plan.id}
                onStep7Change={(done) =>
                  renewalMutation.mutate({
                    isRenewalComplete: done,
                    renewalCompletedDate: done ? new Date().toISOString().split("T")[0] : null,
                    renewalCompletedBy: done ? undefined : null,
                  })
                }
              />

              {/* renewal proposal documents */}
              <div className="mt-3 pt-3 border-t">
                <button
                  className="flex items-center gap-1 text-xs font-medium text-brand-accent hover:text-brand mb-2"
                  onClick={() => setShowRenewalDocs(!showRenewalDocs)}
                  data-testid={`button-toggle-renewal-docs-${plan.id}`}
                >
                  <FileText className="w-3 h-3" />
                  Renewal Proposals ({sortedDocs.length})
                  {showRenewalDocs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showRenewalDocs && (
                  <div className="space-y-1 mb-2">
                    {sortedDocs.length === 0 && (
                      <p className="text-xs text-muted-foreground italic pl-2">No renewal proposals uploaded yet</p>
                    )}
                    {sortedDocs.map((doc: any) => (
                      <div key={doc.id} className="flex items-center justify-between bg-surface-subtle rounded px-3 py-2" data-testid={`renewal-doc-${doc.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3 h-3 text-brand-accent flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{doc.documentName}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.version && <span className="font-semibold text-brand mr-1">{doc.version}</span>}
                              {format(new Date(doc.uploadedAt), "MMM d, yyyy")} · {doc.uploadedBy}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" data-testid={`button-download-doc-${doc.id}`}>
                              <Download className="w-3 h-3" />
                            </Button>
                          </a>
                          <Button
                            size="sm" variant="ghost"
                            className="h-6 w-6 p-0 text-danger hover:text-danger"
                            onClick={() => deleteDocMutation.mutate(doc.id)}
                            data-testid={`button-delete-doc-${doc.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  size="sm" variant="outline"
                  className="gap-1 text-brand-accent border-brand-accent"
                  onClick={() => setShowUploadDialog(true)}
                  data-testid={`button-upload-renewal-${plan.id}`}
                >
                  <Upload className="w-3 h-3" /> Upload Proposal
                </Button>
              </div>
            </div>
          )}

          {/* bottom action row */}
          <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
            {!archived && onEdit && (
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onEdit(); }} className="gap-1 text-brand-accent border-brand-accent" data-testid={`button-edit-plan-${plan.id}`}>
                <Edit className="w-3 h-3" /> Edit Plan
              </Button>
            )}
            {!archived && onEditRates && (
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onEditRates(); }} className="gap-1" data-testid={`button-edit-rates-${plan.id}`}>
                <Edit className="w-3 h-3" /> Edit Rates
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onRenew(); }} className="gap-1 text-warning-strong border-warning-strong" data-testid={`button-renew-plan-${plan.id}`}>
              <RefreshCw className="w-3 h-3" /> Renew Plan
            </Button>
          </div>
        </CardContent>
      )}

      {/* Upload proposal dialog */}
      {showUploadDialog && (
        <RenewalDocUploadDialog
          plan={plan}
          onClose={() => setShowUploadDialog(false)}
          onUploaded={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/plans", String(plan.id), "documents"] });
            setShowRenewalDocs(true);
          }}
        />
      )}

      {/* Mark complete dialog */}
      {showCompleteDialog && (
        <MarkCompleteDialog
          plan={plan}
          onClose={() => setShowCompleteDialog(false)}
          onConfirm={(completedDate: string) => {
            renewalMutation.mutate({
              isRenewalComplete: true,
              renewalCompletedDate: new Date(completedDate + "T00:00:00"),
              renewalCompletedBy: undefined,
            });
          }}
          isPending={renewalMutation.isPending}
        />
      )}
    </Card>
  );
}

// ---------- renewal doc upload dialog ----------
function RenewalDocUploadDialog({ plan, onClose, onUploaded }: any) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docName, setDocName] = useState("");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const versionOptions = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { toast({ title: "Please select a file", variant: "destructive" }); return; }
    if (!docName.trim()) { toast({ title: "Document name is required", variant: "destructive" }); return; }
    if (!version) { toast({ title: "Version is required (e.g. v1, v2)", variant: "destructive" }); return; }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentName", docName);
      formData.append("version", version);

      const res = await fetch(`/api/plans/${plan.id}/documents`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      toast({ title: "Renewal proposal uploaded" });
      onUploaded();
      onClose();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-brand">Upload Renewal Proposal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Document Name <span className="text-danger">*</span></Label>
            <Input
              value={docName}
              onChange={e => setDocName(e.target.value)}
              placeholder="e.g. Renewal Proposal 2027"
              data-testid="input-renewal-doc-name"
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Version <span className="text-danger">*</span></Label>
            <Select value={version} onValueChange={setVersion}>
              <SelectTrigger data-testid="select-renewal-version">
                <SelectValue placeholder="Select version..." />
              </SelectTrigger>
              <SelectContent>
                {versionOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Most recent version is displayed first</p>
          </div>
          <div>
            <Label className="text-sm font-medium">File <span className="text-danger">*</span></Label>
            <Input
              type="file"
              ref={fileRef}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={e => setFile(e.target.files?.[0] || null)}
              data-testid="input-renewal-file"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={uploading} className="bg-brand text-brand-foreground" data-testid="button-upload-renewal-submit">
              {uploading ? "Uploading..." : "Upload"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- mark complete dialog ----------
function MarkCompleteDialog({ plan, onClose, onConfirm, isPending }: any) {
  const [completedDate, setCompletedDate] = useState(format(new Date(), "yyyy-MM-dd"));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-brand">Mark Renewal Complete</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Confirm the date the renewal proposal was completed for <strong className="text-foreground">{plan.planName}</strong>.</p>
          <div>
            <Label className="text-sm font-medium">Completion Date</Label>
            <Input
              type="date"
              value={completedDate}
              onChange={e => setCompletedDate(e.target.value)}
              data-testid="input-renewal-complete-date"
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => onConfirm(completedDate)}
              disabled={isPending || !completedDate}
              className="bg-success text-success-foreground"
              data-testid="button-confirm-complete"
            >
              {isPending ? "Saving..." : "Confirm"}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- plan form dialog ----------
function PlanFormDialog({ open, onClose, clientId, plan }: { open: boolean; onClose: () => void; clientId: number; plan?: any }) {
  const { data: brokerClient } = useQuery<any>({ queryKey: ["/api/clients", String(clientId)] });
  const { toast } = useToast();
  const isEdit = !!plan;
  const [form, setForm] = useState({
    // New plans default to Standard. Many clients carry a single plan, which
    // otherwise gets named after its coverage ("Dental"), repeating the benefit
    // in the name field instead of naming a benefit level. Standard is accurate
    // for a single plan client and leaves room to add Premium later without
    // renaming the original, and renaming breaks a plan's year over year history
    // in the renewal report. Free text on purpose: clients run Gold/Silver,
    // Low/High, Union/Non Union, First Year, Retiree Standard and more.
    planName: plan?.planName ?? "Standard",
    coverageType: plan?.coverageType || "",
    effectiveDate: plan?.effectiveDate ? format(parseLocalDate(plan.effectiveDate), "yyyy-MM-dd") : "",
    planBasis: plan?.planBasis || "PROCEDURE_BASED",
    preventivePercent: plan?.preventivePercent ?? 100,
    correctivePercent: plan?.correctivePercent ?? 80,
    restorativePercent: plan?.restorativePercent ?? 50,
    annualLimit: plan?.annualLimit || "1000.00",
    deductible: plan?.deductible || "",
    dollarTier1Percent: plan?.dollarTier1Percent ?? "",
    dollarTier1Limit: plan?.dollarTier1Limit ?? "",
    dollarTier2Percent: plan?.dollarTier2Percent ?? "",
    dollarTier2Limit: plan?.dollarTier2Limit ?? "",
    dollarTier3Percent: plan?.dollarTier3Percent ?? "",
    renewalDueMonthsBefore: plan?.renewalDueMonthsBefore ?? 3,
    renewalRecipient: plan?.renewalRecipient ?? "CLIENT",
    orthoEligibility: (plan?.orthoEligibility ?? "NONE") as "NONE" | "CHILDREN" | "ALL",
    orthoCoinsurancePercent: plan?.orthoCoinsurancePercent ?? "",
    orthoMaxType: (plan?.orthoMaxType ?? "SHARED_ANNUAL") as "SHARED_ANNUAL" | "SEPARATE_LIFETIME",
    orthoLifetimeMax: plan?.orthoLifetimeMax ?? "",
    assignmentOfBenefits: plan?.assignmentOfBenefits ?? true,
    planNotes: plan?.planNotes || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      if (isEdit) {
        const res = await apiRequest("PUT", `/api/plans/${plan.id}`, data);
        return res.json();
      } else {
        const res = await apiRequest("POST", `/api/clients/${clientId}/plans`, data);
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "plans"] });
      toast({ title: `Plan ${isEdit ? "updated" : "created"} successfully` });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.planName.trim()) errs.planName = "Plan name is required";
    if (!form.effectiveDate) errs.effectiveDate = "Effective date is required";
    else {
      const d = new Date(form.effectiveDate + "T00:00:00");
      if (d.getDate() !== 1) errs.effectiveDate = "Effective date must be the first day of a month";
    }
    if (form.planBasis === "DOLLAR_BASED") {
      if (!form.dollarTier1Percent && form.dollarTier1Percent !== 0) errs.dollarTier1Percent = "Tier 1 percentage is required";
      if (!form.dollarTier1Limit) errs.dollarTier1Limit = "Tier 1 dollar amount is required";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const effectiveDate = new Date(form.effectiveDate + "T00:00:00");
    const isDollar = form.planBasis === "DOLLAR_BASED";
    mutation.mutate({
      planName: form.planName,
      coverageType: form.coverageType || null,
      effectiveDate,
      planBasis: form.planBasis,
      preventivePercent: !isDollar ? Number(form.preventivePercent) : null,
      correctivePercent: !isDollar ? Number(form.correctivePercent) : null,
      restorativePercent: !isDollar ? Number(form.restorativePercent) : null,
      dollarTier1Percent: isDollar && form.dollarTier1Percent !== "" ? Number(form.dollarTier1Percent) : null,
      dollarTier1Limit: isDollar && form.dollarTier1Limit ? String(form.dollarTier1Limit) : null,
      dollarTier2Percent: isDollar && form.dollarTier2Percent !== "" ? Number(form.dollarTier2Percent) : null,
      dollarTier2Limit: isDollar && form.dollarTier2Limit ? String(form.dollarTier2Limit) : null,
      dollarTier3Percent: isDollar && form.dollarTier3Percent !== "" ? Number(form.dollarTier3Percent) : null,
      annualLimit: form.annualLimit || "1000.00",
      deductible: form.deductible || null,
      planYear: effectiveDate.getFullYear(),
      isArchived: false,
      renewalDueMonthsBefore: Number(form.renewalDueMonthsBefore),
      renewalRecipient: form.renewalRecipient,
      orthoEligibility: form.orthoEligibility,
      orthoCoinsurancePercent: form.orthoEligibility !== "NONE" && form.orthoCoinsurancePercent !== "" ? Number(form.orthoCoinsurancePercent) : null,
      orthoMaxType: form.orthoEligibility !== "NONE" ? form.orthoMaxType : "SHARED_ANNUAL",
      orthoLifetimeMax: form.orthoEligibility !== "NONE" && form.orthoMaxType === "SEPARATE_LIFETIME" && form.orthoLifetimeMax ? String(form.orthoLifetimeMax) : null,
      assignmentOfBenefits: form.assignmentOfBenefits,
      planNotes: form.planNotes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-brand">{isEdit ? "Edit Plan" : "Add New Plan"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Plan Name <span className="text-danger">*</span></Label>
            <Input value={form.planName} onChange={e => setForm(f => ({ ...f, planName: e.target.value }))} data-testid="input-plan-name" />
            {errors.planName && <p className="text-xs text-danger mt-1">{errors.planName}</p>}
          </div>
          <div>
            <Label className="text-sm font-medium">Coverage Type</Label>
            <Select value={form.coverageType} onValueChange={v => setForm(f => ({ ...f, coverageType: v }))}>
              <SelectTrigger data-testid="select-coverage-type"><SelectValue placeholder="Select coverage type…" /></SelectTrigger>
              <SelectContent>
                {PLAN_COVERAGE_TYPE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Describes how this plan is funded and reported. A group with one rate covering both dental and vision is a single combined plan — do not create separate dental and vision entries for it.
            </p>
          </div>
          <div>
            <Label className="text-sm font-medium">Effective Date <span className="text-danger">*</span></Label>
            <Input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} data-testid="input-effective-date" />
            <p className="text-xs text-muted-foreground mt-1">Must be the 1st of a month</p>
            {errors.effectiveDate && <p className="text-xs text-danger mt-1">{errors.effectiveDate}</p>}
          </div>
          <div>
            <Label className="text-sm font-medium">Plan Basis <span className="text-danger">*</span></Label>
            <Select value={form.planBasis} onValueChange={v => setForm(f => ({ ...f, planBasis: v }))}>
              <SelectTrigger data-testid="select-plan-basis"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PROCEDURE_BASED">Procedure Based</SelectItem>
                <SelectItem value="DOLLAR_BASED">Dollar Based</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.planBasis === "PROCEDURE_BASED" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Preventive %</Label>
                <Input type="number" min={0} max={100} value={form.preventivePercent} onChange={e => setForm(f => ({ ...f, preventivePercent: Number(e.target.value) }))} data-testid="input-preventive" />
              </div>
              <div>
                <Label className="text-xs">Corrective %</Label>
                <Input type="number" min={0} max={100} value={form.correctivePercent} onChange={e => setForm(f => ({ ...f, correctivePercent: Number(e.target.value) }))} data-testid="input-corrective" />
              </div>
              <div>
                <Label className="text-xs">Restorative %</Label>
                <Input type="number" min={0} max={100} value={form.restorativePercent} onChange={e => setForm(f => ({ ...f, restorativePercent: Number(e.target.value) }))} data-testid="input-restorative" />
              </div>
              <p className="text-xs text-muted-foreground col-span-3">Deductible is waived for Preventive tier</p>
            </div>
          )}
          {form.planBasis === "DOLLAR_BASED" && (
            <div className="space-y-3 p-3 bg-surface-subtle rounded-md border">
              <p className="text-xs font-semibold text-brand">Dollar-Based Coverage Tiers</p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 1 — Percentage <span className="text-danger">*</span></Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} value={form.dollarTier1Percent} onChange={e => setForm(f => ({ ...f, dollarTier1Percent: e.target.value }))} placeholder="100" data-testid="input-dollar-tier1-percent" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground pb-3">of the first</span>
                <div className="flex-1">
                  <Label className="text-xs">Amount ($) <span className="text-danger">*</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input className="pl-6" value={form.dollarTier1Limit} onChange={e => setForm(f => ({ ...f, dollarTier1Limit: e.target.value }))} placeholder="300" data-testid="input-dollar-tier1-limit" />
                  </div>
                </div>
              </div>
              {errors.dollarTier1Percent && <p className="text-xs text-danger">{errors.dollarTier1Percent}</p>}
              {errors.dollarTier1Limit && <p className="text-xs text-danger">{errors.dollarTier1Limit}</p>}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 2 — Percentage</Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} value={form.dollarTier2Percent} onChange={e => setForm(f => ({ ...f, dollarTier2Percent: e.target.value }))} placeholder="70" data-testid="input-dollar-tier2-percent" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground pb-3">of the next</span>
                <div className="flex-1">
                  <Label className="text-xs">Amount ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input className="pl-6" value={form.dollarTier2Limit} onChange={e => setForm(f => ({ ...f, dollarTier2Limit: e.target.value }))} placeholder="500" data-testid="input-dollar-tier2-limit" />
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 3 — Percentage</Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} value={form.dollarTier3Percent} onChange={e => setForm(f => ({ ...f, dollarTier3Percent: e.target.value }))} placeholder="50" data-testid="input-dollar-tier3-percent" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground pb-3">of the balance</span>
                <div className="flex-1" />
              </div>
              <p className="text-xs text-muted-foreground italic">Example: 100% of the first $300, 70% of the next $500, 50% of the balance</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Annual Limit ($)</Label>
              <Input value={form.annualLimit} onChange={e => setForm(f => ({ ...f, annualLimit: e.target.value }))} data-testid="input-annual-limit" />
            </div>
            <div>
              <Label className="text-xs">Deductible ($)</Label>
              <Input value={form.deductible} onChange={e => setForm(f => ({ ...f, deductible: e.target.value }))} placeholder="Optional" data-testid="input-deductible" />
              <p className="text-xs text-muted-foreground mt-1">Corrective & Restorative only</p>
            </div>
          </div>

          {/* orthodontia settings */}
          <div className="p-3 bg-surface-subtle rounded-md border space-y-3">
            <p className="text-xs font-semibold text-brand">Orthodontia</p>
            <div>
              <Label className="text-xs">Ortho Coverage</Label>
              <Select value={form.orthoEligibility} onValueChange={v => setForm(f => ({ ...f, orthoEligibility: v as any, orthoCoinsurancePercent: v === "NONE" ? "" : f.orthoCoinsurancePercent, orthoMaxType: v === "NONE" ? "SHARED_ANNUAL" : f.orthoMaxType, orthoLifetimeMax: v === "NONE" ? "" : f.orthoLifetimeMax }))}>
                <SelectTrigger data-testid="select-ortho-eligibility"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Not covered</SelectItem>
                  <SelectItem value="CHILDREN">Children only</SelectItem>
                  <SelectItem value="ALL">All enrollees</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.orthoEligibility !== "NONE" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Ortho Coinsurance %</Label>
                    <div className="relative">
                      <Input
                        type="number" min={0} max={100}
                        value={form.orthoCoinsurancePercent}
                        onChange={e => setForm(f => ({ ...f, orthoCoinsurancePercent: e.target.value }))}
                        placeholder="50"
                        data-testid="input-ortho-coinsurance"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Ortho Maximum</Label>
                    <Select value={form.orthoMaxType} onValueChange={v => setForm(f => ({ ...f, orthoMaxType: v as any, orthoLifetimeMax: v === "SHARED_ANNUAL" ? "" : f.orthoLifetimeMax }))}>
                      <SelectTrigger data-testid="select-ortho-max-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SHARED_ANNUAL">Shares plan annual max</SelectItem>
                        <SelectItem value="SEPARATE_LIFETIME">Separate lifetime max</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.orthoMaxType === "SEPARATE_LIFETIME" && (
                  <div>
                    <Label className="text-xs">Ortho Lifetime Max ($)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                      <Input
                        className="pl-6"
                        value={form.orthoLifetimeMax}
                        onChange={e => setForm(f => ({ ...f, orthoLifetimeMax: e.target.value }))}
                        placeholder="1000"
                        data-testid="input-ortho-lifetime-max"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* assignment of benefits + plan notes */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-surface-subtle rounded-md border">
              <input
                type="checkbox"
                id="aob-checkbox"
                checked={form.assignmentOfBenefits}
                onChange={e => setForm(f => ({ ...f, assignmentOfBenefits: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
                data-testid="input-assignment-of-benefits"
              />
              <div>
                <label htmlFor="aob-checkbox" className="text-sm font-medium cursor-pointer">Assignment of Benefits</label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When checked, claims are paid directly to the provider. When unchecked, the member pays out of pocket and seeks reimbursement. This appears on member-facing documents.
                </p>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Plan Design Notes</Label>
              <textarea
                value={form.planNotes}
                onChange={e => setForm(f => ({ ...f, planNotes: e.target.value }))}
                placeholder="Optional — use for plan quirks that don't fit the structured fields above. E.g. separate employee vs. dependent annual maximums, LASIK exclusions, unusual deductible structures. These notes appear on client-facing documents."
                rows={4}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                data-testid="input-plan-notes"
              />
            </div>
          </div>

          {/* renewal settings */}
          <div className="p-3 bg-surface-subtle rounded-md border space-y-3">
            <p className="text-xs font-semibold text-brand flex items-center gap-1"><Clock className="w-3 h-3" /> Renewal Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Renewal Due (months before anniversary)</Label>
                <Select value={String(form.renewalDueMonthsBefore)} onValueChange={v => setForm(f => ({ ...f, renewalDueMonthsBefore: Number(v) }))}>
                  <SelectTrigger data-testid="select-renewal-months">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                      <SelectItem key={n} value={String(n)}>{n} month{n > 1 ? "s" : ""} before</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Renewal Recipient</Label>
                {(!brokerClient?.brokerStatus || brokerClient.brokerStatus === "NOT_SET") && <p className="text-destructive text-xs">Broker status is not set. Choose Direct or Broker on the client record before sending a renewal.</p>}
                <Select value={form.renewalRecipient} onValueChange={v => setForm(f => ({ ...f, renewalRecipient: v }))}>
                  <SelectTrigger data-testid="select-renewal-recipient">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CLIENT">Client</SelectItem>
                    <SelectItem value="BROKER" disabled={brokerClient?.brokerStatus !== "BROKER"}>Broker</SelectItem>
                    <SelectItem value="BOTH" disabled={brokerClient?.brokerStatus !== "BROKER"}>Broker & Client</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Accepted renewal option and rating engine version are recorded per
                plan year on the client detail page's Renewal Pipeline card, not
                here — they change each year while the plan itself persists. */}
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending} className="bg-brand text-brand-foreground" data-testid="button-save-plan">
              {mutation.isPending ? "Saving..." : "Save Plan"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- rate form dialog ----------

/** Sentinel for the dropdown entry that reveals the free text field. */
const CUSTOM_TIER = "__custom__";

const isStandardTier = (label: string) =>
  (STANDARD_TIER_LABELS as readonly string[]).includes(label);

const BROKER_MODE_LABELS: Record<string, string> = {
  NONE: "No broker compensation",
  FLAT_PEPM: "Flat per employee / month",
  FIXED_MONTHLY: "Fixed monthly (whole group)",
  PERCENT_OF_PREMIUM: "Percent of premium",
};

function calcTierOutputs(
  r: Record<string, string>,
  brokerMode: string,
  brokerPct: string,
  brokerAmt: string,
) {
  const base = parseFloat(r.baseAdminFee || "0") || 0;
  const cobra = parseFloat(r.cobraFee || "0") || 0;
  const simple = parseFloat(r.simpleFee || "0") || 0;
  const network = parseFloat(r.networkFee || "0") || 0;
  const claims = parseFloat(r.expectedClaims || "0") || 0;

  const bv = brokerMode === "PERCENT_OF_PREMIUM"
    ? (parseFloat(brokerPct || "0") || 0) / 100
    : (parseFloat(brokerAmt || "0") || 0);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const adminSubtotal = r2(base + cobra + simple + network);
  const preBrokerSubtotal = r2(adminSubtotal + claims);

  let brokerFee = 0;
  if (brokerMode === "FLAT_PEPM" || brokerMode === "FIXED_MONTHLY") {
    brokerFee = bv;
  } else if (brokerMode === "PERCENT_OF_PREMIUM" && bv > 0 && bv < 1) {
    const premium = r2(preBrokerSubtotal / (1 - bv));
    brokerFee = r2(premium - preBrokerSubtotal);
  }

  const totalAdminFee = r2(adminSubtotal + brokerFee);
  const monthlyPremium = r2(totalAdminFee + claims);
  return {
    brokerFee: brokerFee.toFixed(2),
    totalAdminFee: totalAdminFee.toFixed(2),
    monthlyPremium: monthlyPremium.toFixed(2),
  };
}

// `custom` is held separately rather than derived from the label, because a tier
// where Custom has just been picked has an empty label and would otherwise snap
// straight back to the dropdown before anything could be typed into it.
type TierRow = { id: string; label: string; custom: boolean };
type RateInputs = { baseAdminFee: string; cobraFee: string; simpleFee: string; networkFee: string; expectedClaims: string };

function RateFormDialog({ open, onClose, planId, clientId, client, plan, existingRates }: any) {
  const { toast } = useToast();

  const defaultBase = () => {
    const ct = plan?.coverageType;
    if (ct === "VISION_ONLY") return "0.48";
    if (ct === "DENTAL_VISION" || ct === "DENTAL_VISION_HEARING") return "2.53";
    return "2.05";
  };
  const defaultCobra = () =>
    client?.cobraAdministeredBy90d ? String(client?.cobraFee ?? "1.00") : "0.00";

  const initAll = () => {
    // Reconstruct tiers from existing rate cards
    let tiers: TierRow[];
    let rateMap: Record<string, RateInputs>;

    if (existingRates && existingRates.length > 0) {
      const sorted = [...existingRates].sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      const seen = new Set<string>();
      tiers = [];
      sorted.forEach((r: any) => {
        const key = String(r.planTierId ?? r.tier ?? "?");
        if (!seen.has(key)) {
          seen.add(key);
          const label = r.tierLabel ?? TIER_LABELS[r.tier] ?? r.tier ?? "";
          tiers.push({ id: key, label, custom: !!label && !isStandardTier(label) });
        }
      });
      rateMap = {};
      sorted.forEach((r: any) => {
        const key = String(r.planTierId ?? r.tier ?? "?");
        rateMap[key] = {
          baseAdminFee: String(r.baseAdminFee ?? defaultBase()),
          cobraFee: String(r.cobraFee ?? defaultCobra()),
          simpleFee: String(r.simpleFee ?? "0.00"),
          networkFee: String(r.networkFee ?? "0.00"),
          expectedClaims: String(r.expectedClaims ?? "0.00"),
        };
      });
    } else {
      const t0: TierRow = { id: "new_0", label: "EE", custom: false };
      tiers = [t0];
      rateMap = { [t0.id]: { baseAdminFee: defaultBase(), cobraFee: defaultCobra(), simpleFee: "0.00", networkFee: "0.00", expectedClaims: "0.00" } };
    }

    const rawBrokerValue = parseFloat(plan?.brokerValue ?? "0") || 0;
    const mode = plan?.brokerMode ?? "NONE";
    return {
      tiers,
      rateMap,
      brokerMode: mode,
      brokerPct: mode === "PERCENT_OF_PREMIUM" ? String(rawBrokerValue * 100) : "",
      brokerAmt: mode !== "PERCENT_OF_PREMIUM" ? rawBrokerValue.toFixed(2) : "",
      feeBasis: plan?.feeBasis ?? "PEPM",
      flatMonthlyFee: plan?.flatMonthlyFee ? String(parseFloat(plan.flatMonthlyFee).toFixed(2)) : "",
      flat90DBFee:    plan?.flat90DBFee    ? String(parseFloat(plan.flat90DBFee).toFixed(2))    : "",
      flatSimpleFee:  plan?.flatSimpleFee  ? String(parseFloat(plan.flatSimpleFee).toFixed(2))  : "",
      flatNetworkFee: plan?.flatNetworkFee ? String(parseFloat(plan.flatNetworkFee).toFixed(2)) : "",
    };
  };

  const [localTiers, setLocalTiers] = useState<TierRow[]>([]);
  const [rates, setRates] = useState<Record<string, RateInputs>>({});
  const [brokerMode, setBrokerMode] = useState("NONE");
  const [brokerPct, setBrokerPct] = useState("");
  const [brokerAmt, setBrokerAmt] = useState("");
  const [feeBasis, setFeeBasis] = useState("PEPM");
  const [flatMonthlyFee, setFlatMonthlyFee] = useState("");
  const [flat90DBFee, setFlat90DBFee] = useState("");
  const [flatSimpleFee, setFlatSimpleFee] = useState("");
  const [flatNetworkFee, setFlatNetworkFee] = useState("");

  useEffect(() => {
    if (open) {
      const s = initAll();
      setLocalTiers(s.tiers);
      setRates(s.rateMap);
      setBrokerMode(s.brokerMode);
      setBrokerPct(s.brokerPct);
      setBrokerAmt(s.brokerAmt);
      setFeeBasis(s.feeBasis);
      setFlatMonthlyFee(s.flatMonthlyFee);
      setFlat90DBFee(s.flat90DBFee);
      setFlatSimpleFee(s.flatSimpleFee);
      setFlatNetworkFee(s.flatNetworkFee);
    }
  }, [open]);

  const addTier = () => {
    if (localTiers.length >= 4) return;
    const newId = `new_${Date.now()}`;
    setLocalTiers(prev => [...prev, { id: newId, label: "", custom: false }]);
    setRates(prev => ({
      ...prev,
      [newId]: { baseAdminFee: defaultBase(), cobraFee: defaultCobra(), simpleFee: "0.00", networkFee: "0.00", expectedClaims: "0.00" },
    }));
  };

  const removeTier = (tierId: string) => {
    if (localTiers.length <= 1) return;
    setLocalTiers(prev => prev.filter(t => t.id !== tierId));
    setRates(prev => { const n = { ...prev }; delete n[tierId]; return n; });
  };

  const updateTierLabel = (tierId: string, label: string) => {
    setLocalTiers(prev => prev.map(t => t.id === tierId ? { ...t, label } : t));
  };

  const chooseStandardTier = (tierId: string, label: string) => {
    setLocalTiers(prev => prev.map(t => t.id === tierId ? { ...t, label, custom: false } : t));
  };

  const chooseCustomTier = (tierId: string) => {
    // Clear a standard label so the free text field starts empty. A label that
    // was already custom is kept so reopening the dialog does not wipe it.
    setLocalTiers(prev => prev.map(t =>
      t.id === tierId ? { ...t, custom: true, label: isStandardTier(t.label) ? "" : t.label } : t,
    ));
  };

  const updateRate = (tierId: string, field: keyof RateInputs, value: string) => {
    setRates(prev => ({ ...prev, [tierId]: { ...(prev[tierId] || {}), [field]: value } as RateInputs }));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      let saveBrokerValue: string;
      if (brokerMode === "PERCENT_OF_PREMIUM") {
        saveBrokerValue = ((parseFloat(brokerPct || "0") || 0) / 100).toFixed(4);
      } else {
        saveBrokerValue = (parseFloat(brokerAmt || "0") || 0).toFixed(4);
      }

      const isFixed = feeBasis === "FIXED_MONTHLY";
      const payload = {
        tiers: localTiers.map((t, i) => ({ label: t.label || `Tier ${i + 1}`, displayOrder: i })),
        rates: localTiers.map((t, i) => ({
          tierIndex: i,
          // Fixed Monthly: only expectedClaims matters per tier. Admin zeros are set server-side.
          baseAdminFee: isFixed ? "0.00" : (rates[t.id]?.baseAdminFee ?? "0.00"),
          cobraFee: isFixed ? "0.00" : (rates[t.id]?.cobraFee ?? "0.00"),
          simpleFee: isFixed ? "0.00" : (rates[t.id]?.simpleFee ?? "0.00"),
          networkFee: isFixed ? "0.00" : (rates[t.id]?.networkFee ?? "0.00"),
          expectedClaims: rates[t.id]?.expectedClaims ?? "0.00",
        })),
        brokerMode,
        brokerValue: saveBrokerValue,
        feeBasis,
        ...(isFixed ? {
          // Pass both the components and the manual total. Storage will auto-compute the total
          // from components when any component is non-zero; otherwise uses the manual total.
          flatMonthlyFee: (parseFloat(flatMonthlyFee || "0") || 0).toFixed(2),
          flat90DBFee:    flat90DBFee    ? (parseFloat(flat90DBFee)    || 0).toFixed(2) : null,
          flatSimpleFee:  flatSimpleFee  ? (parseFloat(flatSimpleFee)  || 0).toFixed(2) : null,
          flatNetworkFee: flatNetworkFee ? (parseFloat(flatNetworkFee) || 0).toFixed(2) : null,
        } : {}),
      };
      const res = await apiRequest("POST", `/api/plans/${planId}/rates`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "plans"] });
      toast({ title: "Rate cards saved" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Input cell: editable
  const FeeInput = ({ tierId, field }: { tierId: string; field: keyof RateInputs }) => (
    <td className="px-1 py-1">
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          value={rates[tierId]?.[field] ?? ""}
          onChange={e => updateRate(tierId, field, e.target.value)}
          className="h-8 pl-5 text-xs text-right"
        />
      </div>
    </td>
  );

  // Calculated cell: read-only
  const CalcCell = ({ tierId, field }: { tierId: string; field: "brokerFee" | "totalAdminFee" | "monthlyPremium" }) => {
    const calc = calcTierOutputs(rates[tierId] || {}, brokerMode, brokerPct, brokerAmt);
    return (
      <td className="px-3 py-1.5 text-right text-xs font-semibold text-brand bg-info-tint">
        ${parseFloat(calc[field]).toFixed(2)}
      </td>
    );
  };

  const editableRows: Array<{ field: keyof RateInputs; label: string; show?: boolean }> = [
    { field: "baseAdminFee", label: "90D Base Admin Fee" },
    { field: "cobraFee", label: "COBRA Fee", show: client?.cobraAdministeredBy90d },
    { field: "simpleFee", label: "Simple Fee" },
    { field: "networkFee", label: "Network Fee", show: client?.networkActive },
    { field: "expectedClaims", label: "Expected Claims" },
  ];
  const visibleEditable = editableRows.filter(r => r.show !== false);

  const hasBrokerCalc = brokerMode !== "NONE";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-brand">Edit Rate Card</DialogTitle>
        </DialogHeader>

        {/* ── TIERS SECTION ─────────────────────────────────────── */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-brand">Tiers ({localTiers.length}/4)</p>
            <Button type="button" size="sm" variant="outline" onClick={addTier} disabled={localTiers.length >= 4} className="h-7 text-xs gap-1">
              <Plus className="w-3 h-3" /> Add Tier
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use the standard labels wherever they fit, so plans stay comparable across
            years and clients. Pick Custom only for a genuinely different structure.
          </p>
          {/* Tier label pickers. Standard labels are the default path; Custom
              reveals a free text field for structures the standard set cannot
              express, such as a family tier split by dependent count. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {localTiers.map((tier, idx) => {
              const selectValue = tier.custom
                ? CUSTOM_TIER
                : (isStandardTier(tier.label) ? tier.label : "");
              return (
                <div key={tier.id} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Select
                      value={selectValue}
                      onValueChange={v =>
                        v === CUSTOM_TIER ? chooseCustomTier(tier.id) : chooseStandardTier(tier.id, v)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-tier-${idx}`}>
                        <SelectValue placeholder={`Tier ${idx + 1} label`} />
                      </SelectTrigger>
                      <SelectContent>
                        {STANDARD_TIER_LABELS.map(label => (
                          <SelectItem key={label} value={label}>
                            <span className="font-semibold">{label}</span>
                            <span className="text-muted-foreground ml-2">{STANDARD_TIER_DESCRIPTIONS[label]}</span>
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_TIER}>Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                    {localTiers.length > 1 && (
                      <button type="button" onClick={() => removeTier(tier.id)} className="text-muted-foreground hover:text-danger flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {tier.custom && (
                    <Input
                      value={tier.label}
                      onChange={e => updateTierLabel(tier.id, e.target.value)}
                      placeholder="Custom label"
                      className="h-8 text-xs"
                      data-testid={`input-tier-custom-${idx}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── PLAN SETTINGS ─────────────────────────────────────── */}
        {(() => {
          const db90    = parseFloat(flat90DBFee    || "0") || 0;
          const simple  = parseFloat(flatSimpleFee  || "0") || 0;
          const network = parseFloat(flatNetworkFee || "0") || 0;
          const hasComponents = db90 > 0 || simple > 0 || network > 0;
          const componentAdminSum = Math.round((db90 + simple + network) * 100) / 100;
          const brokerFixed = brokerMode === "FIXED_MONTHLY" ? (parseFloat(brokerAmt || "0") || 0) : 0;
          const effectiveAdmin = hasComponents ? componentAdminSum : (parseFloat(flatMonthlyFee || "0") || 0);
          const grandTotal = Math.round((effectiveAdmin + brokerFixed) * 100) / 100;
          return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 p-3 bg-surface-subtle rounded-lg border">
          <div className="space-y-2">
            <div>
              <Label className="text-xs font-semibold text-brand block mb-1.5">Fee Basis</Label>
              <Select value={feeBasis} onValueChange={v => {
                setFeeBasis(v);
                if (v !== "FIXED_MONTHLY") { setFlatMonthlyFee(""); setFlat90DBFee(""); setFlatSimpleFee(""); setFlatNetworkFee(""); }
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PEPM">Per employee / month (standard)</SelectItem>
                  <SelectItem value="FIXED_MONTHLY">Fixed monthly — whole group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {feeBasis === "FIXED_MONTHLY" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-brand block">Fee Components (group / month)</Label>
                <p className="text-xs text-muted-foreground -mt-1">Enter the breakdown when known. Leave blank to record only the total for now.</p>

                {[
                  { label: "90 Degree fee", val: flat90DBFee, set: setFlat90DBFee },
                  { label: "Simple fee",    val: flatSimpleFee, set: setFlatSimpleFee },
                  { label: "Network fee",   val: flatNetworkFee, set: setFlatNetworkFee },
                ].map(({ label, val, set }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
                    <span className="text-xs text-muted-foreground">$</span>
                    <Input type="number" step="0.01" min="0" value={val}
                      onChange={e => set(e.target.value)}
                      placeholder="0.00" className="h-7 text-xs w-24" />
                  </div>
                ))}

                <div className="flex items-center gap-2 border-t border-dashed border-border pt-2">
                  <span className="text-xs font-semibold text-brand w-28 shrink-0">Admin total</span>
                  <span className="text-xs text-muted-foreground">$</span>
                  {hasComponents ? (
                    <span className="text-xs font-mono font-semibold text-brand w-24">
                      {componentAdminSum.toFixed(2)}
                    </span>
                  ) : (
                    <Input type="number" step="0.01" min="0" value={flatMonthlyFee}
                      onChange={e => setFlatMonthlyFee(e.target.value)}
                      placeholder="0.00" className="h-7 text-xs w-24" />
                  )}
                  <span className="text-xs text-warning-strong">/ mo, whole group</span>
                </div>

                {grandTotal > 0 && (
                  <div className="flex items-center gap-2 bg-info-tint rounded px-2 py-1.5">
                    <span className="text-xs font-semibold text-brand w-28 shrink-0">Grand total</span>
                    <span className="text-xs font-mono font-bold text-brand">${grandTotal.toFixed(2)}/mo</span>
                    {brokerFixed > 0 && (
                      <span className="text-xs text-muted-foreground">(incl. ${brokerFixed.toFixed(2)} broker)</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs font-semibold text-brand block mb-1.5">Broker Compensation</Label>
            <Select value={brokerMode} onValueChange={v => { setBrokerMode(v); setBrokerPct(""); setBrokerAmt(""); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(BROKER_MODE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {brokerMode === "PERCENT_OF_PREMIUM" && (
              <div className="flex items-center gap-1 mt-1.5">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="50"
                  value={brokerPct}
                  onChange={e => setBrokerPct(e.target.value)}
                  placeholder="e.g. 8"
                  className="h-7 text-xs w-24"
                />
                <span className="text-xs text-muted-foreground">% of premium (gross-up method)</span>
              </div>
            )}
            {(brokerMode === "FLAT_PEPM" || brokerMode === "FIXED_MONTHLY") && (
              <div className="flex items-center gap-1 mt-1.5">
                <span className="text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={brokerAmt}
                  onChange={e => setBrokerAmt(e.target.value)}
                  placeholder="0.00"
                  className="h-7 text-xs w-24"
                />
                <span className="text-xs text-muted-foreground">
                  {brokerMode === "FLAT_PEPM" ? "per employee / month (same across all tiers)" : "per month for the whole group"}
                </span>
              </div>
            )}
          </div>
        </div>
        );})()}

        {/* ── RATE TABLE ────────────────────────────────────────── */}
        {feeBasis === "FIXED_MONTHLY" ? (
          /* Fixed Monthly: tiers carry enrollment + expected claims only */
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="rate-form-table">
              <thead>
                <tr className="bg-brand text-brand-foreground">
                  <th className="px-3 py-2 text-left text-xs font-medium w-44">Tier</th>
                  {localTiers.map((t, i) => (
                    <th key={t.id} className="px-3 py-2 text-center text-xs font-medium">
                      {t.label || `Tier ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="bg-card">
                  <td className="px-3 py-1.5 text-xs text-foreground">Expected Claims (PEPM)</td>
                  {localTiers.map(t => <FeeInput key={t.id} tierId={t.id} field="expectedClaims" />)}
                </tr>
                <tr className="bg-surface-subtle">
                  <td colSpan={localTiers.length + 1} className="px-3 py-2 text-xs text-warning-strong bg-warning-tint">
                    {(() => {
                      const db90n    = parseFloat(flat90DBFee    || "0") || 0;
                      const simplen  = parseFloat(flatSimpleFee  || "0") || 0;
                      const networkn = parseFloat(flatNetworkFee || "0") || 0;
                      const hasComp  = db90n > 0 || simplen > 0 || networkn > 0;
                      const adminAmt = hasComp
                        ? (Math.round((db90n + simplen + networkn) * 100) / 100)
                        : (parseFloat(flatMonthlyFee || "0") || 0);
                      const brokerFixedAmt = brokerMode === "FIXED_MONTHLY" ? (parseFloat(brokerAmt || "0") || 0) : 0;
                      const parts = [];
                      if (hasComp) {
                        if (db90n)    parts.push(`90DB $${db90n.toFixed(2)}`);
                        if (simplen)  parts.push(`Simple $${simplen.toFixed(2)}`);
                        if (networkn) parts.push(`Network $${networkn.toFixed(2)}`);
                      }
                      return (
                        <>
                          Admin fee: ${adminAmt.toFixed(2)}/mo
                          {parts.length > 0 && ` (${parts.join(" + ")})`}
                          {brokerFixedAmt > 0 && ` · Broker $${brokerFixedAmt.toFixed(2)}/mo`}
                          {" "}— not distributed per tier.
                        </>
                      );
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          /* PEPM: full per-tier fee breakdown */
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="rate-form-table">
              <thead>
                <tr className="bg-brand text-brand-foreground">
                  <th className="px-3 py-2 text-left text-xs font-medium w-44">Fee Component</th>
                  {localTiers.map((t, i) => (
                    <th key={t.id} className="px-3 py-2 text-center text-xs font-medium">
                      {t.label || `Tier ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleEditable.map((row, i) => (
                  <tr key={row.field} className={i % 2 === 0 ? "bg-card" : "bg-surface-subtle"}>
                    <td className="px-3 py-1.5 text-xs text-foreground">{row.label}</td>
                    {localTiers.map(t => <FeeInput key={t.id} tierId={t.id} field={row.field} />)}
                  </tr>
                ))}

                {/* Separator row */}
                <tr className="bg-surface-subtle">
                  <td colSpan={localTiers.length + 1} className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Calculated — read only
                  </td>
                </tr>

                {hasBrokerCalc && (
                  <tr className="bg-card">
                    <td className="px-3 py-1.5 text-xs text-foreground">Broker Fee</td>
                    {localTiers.map(t => <CalcCell key={t.id} tierId={t.id} field="brokerFee" />)}
                  </tr>
                )}
                <tr className="bg-surface-subtle">
                  <td className="px-3 py-1.5 text-xs font-semibold text-brand">Total Admin Fee</td>
                  {localTiers.map(t => <CalcCell key={t.id} tierId={t.id} field="totalAdminFee" />)}
                </tr>
                <tr className="bg-card">
                  <td className="px-3 py-2 text-xs font-bold text-brand border-l-4 border-warning-strong">Monthly Premium</td>
                  {localTiers.map(t => <CalcCell key={t.id} tierId={t.id} field="monthlyPremium" />)}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Formula reminder */}
        {feeBasis !== "FIXED_MONTHLY" && (
          <div className="mt-2 p-2 bg-surface-subtle rounded text-xs text-muted-foreground space-y-0.5">
            <p>Admin Fee = Base Admin + COBRA Fee + Simple Fee + Network Fee</p>
            <p>Total Admin Fee = Admin Fee + Broker Fee &nbsp;·&nbsp; Monthly Premium = Total Admin Fee + Expected Claims</p>
            {brokerMode === "PERCENT_OF_PREMIUM" && <p className="text-brand-accent">Broker % uses gross-up: Premium = (Admin + Claims) ÷ (1 − rate). Broker fee derived from rounded premium so totals always balance exactly.</p>}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="bg-brand text-brand-foreground" data-testid="button-save-rates">
            {mutation.isPending ? "Saving..." : "Save Rate Card"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
