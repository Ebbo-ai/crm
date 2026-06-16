import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Users, UserCheck, UserX, AlertCircle, CalendarClock, Clock, CheckCircle2, Bell, Upload, FileText, TrendingUp, TrendingDown, Minus, BarChart2 } from "lucide-react";
import { format, formatDistanceToNow, isPast, isToday } from "date-fns";
import { MONTHS } from "@/lib/constants";

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

function followUpStatus(followUpAt: string | null): "overdue" | "today" | "upcoming" | "none" {
  if (!followUpAt) return "none";
  const d = new Date(followUpAt);
  if (isPast(d)) return "overdue";
  if (isToday(d)) return "today";
  return "upcoming";
}

function LossRatioCell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-[#94A3B8]">—</span>;
  const pct = parseFloat(value);
  const color = pct >= 100 ? "text-[#EF4444]" : pct >= 85 ? "text-[#F5A623]" : "text-[#22C55E]";
  const Icon = pct >= 100 ? TrendingUp : pct >= 85 ? Minus : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-sm ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {pct.toFixed(1)}%
    </span>
  );
}

function SurplusCell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-[#94A3B8]">—</span>;
  const amt = parseFloat(value);
  const color = amt >= 0 ? "text-[#22C55E]" : "text-[#EF4444]";
  return (
    <span className={`font-medium text-sm ${color}`}>
      {amt >= 0 ? "+" : ""}${Math.abs(amt).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
    </span>
  );
}

function BatchImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<any>(null);

  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/ppr/batch-import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/ppr-metrics/summary"] });
      toast({ title: `Import complete: ${data.imported} client${data.imported !== 1 ? "s" : ""} updated` });
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const handleClose = () => {
    onClose();
    setFile(null);
    setResults(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Import Monthly PPRs</DialogTitle>
        </DialogHeader>
        {results ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-[#22C55E]/10 rounded-lg">
                <p className="text-2xl font-bold text-[#22C55E]">{results.imported}</p>
                <p className="text-xs text-[#94A3B8]">Imported</p>
              </div>
              <div className="p-3 bg-[#F5A623]/10 rounded-lg">
                <p className="text-2xl font-bold text-[#F5A623]">{results.skipped}</p>
                <p className="text-xs text-[#94A3B8]">Skipped</p>
              </div>
              <div className="p-3 bg-[#EF4444]/10 rounded-lg">
                <p className="text-2xl font-bold text-[#EF4444]">{results.errors}</p>
                <p className="text-xs text-[#94A3B8]">Errors</p>
              </div>
            </div>
            {results.results?.filter((r: any) => r.status !== "imported").length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {results.results.filter((r: any) => r.status !== "imported").map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-[#F0F4F8] rounded text-xs">
                    <span className={`font-medium ${r.status === "error" ? "text-[#EF4444]" : "text-[#F5A623]"}`}>
                      {r.status === "error" ? "Error" : "Skipped"}
                    </span>
                    <span className="text-[#94A3B8] truncate">{r.file}: {r.error}</span>
                  </div>
                ))}
              </div>
            )}
            <Button onClick={handleClose} className="w-full bg-[#1A5276] text-white">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[#94A3B8]">
              Upload the monthly ZIP file containing all client PPR Excel files. The app will automatically extract loss ratios and surplus/deficit figures for each client.
            </p>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-300 hover:border-[#1A5276]"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0] || null); }}
              data-testid="ppr-zip-dropzone"
            >
              <input ref={fileRef} type="file" className="hidden" accept=".zip" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <div>
                  <FileText className="w-10 h-10 text-[#2E86C1] mx-auto mb-2" />
                  <p className="text-sm font-semibold text-[#2C3E50]">{file.name}</p>
                  <p className="text-xs text-[#94A3B8] mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-10 h-10 text-[#94A3B8] mx-auto mb-2" />
                  <p className="text-sm font-medium text-[#94A3B8]">Drag & drop the monthly ZIP file</p>
                  <p className="text-xs text-[#94A3B8] mt-1">or click to browse — .zip files only</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (!file) return;
                  const fd = new FormData();
                  fd.append("file", file);
                  mutation.mutate(fd);
                }}
                disabled={!file || mutation.isPending}
                className="bg-[#1A5276] text-white flex-1"
                data-testid="button-run-import"
              >
                {mutation.isPending ? "Importing..." : "Import PPRs"}
              </Button>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const [showImport, setShowImport] = useState(false);
  const { data: stats, isLoading: statsLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: issueClients, isLoading: issueClientsLoading } = useQuery<any[]>({ queryKey: ["/api/dashboard/issues"] });
  const { data: expiringPlans } = useQuery<any[]>({ queryKey: ["/api/dashboard/expiring-plans"] });
  const { data: activity } = useQuery<any[]>({ queryKey: ["/api/dashboard/activity"] });
  const { data: pprSummary = [] } = useQuery<any[]>({ queryKey: ["/api/ppr-metrics/summary"], staleTime: 0 });
  const { data: activeIssues } = useQuery<any[]>({
    queryKey: ["/api/issues", "ACTIVE"],
    queryFn: () => fetch("/api/issues?status=ACTIVE", { credentials: "include" }).then(r => r.json()),
  });

  const overdueFollowUps = (activeIssues ?? []).filter(i => followUpStatus(i.followUpAt) === "overdue");
  const todayFollowUps  = (activeIssues ?? []).filter(i => followUpStatus(i.followUpAt) === "today");
  const alertFollowUps  = [...overdueFollowUps, ...todayFollowUps];

  // At-risk clients: loss ratio >= 85%
  const atRisk = pprSummary.filter((m: any) => parseFloat(m.ytdLossRatio ?? "0") >= 85);

  return (
    <div data-testid="dashboard-page">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A5276]" data-testid="text-page-title">Dashboard</h1>
          <p className="text-sm text-[#94A3B8] mt-1">Overview of your benefits management operations</p>
        </div>
        <Button onClick={() => setShowImport(true)} className="bg-[#1A5276] text-white gap-2 flex-shrink-0" data-testid="button-import-pprs">
          <BarChart2 className="w-4 h-4" /> Import Monthly PPRs
        </Button>
      </div>

      {alertFollowUps.length > 0 && (
        <div className="mb-5 p-4 rounded-lg border border-red-200 bg-red-50 flex items-start gap-3" data-testid="dashboard-followup-alert">
          <Bell className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700">
              {alertFollowUps.length} issue follow-up{alertFollowUps.length !== 1 ? "s" : ""} require attention
            </p>
            <div className="mt-1.5 space-y-1">
              {alertFollowUps.map(i => {
                const status = followUpStatus(i.followUpAt);
                return (
                  <Link key={i.id} href="/issues">
                    <div className="flex items-center gap-2 text-xs hover:underline cursor-pointer">
                      <span className={`font-medium ${status === "overdue" ? "text-red-700" : "text-amber-700"}`}>
                        {i.clientName}
                      </span>
                      <span className="text-[#94A3B8]">—</span>
                      <span className={status === "overdue" ? "text-red-600" : "text-amber-700"}>
                        {i.title}
                      </span>
                      <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        status === "overdue"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {status === "overdue"
                          ? `Overdue ${formatDistanceToNow(new Date(i.followUpAt), { addSuffix: true })}`
                          : "Due today"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
            <Link href="/issues">
              <span className="text-xs text-red-600 hover:underline font-medium mt-1.5 inline-block">
                View all issues →
              </span>
            </Link>
          </div>
        </div>
      )}

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

      {/* PPR Performance Panel */}
      {pprSummary.length > 0 && (
        <Card className="border-0 shadow-sm mb-6">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#1A5276]">Plan Performance</h2>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  {pprSummary[0] && `Latest data: ${MONTHS[(pprSummary[0].reportMonth ?? 1) - 1]} ${pprSummary[0].reportYear}`}
                  {atRisk.length > 0 && (
                    <span className="ml-3 text-[#EF4444] font-medium">{atRisk.length} at-risk client{atRisk.length !== 1 ? "s" : ""} (LR ≥ 85%)</span>
                  )}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="ppr-summary-table">
                <thead>
                  <tr className="bg-[#1A5276] text-white">
                    <th className="px-3 py-2.5 text-left text-xs font-medium">Client</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium hidden sm:table-cell">Plan</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium">Monthly LR</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium">YTD LR</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium">Surplus / Deficit</th>
                  </tr>
                </thead>
                <tbody>
                  {pprSummary.slice(0, 15).map((m: any, i: number) => (
                    <Link key={m.id} href={`/clients/${m.clientId}`}>
                      <tr
                        className={`border-b hover:bg-[#F0F4F8] cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-[#F0F4F8]/40"} ${parseFloat(m.ytdLossRatio ?? "0") >= 100 ? "border-l-2 border-[#EF4444]" : ""}`}
                        data-testid={`ppr-summary-row-${m.clientId}`}
                      >
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-[#2C3E50] text-sm">{m.clientName}</p>
                          <p className="text-[10px] text-[#94A3B8]">{m.clientCode}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[#94A3B8] hidden sm:table-cell">{m.planName ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right"><LossRatioCell value={m.monthlyLossRatio} /></td>
                        <td className="px-3 py-2.5 text-right"><LossRatioCell value={m.ytdLossRatio} /></td>
                        <td className="px-3 py-2.5 text-right"><SurplusCell value={m.ytdSurplusDeficit} /></td>
                      </tr>
                    </Link>
                  ))}
                </tbody>
              </table>
            </div>
            {pprSummary.length > 15 && (
              <p className="text-xs text-[#94A3B8] text-center mt-3">
                Showing top 15 of {pprSummary.length} clients by loss ratio
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1A5276]">Clients Needing Attention</h2>
              {issueClients && issueClients.length > 0 && (
                <Link href="/issues">
                  <span className="text-xs text-[#2E86C1] hover:underline">View all issues →</span>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {issueClientsLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
            ) : !issueClients?.length ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
                <p className="text-sm text-[#94A3B8]">All clear — no active issues</p>
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

      <BatchImportDialog open={showImport} onClose={() => setShowImport(false)} />
    </div>
  );
}
