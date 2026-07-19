import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  Users, UserCheck, UserX, AlertCircle, CalendarClock, Search, CheckCircle2,
  Upload, FileText, TrendingUp, TrendingDown, Minus, BarChart2, RefreshCw,
  ChevronRight, Info, Plus, Building2, User
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { MONTHS } from "@/lib/constants";

const ISSUE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  FUNDING:      { label: "Funding",     color: "bg-blue-100 text-blue-700" },
  CLAIMS:       { label: "Claims",      color: "bg-purple-100 text-purple-700" },
  CALL_CENTER:  { label: "Call Center", color: "bg-amber-100 text-amber-700" },
  REPORTING:    { label: "Reporting",   color: "bg-teal-100 text-teal-700" },
  OTHER:        { label: "Other",       color: "bg-gray-100 text-gray-600" },
};

function IssueTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const cfg = ISSUE_TYPE_LABELS[type] ?? { label: type, color: "bg-gray-100 text-gray-600" };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
  );
}

function LossRatioCell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-[#94A3B8]">—</span>;
  const pct = parseFloat(value);
  const color = pct >= 100 ? "text-[#EF4444]" : pct >= 90 ? "text-[#F5A623]" : "text-[#22C55E]";
  const Icon = pct >= 100 ? TrendingUp : pct >= 90 ? Minus : TrendingDown;
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

function StatCard({ label, value, icon: Icon, color, alert }: { label: string; value: number | string; icon: any; color: string; alert?: boolean }) {
  return (
    <Card className="border-0 shadow-sm" data-testid={`stat-card-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[#94A3B8] font-medium">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${alert ? "text-[#EF4444]" : "text-[#2C3E50]"}`}>{value}</p>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
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
      const res = await fetch("/api/ppr/batch-import", { method: "POST", body: formData, credentials: "include" });
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

  const handleClose = () => { onClose(); setFile(null); setResults(null); };

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
                    <span className={`font-medium ${r.status === "error" ? "text-[#EF4444]" : "text-[#F5A623]"}`}>{r.status === "error" ? "Error" : "Skipped"}</span>
                    <span className="text-[#94A3B8] truncate">{r.file}: {r.error}</span>
                  </div>
                ))}
              </div>
            )}
            <Button onClick={handleClose} className="w-full bg-[#1A5276] text-white">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[#94A3B8]">Upload the monthly ZIP file containing all client PPR Excel files. The app will automatically extract loss ratios and surplus/deficit figures.</p>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-300 hover:border-[#1A5276]"}`}
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
              <Button onClick={() => { if (!file) return; const fd = new FormData(); fd.append("file", file); mutation.mutate(fd); }} disabled={!file || mutation.isPending} className="bg-[#1A5276] text-white flex-1" data-testid="button-run-import">
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

function GlobalSearchBar() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results = [], isFetching } = useQuery<any[]>({
    queryKey: ["/api/search", debouncedQuery],
    queryFn: () => debouncedQuery.length >= 2
      ? fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" }).then(r => r.json())
      : Promise.resolve([]),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000,
  });

  const showDropdown = focused && query.length >= 2;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setQuery(""); inputRef.current?.blur(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="relative w-full max-w-2xl mx-auto" data-testid="global-search">
      <div className={`flex items-center gap-3 bg-white rounded-2xl shadow-md border transition-all px-5 py-3.5 ${focused ? "border-[#2E86C1] shadow-lg" : "border-gray-200"}`}>
        <Search className={`w-5 h-5 flex-shrink-0 transition-colors ${focused ? "text-[#2E86C1]" : "text-[#94A3B8]"}`} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search clients, brokers, contacts..."
          className="flex-1 outline-none text-base text-[#2C3E50] placeholder:text-[#94A3B8] bg-transparent"
          data-testid="input-global-search"
        />
        {isFetching && <RefreshCw className="w-4 h-4 text-[#94A3B8] animate-spin flex-shrink-0" />}
        {query && !isFetching && (
          <button onClick={() => setQuery("")} className="text-[#94A3B8] hover:text-[#2C3E50] text-sm flex-shrink-0">✕</button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          {results.length === 0 && !isFetching ? (
            <div className="px-5 py-4 text-sm text-[#94A3B8]">No results for "{query}"</div>
          ) : (() => {
            const groups: Record<string, any[]> = { client: [], broker: [], contact: [], plan: [] };
            results.forEach((r: any) => (groups[r.matchedOn] ??= []).push(r));
            const SECTIONS = [
              { key: "client",  label: "Clients",         Icon: Users },
              { key: "broker",  label: "Broker Matches",  Icon: Building2 },
              { key: "contact", label: "Contact Matches", Icon: User },
              { key: "plan",    label: "Plan Type",       Icon: FileText },
            ];
            return (
              <div>
                {SECTIONS.filter(s => (groups[s.key] ?? []).length > 0).map(({ key, label, Icon }) => (
                  <div key={key}>
                    <div className="px-4 py-1.5 text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider bg-[#F8FAFC] flex items-center gap-1.5 border-b border-gray-100">
                      <Icon className="w-3 h-3" />{label}
                    </div>
                    {groups[key].map((client: any) => (
                      <button
                        key={client.id}
                        className="w-full text-left px-5 py-3 hover:bg-[#F0F4F8] flex items-center gap-3 transition-colors border-b last:border-0 border-gray-100"
                        onMouseDown={() => { setQuery(""); setLocation(`/clients/${client.id}`); }}
                        data-testid={`search-result-${client.id}`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#1A5276] flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">{client.clientCode?.slice(0, 2)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#2C3E50] truncate">{client.clientName}</p>
                          <p className="text-xs text-[#94A3B8]">{client.clientCode} · {client.planType?.replace(/_/g, " ")}</p>
                        </div>
                        {client.activeIssueCount > 0 && (
                          <span className="text-xs font-bold text-white bg-[#EF4444] rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                            {client.activeIssueCount}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-[#94A3B8] flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function DashboardCreateIssueDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("");

  const { data: allClients = [] } = useQuery<any[]>({ queryKey: ["/api/clients"], enabled: open });

  const activeClients = allClients.filter((c: any) => c.isActive);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/clients/${clientId}/issues`, { title, description, issueType: issueType || null }),
    onSuccess: () => {
      toast({ title: "Issue created" });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/issues"] });
      setClientId(""); setTitle(""); setDescription(""); setIssueType("");
      onClose();
    },
    onError: () => toast({ title: "Failed to create issue", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-semibold text-[#2C3E50] mb-1 block">Client *</label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="select-issue-client"><SelectValue placeholder="Select client..." /></SelectTrigger>
              <SelectContent>{activeClients.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.clientName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#2C3E50] mb-1 block">Issue Type</label>
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger data-testid="select-issue-type-dash"><SelectValue placeholder="Select type..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FUNDING">Funding</SelectItem>
                <SelectItem value="CLAIMS">Claims</SelectItem>
                <SelectItem value="CALL_CENTER">Call Center</SelectItem>
                <SelectItem value="REPORTING">Reporting</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#2C3E50] mb-1 block">Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#2E86C1]"
              placeholder="Brief summary of the issue"
              data-testid="input-dash-issue-title"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#2C3E50] mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#2E86C1] resize-none"
              placeholder="Additional details..."
              data-testid="input-dash-issue-description"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!clientId || !title.trim() || mutation.isPending}
              className="bg-[#1A5276] text-white"
              data-testid="button-dash-create-issue"
            >
              {mutation.isPending ? "Creating..." : "Create Issue"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenewalStatusBadge({ status, daysUntilDue }: { status: string; daysUntilDue: number }) {
  if (status === "completed") return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Done</span>;
  if (status === "overdue") return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
      {Math.abs(daysUntilDue)}d overdue
    </span>
  );
  if (status === "due-soon") return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${daysUntilDue <= 14 ? "bg-orange-100 text-orange-700" : "bg-amber-100 text-amber-700"}`}>
      Due in {daysUntilDue}d
    </span>
  );
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">On track</span>;
}

export default function DashboardPage() {
  const [showImport, setShowImport] = useState(false);
  const [showDashCreate, setShowDashCreate] = useState(false);
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: renewals = [], isLoading: renewalsLoading } = useQuery<any[]>({ queryKey: ["/api/dashboard/renewals"] });
  const { data: pprSummary = [] } = useQuery<any[]>({ queryKey: ["/api/ppr-metrics/summary"], staleTime: 0 });
  const { data: allIssues = [], isLoading: issuesLoading } = useQuery<any[]>({
    queryKey: ["/api/dashboard/issues"],
    queryFn: () => fetch("/api/dashboard/issues", { credentials: "include" }).then(r => r.json()),
  });

  const atRisk = pprSummary.filter((m: any) => parseFloat(m.ytdLossRatio ?? "0") >= 90);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.fullName?.split(" ")[0] ?? "";

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const dashboardIssues = allIssues.filter(i =>
    i.status === "ACTIVE" ||
    (i.status === "RESOLVED" && i.resolvedAt && new Date(i.resolvedAt) >= thirtyDaysAgo)
  );
  const activeOnly = allIssues.filter(i => i.status === "ACTIVE");
  const issuesSorted = [...dashboardIssues].sort((a, b) => {
    if (a.status !== b.status) return a.status === "ACTIVE" ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const renewalsDueCount = renewals.filter(r => r.status === "overdue" || r.status === "due-soon").length;
  const displayRenewals = renewals;

  return (
    <TooltipProvider>
      <div data-testid="dashboard-page">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A5276]" data-testid="text-page-title">
              {greeting}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="text-sm text-[#94A3B8] mt-1">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
          </div>
          <Button onClick={() => setShowImport(true)} className="bg-[#1A5276] text-white gap-2 flex-shrink-0" data-testid="button-import-pprs">
            <BarChart2 className="w-4 h-4" /> Import Monthly PPRs
          </Button>
        </div>

        {/* Search bar */}
        <div className="mb-8">
          <GlobalSearchBar />
        </div>

        {/* Stats row */}
        {statsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
            {[...Array(5)].map((_, i) => (
              <Card key={i} className="border-0"><CardContent className="p-5"><Skeleton className="h-16" /></CardContent></Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
            <StatCard label="Total Clients"   value={stats?.totalClients ?? 0}      icon={Users}        color="bg-[#1A5276]" />
            <StatCard label="Active Clients"  value={stats?.activeClients ?? 0}     icon={UserCheck}    color="bg-[#22C55E]" />
            <StatCard label="Terminated"      value={stats?.terminatedClients ?? 0} icon={UserX}        color="bg-[#94A3B8]" />
            <StatCard label="Active Issues"   value={activeOnly.length}             icon={AlertCircle}  color="bg-[#EF4444]" alert={activeOnly.length > 0} />
            <StatCard label="Renewals Due"    value={renewalsDueCount}              icon={CalendarClock} color="bg-[#F5A623]" alert={renewals.some(r => r.status === "overdue")} />
          </div>
        )}

        {/* Three panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

          {/* Renewals Panel */}
          <Card className="border-0 shadow-sm flex flex-col">
            <CardHeader className="pb-2 pt-5 px-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#1A5276]">Renewals</h2>
                <span className="text-xs text-[#94A3B8]">{renewalsDueCount} due within 30d</span>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 flex-1">
              {renewalsLoading ? (
                <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
              ) : displayRenewals.length === 0 ? (
                <div className="text-center py-10">
                  <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
                  <p className="text-sm text-[#94A3B8]">No upcoming renewals</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {displayRenewals.map((r: any) => (
                    <Link key={r.id} href={`/clients/${r.clientId}`}>
                      <div
                        className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-[#F0F4F8] border-l-2 ${
                          r.status === "overdue" ? "border-l-[#EF4444]" : r.status === "completed" ? "border-l-[#22C55E]" : r.daysUntilDue <= 14 ? "border-l-[#F97316]" : "border-l-[#F5A623]"
                        }`}
                        data-testid={`renewal-row-${r.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#2C3E50] truncate">{r.clientName}</p>
                          <p className="text-xs text-[#94A3B8] truncate">{r.planName}</p>
                          <p className="text-xs text-[#94A3B8] mt-0.5">
                            Due {format(new Date(r.dueDate), "MMM d")} · Anniversary {format(new Date(r.renewalDate), "MMM d, yyyy")}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <RenewalStatusBadge status={r.status} daysUntilDue={r.daysUntilDue} />
                          {r.status === "completed" && (
                            <p className="text-[10px] text-[#94A3B8]">
                              {r.renewalCompletedDate ? format(new Date(r.renewalCompletedDate), "MMM d, yyyy") : ""}
                              {r.renewalCompletedBy ? ` · ${r.renewalCompletedBy}` : ""}
                            </p>
                          )}
                          {r.status !== "completed" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled
                                  className="h-6 text-[10px] px-2 py-0 opacity-50"
                                  data-testid={`button-process-renewal-${r.id}`}
                                  onClick={e => e.preventDefault()}
                                >
                                  Process Renewal
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Coming Soon</p></TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Issues Panel */}
          <Card className="border-0 shadow-sm flex flex-col">
            <CardHeader className="pb-2 pt-5 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-[#1A5276]">Issues</h2>
                  {activeOnly.length > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">{activeOnly.length} active</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dashboardIssues.length > 0 && (
                    <Link href="/issues">
                      <span className="text-xs text-[#2E86C1] hover:underline cursor-pointer">View all →</span>
                    </Link>
                  )}
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setShowDashCreate(true)} data-testid="button-new-issue-dash">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 flex-1">
              {issuesLoading ? (
                <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
              ) : issuesSorted.length === 0 ? (
                <div className="text-center py-10">
                  <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
                  <p className="text-sm text-[#94A3B8]">No active issues</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {issuesSorted.slice(0, 8).map((issue: any) => {
                    const isResolved = issue.status === "RESOLVED";
                    const ageD = differenceInDays(new Date(), new Date(issue.createdAt));
                    const isOld = !isResolved && ageD > 7;
                    const borderColor = isResolved ? "border-l-[#22C55E]" : isOld ? "border-l-[#EF4444]" : "border-l-[#F5A623]";
                    return (
                      <Link key={issue.id} href={`/clients/${issue.clientId}`}>
                        <div
                          className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-[#F0F4F8] border-l-2 ${borderColor}`}
                          data-testid={`dashboard-issue-${issue.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <p className="text-sm font-semibold text-[#2C3E50] truncate">{issue.clientName}</p>
                              <IssueTypeBadge type={issue.issueType} />
                            </div>
                            <p className="text-xs text-[#94A3B8] truncate">{issue.title}</p>
                            <p className="text-[10px] text-[#94A3B8]">Logged {format(new Date(issue.createdAt), "MMM d, yyyy")}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {isResolved ? (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Resolved</span>
                            ) : (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isOld ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                                {ageD === 0 ? "Today" : ageD === 1 ? "1d" : `${ageD}d`}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                  {issuesSorted.length > 8 && (
                    <Link href="/issues">
                      <p className="text-xs text-center text-[#2E86C1] hover:underline pt-1 cursor-pointer">
                        +{issuesSorted.length - 8} more →
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Plan Performance Panel */}
          <Card className="border-0 shadow-sm flex flex-col">
            <CardHeader className="pb-2 pt-5 px-5">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#1A5276]">High Loss Ratio</h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-[#94A3B8] cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent><p>Clients with YTD loss ratio ≥ 90%</p></TooltipContent>
                </Tooltip>
                {atRisk.length > 0 && (
                  <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{atRisk.length} at risk</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 flex-1">
              {atRisk.length === 0 ? (
                <div className="text-center py-10">
                  <TrendingDown className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
                  <p className="text-sm text-[#94A3B8]">All loss ratios below 90%</p>
                  {pprSummary.length === 0 && <p className="text-xs text-[#94A3B8] mt-1">No PPR data imported yet</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  {atRisk.map((m: any) => (
                    <Link key={m.id} href={`/clients/${m.clientId}`}>
                      <div
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-[#F0F4F8] border-l-2 ${parseFloat(m.ytdLossRatio) >= 100 ? "border-l-[#EF4444]" : "border-l-[#F5A623]"}`}
                        data-testid={`ppr-at-risk-${m.clientId}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#2C3E50] truncate">{m.clientName}</p>
                          <p className="text-xs text-[#94A3B8] truncate">{m.planName ?? "—"}</p>
                          {m.reportMonth && m.reportYear && (
                            <p className="text-[10px] text-[#94A3B8]">{MONTHS[(m.reportMonth ?? 1) - 1]} {m.reportYear}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          {m.monthlyLossRatio && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-[#94A3B8]">Mo:</span>
                              <LossRatioCell value={m.monthlyLossRatio} />
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-[#94A3B8]">YTD:</span>
                            <LossRatioCell value={m.ytdLossRatio} />
                          </div>
                          <SurplusCell value={m.ytdSurplusDeficit} />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Full PPR table if there's data — below 90% clients too */}
        {pprSummary.length > 0 && (
          <Card className="border-0 shadow-sm mb-6">
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[#1A5276]">Plan Performance — All Clients</h2>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    {pprSummary[0] && `Latest data: ${MONTHS[(pprSummary[0].reportMonth ?? 1) - 1]} ${pprSummary[0].reportYear}`}
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
                <p className="text-xs text-[#94A3B8] text-center mt-3">Showing top 15 of {pprSummary.length} clients by loss ratio</p>
              )}
            </CardContent>
          </Card>
        )}

        <BatchImportDialog open={showImport} onClose={() => setShowImport(false)} />
        <DashboardCreateIssueDialog open={showDashCreate} onClose={() => setShowDashCreate(false)} />
      </div>
    </TooltipProvider>
  );
}
