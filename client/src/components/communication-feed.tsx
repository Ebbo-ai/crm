import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow, format } from "date-fns";
import {
  Inbox, AlertTriangle, ArrowRight, Check, Undo2, Search, Building2,
  Paperclip, CheckSquare, Loader2, Sparkles,
} from "lucide-react";

/** How long a resolved row lingers, faded, before it leaves the feed. */
const UNDO_WINDOW_MS = 5000;

export interface FeedComm {
  id: number;
  subject: string | null;
  senderEmail: string;
  senderName: string | null;
  senderDomain: string | null;
  claudeSummary: string | null;
  receivedAt: string;
  isInternal: boolean;
  isUnmatched: boolean;
  isFollowUp: boolean;
  followUpReason: string | null;
  attachments: { id: number }[];
  tasks: { id: number; status: string }[];
  clientIds: number[];
  clientNames: string[];
  clientCodes: string[];
}

/** Assign a communication the matcher could not place. */
function AssignDialog({ comm, onClose }: { comm: FeedComm; onClose: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const { data: clients = [] } = useQuery<any[]>({ queryKey: ["/api/clients"] });

  const assign = useMutation({
    mutationFn: (clientId: number) => apiRequest("POST", `/api/communications/${comm.id}/assign`, { clientId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communications/unread-count"] });
      toast({ title: "Assigned to client" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not assign", description: e.message, variant: "destructive" }),
  });

  const term = search.trim().toLowerCase();
  const matches = term
    ? clients.filter(c =>
        (c.clientName ?? "").toLowerCase().includes(term) ||
        (c.clientCode ?? "").toLowerCase().includes(term))
    : clients.slice(0, 40);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-feed-assign">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Assign to a client</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-[#94A3B8] -mt-2 truncate">
          {comm.subject || "(no subject)"} — from {comm.senderName || comm.senderEmail}
        </p>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <Input
            autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search client name or code..." className="pl-8 text-sm"
            data-testid="input-feed-assign-search"
          />
        </div>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {matches.length === 0 && <p className="text-xs text-[#94A3B8] py-4 text-center">No clients match "{search}".</p>}
          {matches.map(c => (
            <button
              key={c.id}
              onClick={() => assign.mutate(c.id)}
              disabled={assign.isPending}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-[#F0F4F8] flex items-center gap-2 disabled:opacity-50"
              data-testid={`button-feed-assign-${c.id}`}
            >
              <Building2 className="w-3.5 h-3.5 text-[#94A3B8] flex-shrink-0" />
              <span className="text-sm text-[#2C3E50] truncate">{c.clientName}</span>
              <span className="text-[10px] text-[#94A3B8] ml-auto flex-shrink-0">{c.clientCode}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeedRow({
  comm, fading, onOpen, onRead, onUndo, isBusy,
}: {
  comm: FeedComm;
  fading: boolean;
  onOpen: () => void;
  onRead: () => void;
  onUndo: () => void;
  isBusy: boolean;
}) {
  const sender = comm.senderName || comm.senderEmail;
  const openTasks = comm.tasks.filter(t => t.status !== "RESOLVED").length;
  const unassigned = comm.clientIds.length === 0;

  return (
    <div
      className={`border rounded-lg transition-all duration-500 ${
        fading ? "opacity-40" : "opacity-100"
      } ${comm.isFollowUp ? "border-[#FECACA] bg-[#FEF2F2]" : "border-gray-100 bg-white hover:border-[#CBD5E1]"}`}
      data-testid={`feed-row-${comm.id}`}
    >
      <div className="flex">
        {/* Red spine marks mail that is chasing us for something we owe. */}
        <div className={`w-1 rounded-l-lg flex-shrink-0 ${comm.isFollowUp ? "bg-[#EF4444]" : "bg-transparent"}`} />

        <div className="flex-1 min-w-0 p-3">
          <div className="flex items-start justify-between gap-3">
            <button onClick={onOpen} className="min-w-0 text-left flex-1" data-testid={`button-open-comm-${comm.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {unassigned ? (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#F5A623] text-[#F5A623]">
                    Unassigned
                  </Badge>
                ) : (
                  <span className="text-xs font-semibold text-[#1A5276] truncate" data-testid={`text-feed-client-${comm.id}`}>
                    {comm.clientNames.join(", ")}
                  </span>
                )}
                {comm.isFollowUp && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#EF4444] uppercase tracking-wide">
                    <AlertTriangle className="w-3 h-3" /> Chasing us
                  </span>
                )}
                {comm.isInternal && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#1A5276] text-[#1A5276]">Internal</Badge>
                )}
              </div>

              <p className="text-sm font-medium text-[#2C3E50] mt-1 truncate">
                {comm.subject || "(no subject)"}
              </p>

              <p className="text-xs text-[#94A3B8] mt-0.5">
                {sender}
                <span className="mx-1.5">·</span>
                <span title={format(new Date(comm.receivedAt), "PPpp")}>
                  {formatDistanceToNow(new Date(comm.receivedAt), { addSuffix: true })}
                </span>
                {openTasks > 0 && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span className="inline-flex items-center gap-1 text-[#F5A623] font-medium">
                      <CheckSquare className="w-3 h-3" />{openTasks} task{openTasks !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
                {comm.attachments.length > 0 && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="w-3 h-3" />{comm.attachments.length}
                    </span>
                  </>
                )}
              </p>

              {comm.claudeSummary && (
                <p className="text-xs text-[#2C3E50] mt-1.5 leading-relaxed line-clamp-2">
                  {comm.claudeSummary}
                </p>
              )}

              {comm.isFollowUp && comm.followUpReason && (
                <p className="text-[11px] text-[#EF4444] mt-1 leading-snug" data-testid={`text-followup-reason-${comm.id}`}>
                  {comm.followUpReason}
                </p>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 mt-2.5">
            {fading ? (
              <Button
                size="sm" variant="outline" onClick={onUndo}
                className="h-7 text-xs gap-1.5 border-[#1A5276] text-[#1A5276]"
                data-testid={`button-undo-${comm.id}`}
              >
                <Undo2 className="w-3 h-3" /> Undo
              </Button>
            ) : (
              <Button
                size="sm" variant="outline" onClick={onRead} disabled={isBusy}
                className="h-7 text-xs gap-1.5 text-[#22C55E] border-[#BBF7D0] hover:bg-[#F0FDF4]"
                data-testid={`button-read-no-task-${comm.id}`}
              >
                {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Read: no task needed
              </Button>
            )}
            <Button
              size="sm" variant="ghost" onClick={onOpen}
              className="h-7 text-xs gap-1.5 text-[#1A5276] hover:bg-[#F0F4F8]"
              data-testid={`button-go-to-client-${comm.id}`}
            >
              {comm.clientIds.length === 0 ? "Assign to client" : "Go to client"}
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The morning triage feed.
 *
 * Everything unresolved, newest first, and nothing ages out on its own. A row
 * leaves only when it is resolved, and even then it lingers faded for a few
 * seconds so a mis-click can be taken back.
 */
export default function CommunicationFeed() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [assigning, setAssigning] = useState<FeedComm | null>(null);

  /** Rows resolved in this session, held so they can fade rather than vanish. */
  const [fading, setFading] = useState<Map<number, FeedComm>>(new Map());
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const { data: serverRows = [], isLoading } = useQuery<FeedComm[]>({
    queryKey: ["/api/communications/feed"],
    // Paused while something is fading so a poll cannot yank the undo away.
    refetchInterval: fading.size > 0 ? false : 60_000,
  });

  const rows = useMemo(() => {
    const byId = new Map<number, FeedComm>();
    for (const c of serverRows) byId.set(c.id, c);
    for (const [id, c] of Array.from(fading.entries())) if (!byId.has(id)) byId.set(id, c);
    return Array.from(byId.values())
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [serverRows, fading]);

  const clearRow = (id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setFading(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const readMutation = useMutation({
    mutationFn: (comm: FeedComm) =>
      apiRequest("POST", `/api/communications/${comm.id}/resolve`, { resolutionType: "READ_NO_TASK" }),
    onSuccess: (_res, comm) => {
      setFading(prev => new Map(prev).set(comm.id, comm));
      timers.current.set(comm.id, setTimeout(() => {
        clearRow(comm.id);
        queryClient.invalidateQueries({ queryKey: ["/api/communications/feed"] });
      }, UNDO_WINDOW_MS));
    },
    onError: (e: any) => toast({ title: "Could not mark as read", description: e.message, variant: "destructive" }),
  });

  const undoMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/communications/${id}/unresolve`),
    onSuccess: (_res, id) => {
      clearRow(id);
      queryClient.invalidateQueries({ queryKey: ["/api/communications/feed"] });
      toast({ title: "Put back in the feed" });
    },
    onError: (e: any) => toast({ title: "Could not undo", description: e.message, variant: "destructive" }),
  });

  const open = (comm: FeedComm) => {
    if (comm.clientIds.length === 0) {
      setAssigning(comm);
      return;
    }
    // Deep link straight to this message inside the client's communications tab.
    setLocation(`/clients/${comm.clientIds[0]}?tab=communications&comm=${comm.id}`);
  };

  const followUps = rows.filter(r => r.isFollowUp && !fading.has(r.id)).length;

  return (
    <Card className="border-0 shadow-sm" data-testid="card-communication-feed">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-[#1A5276]" />
            <h3 className="text-sm font-semibold text-[#1A5276]">Communications to triage</h3>
            <span className="text-xs text-[#94A3B8]" data-testid="text-feed-count">
              {isLoading ? "" : `${rows.length}`}
            </span>
          </div>
          {followUps > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#EF4444]" data-testid="text-followup-count">
              <AlertTriangle className="w-3 h-3" />
              {followUps} chasing us
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <Sparkles className="w-8 h-8 text-[#22C55E] mx-auto mb-2" />
            <p className="text-sm font-medium text-[#2C3E50]">Nothing left to triage.</p>
            <p className="text-xs text-[#94A3B8] mt-1">Every message has been read or resolved.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1" data-testid="list-communication-feed">
            {rows.map(comm => (
              <FeedRow
                key={comm.id}
                comm={comm}
                fading={fading.has(comm.id)}
                isBusy={readMutation.isPending && readMutation.variables?.id === comm.id}
                onOpen={() => open(comm)}
                onRead={() => readMutation.mutate(comm)}
                onUndo={() => undoMutation.mutate(comm.id)}
              />
            ))}
          </div>
        )}
      </CardContent>

      {assigning && <AssignDialog comm={assigning} onClose={() => setAssigning(null)} />}
    </Card>
  );
}
