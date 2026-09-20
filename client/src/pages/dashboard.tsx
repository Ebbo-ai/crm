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
import { countsAsActive, deriveClientState } from "@shared/client-state";
import {
  Users, UserCheck, UserX, AlertCircle, CalendarClock, Search, CheckCircle2,
  Upload, FileText, TrendingUp, TrendingDown, Minus, BarChart2, RefreshCw,
  ChevronRight, Info, Plus, Building2, User
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { MONTHS } from "@/lib/constants";
import CommunicationFeed from "@/components/communication-feed";
import GmailTriageFeed from "@/components/gmail-triage-feed";
import TodoList from "@/components/todo-list";

const ISSUE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  FUNDING:      { label: "Funding",     color: "bg-info-tint text-brand-accent" },
  CLAIMS:       { label: "Claims",      color: "bg-purple-100 text-purple-700" },
  CALL_CENTER:  { label: "Call Center", color: "bg-warning-tint text-warning-strong" },
  REPORTING:    { label: "Reporting",   color: "bg-teal-100 text-teal-700" },
  OTHER:        { label: "Other",       color: "bg-muted text-muted-foreground" },
};

function IssueTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const cfg = ISSUE_TYPE_LABELS[type] ?? { label: type, color: "bg-muted text-muted-foreground" };
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
  );
}

function LossRatioCell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const pct = parseFloat(value);
  const color = pct >= 100 ? "text-danger" : pct >= 85 ? "text-warning-strong" : "text-success";
  const Icon = pct >= 100 ? TrendingUp : pct >= 85 ? Minus : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-sm ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {pct.toFixed(1)}%
    </span>
  );
}

