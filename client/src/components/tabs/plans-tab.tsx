import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { PLAN_BASIS_LABELS, TIER_LABELS, formatCurrency } from "@/lib/constants";
import { Plus, ChevronDown, ChevronUp, Edit, Archive, RefreshCw, FileText, CalendarDays } from "lucide-react";
import { format } from "date-fns";

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

  const currentPlans = plans.filter(p => !p.isArchived);
  const archivedPlans = plans.filter(p => p.isArchived);

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
        key={editingPlan?.id ?? 'new'}
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
          existingRates={plans.find(p => p.id === showRateForm)?.rateCards || []}
        />
      )}
    </div>
  );
}

function PlanCard({ plan, expanded, onToggle, onEdit, onEditRates, onRenew, client, archived }: any) {
  return (
    <Card className={`border-0 shadow-sm ${archived ? "bg-gray-50" : ""}`} data-testid={`plan-card-${plan.id}`}>
      <div className="px-5 py-4 cursor-pointer flex items-center justify-between gap-4" onClick={onToggle}>
        <div className="flex items-center gap-3 min-w-0">
          <CalendarDays className="w-5 h-5 text-[#2E86C1] flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#2C3E50] truncate">{plan.planName}</p>
            <p className="text-xs text-[#94A3B8]">
              {format(new Date(plan.effectiveDate), "MMM d, yyyy")} | {PLAN_BASIS_LABELS[plan.planBasis]} | Year {plan.planYear}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${
            archived ? "bg-gray-200 text-gray-600" : "bg-[#22C55E]/10 text-[#22C55E]"
          }`}>
            {archived ? "Archived" : "Current"}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-[#94A3B8]" /> : <ChevronDown className="w-4 h-4 text-[#94A3B8]" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="px-5 pb-5 pt-0 border-t">
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

          {plan.rateCards?.length > 0 && (
            <div className="mt-4">
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
                      { key: "spreadAdminFee", label: "Spread Admin Fee" },
                      ...(client?.networkActive ? [{ key: "networkFee", label: "Network Fee" }] : []),
                      ...(client?.hasBroker ? [{ key: "brokerFee", label: "Broker Fee" }] : []),
                      { key: "totalAdminFee", label: "Total Admin Fee" },
                      { key: "totalFee", label: "Total Fee" },
                      { key: "expectedClaims", label: "Expected Claims" },
                      { key: "monthlyPremium", label: "Monthly Premium", highlight: true },
                    ].map((row, i) => (
                      <tr key={row.key} className={`${i % 2 === 0 ? "bg-white" : "bg-[#F0F4F8]"} ${row.highlight ? "font-bold" : ""}`}>
                        <td className={`px-3 py-2 text-xs ${row.highlight ? "border-l-4 border-[#F5A623]" : ""}`}>{row.label}</td>
                        {["EE", "EE_CHILD", "EE_SPOUSE", "FAMILY"].map(tier => {
                          const card = plan.rateCards.find((c: any) => c.tier === tier);
                          return <td key={tier} className="px-3 py-2 text-right text-xs">{card ? formatCurrency((card as any)[row.key]) : "-"}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
    </Card>
  );
}

function PlanFormDialog({ open, onClose, clientId, plan }: { open: boolean; onClose: () => void; clientId: number; plan?: any }) {
  const { toast } = useToast();
  const isEdit = !!plan;
  const [form, setForm] = useState({
    planName: plan?.planName || "",
    effectiveDate: plan?.effectiveDate ? format(new Date(plan.effectiveDate), "yyyy-MM-dd") : "",
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
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
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
                    <Input
                      type="number" min={0} max={100}
                      value={form.dollarTier1Percent}
                      onChange={e => setForm(f => ({ ...f, dollarTier1Percent: e.target.value }))}
                      placeholder="100"
                      data-testid="input-dollar-tier1-percent"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">%</span>
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8] pb-3">of the first</span>
                <div className="flex-1">
                  <Label className="text-xs">Amount ($) <span className="text-[#EF4444]">*</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">$</span>
                    <Input
                      className="pl-6"
                      value={form.dollarTier1Limit}
                      onChange={e => setForm(f => ({ ...f, dollarTier1Limit: e.target.value }))}
                      placeholder="300"
                      data-testid="input-dollar-tier1-limit"
                    />
                  </div>
                </div>
              </div>
              {errors.dollarTier1Percent && <p className="text-xs text-[#EF4444]">{errors.dollarTier1Percent}</p>}
              {errors.dollarTier1Limit && <p className="text-xs text-[#EF4444]">{errors.dollarTier1Limit}</p>}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 2 — Percentage</Label>
                  <div className="relative">
                    <Input
                      type="number" min={0} max={100}
                      value={form.dollarTier2Percent}
                      onChange={e => setForm(f => ({ ...f, dollarTier2Percent: e.target.value }))}
                      placeholder="70"
                      data-testid="input-dollar-tier2-percent"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">%</span>
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8] pb-3">of the next</span>
                <div className="flex-1">
                  <Label className="text-xs">Amount ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">$</span>
                    <Input
                      className="pl-6"
                      value={form.dollarTier2Limit}
                      onChange={e => setForm(f => ({ ...f, dollarTier2Limit: e.target.value }))}
                      placeholder="500"
                      data-testid="input-dollar-tier2-limit"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Tier 3 — Percentage</Label>
                  <div className="relative">
                    <Input
                      type="number" min={0} max={100}
                      value={form.dollarTier3Percent}
                      onChange={e => setForm(f => ({ ...f, dollarTier3Percent: e.target.value }))}
                      placeholder="50"
                      data-testid="input-dollar-tier3-percent"
                    />
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

function RateFormDialog({ open, onClose, planId, clientId, client, existingRates }: any) {
  const { toast } = useToast();
  const tiers = ["EE", "EE_CHILD", "EE_SPOUSE", "FAMILY"] as const;
  const feeFields = [
    { key: "baseAdminFee", label: "Base Admin Fee", required: true },
    { key: "spreadAdminFee", label: "Spread Admin Fee", required: true },
    ...(client?.networkActive ? [{ key: "networkFee", label: "Network Fee", required: false }] : []),
    ...(client?.hasBroker ? [{ key: "brokerFee", label: "Broker Fee", required: false }] : []),
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
                  <tr key={field.key} className={`${i % 2 === 0 ? "bg-white" : "bg-[#F0F4F8]"} ${field.highlight ? "font-semibold" : ""}`}>
                    <td className={`px-3 py-2 text-xs ${field.highlight ? "border-l-4 border-[#F5A623]" : ""}`}>{field.label}</td>
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
            <p>Total Admin Fee = Base Admin + Spread Admin + Network Fee (excludes Broker Fee)</p>
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
