import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, CheckCircle2, Calendar, ArrowRight } from "lucide-react";
import { getRenewalStatus, getProposalDueDate, isAwaitingTooLong, RENEWAL_STATUS_LABELS, RENEWAL_STATUS_COLORS } from "@/lib/renewal";

const STATUS_ICONS: Record<string, React.ReactNode> = {
  OVERDUE:             <AlertTriangle className="w-4 h-4 text-red-600" />,
  PROPOSAL_DUE:        <Clock className="w-4 h-4 text-amber-600" />,
  AWAITING_ACCEPTANCE: <Calendar className="w-4 h-4 text-blue-600" />,
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

  const overdue = alerts.filter(c => c.renewalStatus === "OVERDUE");
  const proposalDue = alerts.filter(c => c.renewalStatus === "PROPOSAL_DUE");
  const awaitingLong = alerts.filter(c => c.renewalStatus === "AWAITING_ACCEPTANCE");

  const totalAlerts = alerts.length;

  return (
    <div data-testid="renewal-alerts-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5276]">Renewal Alerts</h1>
        <p className="text-sm text-[#94A3B8] mt-1">
          Clients that need attention right now — internal use only
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
              No clients need renewal attention right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <AlertGroup
              title="Overdue"
              subtitle="Anniversary passed — acceptance not yet received"
              color="border-red-200 bg-red-50"
              headerColor="text-red-700"
              clients={overdue}
            />
          )}
          {proposalDue.length > 0 && (
            <AlertGroup
              title="Proposal due"
              subtitle="Due date has passed and nothing has been sent"
              color="border-amber-200 bg-amber-50"
              headerColor="text-amber-700"
              clients={proposalDue}
            />
          )}
          {awaitingLong.length > 0 && (
            <AlertGroup
              title="Awaiting acceptance"
              subtitle="Proposal sent more than 14 days ago — no response yet"
              color="border-blue-200 bg-blue-50"
              headerColor="text-blue-700"
              clients={awaitingLong}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AlertGroup({
  title, subtitle, color, headerColor, clients,
}: {
  title: string;
  subtitle: string;
  color: string;
  headerColor: string;
  clients: any[];
}) {
  return (
    <div>
      <div className={`rounded-t-lg border px-5 py-3 ${color}`}>
        <h2 className={`text-sm font-bold ${headerColor}`}>{title}</h2>
        <p className={`text-xs mt-0.5 opacity-75 ${headerColor}`}>{subtitle}</p>
      </div>
      <div className="border border-t-0 rounded-b-lg divide-y divide-gray-100 overflow-hidden">
        {clients.map((client: any) => {
          const proposalDueDate = getProposalDueDate(client);
          const anniversary = client.anniversaryDate ? new Date(client.anniversaryDate) : null;
          return (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <div className="flex items-center justify-between px-5 py-4 bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer group">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {client.clientCode && (
                      <span className="text-[10px] text-[#2E86C1] font-semibold">{client.clientCode}</span>
                    )}
                    <span className="text-sm font-semibold text-[#2C3E50]">{client.clientName}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-[#94A3B8]">
                    {anniversary && (
                      <span>Anniversary: {fmtDate(client.anniversaryDate)}</span>
                    )}
                    {proposalDueDate && (
                      <span>Proposal due: {fmtDate(proposalDueDate.toISOString())}</span>
                    )}
                    {client.proposalSentDate && (
                      <span>Proposal sent: {fmtDate(client.proposalSentDate)}{client.proposalVersion ? ` (${client.proposalVersion})` : ""}</span>
                    )}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#94A3B8] flex-shrink-0 group-hover:text-[#1A5276] transition-colors" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
