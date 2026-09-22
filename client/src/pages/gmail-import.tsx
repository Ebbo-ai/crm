import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import { Inbox, RefreshCw, Download, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";

interface UnfiledAttachment {
  id: number;
  mailbox: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  subject: string | null;
  fromEmail: string | null;
  toEmails: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface Client {
  id: number;
  clientName: string;
  clientCode: string | null;
}

export default function GmailImportPage() {
  const { toast } = useToast();
  const [assignSelections, setAssignSelections] = useState<Record<number, { clientId?: string; category?: string }>>({});

  const queue = useQuery<UnfiledAttachment[]>({ queryKey: ["/api/unfiled-attachments"] });
  const clients = useQuery<Client[]>({ queryKey: ["/api/clients"] });

  const sync = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmail-inbox/sync", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unfiled-attachments"] });
      toast({ title: "Sync complete" });
    },
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const assign = useMutation({
    mutationFn: async ({ id, clientId, category }: { id: number; clientId: number; category: string }) => {
      const res = await apiRequest("POST", `/api/unfiled-attachments/${id}/assign`, { clientId, category });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unfiled-attachments"] });
      toast({ title: "Attachment filed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const dismiss = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/unfiled-attachments/${id}/dismiss`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unfiled-attachments"] });
      toast({ title: "Dismissed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rows = queue.data || [];

  return (
    <div data-testid="gmail-import-page" className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand">Unfiled Attachments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real attachments Gmail sync could not match to a client, even after AI matching — nothing here was
            dropped. Pick a client and category to file one, or dismiss it if it isn't worth keeping.
          </p>
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending} className="bg-brand hover:bg-brand-dark gap-2" data-testid="button-run-sync">
          <RefreshCw className={`w-4 h-4 ${sync.isPending ? "animate-spin" : ""}`} />
          {sync.isPending ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      {queue.isLoading ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-unfiled">Nothing waiting for review.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const sel = assignSelections[row.id] || {};
            return (
              <Card key={row.id} data-testid={`unfiled-row-${row.id}`}>
                <CardContent className="py-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{row.filename}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {row.mailbox} · {row.sentAt ? format(new Date(row.sentAt), "MMM d, yyyy") : "unknown date"} ·
                        {" "}from {row.fromEmail || "unknown"}
                      </p>
                      {row.subject && <p className="text-xs text-muted-foreground truncate">Subject: {row.subject}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/api/unfiled-attachments/${row.id}/download`} target="_blank" rel="noreferrer">
                        <Button size="icon" variant="ghost" data-testid={`button-download-${row.id}`}>
                          <Download className="w-4 h-4 text-brand-accent" />
                        </Button>
                      </a>
                      <Select value={sel.clientId} onValueChange={(v) => setAssignSelections((s) => ({ ...s, [row.id]: { ...s[row.id], clientId: v } }))}>
                        <SelectTrigger className="w-48" data-testid={`select-client-${row.id}`}><SelectValue placeholder="Client…" /></SelectTrigger>
                        <SelectContent>
                          {(clients.data || []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.clientName}{c.clientCode ? ` (${c.clientCode})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={sel.category} onValueChange={(v) => setAssignSelections((s) => ({ ...s, [row.id]: { ...s[row.id], category: v } }))}>
                        <SelectTrigger className="w-40" data-testid={`select-category-${row.id}`}><SelectValue placeholder="Category…" /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!sel.clientId || !sel.category || assign.isPending}
                        onClick={() => assign.mutate({ id: row.id, clientId: parseInt(sel.clientId!), category: sel.category! })}
                        data-testid={`button-assign-${row.id}`}
                      >
                        <CheckCircle2 className="w-4 h-4 text-success-strong" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => dismiss.mutate(row.id)} data-testid={`button-dismiss-${row.id}`}>
                        <XCircle className="w-4 h-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
