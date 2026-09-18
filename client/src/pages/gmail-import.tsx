import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Inbox, Mail, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

interface GmailEstimate {
  mailbox: string;
  matchingThreadsEstimate: number;
  windowMonths: number;
}

interface GmailImportState {
  id: number;
  mailbox: string;
  backfillStartDate: string | null;
  lastProcessedInternalDate: string | null;
  lastRunAt: string | null;
  lastRunSummary: string | null;
}

interface GmailImportStatus {
  mailbox: string;
  state: GmailImportState | null;
}

interface GmailImportSummary {
  mailbox: string;
  messagesScanned: number;
  attachmentsDownloaded: number;
  attachmentsSkippedDuplicate: number;
  documentsFiled: number;
  fieldProposalsCreated: number;
  errors: string[];
}

export default function GmailImportPage() {
  const { toast } = useToast();

  const estimate = useQuery<GmailEstimate>({ queryKey: ["/api/gmail-import/estimate"] });
  const status = useQuery<GmailImportStatus>({ queryKey: ["/api/gmail-import/status"] });

  const run = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmail-import/run", {});
      return res.json() as Promise<GmailImportSummary>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-import/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals"] });
      toast({
        title: "Import complete",
        description: `${data.documentsFiled} document(s) filed, ${data.fieldProposalsCreated} field proposal(s) created${data.errors.length ? `, ${data.errors.length} error(s)` : ""}.`,
      });
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const state = status.data?.state;

  return (
    <div data-testid="gmail-import-page" className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand">Gmail Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pulls attachments straight out of Kim's mailbox onto the matching client's documents — no re-uploading by
          hand. Bounded to the trailing 12 months and 200 messages per run; safe to run again, it never re-downloads
          or re-files anything already on record.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-brand" />
            <h2 className="font-semibold text-brand">Mailbox</h2>
          </div>
        </CardHeader>
        <CardContent>
          {estimate.isLoading ? (
            <Skeleton className="h-16" />
          ) : estimate.isError ? (
            <div className="flex items-center gap-2 text-sm text-danger-strong">
              <AlertTriangle className="w-4 h-4" />
              Could not reach Gmail. {(estimate.error as any)?.message}
            </div>
          ) : (
            <div className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-medium text-brand" data-testid="text-mailbox">{estimate.data?.mailbox}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ~{estimate.data?.matchingThreadsEstimate} threads with attachments in the last{" "}
                  {estimate.data?.windowMonths} months
                </p>
              </div>
              <Button
                className="bg-brand hover:bg-brand-dark"
                disabled={run.isPending}
                onClick={() => run.mutate()}
                data-testid="button-run-import"
              >
                <Inbox className="w-4 h-4 mr-2" />
                {run.isPending ? "Importing…" : "Run import"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-brand" />
            <h2 className="font-semibold text-brand">Last run</h2>
          </div>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <Skeleton className="h-16" />
          ) : !state ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-runs">No import has run yet.</p>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-success-strong" />
                <p className="text-sm font-medium text-brand" data-testid="text-last-run-at">
                  {state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : "—"}
                </p>
              </div>
              <p className="text-sm text-foreground" data-testid="text-last-run-summary">{state.lastRunSummary}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {run.data && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <h2 className="font-semibold text-brand">This run</h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Messages scanned</p>
                <p className="text-xl font-bold text-brand tabular-nums">{run.data.messagesScanned}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Documents filed</p>
                <p className="text-xl font-bold text-brand tabular-nums">{run.data.documentsFiled}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Duplicates skipped</p>
                <p className="text-xl font-bold text-brand tabular-nums">{run.data.attachmentsSkippedDuplicate}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Field proposals</p>
                <p className="text-xl font-bold text-brand tabular-nums">{run.data.fieldProposalsCreated}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Errors</p>
                <p className={`text-xl font-bold tabular-nums ${run.data.errors.length ? "text-danger-strong" : "text-brand"}`}>
                  {run.data.errors.length}
                </p>
              </div>
            </div>
            {run.data.errors.length > 0 && (
              <ul className="mt-4 space-y-1" data-testid="list-run-errors">
                {run.data.errors.map((e, i) => (
                  <li key={i} className="text-xs text-danger-strong font-mono">{e}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground mt-6">
        Field proposals from PPRs, renewal letters, and rate sheets are reviewed separately, in Field Review.
      </p>
    </div>
  );
}
