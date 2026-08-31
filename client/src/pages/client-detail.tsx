import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Mail, Phone, Building2, Landmark, CreditCard, History, UserPlus, FileText, Loader2, AlertCircle, CheckCircle2, Circle, CalendarClock } from "lucide-react";
import { PLAN_TYPE_LABELS, BANKING_TYPE_LABELS, FUNDING_TYPE_LABELS } from "@/lib/constants";
import { ClientStateBadge, clientStateSummary } from "@/components/client-state-badge";
import { BrokerFirmSelect } from "@/components/broker-firm-select";
import { getClientCompleteness } from "@/lib/client-completeness";
import {
  getRenewalTimingWarning, getProposalDueDate,
  RENEWAL_TIMING_WARNING_LABELS, RENEWAL_TIMING_WARNING_COLORS,
  RENEWAL_PIPELINE_STEPS, RENEWAL_PIPELINE_STEP_LABELS, RENEWAL_PIPELINE_STEP_COLORS,
  getNextPipelineStep, type RenewalPipelineStep,
} from "@/lib/renewal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import PlansTab from "@/components/tabs/plans-tab";
import DocumentsTab from "@/components/tabs/documents-tab";
import IssuesTab from "@/components/tabs/issues-tab";
import PprTab from "@/components/tabs/ppr-tab";
import CommunicationsTab from "@/components/tabs/communications-tab";
import PipelineTab from "@/components/tabs/pipeline-tab";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatBrokerDate(dateStr: string | null, isCurrent: boolean): string {
  if (isCurrent) return "Current";
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatEffectiveMonth(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = parseInt(params.id!);
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialTab = search?.get("tab") ?? "profile";
  const [activeTab, setActiveTab] = useState(initialTab);
  // Set when the dashboard feed deep-links to one specific message, so the
  // communications tab can scroll to it and mark it rather than dumping Kim at
  // the top of a long history.
  const focusCommId = (() => {
    const raw = search?.get("comm");
    const n = raw ? parseInt(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  })();

  const { data: client, isLoading } = useQuery<any>({
    queryKey: ["/api/clients", params.id],
  });

  // Full renewal history, newest plan year first. The server opens the current
  // year's record automatically when it comes due.
  const { data: renewalHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/clients", params.id, "renewals"],
  });

  // Needed so the open renewal can show an accepted-option selector per plan.
  const { data: clientPlans = [] } = useQuery<any[]>({
    queryKey: ["/api/clients", params.id, "plans"],
  });

  const openRenewal = renewalHistory.find(r => r.pipelineStep !== "EMAILED_TO_90D") ?? null;
  const priorRenewals = renewalHistory.filter(r => r.id !== openRenewal?.id);

  const { toast } = useToast();

  const generateDraftMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/clients/${clientId}/generate-renewal-draft`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "documents"] });
      setActiveTab("documents");
      toast({ title: "Renewal draft generated", description: "The proposal PDF is now in the Documents tab." });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message || "Rating engine error", variant: "destructive" });
    },
  });

  const advancePipelineMutation = useMutation({
    mutationFn: async ({ renewalId, step }: { renewalId: number; step: RenewalPipelineStep | null }) => {
      const res = await apiRequest("PUT", `/api/renewals/${renewalId}`, { pipelineStep: step });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", params.id, "renewals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/renewal-alerts"] });
      toast({ title: "Pipeline step updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // The renewal report is the document that completes a renewal. It tells 90
  // Degree Benefits what to change in their claims system for the new plan year,
  // and it files itself against the renewal it came from.
  const renewalReportMutation = useMutation({
    mutationFn: async (renewalId: number) => {
      const res = await apiRequest("POST", `/api/renewals/${renewalId}/report/save`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "documents"] });
      setActiveTab("documents");
      toast({ title: "Renewal report generated", description: "The PDF is now in the Documents tab." });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  // Accepted option is per plan — a multi-plan client can accept a different
  // tier on each plan within the same renewal.
  const planOptionMutation = useMutation({
    mutationFn: async ({ renewalId, planId, acceptedOption }: { renewalId: number; planId: number; acceptedOption: string | null }) => {
      const res = await apiRequest("PUT", `/api/renewals/${renewalId}/plan-options/${planId}`, { acceptedOption });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", params.id, "renewals"] });
      toast({ title: "Accepted option saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!client) {
    return <div className="text-center py-16"><p className="text-muted-foreground">Client not found</p></div>;
  }

  return (
    <div data-testid="client-detail-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {client.activeIssueCount > 0 && <div className="pulse-dot flex-shrink-0" />}
            <div>
              <h1 className="text-2xl font-bold text-brand" data-testid="text-client-name">{client.clientName}</h1>
              <p className="text-sm text-muted-foreground">{client.city}, {client.state}</p>
            </div>
          </div>
          <ClientStateBadge
            client={client}
            className="text-xs px-2.5 py-1 ml-2"
            testId="badge-client-status"
          />
          {client.zeroPayFlag && (
            <span
              className="text-xs px-2.5 py-1 rounded-full font-semibold bg-warning/10 text-warning flex items-center gap-1"
              title="One or more months have enrollment but zero paid claims with no reason code on file. Review before the next report cycle."
              data-testid="badge-zero-pay-flag"
            >
              <AlertCircle className="w-3 h-3" /> Zero-Paid
            </span>
          )}
          {client.underfundingFlag && (
            <span
              className="text-xs px-2.5 py-1 rounded-full font-semibold bg-danger/10 text-danger flex items-center gap-1"
              title="The plan's actual account balance has fallen below the billed position. Money was invoiced but not deposited — review funding with the plan sponsor."
              data-testid="badge-underfunding-flag"
            >
              <AlertCircle className="w-3 h-3" /> Underfunded
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/clients/${clientId}/edit`}>
            <Button className="bg-brand text-brand-foreground gap-2" data-testid="button-edit-client">
              <Edit className="w-4 h-4" /> Edit Client
            </Button>
          </Link>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border mb-6 h-auto flex-wrap">
          <TabsTrigger value="profile" data-testid="tab-profile" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">Profile</TabsTrigger>
          <TabsTrigger value="plans" data-testid="tab-plans" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">Plans & Rates</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">Documents</TabsTrigger>
          <TabsTrigger value="issues" data-testid="tab-issues" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">
            Issues {client.activeIssueCount > 0 && `(${client.activeIssueCount})`}
          </TabsTrigger>
          <TabsTrigger value="ppr" data-testid="tab-ppr" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">PPR</TabsTrigger>
          <TabsTrigger value="communications" data-testid="tab-communications" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">Communications</TabsTrigger>
          <TabsTrigger value="banking" data-testid="tab-banking" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">Banking</TabsTrigger>
          <TabsTrigger value="pipeline" data-testid="tab-pipeline" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Completeness indicator — shown only when profile is incomplete */}
            {(() => {
              const c = getClientCompleteness(client);
              if (c.isComplete) return null;
              return (
                <div className="lg:col-span-2">
                  <div className="rounded-lg border border-warning/40 bg-warning-tint px-5 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Circle className="w-4 h-4 text-warning-strong" />
                        <span className="text-sm font-semibold text-warning-strong">
                          Profile {c.pct}% complete — {c.filled}/{c.total} fields filled
                        </span>
                      </div>
                      <Link href={`/clients/${clientId}/edit`}>
                        <Button size="sm" variant="outline" className="text-xs border-warning/40 text-warning-strong hover:bg-warning-tint h-7">
                          Fill in missing fields
                        </Button>
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {c.missing.map(label => (
                        <span key={label} className="text-xs px-2 py-0.5 rounded-full bg-warning-tint text-warning-strong border border-warning/40">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-6">
                <h2 className="text-lg font-semibold text-brand">Client Information</h2>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-3">
                {(client.streetAddress || client.city || client.state) && (
                  <InfoRow label="Address" value={[
                    client.streetAddress,
                    client.suiteUnit,
                    client.city && client.state ? `${client.city}, ${client.state}` : client.city || client.state,
                    client.zipCode,
                  ].filter(Boolean).join(" ")} />
                )}
                {client.industryType && <InfoRow label="Industry" value={client.industryType} />}
                {client.numberOfEmployees != null && <InfoRow label="Employees" value={client.numberOfEmployees} />}
                {client.anniversaryDate && (
                  <InfoRow label="Anniversary Date" value={new Date(client.anniversaryDate).toLocaleDateString()} />
                )}
                <InfoRow label="Plan Type">
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-brand-accent/10 text-brand-accent">
                    {PLAN_TYPE_LABELS[client.planType]}
                  </span>
                </InfoRow>
                {client.networkActive && <InfoRow label="Network" value={client.dentalNetworkName || "Active"} />}
                {client.terminationDate && (
                  <InfoRow label="Termination Date" value={new Date(client.terminationDate).toLocaleDateString()} />
                )}
                {/* Spelled out rather than left as arithmetic on the termination
                    date, so nobody has to count three months forward in their head
                    to know whether claims and PPRs are still expected. */}
                {client.terminationDate && (() => {
                  const { state, closes } = clientStateSummary(client);
                  if (!closes) return null;
                  return (
                    <InfoRow
                      label={state === "CLOSED" ? "Run-Out Ended" : "Run-Out Closes"}
                      value={closes.toLocaleDateString()}
                    />
                  );
                })()}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-6">
                <h2 className="text-lg font-semibold text-brand">Contacts</h2>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-5">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Decision Maker</p>
                  {client.decisionMakerName
                    ? <p className="text-sm font-medium text-foreground">{client.decisionMakerName}</p>
                    : <p className="text-xs italic text-muted-foreground">Not on file</p>}
                  {client.decisionMakerTitle && <p className="text-xs text-muted-foreground">{client.decisionMakerTitle}</p>}
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    {client.decisionMakerPhone && (
                      <a href={`tel:${client.decisionMakerPhone}`} className="flex items-center gap-1 text-xs text-brand-accent">
                        <Phone className="w-3 h-3" /> {client.decisionMakerPhone}
                      </a>
                    )}
                    {client.decisionMakerEmail && (
                      <a href={`mailto:${client.decisionMakerEmail}`} className="flex items-center gap-1 text-xs text-brand-accent">
                        <Mail className="w-3 h-3" /> {client.decisionMakerEmail}
                      </a>
                    )}
                  </div>
                </div>
                <div className="border-t pt-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Admin Contact</p>
                  {client.adminContactName
                    ? <p className="text-sm font-medium text-foreground">{client.adminContactName}</p>
                    : <p className="text-xs italic text-muted-foreground">Not on file</p>}
                  {client.adminContactTitle && <p className="text-xs text-muted-foreground">{client.adminContactTitle}</p>}
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    {client.adminContactPhone && (
                      <a href={`tel:${client.adminContactPhone}`} className="flex items-center gap-1 text-xs text-brand-accent">
                        <Phone className="w-3 h-3" /> {client.adminContactPhone}
                      </a>
                    )}
                    {client.adminContactEmail && (
                      <a href={`mailto:${client.adminContactEmail}`} className="flex items-center gap-1 text-xs text-brand-accent">
                        <Mail className="w-3 h-3" /> {client.adminContactEmail}
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {client.hasBroker && (
              <BrokerCard client={client} clientId={clientId} />
            )}

            {client.anniversaryDate && (() => {
              const step = (openRenewal?.pipelineStep ?? null) as RenewalPipelineStep | null;
              const nextStep = getNextPipelineStep(step);
              const warning = getRenewalTimingWarning(openRenewal, client);
              const proposalDue = getProposalDueDate(client, openRenewal?.planYear);
              const currentStepIdx = step ? RENEWAL_PIPELINE_STEPS.indexOf(step) : -1;
              // Without an accepted option there is nothing for the report to say.
              const hasAcceptedOption = (openRenewal?.planOptions ?? []).some((o: any) => o.acceptedOption);
              return (
                <Card className="border-0 shadow-sm lg:col-span-2">
                  <CardHeader className="pb-3 pt-5 px-6">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h2 className="text-lg font-semibold text-brand">
                        Renewal Pipeline
                        {openRenewal && <span className="ml-2 text-sm font-normal text-muted-foreground">Plan year {openRenewal.planYear}</span>}
                      </h2>
                      <div className="flex items-center gap-2 flex-wrap">
                        {warning && (
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${RENEWAL_TIMING_WARNING_COLORS[warning]}`}>
                            ⚠ {RENEWAL_TIMING_WARNING_LABELS[warning]}
                          </span>
                        )}
                        {openRenewal?.incompletePriorFlag && (
                          <span className="text-xs font-bold px-2 py-1 rounded-full bg-danger-tint text-danger-strong">
                            ⚠ Prior year never completed
                          </span>
                        )}
                        {step
                          ? <span className={`text-xs font-bold px-2 py-1 rounded-full ${RENEWAL_PIPELINE_STEP_COLORS[step]}`}>{RENEWAL_PIPELINE_STEP_LABELS[step]}</span>
                          : <span className="text-xs italic text-muted-foreground">Not started</span>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 space-y-4">
                    {!openRenewal ? (
                      <p className="text-sm text-muted-foreground italic" data-testid="text-no-open-renewal">
                        No renewal is open for this client yet. One opens automatically 30 days before the proposal due date
                        {proposalDue ? ` (${new Date(proposalDue.getTime() - 30 * 86400000).toLocaleDateString()})` : ""}.
                      </p>
                    ) : (
                    <>
                    {/* 7-segment progress bar */}
                    <div>
                      <div className="flex gap-1 mb-3">
                        {RENEWAL_PIPELINE_STEPS.map((s, i) => (
                          <div
                            key={s}
                            title={RENEWAL_PIPELINE_STEP_LABELS[s]}
                            className={`h-2 rounded-full flex-1 transition-colors ${
                              i < currentStepIdx ? "bg-brand" : i === currentStepIdx ? "bg-brand-accent" : "bg-muted"
                            }`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {nextStep && (
                          <Button
                            size="sm"
                            className="h-8 text-xs bg-brand text-brand-foreground gap-1"
                            onClick={() => advancePipelineMutation.mutate({ renewalId: openRenewal.id, step: nextStep })}
                            disabled={advancePipelineMutation.isPending}
                            data-testid="button-advance-pipeline"
                          >
                            → {RENEWAL_PIPELINE_STEP_LABELS[nextStep]}
                          </Button>
                        )}
                        <Select
                          value={step ?? "_none"}
                          onValueChange={v => advancePipelineMutation.mutate({ renewalId: openRenewal.id, step: v === "_none" ? null : v as RenewalPipelineStep })}
                        >
                          <SelectTrigger className="h-8 text-xs w-auto min-w-[150px]" data-testid="select-pipeline-step">
                            <SelectValue placeholder="Set step…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">— Not started</SelectItem>
                            {RENEWAL_PIPELINE_STEPS.map(s => (
                              <SelectItem key={s} value={s}>{RENEWAL_PIPELINE_STEP_LABELS[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1"
                          onClick={() => renewalReportMutation.mutate(openRenewal.id)}
                          disabled={!hasAcceptedOption || renewalReportMutation.isPending}
                          title={hasAcceptedOption
                            ? "Generate the document telling 90 Degree Benefits what to change"
                            : "Record an accepted option on at least one plan first"}
                          data-testid="button-renewal-report"
                        >
                          {renewalReportMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <FileText className="h-3.5 w-3.5" />}
                          Renewal Report
                        </Button>
                      </div>
                    </div>

                    {/* Accepted option per plan. Terminated plans have nothing to
                        renew, so they are excluded here entirely rather than shown
                        disabled — they still appear, clearly marked, on the Plans tab. */}
                    {clientPlans.filter((p: any) => !p.terminationDate).length > 0 && (
                      <div className="border-t pt-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Accepted option by plan</p>
                        {clientPlans.filter((p: any) => !p.terminationDate).map((plan: any) => {
                          const opt = openRenewal.planOptions?.find((o: any) => o.planId === plan.id);
                          return (
                            <div key={plan.id} className="flex items-center justify-between gap-3 flex-wrap">
                              <span className="text-sm text-foreground">{plan.planName || PLAN_TYPE_LABELS[plan.planType] || `Plan #${plan.id}`}</span>
                              <div className="flex items-center gap-2">
                                {opt?.ratingEngineVersion && (
                                  <span className="text-xs text-muted-foreground">engine {opt.ratingEngineVersion}</span>
                                )}
                                <Select
                                  value={opt?.acceptedOption ?? "_none"}
                                  onValueChange={v => planOptionMutation.mutate({
                                    renewalId: openRenewal.id,
                                    planId: plan.id,
                                    acceptedOption: v === "_none" ? null : v,
                                  })}
                                >
                                  <SelectTrigger className="h-8 text-xs w-[160px]" data-testid={`select-accepted-option-${plan.id}`}>
                                    <SelectValue placeholder="Not accepted" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_none">— Not accepted</SelectItem>
                                    <SelectItem value="VALUE">Value</SelectItem>
                                    <SelectItem value="RECOMMENDED">Recommended</SelectItem>
                                    <SelectItem value="PROTECTIVE">Protective</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Date facts */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t pt-3">
                      <InfoRow label="Anniversary" value={new Date(client.anniversaryDate).toLocaleDateString()} />
                      {proposalDue && <InfoRow label="Proposal due" value={proposalDue.toLocaleDateString()} />}
                      {openRenewal.proposalSentDate && (
                        <InfoRow label="Proposal sent" value={`${new Date(openRenewal.proposalSentDate).toLocaleDateString()}${openRenewal.proposalVersion ? ` — ${openRenewal.proposalVersion}` : ""}`} />
                      )}
                      {openRenewal.acceptanceReceivedDate && (
                        <InfoRow label="Acceptance received" value={new Date(openRenewal.acceptanceReceivedDate).toLocaleDateString()} />
                      )}
                    </div>
                    </>
                    )}

                    {/* Prior years — the reason renewals are year-specific records */}
                    {priorRenewals.length > 0 && (
                      <div className="border-t pt-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Renewal history</p>
                        {priorRenewals.map((r: any) => (
                          <div key={r.id} className="flex items-center justify-between gap-3 flex-wrap text-sm" data-testid={`row-renewal-history-${r.planYear}`}>
                            <span className="font-medium text-foreground">{r.planYear}</span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {(r.planOptions ?? []).filter((o: any) => o.acceptedOption).map((o: any) => (
                                <span key={o.id} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {o.acceptedOption === "RECOMMENDED" ? "Recommended" : o.acceptedOption === "VALUE" ? "Value" : "Protective"}
                                </span>
                              ))}
                              {r.pipelineStep === "EMAILED_TO_90D"
                                ? <span className="text-xs text-success font-semibold">✓ Complete</span>
                                : <span className="text-xs text-warning-strong font-semibold">Never completed</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-6">
                <h2 className="text-lg font-semibold text-brand">Banking & Funding</h2>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-3">
                {client.bankingType ? (
                  <div className="flex items-center gap-3">
                    <Landmark className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Banking Type</p>
                      <p className="text-sm font-medium text-foreground">{BANKING_TYPE_LABELS[client.bankingType] ?? client.bankingType}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs italic text-muted-foreground">Banking type not set</p>
                )}
                {client.fundingType && (
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Funding Type</p>
                      <p className="text-sm font-medium text-foreground">{FUNDING_TYPE_LABELS[client.fundingType] ?? client.fundingType}</p>
                    </div>
                  </div>
                )}
                {client.cobraAdministeredBy90d && (
                  <InfoRow label="COBRA Admin">
                    <span className="text-sm text-foreground">
                      90 Degree Benefits
                      {client.cobraFee != null && ` — $${parseFloat(client.cobraFee).toFixed(2)}/mo`}
                    </span>
                  </InfoRow>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="plans">
          <PlansTab clientId={clientId} client={client} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab clientId={clientId} />
        </TabsContent>

        <TabsContent value="issues">
          <IssuesTab clientId={clientId} />
        </TabsContent>

        <TabsContent value="ppr">
          <PprTab clientId={clientId} client={client} />
        </TabsContent>

        <TabsContent value="communications">
          <CommunicationsTab clientId={clientId} focusCommId={focusCommId} />
        </TabsContent>

        <TabsContent value="pipeline">
          {/* The pipeline tab only distinguishes prospect, live and gone. A
              terminating or run-out client is still live: renewals are suppressed
              but the pipeline history stays on view. */}
          <PipelineTab
            clientId={clientId}
            clientStatus={(() => {
              const s = clientStateSummary(client).state;
              return s === "PROSPECT" ? "PROSPECT" : s === "CLOSED" ? "TERMINATED" : "ACTIVE";
            })()}
          />
        </TabsContent>

        <TabsContent value="banking">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-6">
                <h2 className="text-lg font-semibold text-brand">Banking & Funding Summary</h2>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-4 p-4 bg-surface-subtle rounded-lg">
                    <Landmark className="w-8 h-8 text-brand" />
                    <div>
                      <p className="text-xs text-muted-foreground">Who Holds the Bank Account</p>
                      <p className="text-base font-semibold text-foreground">
                        {client.bankingType
                          ? (BANKING_TYPE_LABELS[client.bankingType] ?? client.bankingType)
                          : <span className="text-muted-foreground font-normal text-sm italic">Not set</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-surface-subtle rounded-lg">
                    <CreditCard className="w-8 h-8 text-brand" />
                    <div>
                      <p className="text-xs text-muted-foreground">Funding Approval</p>
                      <p className="text-base font-semibold text-foreground">
                        {client.fundingType
                          ? (FUNDING_TYPE_LABELS[client.fundingType] ?? client.fundingType)
                          : <span className="text-muted-foreground font-normal text-sm italic">Not set</span>}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Account balance — only for 90 Degree bank clients */}
                {client.bankingType === "NINETY_DEGREE_BANK" && (
                  <div className="border rounded-lg p-4 space-y-2">
                    <p className="text-sm font-semibold text-brand">Account Balance</p>
                    <p className="text-xs text-muted-foreground">
                      This is the actual bank account balance as reported by 90 Degree Benefits — updated monthly.
                      It is separate from the plan surplus or deficit shown on the PPR tab. The account holds
                      more than just claims funds, and admin fees are drawn from it, so the two numbers
                      legitimately differ.
                    </p>
                    {client.accountBalance != null ? (
                      <div className="flex items-baseline gap-3 pt-1">
                        <span className="text-2xl font-bold text-foreground">
                          ${parseFloat(client.accountBalance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                        {client.accountBalanceAsOfDate && (
                          <span className="text-xs text-muted-foreground">
                            as of {new Date(client.accountBalanceAsOfDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm italic text-muted-foreground pt-1">
                        Balance not yet on file — updated monthly by 90 Degree Benefits
                      </p>
                    )}
                  </div>
                )}

                {/* COBRA */}
                <div className="border rounded-lg p-4">
                  <p className="text-sm font-semibold text-brand mb-1">COBRA Administration</p>
                  {client.cobraAdministeredBy90d ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span className="text-sm text-foreground">
                        Administered by 90 Degree Benefits
                        {client.cobraFee != null
                          ? ` — $${parseFloat(client.cobraFee).toFixed(2)}/member/month`
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not administered by 90 Degree Benefits</p>
                  )}
                </div>

                <div>
                  <Link href={`/clients/${clientId}/edit`}>
                    <Button variant="outline" size="sm" className="text-brand-accent border-brand-accent" data-testid="button-edit-banking">
                      Edit Banking Settings
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BrokerCard({ client, clientId }: { client: any; clientId: number }) {
  const { toast } = useToast();
  const [changeOpen, setChangeOpen] = useState(false);

  // Edit Client sends the operator here when they try to change the firm, so open the
  // dialog they were actually after instead of dropping them on the page to hunt for it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("broker") === "change") {
      setChangeOpen(true);
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);

  const now = new Date();
  const currentYear = now.getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => currentYear - 2 + i);

  const [form, setForm] = useState({
    brokerFirmName: "",
    brokerContactName: "",
    brokerPhone: "",
    brokerEmail: "",
    effectiveMonth: String(now.getMonth() + 1),
    effectiveYear: String(currentYear),
  });

  // The brokerage assigns a lead plus a service rep, sometimes a third. The flat
  // columns on the client still mirror the primary, but the card lists everyone.
  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["/api/clients", String(clientId), "broker-contacts"],
    queryFn: () =>
      fetch(`/api/clients/${clientId}/broker-contacts`, { credentials: "include" })
        .then(r => r.ok ? r.json() : []),
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", String(clientId), "broker-history"],
    queryFn: () =>
      fetch(`/api/clients/${clientId}/broker-history`, { credentials: "include" })
        .then(r => r.ok ? r.json() : []),
    enabled: historyOpen,
  });

  const changeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/clients/${clientId}/broker-change`, {
        brokerFirmName: form.brokerFirmName,
        brokerContactName: form.brokerContactName,
        brokerPhone: form.brokerPhone,
        brokerEmail: form.brokerEmail,
        effectiveMonth: form.effectiveMonth,
        effectiveYear: form.effectiveYear,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "broker-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "broker-contacts"] });
      setChangeOpen(false);
      setForm(f => ({ ...f, brokerFirmName: "", brokerContactName: "", brokerPhone: "", brokerEmail: "" }));
      toast({ title: "Broker updated", description: "The broker has been changed and history recorded." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update broker", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.brokerFirmName.trim()) {
      toast({ title: "Validation error", description: "Broker firm name is required.", variant: "destructive" });
      return;
    }
    changeMutation.mutate();
  };

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3 pt-5 px-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-brand">Broker</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setHistoryOpen(true)}
                data-testid="button-broker-history"
              >
                <History className="w-3.5 h-3.5" /> History
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-xs bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={() => setChangeOpen(true)}
                data-testid="button-change-broker"
              >
                <UserPlus className="w-3.5 h-3.5" /> Change Broker
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{client.brokerFirmName}</p>
          </div>
          {contacts.length > 0 ? (
            <div className="pl-6 space-y-3" data-testid="list-broker-contacts">
              {contacts.map((bc: any) => (
                <div key={bc.id} data-testid={`broker-contact-${bc.id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-foreground">{bc.contactName}</p>
                    {bc.isPrimary && (
                      <span className="text-xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand/10 text-brand">
                        Primary
                      </span>
                    )}
                    {bc.role && <span className="text-xs text-muted-foreground">{bc.role}</span>}
                    {bc.terminationDate && (
                      <span className="text-xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted-foreground/15 text-muted-foreground">
                        Former
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-0.5">
                    {bc.phone && (
                      <a href={`tel:${bc.phone}`} className="flex items-center gap-1 text-xs text-brand-accent">
                        <Phone className="w-3 h-3" /> {bc.phone}
                      </a>
                    )}
                    {bc.email && (
                      <a href={`mailto:${bc.email}`} className="flex items-center gap-1 text-xs text-brand-accent">
                        <Mail className="w-3 h-3" /> {bc.email}
                      </a>
                    )}
                  </div>
                  {bc.notes && (
                    <p
                      className="mt-1 text-xs text-muted-foreground italic whitespace-pre-wrap"
                      data-testid={`broker-contact-notes-${bc.id}`}
                    >
                      {bc.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // No contact rows yet — fall back to the flat columns so a client whose
            // contacts have never been edited still shows whatever is on file.
            <>
              <p className="text-sm text-foreground pl-6">{client.brokerContactName}</p>
              <div className="flex flex-wrap gap-3 pl-6">
                {client.brokerPhone && (
                  <a href={`tel:${client.brokerPhone}`} className="flex items-center gap-1 text-xs text-brand-accent">
                    <Phone className="w-3 h-3" /> {client.brokerPhone}
                  </a>
                )}
                {client.brokerEmail && (
                  <a href={`mailto:${client.brokerEmail}`} className="flex items-center gap-1 text-xs text-brand-accent">
                    <Mail className="w-3 h-3" /> {client.brokerEmail}
                  </a>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Change Broker Dialog */}
      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-change-broker">
          <DialogHeader>
            <DialogTitle className="text-brand">Change Broker</DialogTitle>
          </DialogHeader>
          <div
            className="rounded-md border border-border bg-surface-subtle p-3 text-xs text-foreground space-y-1"
            data-testid="note-broker-replacement"
          >
            <p className="font-medium">This replaces the broker with a new one.</p>
            <p className="text-muted-foreground">
              Use this when the client is moving to a different broker or a different brokerage
              firm. The current broker is retired as of the effective date below and the change is
              recorded in the broker history.
            </p>
            <p className="text-muted-foreground">
              To correct the name, phone, address or contact of the broker they already have, use
              Edit Client instead. That is not a replacement and does not belong here.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="cb-firm">Broker Firm Name <span className="text-danger">*</span></Label>
              <BrokerFirmSelect
                id="cb-firm"
                value={form.brokerFirmName}
                onChange={v => setForm(f => ({ ...f, brokerFirmName: v }))}
                testId="input-broker-firm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cb-contact">Contact Name</Label>
              <Input
                id="cb-contact"
                value={form.brokerContactName}
                onChange={e => setForm(f => ({ ...f, brokerContactName: e.target.value }))}
                placeholder="e.g. Jane Smith"
                data-testid="input-broker-contact"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cb-phone">Phone</Label>
                <Input
                  id="cb-phone"
                  value={form.brokerPhone}
                  onChange={e => setForm(f => ({ ...f, brokerPhone: e.target.value }))}
                  placeholder="(555) 000-0000"
                  data-testid="input-broker-phone"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cb-email">Email</Label>
                <Input
                  id="cb-email"
                  type="email"
                  value={form.brokerEmail}
                  onChange={e => setForm(f => ({ ...f, brokerEmail: e.target.value }))}
                  placeholder="jane@firm.com"
                  data-testid="input-broker-email"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Effective Date (first of month) <span className="text-danger">*</span></Label>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  value={form.effectiveMonth}
                  onValueChange={v => setForm(f => ({ ...f, effectiveMonth: v }))}
                >
                  <SelectTrigger data-testid="select-broker-month">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={form.effectiveYear}
                  onValueChange={v => setForm(f => ({ ...f, effectiveYear: v }))}
                >
                  <SelectTrigger data-testid="select-broker-year">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Effective {MONTHS[parseInt(form.effectiveMonth) - 1]} 1, {form.effectiveYear}. The current broker's termination date will be set to the last day of the prior month.
              </p>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setChangeOpen(false)} data-testid="button-cancel-broker-change">
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-brand text-brand-foreground"
                disabled={changeMutation.isPending}
                data-testid="button-confirm-broker-change"
              >
                {changeMutation.isPending ? "Saving…" : "Save Change"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Broker History Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-broker-history">
          <DialogHeader>
            <DialogTitle className="text-brand">Broker History</DialogTitle>
          </DialogHeader>
          <div className="pt-1">
            {historyLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-10">
                <History className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No broker history recorded yet.</p>
                <p className="text-xs text-muted-foreground mt-1">History is created when you use "Change Broker".</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Broker Firm</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Effective</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Terminated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row: any) => {
                      const isCurrent = !row.terminationDate;
                      return (
                        <tr key={row.id} className={`border-b border-border ${isCurrent ? "bg-surface-subtle" : ""}`} data-testid={`broker-history-row-${row.id}`}>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              {isCurrent && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-success/10 text-success font-semibold">Current</span>
                              )}
                              <span className="font-medium text-foreground">{row.brokerFirmName || "—"}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <p className="text-foreground">{row.brokerContactName || "—"}</p>
                            {row.brokerEmail && (
                              <p className="text-xs text-muted-foreground">{row.brokerEmail}</p>
                            )}
                          </td>
                          <td className="py-3 px-3 text-foreground whitespace-nowrap">
                            {formatEffectiveMonth(row.effectiveDate)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {isCurrent ? (
                              <span className="text-success font-medium">Current</span>
                            ) : (
                              <span className="text-muted-foreground">{formatBrokerDate(row.terminationDate, false)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)} data-testid="button-close-history">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfoRow({ label, value, children }: { label: string; value?: any; children?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-sm text-muted-foreground flex-shrink-0">{label}</span>
      {children || <span className="text-sm text-foreground text-right">{value}</span>}
    </div>
  );
}
