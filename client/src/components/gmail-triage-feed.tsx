import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { formatDistanceToNow, format } from "date-fns";
import { Inbox, ArrowRight, X, Undo2, Sparkles, Loader2, CheckCircle2, Reply } from "lucide-react";
import ComposeMessageDialog from "@/components/compose-message-dialog";

interface TriageRow {
  id: number;
  description: string;
  dueDate: string | null;
  owner: string;
  aiPriority: "HIGH" | "MEDIUM" | "LOW" | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  gmailMessageId: number;
  gmailThreadId: number;
  subject: string | null;
  senderName: string | null;
  senderEmail: string;
  clients: { id: number; clientName: string }[];
  displayName: string;
}

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: "border-danger-strong text-danger-strong",
  MEDIUM: "border-warning-strong text-warning-strong",
  LOW: "border-border text-muted-foreground",
};

function TriageRowView({
  row, tab, onOpen, onDismiss, onUnresolve, onReply, isBusy,
}: {
  row: TriageRow;
  tab: "open" | "resolved";
  onOpen: () => void;
  onDismiss: () => void;
  onUnresolve: () => void;
  onReply: () => void;
  isBusy: boolean;
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-3" data-testid={`triage-row-${row.id}`}>
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="min-w-0 text-left flex-1" data-testid={`button-open-triage-${row.id}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-brand truncate">{row.displayName}</span>
            {row.aiPriority && (
              <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${PRIORITY_COLOR[row.aiPriority]}`}>
                {row.aiPriority}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium text-foreground mt-1 truncate">{row.subject || "(no subject)"}</p>
          <p className="text-xs text-foreground mt-1 leading-relaxed line-clamp-2">{row.description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {row.senderName || row.senderEmail}
            <span className="mx-1.5">·</span>
            <span title={format(new Date(row.createdAt), "PPpp")}>
              {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
            </span>
            {tab === "resolved" && row.resolvedBy && (
              <>
                <span className="mx-1.5">·</span>
                dismissed by {row.resolvedBy}
              </>
            )}
          </p>
        </button>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {tab === "open" ? (
            <Button
              size="sm" variant="outline" onClick={onDismiss} disabled={isBusy}
              className="h-7 text-xs gap-1.5"
              data-testid={`button-dismiss-triage-${row.id}`}
            >
              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
              Dismiss
            </Button>
          ) : (
            <Button
              size="sm" variant="outline" onClick={onUnresolve} disabled={isBusy}
              className="h-7 text-xs gap-1.5 border-brand text-brand"
              data-testid={`button-unresolve-triage-${row.id}`}
            >
              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
              Un-resolve
            </Button>
          )}
          {tab === "open" && (
            <Button
              size="sm" variant="outline" onClick={onReply}
              className="h-7 text-xs gap-1.5 border-brand text-brand"
              data-testid={`button-reply-triage-${row.id}`}
            >
              <Reply className="w-3 h-3" /> Reply
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onOpen} className="h-6 text-xs gap-1 text-brand">
            Open email <ArrowRight className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-owner Gmail-native triage dashboard.
 *
 * Kim only ever sees her own queue. Steve sees his own by default and can
 * toggle to Kim's or the combined view — he is the only one with a reason to
 * check someone else's queue. Reads exclusively from Gmail-native tables
 * (via /api/gmail-triage/feed), never the legacy communications table.
 */
export default function GmailTriageFeed() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const isSteve = user?.fullName === "Steve Schultz";
  const [ownerView, setOwnerView] = useState<string>(user?.fullName ?? "Kim Anderson");
  const [replyTo, setReplyTo] = useState<TriageRow | null>(null);

  const owner = isSteve ? ownerView : (user?.fullName ?? "Kim Anderson");

  const { data: rows = [], isLoading } = useQuery<TriageRow[]>({
    queryKey: ["/api/gmail-triage/feed", owner, tab],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/gmail-triage/feed?owner=${encodeURIComponent(owner)}&status=${tab === "open" ? "OPEN" : "RESOLVED"}`);
      return res.json();
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/gmail-triage/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-triage/feed"] });
    },
    onError: (e: any) => toast({ title: "Could not dismiss", description: e.message, variant: "destructive" }),
  });

  const unresolve = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/gmail-triage/${id}/unresolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-triage/feed"] });
      toast({ title: "Moved back to open" });
    },
    onError: (e: any) => toast({ title: "Could not un-resolve", description: e.message, variant: "destructive" }),
  });

  const openEmail = (row: TriageRow) => setLocation(`/mail?threadId=${row.gmailThreadId}`);

  // Reply happens here, on the item Steve is already looking at, rather than
  // sending him to another screen to find the same message again.
  const replyDialog = replyTo && (
    <ComposeMessageDialog
      mode="reply"
      source={{
        id: replyTo.gmailMessageId,
        subject: replyTo.subject,
        fromEmail: replyTo.senderEmail,
        fromName: replyTo.senderName,
        sentAt: replyTo.createdAt,
      }}
      clientId={replyTo.clients[0]?.id ?? null}
      clientIds={replyTo.clients.map((c) => c.id)}
      onClose={() => setReplyTo(null)}
    />
  );

  return (
    <Card className="border-0 shadow-sm" data-testid="card-gmail-triage-feed">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-brand" />
            <h3 className="text-sm font-semibold text-brand">Mail triage</h3>
            <span className="text-xs text-muted-foreground" data-testid="text-triage-count">
              {isLoading ? "" : `${rows.length}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isSteve && (
              <Select value={ownerView} onValueChange={setOwnerView}>
                <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-triage-owner">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Steve Schultz">My queue</SelectItem>
                  <SelectItem value="Kim Anderson">Kim's queue</SelectItem>
                  <SelectItem value="ALL">Everyone</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "resolved")}>
              <TabsList className="h-7">
                <TabsTrigger value="open" className="text-xs h-6 px-2" data-testid="tab-triage-open">Open</TabsTrigger>
                <TabsTrigger value="resolved" className="text-xs h-6 px-2" data-testid="tab-triage-resolved">Resolved</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">
            {tab === "open" ? (
              <>
                <Sparkles className="w-7 h-7 text-success mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">Nothing to triage.</p>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nothing resolved yet.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1" data-testid="list-gmail-triage">
            {rows.map((row) => (
              <TriageRowView
                key={row.id}
                row={row}
                tab={tab}
                onOpen={() => openEmail(row)}
                onDismiss={() => dismiss.mutate(row.id)}
                onUnresolve={() => unresolve.mutate(row.id)}
                onReply={() => setReplyTo(row)}
                isBusy={(dismiss.isPending && dismiss.variables === row.id) || (unresolve.isPending && unresolve.variables === row.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
      {replyDialog}
    </Card>
  );
}
