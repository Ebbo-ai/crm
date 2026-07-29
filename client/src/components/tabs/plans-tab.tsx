import { useState, useRef } from "react";
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
import { PLAN_BASIS_LABELS, TIER_LABELS, formatCurrency, parseLocalDate } from "@/lib/constants";
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

  const currentPlans = plans.filter((p: any) => !p.isArchived);
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
        <h2 className="text-lg font-semibold text-[#1A5276]">Current Plans</h2>
        <Button
          onClick={() => { setEditingPlan(null); setShowPlanForm(true); }}
          disabled={currentPlans.length >= 6}
          className="bg-[#1A5276] text-white gap-2"
          title={currentPlans.length >= 6 ? "Maximum of 6 active plans reached" : ""}
          data-testid="button-add-plan"
        >
          <Plus className="w-4 h-4" /> Add New Plan
        </Button>
      </div>

      {!currentPlans.length && !isLoading && (
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 text-[#94A3B8] mx-auto mb-2" />
            <p className="text-sm text-[#94A3B8]">No plans configured for this client yet</p>
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
            <button className="flex items-center gap-2 text-sm font-medium text-[#94A3B8] mb-3 hover:text-[#2C3E50] transition-colors" data-testid="button-toggle-archived">
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
        <div className="mb-3 px-3 py-2 bg-[#22C55E]/10 rounded text-xs text-[#22C55E] font-semibold flex items-center gap-1.5">
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
                    ? <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                    : isActive
                      ? <div className="w-4 h-4 rounded-full border-2 border-[#2E86C1] bg-white" />
                      : <div className="w-4 h-4 rounded-full border-2 border-[#CBD5E1] bg-white" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <div>
                      <span className={`text-xs font-medium ${isDone ? "text-[#22C55E]" : isActive ? "text-[#1A5276]" : "text-[#94A3B8]"}`}>
                        {step.label}
                      </span>
                      {!isDone && <p className="text-[10px] text-[#94A3B8] mt-0.5">{step.desc}</p>}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isDone && (
                        <>
                          <span className="text-[11px] text-[#94A3B8]">{format(stepDate!, "MMM d, yyyy")}</span>
                          {"hasUpload" in step && step.hasUpload && (
                            <>
                              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.png,.jpg" onChange={handleFileChange} />
                              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-[#2E86C1]" onClick={() => fileRef.current?.click()}>
                                {prog?.step6DocumentId ? "Re-upload" : "Upload"}
                              </Button>
                            </>
                          )}
                          {!isComplete && (
                            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-[#94A3B8] hover:text-[#EF4444]"
                              onClick={() => updateMutation.mutate({ [step.key]: null, ...(step.key === "step3Date" && revisions.length > 0 ? { step4Revisions: [] } : {}) })}>
                              Undo
                            </Button>
                          )}
                        </>
                      )}
                      {isActive && (
                        <Button size="sm" className="h-6 px-2.5 text-[11px] bg-[#2E86C1] text-white hover:bg-[#1A5276]"
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
                  <div className="border-l-2 border-dashed border-[#CBD5E1] pl-3 pb-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wide">Revisions (optional)</p>
                      {prog?.step3Date && !isComplete && (
                        <Button size="sm" variant="ghost" className="h-4 px-1.5 text-[10px] text-[#2E86C1]"
                          onClick={() => { setAddingRevision(true); setRevisionDate(today); }}>
                          + Add
                        </Button>
                      )}
                    </div>
                    {revisions.length === 0 && <p className="text-[10px] text-[#94A3B8] italic">None</p>}
                    {revisions.map((rev: string, i: number) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] py-0.5">
                        <RefreshCw className="w-3 h-3 text-[#F5A623]" />
                        <span className="text-[#2C3E50]">Revised {format(new Date(rev), "MMM d, yyyy")}</span>
                        {!isComplete && (
                          <button className="text-[10px] text-[#EF4444] hover:underline ml-0.5"
                            onClick={() => updateMutation.mutate({ step4Revisions: revisions.filter((_: any, j: number) => j !== i) })}>
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {addingRevision && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input type="date" value={revisionDate} onChange={e => setRevisionDate(e.target.value)}
                          className="text-[11px] border rounded px-1.5 py-0.5 h-6 bg-white" />
                        <Button size="sm" className="h-6 px-2 text-[10px] bg-[#2E86C1] text-white"
                          onClick={() => updateMutation.mutate({ step4Revisions: [...revisions, revisionDate || today] })}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
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
                <p className="text-[11px] text-[#94A3B8] mt-2">
                  You can upload the signed form after marking this step done.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setMarkingKey(null)}>Cancel</Button>
              <Button size="sm" className="bg-[#2E86C1] text-white"
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
    <Card className={`border-0 shadow-sm ${archived ? "bg-gray-50" : ""}`} data-testid={`plan-card-${plan.id}`}>
      {/* header row */}
      <div className="px-5 py-4 cursor-pointer flex items-center justify-between gap-4" onClick={onToggle}>
        <div className="flex items-center gap-3 min-w-0">
          <CalendarDays className="w-5 h-5 text-[#2E86C1] flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#2C3E50] truncate">{plan.planName}</p>
            <p className="text-xs text-[#94A3B8]">
              {format(effectiveDate, "MMM d, yyyy")} | {PLAN_BASIS_LABELS[plan.planBasis]} | Renews {format(nextRenewal, "MMM d, yyyy")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!archived && (
            plan.isRenewalComplete
              ? <span className="text-[10px] px-2 py-1 rounded-full font-medium bg-[#22C55E]/10 text-[#22C55E] flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Renewal Done</span>
              : isDueSoon
                ? <span className="text-[10px] px-2 py-1 rounded-full font-medium bg-[#F5A623]/10 text-[#F5A623] flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Due Soon</span>
                : null
          )}
          <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${archived ? "bg-gray-200 text-gray-600" : "bg-[#22C55E]/10 text-[#22C55E]"}`}>
            {archived ? "Archived" : "Current"}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-[#94A3B8]" /> : <ChevronDown className="w-4 h-4 text-[#94A3B8]" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="px-5 pb-5 pt-0 border-t">
          {/* plan details grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
            <div><p className="text-xs text-[#94A3B8]">Plan Basis</p><p className="text-sm font-medium">{PLAN_BASIS_LABELS[plan.planBasis]}</p></div>
            <div><p className="text-xs text-[#94A3B8]">Annual Limit</p><p className="text-sm font-medium">{formatCurrency(plan.annualLimit)}</p></div>
            {plan.deductible && <div><p className="text-xs text-[#94A3B8]">Deductible</p><p className="text-sm font-medium">{formatCurrency(plan.deductible)}</p></div>}
            {plan.planBasis === "PROCEDURE_BASED" && (
              <>
                <div><p className="text-xs text-[#94A3B8]">Preventive</p><p className="text-sm font-medium">{plan.preventivePercent}%</p></div>
                <div><p className="text-xs text-[#94A3B8]">Corrective</p><p className="text-sm font-medium">{plan.correctivePercent}%</p></div>
                <div><p className="text-xs text-[#94A3B8]">Restorative</p><p className="text-sm font-medium">{plan.restorativePercent}%</p></div>
              </>
            )}
            {plan.planBasis === "DOLLAR_BASED" && plan.dollarTier1Percent != null && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-xs text-[#94A3B8] mb-1">Coverage Tiers</p>
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
            <p className="text-xs font-semibold text-[#1A5276] mb-2">Orthodontia</p>
            {(!plan.orthoEligibility || plan.orthoEligibility === "NONE") ? (
              <p className="text-sm text-[#94A3B8]">Not covered</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-[#94A3B8]">Eligible</p>
                  <p className="text-sm font-medium">
                    {plan.orthoEligibility === "CHILDREN" ? "Children only" : "All enrollees"}
                  </p>
                </div>
                {plan.orthoCoinsurancePercent != null && (
                  <div>
                    <p className="text-xs text-[#94A3B8]">Coinsurance</p>
                    <p className="text-sm font-medium">{plan.orthoCoinsurancePercent}%</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-[#94A3B8]">Maximum</p>
                  <p className="text-sm font-medium">
                    {plan.orthoMaxType === "SEPARATE_LIFETIME"
                      ? `Separate lifetime${plan.orthoLifetimeMax ? ` — ${formatCurrency(plan.orthoLifetimeMax)}` : ""}`
                      : "Shares annual max"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* rate card table */}
          {plan.rateCards?.length > 0 && (
            <div className="mt-2 mb-4">
              <h4 className="text-sm font-semibold text-[#1A5276] mb-2">Rate Card</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid={`rate-table-${plan.id}`}>
                  <thead>
                    <tr className="bg-[#1A5276] text-white">
                      <th className="px-3 py-2 text-left text-xs font-medium">Fee Type</th>
                      {["EE", "EE_CHILD", "EE_SPOUSE", "FAMILY"].map(tier => (
                        <th key={tier} className="px-3 py-2 text-right text-xs font-medium">{TIER_LABELS[tier]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { key: "baseAdminFee", label: "Base Admin Fee" },
                      { key: "spreadAdminFee", label: "Simple Marketing Fee" },
                      ...(client?.networkActive ? [{ key: "networkFee", label: "Network Fee" }] : []),
                      { key: "brokerFee", label: client?.hasBroker ? "Broker Fee" : "Broker Fee — No Broker" },
                      { key: "totalAdminFee", label: "Total Admin Fee" },
                      { key: "totalFee", label: "Total Fee" },
                      { key: "expectedClaims", label: "Expected Claims" },
                      { key: "monthlyPremium", label: "Monthly Premium", highlight: true },
                    ].map((row, i) => (
                      <tr key={row.key} className={`${i % 2 === 0 ? "bg-white" : "bg-[#F0F4F8]"} ${(row as any).highlight ? "font-bold" : ""}`}>
                        <td className={`px-3 py-2 text-xs ${(row as any).highlight ? "border-l-4 border-[#F5A623]" : ""} ${!client?.hasBroker && row.key === "brokerFee" ? "text-[#94A3B8] italic" : ""}`}>
                          {row.label}
                        </td>
                        {["EE", "EE_CHILD", "EE_SPOUSE", "FAMILY"].map(tier => {
                          const card = plan.rateCards.find((c: any) => c.tier === tier);
                          return (
                            <td key={tier} className={`px-3 py-2 text-right text-xs ${!client?.hasBroker && row.key === "brokerFee" ? "text-[#94A3B8]" : ""}`}>
                              {card ? formatCurrency((card as any)[row.key]) : "-"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* renewal tracking section — 7-step pipeline */}
          {!archived && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-[#1A5276] flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Renewal Tracking
                </h4>
                <div className="flex items-center gap-3 text-xs text-[#94A3B8]">
                  <span>Next renewal: <span className="font-medium text-[#2C3E50]">{format(nextRenewal, "MMM d, yyyy")}</span></span>
                  <span>Proposal due: <span className={`font-medium ${isDueSoon && !plan.isRenewalComplete ? "text-[#F5A623]" : "text-[#2C3E50]"}`}>{format(renewalDueDate, "MMM d, yyyy")}</span></span>
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
                  className="flex items-center gap-1 text-xs font-medium text-[#2E86C1] hover:text-[#1A5276] mb-2"
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
                      <p className="text-xs text-[#94A3B8] italic pl-2">No renewal proposals uploaded yet</p>
                    )}
                    {sortedDocs.map((doc: any) => (
                      <div key={doc.id} className="flex items-center justify-between bg-[#F0F4F8] rounded px-3 py-2" data-testid={`renewal-doc-${doc.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3 h-3 text-[#2E86C1] flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{doc.documentName}</p>
                            <p className="text-[10px] text-[#94A3B8]">
                              {doc.version && <span className="font-semibold text-[#1A5276] mr-1">{doc.version}</span>}
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
                            className="h-6 w-6 p-0 text-[#EF4444] hover:text-[#EF4444]"
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
                  className="gap-1 text-[#2E86C1] border-[#2E86C1]"
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
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onEdit(); }} className="gap-1 text-[#2E86C1] border-[#2E86C1]" data-testid={`button-edit-plan-${plan.id}`}>
                <Edit className="w-3 h-3" /> Edit Plan
              </Button>
            )}
            {!archived && onEditRates && (
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onEditRates(); }} className="gap-1" data-testid={`button-edit-rates-${plan.id}`}>
                <Edit className="w-3 h-3" /> Edit Rates
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onRenew(); }} className="gap-1 text-[#F5A623] border-[#F5A623]" data-testid={`button-renew-plan-${plan.id}`}>
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
          <DialogTitle className="text-[#1A5276]">Upload Renewal Proposal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Document Name <span className="text-[#EF4444]">*</span></Label>
            <Input
              value={docName}
              onChange={e => setDocName(e.target.value)}
              placeholder="e.g. Renewal Proposal 2027"
              data-testid="input-renewal-doc-name"
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Version <span className="text-[#EF4444]">*</span></Label>
            <Select value={version} onValueChange={setVersion}>
              <SelectTrigger data-testid="select-renewal-version">
                <SelectValue placeholder="Select version..." />
              </SelectTrigger>
              <SelectContent>
                {versionOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-[#94A3B8] mt-1">Most recent version is displayed first</p>
          </div>
          <div>
            <Label className="text-sm font-medium">File <span className="text-[#EF4444]">*</span></Label>
            <Input
              type="file"
              ref={fileRef}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={e => setFile(e.target.files?.[0] || null)}
              data-testid="input-renewal-file"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={uploading} className="bg-[#1A5276] text-white" data-testid="button-upload-renewal-submit">
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
          <DialogTitle className="text-[#1A5276]">Mark Renewal Complete</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-[#94A3B8]">Confirm the date the renewal proposal was completed for <strong className="text-[#2C3E50]">{plan.planName}</strong>.</p>
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
              className="bg-[#22C55E] text-white"
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
  const { toast } = useToast();
  const isEdit = !!plan;
  const [form, setForm] = useState({
    planName: plan?.planName || "",
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
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">{isEdit ? "Edit Plan" : "Add New Plan"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Plan Name <span className="text-[#EF4444]">*</span></Label>
            <Input value={form.planName} onChange={e => setForm(f => ({ ...f, planName: e.target.value }))} data-testid="input-plan-name" />
            {errors.planName && <p className="text-xs text-[#EF4444] mt-1">{errors.planName}</p>}
          </div>
          <div>
            <Label className="text-sm font-medium">Effective Date <span className="text-[#EF4444]">*</span></Label>
            <Input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} data-testid="input-effective-date" />
            <p className="text-xs text-[#94A3B8] mt-1">Must be the 1st of a month</p>
            {errors.effectiveDate && <p className="text-xs text-[#EF4444] mt-1">{errors.effectiveDate}</p>}
          </div>
          <div>
            <Label className="text-sm font-medium">Plan Basis <span className="text-[#EF4444]">*</span></Label>
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
              <p className="text-xs text-[#94A3B8] col-span-3">Deductible is waived for Preventive tier</p>
            </div>
          )}
          {form.planBasis === "DOLLAR_BASED" && (
            <div className="space-y-3 p-3 bg-[#F0F4F8] rounded-md border">
              <p className="text-xs font-semibold text-[#1A5276]">Dollar-Based Coverage Tiers</p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 1 — Percentage <span className="text-[#EF4444]">*</span></Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} value={form.dollarTier1Percent} onChange={e => setForm(f => ({ ...f, dollarTier1Percent: e.target.value }))} placeholder="100" data-testid="input-dollar-tier1-percent" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">%</span>
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8] pb-3">of the first</span>
                <div className="flex-1">
                  <Label className="text-xs">Amount ($) <span className="text-[#EF4444]">*</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">$</span>
                    <Input className="pl-6" value={form.dollarTier1Limit} onChange={e => setForm(f => ({ ...f, dollarTier1Limit: e.target.value }))} placeholder="300" data-testid="input-dollar-tier1-limit" />
                  </div>
                </div>
              </div>
              {errors.dollarTier1Percent && <p className="text-xs text-[#EF4444]">{errors.dollarTier1Percent}</p>}
              {errors.dollarTier1Limit && <p className="text-xs text-[#EF4444]">{errors.dollarTier1Limit}</p>}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 2 — Percentage</Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} value={form.dollarTier2Percent} onChange={e => setForm(f => ({ ...f, dollarTier2Percent: e.target.value }))} placeholder="70" data-testid="input-dollar-tier2-percent" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">%</span>
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8] pb-3">of the next</span>
                <div className="flex-1">
                  <Label className="text-xs">Amount ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">$</span>
                    <Input className="pl-6" value={form.dollarTier2Limit} onChange={e => setForm(f => ({ ...f, dollarTier2Limit: e.target.value }))} placeholder="500" data-testid="input-dollar-tier2-limit" />
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 3 — Percentage</Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} value={form.dollarTier3Percent} onChange={e => setForm(f => ({ ...f, dollarTier3Percent: e.target.value }))} placeholder="50" data-testid="input-dollar-tier3-percent" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">%</span>
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8] pb-3">of the balance</span>
                <div className="flex-1" />
              </div>
              <p className="text-xs text-[#94A3B8] italic">Example: 100% of the first $300, 70% of the next $500, 50% of the balance</p>
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
              <p className="text-xs text-[#94A3B8] mt-1">Corrective & Restorative only</p>
            </div>
          </div>

          {/* orthodontia settings */}
          <div className="p-3 bg-[#F0F4F8] rounded-md border space-y-3">
            <p className="text-xs font-semibold text-[#1A5276]">Orthodontia</p>
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
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">%</span>
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
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">$</span>
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

          {/* renewal settings */}
          <div className="p-3 bg-[#F0F4F8] rounded-md border space-y-3">
            <p className="text-xs font-semibold text-[#1A5276] flex items-center gap-1"><Clock className="w-3 h-3" /> Renewal Settings</p>
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
                <Select value={form.renewalRecipient} onValueChange={v => setForm(f => ({ ...f, renewalRecipient: v }))}>
                  <SelectTrigger data-testid="select-renewal-recipient">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CLIENT">Client</SelectItem>
                    <SelectItem value="BROKER">Broker</SelectItem>
                    <SelectItem value="BOTH">Broker & Client</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending} className="bg-[#1A5276] text-white" data-testid="button-save-plan">
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
function RateFormDialog({ open, onClose, planId, clientId, client, existingRates }: any) {
  const { toast } = useToast();
  const tiers = ["EE", "EE_CHILD", "EE_SPOUSE", "FAMILY"] as const;
  const feeFields = [
    { key: "baseAdminFee", label: "Base Admin Fee", required: true },
    { key: "spreadAdminFee", label: "Simple Marketing Fee", required: true },
    ...(client?.networkActive ? [{ key: "networkFee", label: "Network Fee", required: false }] : []),
    { key: "brokerFee", label: client?.hasBroker ? "Broker Fee" : "Broker Fee — No Broker", required: false },
    { key: "totalAdminFee", label: "Total Admin Fee", required: true },
    { key: "totalFee", label: "Total Fee", required: true },
    { key: "expectedClaims", label: "Expected Claims", required: true },
    { key: "monthlyPremium", label: "Monthly Premium", required: true, highlight: true },
  ];

  const initRates = () => {
    const rates: Record<string, Record<string, string>> = {};
    tiers.forEach(tier => {
      const existing = existingRates.find((r: any) => r.tier === tier);
      rates[tier] = {};
      feeFields.forEach(f => {
        rates[tier][f.key] = existing ? String(existing[f.key] || "0.00") : "0.00";
      });
    });
    return rates;
  };

  const [rates, setRates] = useState(initRates);

  const mutation = useMutation({
    mutationFn: async (data: any[]) => {
      const res = await apiRequest("POST", `/api/plans/${planId}/rates`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "plans"] });
      toast({ title: "Rate cards saved successfully" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cards = tiers.map(tier => ({
      planId,
      tier,
      baseAdminFee: rates[tier].baseAdminFee || "0.00",
      spreadAdminFee: rates[tier].spreadAdminFee || "0.00",
      networkFee: rates[tier].networkFee || "0.00",
      brokerFee: rates[tier].brokerFee || "0.00",
      totalAdminFee: rates[tier].totalAdminFee || "0.00",
      totalFee: rates[tier].totalFee || "0.00",
      expectedClaims: rates[tier].expectedClaims || "0.00",
      monthlyPremium: rates[tier].monthlyPremium || "0.00",
    }));
    mutation.mutate(cards);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Edit Rate Card</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="rate-form-table">
              <thead>
                <tr className="bg-[#1A5276] text-white">
                  <th className="px-3 py-2 text-left text-xs font-medium">Fee Type</th>
                  {tiers.map(tier => (
                    <th key={tier} className="px-3 py-2 text-center text-xs font-medium">{TIER_LABELS[tier]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feeFields.map((field, i) => (
                  <tr key={field.key} className={`${i % 2 === 0 ? "bg-white" : "bg-[#F0F4F8]"} ${(field as any).highlight ? "font-semibold" : ""}`}>
                    <td className={`px-3 py-2 text-xs ${(field as any).highlight ? "border-l-4 border-[#F5A623]" : ""} ${!client?.hasBroker && field.key === "brokerFee" ? "text-[#94A3B8] italic" : ""}`}>
                      {field.label}
                    </td>
                    {tiers.map(tier => (
                      <td key={tier} className="px-1 py-1">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">$</span>
                          <Input
                            value={rates[tier]?.[field.key] || ""}
                            onChange={e => setRates(prev => ({
                              ...prev,
                              [tier]: { ...prev[tier], [field.key]: e.target.value },
                            }))}
                            className="h-8 pl-5 text-xs text-right"
                            data-testid={`input-rate-${field.key}-${tier}`}
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 p-3 bg-[#F0F4F8] rounded-md text-xs text-[#94A3B8] space-y-1">
            <p>Total Admin Fee = Base Admin + Simple Marketing Fee + Network Fee (excludes Broker Fee)</p>
            <p>Total Fee = Total Admin Fee + Broker Fee</p>
            <p>Monthly Premium = Total Fee + Expected Claims</p>
          </div>
          <div className="flex gap-2 mt-4">
            <Button type="submit" disabled={mutation.isPending} className="bg-[#1A5276] text-white" data-testid="button-save-rates">
              {mutation.isPending ? "Saving..." : "Save Rate Card"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