function SurplusCell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const amt = parseFloat(value);
  const color = amt >= 0 ? "text-success" : "text-danger";
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
            <p className="text-sm text-muted-foreground font-medium">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${alert ? "text-danger" : "text-foreground"}`}>{value}</p>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
            <Icon className="w-5 h-5" />
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
          <DialogTitle className="text-brand">Import Monthly PPRs</DialogTitle>
        </DialogHeader>
        {results ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-success/10 rounded-lg">
                <p className="text-2xl font-bold text-success">{results.imported}</p>
                <p className="text-xs text-muted-foreground">Imported</p>
              </div>
              <div className="p-3 bg-gold/10 rounded-lg">
                <p className="text-2xl font-bold text-warning-strong">{results.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div className="p-3 bg-danger/10 rounded-lg">
                <p className="text-2xl font-bold text-danger">{results.errors}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
            {results.results?.filter((r: any) => r.status !== "imported").length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {results.results.filter((r: any) => r.status !== "imported").map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-surface-subtle rounded text-xs">
                    <span className={`font-medium ${r.status === "error" ? "text-danger" : "text-warning-strong"}`}>{r.status === "error" ? "Error" : "Skipped"}</span>
                    <span className="text-muted-foreground truncate">{r.file}: {r.error}</span>
                  </div>
                ))}
              </div>
            )}
            <Button onClick={handleClose} className="w-full bg-brand text-brand-foreground">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Upload the monthly ZIP file containing all client PPR Excel files. The app will automatically extract loss ratios and plan position figures.</p>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-brand bg-brand/5" : "border-border hover:border-brand"}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0] || null); }}
              data-testid="ppr-zip-dropzone"
            >
              <input ref={fileRef} type="file" className="hidden" accept=".zip" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <div>
                  <FileText className="w-10 h-10 text-brand-accent mx-auto mb-2" />
                  <p className="text-sm font-semibold text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium text-muted-foreground">Drag & drop the monthly ZIP file</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse — .zip files only</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => { if (!file) return; const fd = new FormData(); fd.append("file", file); mutation.mutate(fd); }} disabled={!file || mutation.isPending} className="bg-brand text-brand-foreground flex-1" data-testid="button-run-import">
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
      ? fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" }).then(r => r.ok ? r.json() : [])
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
      <div className={`flex items-center gap-3 bg-card rounded-2xl shadow-md border transition-all px-5 py-3.5 ${focused ? "border-brand-accent shadow-lg" : "border-border"}`}>
        <Search className={`w-5 h-5 flex-shrink-0 transition-colors ${focused ? "text-brand-accent" : "text-muted-foreground"}`} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search clients, brokers, contacts..."
          className="flex-1 outline-none text-base text-foreground placeholder:text-muted-foreground bg-transparent"
          data-testid="input-global-search"
        />
        {isFetching && <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />}
        {query && !isFetching && (
          <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground text-sm flex-shrink-0">✕</button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-card rounded-xl shadow-xl border border-border z-50 overflow-hidden">
          {results.length === 0 && !isFetching ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">No results for "{query}"</div>
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
                    <div className="px-4 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider bg-surface-subtle flex items-center gap-1.5 border-b border-border">
                      <Icon className="w-3 h-3" />{label}
                    </div>
                    {groups[key].map((client: any) => (
                      <button
                        key={client.id}
                        className="w-full text-left px-5 py-3 hover:bg-surface-subtle flex items-center gap-3 transition-colors border-b last:border-0 border-border"
                        onMouseDown={() => { setQuery(""); setLocation(`/clients/${client.id}`); }}
                        data-testid={`search-result-${client.id}`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
                          <span className="text-brand-foreground text-xs font-bold">{client.clientCode?.slice(0, 2)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{client.clientName}</p>
                          <p className="text-xs text-muted-foreground">{client.clientCode} · {client.planType?.replace(/_/g, " ")}</p>
                        </div>
                        {client.activeIssueCount > 0 && (
                          <span className="text-xs font-bold text-danger-foreground bg-danger rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                            {client.activeIssueCount}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
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

  // Terminating and run-out clients are still being serviced, so issues can still
  // be raised against them. Only genuinely closed accounts drop off the list.
  const activeClients = allClients.filter((c: any) => countsAsActive(deriveClientState(c)));

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
            <label className="text-xs font-semibold text-foreground mb-1 block">Client *</label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="select-issue-client"><SelectValue placeholder="Select client..." /></SelectTrigger>
              <SelectContent>{activeClients.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.clientName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground mb-1 block">Issue Type</label>
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
            <label className="text-xs font-semibold text-foreground mb-1 block">Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-accent"
              placeholder="Brief summary of the issue"
              data-testid="input-dash-issue-title"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-accent resize-none"
              placeholder="Additional details..."
              data-testid="input-dash-issue-description"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!clientId || !title.trim() || mutation.isPending}
              className="bg-brand text-brand-foreground"
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

interface RenewalBucketItem {
  renewalId: number;
  clientId: number;
  clientCode: string;
  clientName: string;
  anniversaryDate: string;
  pipelineStep: string | null;
  completedAt: string | null;
  daysOut: number;
  late: boolean;
}

interface RenewalBuckets {
  upcoming: RenewalBucketItem[];
  current: RenewalBucketItem[];
  complete: RenewalBucketItem[];
  lateCount: number;
}

function pipelineLabel(step: string | null) {
  return step ? step.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "Not started";
}

function daysOutLabel(daysOut: number) {
  if (daysOut < 0) return `${Math.abs(daysOut)} day${daysOut === -1 ? "" : "s"} overdue`;
  if (daysOut === 0) return "Anniversary today";
  return `${daysOut} day${daysOut === 1 ? "" : "s"} out`;
}

function RenewalBucketCard({
  title,
  items,
  loading,
  emptyMessage,
  lateCount,
}: {
  title: string;
  items: RenewalBucketItem[];
  loading: boolean;
  emptyMessage: string;
  lateCount?: number;
}) {
  return (
    <Card className="border border-border bg-card shadow-sm flex flex-col min-h-72">
      <CardHeader className="pb-3 pt-5 px-5 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-brand">{title}</h2>
          <div className="flex items-center gap-2">
            {lateCount !== undefined && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-danger-tint text-danger-strong">
                {lateCount} LATE
              </span>
            )}
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-foreground">
              {items.length}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 py-4 flex-1">
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>
        ) : items.length === 0 ? (
          <div className="min-h-44 flex flex-col items-center justify-center text-center">
            <CheckCircle2 className="w-9 h-9 text-success mb-2" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {items.map(item => (
              <Link key={item.clientId} href={`/clients/${item.clientId}`}>
                <div
                  className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-surface-subtle ${
                    item.late ? "border-danger bg-danger-tint" : "border-border bg-background"
                  }`}
                  data-testid={`renewal-bucket-row-${item.clientId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{item.clientName}</p>
                      <p className="text-xs text-muted-foreground">{item.clientCode}</p>
                    </div>
                    {item.late && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-danger-tint text-danger-strong border border-danger">
                        LATE
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground space-y-1">
                    <p>Anniversary: {format(new Date(item.anniversaryDate), "MMM d, yyyy")}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{pipelineLabel(item.pipelineStep)}</span>
                      <span className={item.daysOut < 0 ? "text-danger-strong font-semibold" : "text-muted-foreground"}>
                        {daysOutLabel(item.daysOut)}
                      </span>
                    </div>
                    {item.completedAt && (
                      <p className="text-success">Completed {format(new Date(item.completedAt), "MMM d, yyyy")}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const [showImport, setShowImport] = useState(false);
  const [showDashCreate, setShowDashCreate] = useState(false);
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: renewalBuckets, isLoading: renewalsLoading } = useQuery<RenewalBuckets>({
    queryKey: ["/api/dashboard/renewal-buckets"],
  });
  const { data: pprSummary = [] } = useQuery<any[]>({ queryKey: ["/api/ppr-metrics/summary"], staleTime: 0 });
  const { data: allIssues = [], isLoading: issuesLoading } = useQuery<any[]>({
    queryKey: ["/api/dashboard/issues"],
    queryFn: () => fetch("/api/dashboard/issues", { credentials: "include" }).then(r => r.json()),
  });

  const { data: stalledPipelines = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/stalled"],
    queryFn: () => fetch("/api/dashboard/stalled", { credentials: "include" }).then(r => r.json()),
  });

  const atRisk = pprSummary.filter((m: any) => parseFloat(m.ytdLossRatio ?? "0") >= 85);

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

  const upcomingRenewals = renewalBuckets?.upcoming ?? [];
  const currentRenewals = renewalBuckets?.current ?? [];
  const completeRenewals = renewalBuckets?.complete ?? [];
  const renewalsDueCount = upcomingRenewals.length + currentRenewals.length;

  return (
    <TooltipProvider>
      <div data-testid="dashboard-page">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand" data-testid="text-page-title">
              {greeting}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
          </div>
          <Button onClick={() => setShowImport(true)} className="bg-brand text-brand-foreground gap-2 flex-shrink-0" data-testid="button-import-pprs">
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
            <StatCard label="Total Clients"   value={stats?.totalClients ?? 0}      icon={Users}        color="bg-brand text-brand-foreground" />
            <StatCard label="Active Clients"  value={stats?.activeClients ?? 0}     icon={UserCheck}    color="bg-success text-success-foreground" />
            <StatCard label="Terminated"      value={stats?.terminatedClients ?? 0} icon={UserX}        color="bg-muted-foreground text-background" />
            <StatCard label="Active Issues"   value={activeOnly.length}             icon={AlertCircle}  color="bg-danger text-danger-foreground" alert={activeOnly.length > 0} />
            <StatCard label="Renewals Due"    value={renewalsDueCount} icon={CalendarClock} color="bg-gold text-gold-foreground" alert={(renewalBuckets?.lateCount ?? 0) > 0} />
          </div>
        )}

        {/* Triage: AI-flagged mail from the Gmail-native pipeline, per owner.
            This is the primary triage surface going forward — the legacy
            communications feed below it only ever shrinks from here since
            the Mailgun inbound webhook that fed it has been retired. */}
        <div className="mb-6">
          <GmailTriageFeed />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <CommunicationFeed />
          </div>
          <div>
            <TodoList />
          </div>
        </div>

        <section className="mb-6" aria-labelledby="renewals-heading">
          <h2 id="renewals-heading" className="text-lg font-semibold text-brand mb-3">Renewals</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <RenewalBucketCard
              title="Upcoming Renewals"
              items={upcomingRenewals}
              loading={renewalsLoading}
              emptyMessage="No renewals coming up in the next 30 days"
            />
            <RenewalBucketCard
              title="Current Renewals"
              items={currentRenewals}
              loading={renewalsLoading}
              emptyMessage="No renewals need action right now"
              lateCount={renewalBuckets?.lateCount ?? 0}
            />
            <RenewalBucketCard
              title="Complete Renewals"
              items={completeRenewals}
              loading={renewalsLoading}
              emptyMessage="No recently completed renewals"
            />
          </div>
        </section>

        {/* Operational panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          {/* Active Issues Panel */}
          <Card className="border-0 shadow-sm flex flex-col">
            <CardHeader className="pb-2 pt-5 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-brand">Issues</h2>
                  {activeOnly.length > 0 && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-danger-tint text-danger-strong">{activeOnly.length} active</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dashboardIssues.length > 0 && (
                    <Link href="/issues">
                      <span className="text-xs text-brand-accent hover:underline cursor-pointer">View all →</span>
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
                  <CheckCircle2 className="w-10 h-10 text-success mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No active issues</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {issuesSorted.slice(0, 8).map((issue: any) => {
                    const isResolved = issue.status === "RESOLVED";
                    const ageD = differenceInDays(new Date(), new Date(issue.createdAt));
                    const isOld = !isResolved && ageD > 7;
                    const borderColor = isResolved ? "border-l-success" : isOld ? "border-l-danger" : "border-l-gold";
                    return (
                      <Link key={issue.id} href={`/clients/${issue.clientId}`}>
                        <div
                          className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-surface-subtle border-l-2 ${borderColor}`}
                          data-testid={`dashboard-issue-${issue.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <p className="text-sm font-semibold text-foreground truncate">{issue.clientName}</p>
                              <IssueTypeBadge type={issue.issueType} />
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{issue.title}</p>
                            <p className="text-xs text-muted-foreground">Logged {format(new Date(issue.createdAt), "MMM d, yyyy")}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {isResolved ? (
                              <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-success-tint text-success-strong">Resolved</span>
                            ) : (
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isOld ? "bg-danger-tint text-danger-strong" : "bg-warning-tint text-warning-strong"}`}>
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
                      <p className="text-xs text-center text-brand-accent hover:underline pt-1 cursor-pointer">
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
                <h2 className="text-base font-semibold text-brand">High Loss Ratio</h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent><p>Clients with YTD loss ratio ≥ 85% (amber) or ≥ 100% (red)</p></TooltipContent>
                </Tooltip>
                {atRisk.length > 0 && (
                  <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-danger-tint text-danger-strong">{atRisk.length} at risk</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 flex-1">
              {atRisk.length === 0 ? (
                <div className="text-center py-10">
                  <TrendingDown className="w-10 h-10 text-success mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">All loss ratios below 85%</p>
                  {pprSummary.length === 0 && <p className="text-xs text-muted-foreground mt-1">No PPR data imported yet</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  {atRisk.map((m: any) => (
                    <Link key={m.id} href={`/clients/${m.clientId}?tab=ppr`}>
                      <div
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-surface-subtle border-l-2 ${parseFloat(m.ytdLossRatio) >= 100 ? "border-l-danger" : "border-l-gold"}`}
                        data-testid={`ppr-at-risk-${m.clientId}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{m.clientName}</p>
                          <p className="text-xs text-muted-foreground truncate">{m.planName ?? "—"}</p>
                          {m.reportMonth && m.reportYear && (
                            <p className="text-xs text-muted-foreground">{MONTHS[(m.reportMonth ?? 1) - 1]} {m.reportYear}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          {m.monthlyLossRatio && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">Mo:</span>
                              <LossRatioCell value={m.monthlyLossRatio} />
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">YTD:</span>
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

        {/* Stalled pipeline reminders */}
        {stalledPipelines.length > 0 && (
          <Card className="border-0 shadow-sm mb-6" data-testid="stalled-pipelines-card">
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-danger flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Stalled Pipelines
                </h2>
                <span className="text-xs text-muted-foreground">
                  {stalledPipelines.length} item{stalledPipelines.length !== 1 ? "s" : ""} stuck ≥14 days
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="stalled-pipelines-table">
                  <thead>
                    <tr className="bg-danger/10 text-danger">
                      <th className="px-3 py-2 text-left text-xs font-semibold">Client</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Stuck at Step</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Days Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stalledPipelines.map((item: any, i: number) => (
                        <tr
                          key={i}
                          onClick={() => setLocation(`/clients/${item.clientId}?tab=${item.type === "prospect" ? "pipeline" : "plans"}`)}
                          className={`border-b hover:bg-danger-tint cursor-pointer transition-colors ${i % 2 === 0 ? "bg-card" : "bg-danger-tint/40"}`}
                          data-testid={`stalled-row-${item.clientId}`}
                        >
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-foreground">{item.clientName}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.clientCode}{item.planName ? ` · ${item.planName}` : ""}
                            </p>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                              item.type === "prospect"
                                ? "bg-info-tint text-brand-accent"
                                : "bg-warning-tint text-warning-strong"
                            }`}>
                              {item.type === "prospect" ? "Prospect" : "Renewal"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-foreground">{item.step}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-sm font-bold text-danger">{item.daysOverdue}d</span>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Full PPR table if there's data — below 90% clients too */}
        {pprSummary.length > 0 && (
          <Card className="border-0 shadow-sm mb-6">
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-brand">Plan Performance — All Clients</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pprSummary[0] && `Latest data: ${MONTHS[(pprSummary[0].reportMonth ?? 1) - 1]} ${pprSummary[0].reportYear}`}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="ppr-summary-table">
                  <thead>
                    <tr className="bg-brand text-brand-foreground">
                      <th className="px-3 py-2.5 text-left text-xs font-medium">Client</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium hidden sm:table-cell">Plan</th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium">Monthly LR</th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium">YTD LR</th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium">Plan Position (as billed)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pprSummary.slice(0, 15).map((m: any, i: number) => (
                        <tr
                          key={m.id}
                          onClick={() => setLocation(`/clients/${m.clientId}?tab=ppr`)}
                          className={`border-b hover:bg-surface-subtle cursor-pointer transition-colors ${i % 2 === 0 ? "bg-card" : "bg-surface-subtle/40"} ${parseFloat(m.ytdLossRatio ?? "0") >= 100 ? "border-l-2 border-danger" : ""}`}
                          data-testid={`ppr-summary-row-${m.clientId}`}
                        >
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-foreground text-sm">{m.clientName}</p>
                            <p className="text-xs text-muted-foreground">{m.clientCode}</p>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">{m.planName ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right"><LossRatioCell value={m.monthlyLossRatio} /></td>
                          <td className="px-3 py-2.5 text-right"><LossRatioCell value={m.ytdLossRatio} /></td>
                          <td className="px-3 py-2.5 text-right"><SurplusCell value={m.ytdSurplusDeficit} /></td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pprSummary.length > 15 && (
                <p className="text-xs text-muted-foreground text-center mt-3">Showing top 15 of {pprSummary.length} clients by loss ratio</p>
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
