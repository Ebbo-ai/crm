import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Hourglass, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MailboxSyncStatus {
  mailbox: string;
  running: boolean;
  trigger: string | null;
  startedAt: string | null;
  scanned: number;
  newMessages: number;
  errors: number;
  lastRunAt: string | null;
  lastRunSummary: string | null;
}

/** "kim.anderson@simple.us" → "kim.anderson" — the mailbox is identifying enough without the domain repeated three times in a header. */
function shortMailbox(mailbox: string): string {
  return mailbox.split("@")[0];
}

function elapsed(startedAt: string | null): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Sync-now control for Kim and Steve, in the app header so it is on every
 * page rather than buried on the mail screen.
 *
 * It never starts a second run: the server claims a per-mailbox lock, so
 * pressing this while the five-minute poller (or a scheduled run) is working
 * reports that run and follows its progress instead of stacking another.
 */
export function MailSyncButton() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [justFinished, setJustFinished] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const { data: statuses } = useQuery<MailboxSyncStatus[]>({
    queryKey: ["/api/gmail-inbox/sync-status"],
    // Fast while something is in flight so the counters actually move; slow
    // when idle so an open tab is not polling the server all day.
    refetchInterval: (query) => ((query.state.data as MailboxSyncStatus[] | undefined)?.some((s) => s.running) ? 2500 : 60000),
  });

  const active = (statuses || []).find((s) => s.running);
  const running = Boolean(active);

  // A run that finishes while the user is looking gets an explicit finished
  // state — a spinner that simply disappears reads as "did anything happen?".
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    const totalNew = (statuses || []).reduce((sum, s) => sum + (s.newMessages || 0), 0);
    setJustFinished(totalNew > 0 ? `${totalNew} new` : "Up to date");
    queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/threads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/counts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/gmail-triage/feed"] });
    const timer = setTimeout(() => setJustFinished(null), 12000);
    return () => clearTimeout(timer);
  }, [running, statuses, queryClient]);

  const startSync = useMutation({
    mutationFn: () => apiRequest("POST", "/api/gmail-inbox/sync-now", {}),
    onSuccess: () => {
      setJustFinished(null);
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/sync-status"] });
    },
    onError: (err: any) => toast({ title: "Could not start the sync", description: err.message, variant: "destructive" }),
  });

  const triggerLabel = active?.trigger === "POLLER" ? "automatic sync" : active?.trigger === "SCHEDULED" ? "scheduled sync" : "sync";

  const label = running
    ? `${shortMailbox(active!.mailbox)} · ${active!.scanned} scanned, ${active!.newMessages} new`
    : justFinished
      ? justFinished
      : "Sync mail";

  const tooltip = running
    ? `Running ${triggerLabel} on ${active!.mailbox} — ${elapsed(active!.startedAt)} so far. Pressing this again will not start a second run.`
    : (statuses || []).find((s) => s.lastRunSummary)
      ? `Last run: ${(statuses || []).find((s) => s.lastRunSummary)!.lastRunSummary}`
      : "Check all connected mailboxes for new mail now.";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 h-8 px-3 text-xs"
          disabled={startSync.isPending || running}
          onClick={() => startSync.mutate()}
          data-testid="button-mail-sync"
          aria-live="polite"
        >
          {running ? (
            <Hourglass className="w-3.5 h-3.5 animate-pulse text-brand" aria-hidden="true" />
          ) : justFinished ? (
            <Check className="w-3.5 h-3.5 text-success" aria-hidden="true" />
          ) : (
            <RefreshCw className={`w-3.5 h-3.5 ${startSync.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
          )}
          <span className="max-w-[16rem] truncate" data-testid="text-mail-sync-state">{label}</span>
          {running && <span className="hidden sm:inline text-muted-foreground font-mono">{elapsed(active!.startedAt)}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
