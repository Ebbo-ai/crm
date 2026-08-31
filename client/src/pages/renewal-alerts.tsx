import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ArrowRight } from "lucide-react";
import {
  getProposalDueDate,
  RENEWAL_TIMING_WARNING_LABELS, RENEWAL_TIMING_WARNING_COLORS,
  RENEWAL_PIPELINE_STEP_LABELS, RENEWAL_PIPELINE_STEP_COLORS,
  type RenewalPipelineStep, type RenewalTimingWarning,
} from "@/lib/renewal";

// Entries with no timing warning are surfaced because a prior plan year was
// never completed. Without its own group they'd count toward the alert total
// but render nowhere.
type AlertGroupKey = RenewalTimingWarning | "INCOMPLETE_PRIOR";

const WARNING_GROUP_TITLES: Record<AlertGroupKey, { title: string; subtitle: string; headerBg: string; headerText: string }> = {
  OVERDUE: {
    title: "Overdue",
    subtitle: "Anniversary has passed and renewal is not yet complete",
    headerBg: "bg-danger-tint border-danger/40",
    headerText: "text-danger-strong",
  },
  PROPOSAL_DUE: {
    title: "Proposal past due",
    subtitle: "Due date passed — proposal not yet sent",
    headerBg: "bg-warning-tint border-warning/40",
    headerText: "text-warning-strong",
  },
  LATE_RESPONSE: {
    title: "No response in 14+ days",
    subtitle: "Proposal sent but client has not responded",
    headerBg: "bg-warning-tint border-warning/40",
    headerText: "text-warning-strong",
  },
  INCOMPLETE_PRIOR: {
    title: "Prior year never completed",
    subtitle: "A new renewal opened while the previous plan year was still unfinished",
    headerBg: "bg-muted border-border",
    headerText: "text-muted-foreground",
  },
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function RenewalAlertsPage() {
  const { data: alerts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/renewal-alerts"],
    queryFn: () => fetch("/api/renewal-alerts", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60_000,
  });

  // Group by timing warning. Entries carry { client, renewal, timingWarning }.
  const groups: Record<AlertGroupKey, any[]> = {
    OVERDUE: alerts.filter(a => a.timingWarning === "OVERDUE"),
    PROPOSAL_DUE: alerts.filter(a => a.timingWarning === "PROPOSAL_DUE"),
    LATE_RESPONSE: alerts.filter(a => a.timingWarning === "LATE_RESPONSE"),
    INCOMPLETE_PRIOR: alerts.filter(a => !a.timingWarning),
  };

  const warningOrder: AlertGroupKey[] = ["OVERDUE", "PROPOSAL_DUE", "LATE_RESPONSE", "INCOMPLETE_PRIOR"];
  const totalAlerts = alerts.length;

  return (
    <div data-testid="renewal-alerts-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand">Renewal Alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clients whose renewal timing is off-track — internal view only
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      ) : totalAlerts === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" />
            <h3 className="text-lg font-medium text-foreground">All caught up</h3>
            <p className="text-sm text-muted-foreground mt-1">
              No renewal timing issues right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {warningOrder.map(w => {
            const clients = groups[w];
            if (!clients.length) return null;
            const cfg = WARNING_GROUP_TITLES[w];
            return (
              <div key={w}>
                <div className={`rounded-t-lg border px-5 py-3 ${cfg.headerBg}`}>
                  <h2 className={`text-sm font-bold ${cfg.headerText}`}>{cfg.title}</h2>
                  <p className={`text-xs mt-0.5 opacity-75 ${cfg.headerText}`}>{cfg.subtitle}</p>
                </div>
                <div className="border border-t-0 rounded-b-lg divide-y divide-gray-100 overflow-hidden">
                  {clients.map((item: any) => {
                    const client = item.client;
                    const renewal = item.renewal;
                    const step = (renewal?.pipelineStep ?? null) as RenewalPipelineStep | null;
                    const proposalDue = getProposalDueDate(client, renewal?.planYear);
                    return (
                      <Link key={client.id} href={`/clients/${client.id}`}>
                        <div
                          className="flex items-center justify-between px-5 py-4 bg-card hover:bg-surface-subtle transition-colors cursor-pointer group"
                          data-testid={`alert-client-${client.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {client.clientCode && (
                                <span className="text-xs text-brand-accent font-semibold">{client.clientCode}</span>
                              )}
                              <span className="text-sm font-semibold text-foreground">{client.clientName}</span>
                              {renewal?.planYear && (
                                <span className="text-xs text-muted-foreground">PY {renewal.planYear}</span>
                              )}
                              {/* Pipeline step badge */}
                              {step ? (
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${RENEWAL_PIPELINE_STEP_COLORS[step]}`}>
                                  {RENEWAL_PIPELINE_STEP_LABELS[step]}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Not started</span>
                              )}
                              {renewal?.incompletePriorFlag && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-danger-tint text-danger-strong">
                                  ⚠ Prior year never completed
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                              {client.anniversaryDate && (
                                <span>Anniversary: {fmtDate(client.anniversaryDate)}</span>
                              )}
                              {proposalDue && (
                                <span>Proposal due: {fmtDate(proposalDue.toISOString())}</span>
                              )}
                              {renewal?.proposalSentDate && (
                                <span>
                                  Sent: {fmtDate(renewal.proposalSentDate)}
                                  {renewal.proposalVersion ? ` (${renewal.proposalVersion})` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3 group-hover:text-brand transition-colors" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
