import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Mail, Link2, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck, ShieldX, DollarSign, PauseCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import StartupTasksCard from "@/components/startup-tasks-card";

interface MailAccountRow {
  syncEnabled: boolean;
  mailbox: string;
  displayName: string;
  status: "CONNECTED" | "NEEDS_REAUTH" | "NOT_CONNECTED";
  scopes: string[];
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
}

interface LlmUsageSummary {
  todaySpendUsd: number;
  ceilingUsd: number;
  paused: boolean;
  byMailbox: { mailbox: string; calls: number; costUsd: number }[];
  byCallType: { callType: string; calls: number; costUsd: number }[];
  totalCalls: number;
  totalCostUsd: number;
}

interface AllowlistDomain {
  id: number;
  domain: string;
  source: string;
  sourceLabel: string | null;
  approved: boolean | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

function StatusBadge({ status }: { status: MailAccountRow["status"] }) {
  if (status === "CONNECTED") {
    return <Badge className="bg-success-strong text-success-foreground gap-1"><CheckCircle2 className="w-3 h-3" /> Connected</Badge>;
  }
  if (status === "NEEDS_REAUTH") {
    return <Badge className="bg-danger-strong text-danger-foreground gap-1"><AlertTriangle className="w-3 h-3" /> Needs reauthorization</Badge>;
  }
  return <Badge variant="outline" className="gap-1 text-muted-foreground"><Link2 className="w-3 h-3" /> Not connected</Badge>;
}

export default function MailAccountsPage() {
  const { toast } = useToast();
  const [location] = useLocation();
  const [ceilingInput, setCeilingInput] = useState("");

  const accounts = useQuery<MailAccountRow[]>({ queryKey: ["/api/mail-accounts"] });
  const domains = useQuery<AllowlistDomain[]>({ queryKey: ["/api/mail-allowlist/domains"] });
  const usage = useQuery<LlmUsageSummary>({ queryKey: ["/api/llm-usage/summary"], refetchInterval: 30_000 });

  const updateCeiling = useMutation({
    mutationFn: async (ceilingUsd: number) => {
      const res = await apiRequest("PUT", "/api/llm-usage/ceiling", { ceilingUsd });
      return res.json() as Promise<LlmUsageSummary>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/llm-usage/summary"], data);
      setCeilingInput("");
      toast({ title: "Daily ceiling updated", description: `LLM enrichment now pauses at $${data.ceilingUsd.toFixed(2)}/day.` });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      toast({ title: "Mailbox connected", description: `${connected} is now authorized.` });
      queryClient.invalidateQueries({ queryKey: ["/api/mail-accounts"] });
      window.history.replaceState({}, "", "/settings/mail-accounts");
    } else if (error) {
      toast({ title: "Authorization failed", description: error, variant: "destructive" });
      window.history.replaceState({}, "", "/settings/mail-accounts");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmail-inbox/sync", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-accounts"] });
      toast({ title: "Sync started", description: "All connected mailboxes were synced." });
    },
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const refreshCandidates = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mail-allowlist/refresh", {});
      return res.json() as Promise<{ added: number; totalCandidates: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-allowlist/domains"] });
      toast({ title: "Allow-list refreshed", description: `${data.added} new domain(s) added for review.` });
    },
    onError: (err: any) => toast({ title: "Refresh failed", description: err.message, variant: "destructive" }),
  });

  const review = useMutation({
    mutationFn: async ({ id, approved }: { id: number; approved: boolean }) => {
      const res = await apiRequest("PATCH", `/api/mail-allowlist/domains/${id}`, { approved });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mail-allowlist/domains"] }),
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const pending = (domains.data || []).filter(d => d.approved === null);
  const reviewed = (domains.data || []).filter(d => d.approved !== null);

  return (
    <div data-testid="mail-accounts-page" className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand">Mail Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The CRM's own Gmail authorization for Kim, clientservice@, and Steve — each mailbox is connected
            separately and can be reconnected here if authorization expires or is revoked.
          </p>
        </div>
        <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()} data-testid="button-sync-all">
          <RefreshCw className={`w-4 h-4 mr-2 ${sync.isPending ? "animate-spin" : ""}`} />
          {sync.isPending ? "Syncing…" : "Sync all now"}
        </Button>
      </div>

      <div className="mb-6">
        <StartupTasksCard />
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-brand" />
            <h2 className="font-semibold text-brand">Mailboxes</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            (accounts.data || []).map((acct) => (
              <div key={acct.mailbox} className="flex items-center justify-between border border-border rounded-lg px-4 py-3" data-testid={`row-mailbox-${acct.mailbox}`}>
                <div>
                  <p className="text-xs font-medium">{acct.syncEnabled ? "Sync enabled" : "Sync disabled — Google connection retained for sending; stored mail is unchanged."}</p>
                  <p className="text-sm font-medium text-brand">{acct.displayName} <span className="text-muted-foreground font-normal">— {acct.mailbox}</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {acct.lastSyncAt ? `Last synced ${new Date(acct.lastSyncAt).toLocaleString()}` : "Never synced"}
                    {acct.lastSyncSummary ? ` — ${acct.lastSyncSummary}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={acct.status} />
                  {acct.status !== "CONNECTED" && (
                    <Button
                      size="sm"
                      className="bg-brand hover:bg-brand-dark"
                      onClick={() => { window.location.href = `/api/mail-accounts/${encodeURIComponent(acct.mailbox)}/connect`; }}
                      data-testid={`button-connect-${acct.mailbox}`}
                    >
                      {acct.status === "NEEDS_REAUTH" ? "Reconnect" : "Connect"}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-brand" />
              <h2 className="font-semibold text-brand">LLM usage & cost guard</h2>
            </div>
            {usage.data?.paused && (
              <Badge className="bg-danger-strong text-danger-foreground gap-1" data-testid="badge-enrichment-paused">
                <PauseCircle className="w-3 h-3" /> Enrichment paused today
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Every Claude call made by the Gmail sync (matching, classifying, action items, summaries) is logged with
            its real token usage. When today's estimated spend reaches the ceiling, matching/classifying/summarizing/task-extraction
            pause for the rest of the day — messages keep being ingested and stored, just without AI enrichment — until spend
            resets tomorrow or the ceiling is raised. Costs shown are estimates from published list pricing, not an actual invoice.
          </p>
        </CardHeader>
        <CardContent>
          {usage.isLoading ? (
            <Skeleton className="h-24" />
          ) : usage.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="border border-border rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground">Today's spend</p>
                  <p className="text-lg font-semibold text-brand" data-testid="text-today-spend">${usage.data.todaySpendUsd.toFixed(2)}</p>
                </div>
                <div className="border border-border rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground">Daily ceiling</p>
                  <p className="text-lg font-semibold text-brand" data-testid="text-ceiling">${usage.data.ceilingUsd.toFixed(2)}</p>
                </div>
                <div className="border border-border rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground">All-time (since guard installed)</p>
                  <p className="text-lg font-semibold text-brand" data-testid="text-total-spend">${usage.data.totalCostUsd.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">/ {usage.data.totalCalls} calls</span></p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  step="0.5"
                  placeholder={`New ceiling (currently $${usage.data.ceilingUsd.toFixed(2)})`}
                  value={ceilingInput}
                  onChange={(e) => setCeilingInput(e.target.value)}
                  className="max-w-xs"
                  data-testid="input-ceiling"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ceilingInput || updateCeiling.isPending}
                  onClick={() => updateCeiling.mutate(Number(ceilingInput))}
                  data-testid="button-update-ceiling"
                >
                  Update ceiling
                </Button>
              </div>

              {usage.data.byMailbox.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">By mailbox</p>
                  <div className="space-y-1.5">
                    {usage.data.byMailbox.map((m) => (
                      <div key={m.mailbox} className="flex items-center justify-between text-sm px-4 py-1.5 border border-border rounded-lg" data-testid={`row-usage-mailbox-${m.mailbox}`}>
                        <span className="text-foreground">{m.mailbox}</span>
                        <span className="text-muted-foreground">{m.calls} calls — ${m.costUsd.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {usage.data.byCallType.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">By call type</p>
                  <div className="space-y-1.5">
                    {usage.data.byCallType.map((c) => (
                      <div key={c.callType} className="flex items-center justify-between text-sm px-4 py-1.5 border border-border rounded-lg" data-testid={`row-usage-calltype-${c.callType}`}>
                        <span className="text-foreground">{c.callType}</span>
                        <span className="text-muted-foreground">{c.calls} calls — ${c.costUsd.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {usage.data.totalCalls === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-usage">
                  No LLM calls logged yet — this counter started tracking just now, so it does not include spend from before today.
                </p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-brand" />
              <h2 className="font-semibold text-brand">Steve's mailbox allow-list</h2>
            </div>
            <Button variant="outline" size="sm" disabled={refreshCandidates.isPending} onClick={() => refreshCandidates.mutate()} data-testid="button-refresh-allowlist">
              {refreshCandidates.isPending ? "Scanning…" : "Scan for new domains"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Only mail to/from a known business contact — an exact client, broker, or 90 Degree Benefits address, or an
            approved employer/broker domain below — is ever read out of Steve's mailbox. Everything else is skipped
            without storing anything about it. Review each domain below before it's used to admit mail.
          </p>
        </CardHeader>
        <CardContent>
          {domains.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              {pending.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Pending review ({pending.length})</p>
                  <div className="space-y-2">
                    {pending.map((d) => (
                      <div key={d.id} className="flex items-center justify-between border border-border rounded-lg px-4 py-2.5" data-testid={`row-domain-${d.domain}`}>
                        <div>
                          <p className="text-sm font-medium text-brand">{d.domain}</p>
                          <p className="text-xs text-muted-foreground">{d.source}{d.sourceLabel ? ` — ${d.sourceLabel}` : ""}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="text-danger-strong" onClick={() => review.mutate({ id: d.id, approved: false })} data-testid={`button-reject-${d.domain}`}>
                            <ShieldX className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                          <Button size="sm" className="bg-brand hover:bg-brand-dark" onClick={() => review.mutate({ id: d.id, approved: true })} data-testid={`button-approve-${d.domain}`}>
                            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {reviewed.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Reviewed ({reviewed.length})</p>
                  <div className="space-y-1.5">
                    {reviewed.map((d) => (
                      <div key={d.id} className="flex items-center justify-between text-sm px-4 py-1.5" data-testid={`row-reviewed-${d.domain}`}>
                        <span className="text-foreground">{d.domain}</span>
                        <Badge variant={d.approved ? "default" : "outline"} className={d.approved ? "bg-success-strong text-success-foreground" : "text-muted-foreground"}>
                          {d.approved ? "Approved" : "Rejected"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {pending.length === 0 && reviewed.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-domains">
                  No candidate domains yet — click "Scan for new domains" to generate a list from current clients, brokers, and vendor contacts.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
