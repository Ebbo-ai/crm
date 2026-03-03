import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, UserX, AlertCircle, CalendarClock, Clock, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

function StatCard({ label, value, icon: Icon, color, alert }: { label: string; value: number | string; icon: any; color: string; alert?: boolean }) {
  return (
    <Card className="border-0 shadow-sm" data-testid={`stat-card-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[#94A3B8] font-medium">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${alert ? "text-[#EF4444]" : "text-[#2C3E50]"}`}>
              {value}
            </p>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: issueClients, isLoading: issueClientsLoading } = useQuery<any[]>({ queryKey: ["/api/dashboard/issues"] });
  const { data: expiringPlans } = useQuery<any[]>({ queryKey: ["/api/dashboard/expiring-plans"] });
  const { data: activity } = useQuery<any[]>({ queryKey: ["/api/dashboard/activity"] });

  return (
    <div data-testid="dashboard-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5276]" data-testid="text-page-title">Dashboard</h1>
        <p className="text-sm text-[#94A3B8] mt-1">Overview of your benefits management operations</p>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="border-0"><CardContent className="p-5"><Skeleton className="h-16" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard label="Total Clients" value={stats?.totalClients ?? 0} icon={Users} color="bg-[#1A5276]" />
          <StatCard label="Active Clients" value={stats?.activeClients ?? 0} icon={UserCheck} color="bg-[#22C55E]" />
          <StatCard label="Terminated" value={stats?.terminatedClients ?? 0} icon={UserX} color="bg-[#94A3B8]" />
          <StatCard label="Active Issues" value={stats?.activeIssues ?? 0} icon={AlertCircle} color="bg-[#EF4444]" alert={(stats?.activeIssues ?? 0) > 0} />
          <StatCard label="Expiring Plans" value={stats?.expiringPlans ?? 0} icon={CalendarClock} color="bg-[#F5A623]" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <h2 className="text-lg font-semibold text-[#1A5276]">Clients Needing Attention</h2>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {issueClientsLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
            ) : !issueClients?.length ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
                <p className="text-sm text-[#94A3B8]">All clear -- no active issues</p>
              </div>
            ) : (
              <div className="space-y-2">
                {issueClients.map((client: any) => (
                  <Link key={client.id} href={`/clients/${client.id}`}>
                    <div className="flex items-center gap-3 p-3 rounded-md hover:bg-[#F0F4F8] transition-colors cursor-pointer" data-testid={`attention-client-${client.id}`}>
                      <div className="pulse-dot flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#2C3E50] truncate">{client.clientName}</p>
                        {client.mostRecentIssue && (
                          <p className="text-xs text-[#94A3B8] truncate mt-0.5">{client.mostRecentIssue.title}</p>
                        )}
                      </div>
                      <span className="text-xs font-bold text-white bg-[#EF4444] rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">
                        {client.activeIssueCount}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <h2 className="text-lg font-semibold text-[#1A5276]">Recent Activity</h2>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {!activity?.length ? (
              <p className="text-sm text-[#94A3B8] text-center py-8">No recent activity</p>
            ) : (
              <div className="space-y-0">
                {activity.map((log: any, i: number) => (
                  <div key={log.id} className="flex gap-3 py-2.5" data-testid={`activity-${log.id}`}>
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-[#2E86C1] mt-1.5 flex-shrink-0" />
                      {i < activity.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" />}
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="text-sm text-[#2C3E50]">
                        <span className="font-medium">{log.userName}</span>{" "}
                        <span className="text-[#94A3B8]">{log.action}</span>{" "}
                        <span>{log.entity}</span>
                      </p>
                      {log.details && <p className="text-xs text-[#94A3B8] truncate mt-0.5">{log.details}</p>}
                      <p className="text-[10px] text-[#94A3B8] mt-0.5 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {expiringPlans && expiringPlans.length > 0 && (
        <Card className="border-0 shadow-sm mt-6">
          <CardHeader className="pb-3 pt-5 px-5">
            <h2 className="text-lg font-semibold text-[#1A5276]">Plans Expiring Soon</h2>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="space-y-2">
              {expiringPlans.map((plan: any) => (
                <div key={plan.id} className="flex items-center justify-between p-3 rounded-md bg-[#FFF7ED] border border-[#F5A623]/20" data-testid={`expiring-plan-${plan.id}`}>
                  <div>
                    <p className="text-sm font-medium text-[#2C3E50]">{plan.clientName} - {plan.planName}</p>
                    <p className="text-xs text-[#94A3B8] mt-0.5">
                      Effective: {format(new Date(plan.effectiveDate), "MMM d, yyyy")} |{" "}
                      <span className="text-[#F5A623] font-medium">{plan.daysUntilExpiration} days remaining</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
