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

const WARNING_GROUP_TITLES: Record<RenewalTimingWarning, { title: string; subtitle: string; headerBg: string; headerText: string }> = {
  OVERDUE: {
    title: "Overdue",
    subtitle: "Anniversary has passed and renewal is not yet complete",
    headerBg: "bg-red-50 border-red-200",
    headerText: "text-red-700",
  },
  PROPOSAL_DUE: {
    title: "Proposal past due",
    subtitle: "Due date passed — proposal not yet sent",
    headerBg: "bg-amber-50 border-amber-200",
    headerText: "text-amber-700",
  },
  LATE_RESPONSE: {
    title: "No response in 14+ days",
    subtitle: "Proposal sent but client has not responded",
    headerBg: "bg-orange-50 border-orange-200",
    headerText: "text-orange-700",
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

  // Group by timing warning
  const groups: Record<RenewalTimingWarning, any[]> = {
    OVERDUE: alerts.filter(c => c.timingWarning === "OVERDUE"),
    PROPOSAL_DUE: alerts.filter(c => c.timingWarning === "PROPOSAL_DUE"),
    LATE_RESPONSE: alerts.filter(c => c.timingWarning === "LATE_RESPONSE"),
  };

  const warningOrder: RenewalTimingWarning[] = ["OVERDUE", "PROPOSAL_DUE", "LATE_RESPONSE"];
  const totalAlerts = alerts.length;

  return (
    <div data-testid="renewal-alerts-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5276]">Renewal Alerts</h1>
        <p className="text-sm text-[#94A3B8] mt-1">
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
            <CheckCircle2 className="w-12 h-12 text-[#22C55E] mx-auto mb-3" />
            <h3 className="text-lg font-medium text-[#2C3E50]">All caught up</h3>
            <p className="text-sm text-[#94A3B8] mt-1">
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
                  {clients.map((client: any) => {
                    const step = client.renewalPipelineStep as RenewalPipelineStep | null;
                    const proposalDue = getProposalDueDate(client);
                    return (
                      <Link key={client.id} href={`/clients/${client.id}`}>
                        <div
                          className="flex items-center justify-between px-5 py-4 bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer group"
                          data-testid={`alert-client-${client.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {client.clientCode && (
                                <span className="text-[10px] text-[#2E86C1] font-semibold">{client.clientCode}</span>
                              )}
                              <span className="text-sm font-semibold text-[#2C3E50]">{client.clientName}</span>
                              {/* Pipeline step badge */}
                              {step ? (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${RENEWAL_PIPELINE_STEP_COLORS[step]}`}>
                                  {RENEWAL_PIPELINE_STEP_LABELS[step]}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#94A3B8] italic">Not started</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[#94A3B8]">
                              {client.anniversaryDate && (
                                <span>Anniversary: {fmtDate(client.anniversaryDate)}</span>
                              )}
                              {proposalDue && (
                                <span>Proposal due: {fmtDate(proposalDue.toISOString())}</span>
                              )}
                              {client.proposalSentDate && (
                                <span>
                                  Sent: {fmtDate(client.proposalSentDate)}
                                  {client.proposalVersion ? ` (${client.proposalVersion})` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-[#94A3B8] flex-shrink-0 ml-3 group-hover:text-[#1A5276] transition-colors" />
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
