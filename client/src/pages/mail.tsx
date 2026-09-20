import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  Mail, Paperclip, RefreshCw, Search, Lock, Sparkles, ChevronLeft, ChevronDown, ChevronUp, Forward,
} from "lucide-react";

interface ThreadListItem {
  id: number;
  gmailThreadId: string;
  subject: string | null;
  latestMessageAt: string;
  messageCount: number;
  businessStatus: "MATCHED" | "UNASSIGNED" | "NOT_BUSINESS";
  summaryOneLine: string | null;
  isPrivate: boolean;
  clientIds: number[];
}

interface ThreadMessage {
  id: number;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  bodyHtmlSafe: string | null;
  bodyTextNew: string | null;
  hasQuotedText: boolean;
  isForward: boolean;
  sentAt: string;
  direction: "SENT" | "RECEIVED";
  attachments: { id: number; filename: string; mimeType: string | null; sizeBytes: number | null; filedAsDocumentId: number | null }[];
}

/** Escapes the sender's new-text-only body for safe display, preserving line breaks. Used for the default collapsed view; "show quoted text" switches to the fully-styled, sanitized original instead. */
function newTextToDisplayHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br/>");
}

interface ThreadDetail {
  thread: ThreadListItem & { summary: string | null };
  clients: { id: number; clientName: string; clientCode: string }[];
  messages: ThreadMessage[];
}

interface ClientOption {
  id: number;
  clientName: string;
  clientCode: string;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ThreadRow({ t, active, onClick }: { t: ThreadListItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-border hover:bg-muted/50 transition-colors ${active ? "bg-muted" : ""}`}
      data-testid={`thread-row-${t.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground truncate">{t.subject || "(no subject)"}</p>
        <span className="text-xs text-muted-foreground flex-shrink-0">{fmt(t.latestMessageAt)}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {t.isPrivate && <Lock className="w-3 h-3 text-muted-foreground" />}
        {t.messageCount > 1 && <Badge variant="outline" className="text-xs h-4 px-1">{t.messageCount}</Badge>}
        {t.summaryOneLine && <p className="text-xs text-muted-foreground truncate">{t.summaryOneLine}</p>}
      </div>
    </button>
  );
}

function ThreadPane({ threadId }: { threadId: number }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ThreadDetail>({ queryKey: [`/api/gmail-inbox/threads/${threadId}`] });
  const { data: clients } = useQuery<ClientOption[]>({ queryKey: ["/api/clients"] });
  const [assignClientId, setAssignClientId] = useState<string>("");

  const assign = useMutation({
    mutationFn: () => apiRequest("POST", `/api/gmail-inbox/threads/${threadId}/assign`, { clientId: assignClientId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gmail-inbox/threads/${threadId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/threads"] });
      toast({ title: "Assigned to client" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const togglePrivate = useMutation({
    mutationFn: (isPrivate: boolean) => apiRequest("POST", `/api/gmail-inbox/threads/${threadId}/private`, { isPrivate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gmail-inbox/threads/${threadId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/threads"] });
    },
  });

  if (isLoading || !data) return <div className="p-6"><Skeleton className="h-64" /></div>;
  const { thread, messages } = data;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-4 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{thread.subject || "(no subject)"}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.clients.length > 0
                ? data.clients.map((c) => `${c.clientName} (${c.clientCode})`).join(", ")
                : thread.businessStatus === "NOT_BUSINESS" ? "Not business" : "Unassigned"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => togglePrivate.mutate(!thread.isPrivate)}
            data-testid="button-toggle-private"
          >
            <Lock className="w-3.5 h-3.5 mr-1.5" />
            {thread.isPrivate ? "Private" : "Mark private"}
          </Button>
        </div>

        {thread.businessStatus === "UNASSIGNED" && (
          <div className="flex items-center gap-2 border border-border rounded-md p-2.5 bg-muted/30">
            <span className="text-xs text-muted-foreground">Assign to client:</span>
            <Select value={assignClientId} onValueChange={setAssignClientId}>
              <SelectTrigger className="h-8 w-64 text-xs" data-testid="select-assign-client">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {(clients || []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.clientName} ({c.clientCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!assignClientId || assign.isPending} onClick={() => assign.mutate()} data-testid="button-assign">
              Assign
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m) => (
            <MessageCard key={m.id} m={m} />
          ))}
        </div>
      </div>

      {thread.summary && (
        <div className="w-72 flex-shrink-0 border-l border-border p-4 overflow-y-auto" data-testid="thread-summary-panel">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-brand" />
            <p className="text-xs font-semibold text-brand">Summary</p>
          </div>
          <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{thread.summary}</div>
        </div>
      )}
    </div>
  );
}

function MessageCard({ m }: { m: ThreadMessage }) {
  const [expanded, setExpanded] = useState(false);
  // Forwards and low-confidence messages carry the full body as bodyTextNew
  // already, so there's nothing meaningful to collapse — always show the
  // full, richly-formatted original for those.
  const canCollapse = m.hasQuotedText && !m.isForward;
  const showFull = expanded || !canCollapse;

  return (
    <Card data-testid={`message-${m.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              {m.fromName || m.fromEmail}
              {m.isForward && <Badge variant="outline" className="text-xs h-4 px-1 gap-1"><Forward className="w-2.5 h-2.5" /> Forwarded</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              to {m.toEmails.join(", ")}{m.ccEmails.length > 0 ? ` · cc ${m.ccEmails.join(", ")}` : ""}
            </p>
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0">{fmt(m.sentAt)}</span>
        </div>
        {showFull ? (
          <div
            className="text-sm text-foreground prose prose-sm max-w-none [&_img]:max-w-full"
            dangerouslySetInnerHTML={{ __html: m.bodyHtmlSafe || "" }}
          />
        ) : (
          <div
            className="text-sm text-foreground"
            dangerouslySetInnerHTML={{ __html: newTextToDisplayHtml(m.bodyTextNew || "") }}
          />
        )}
        {canCollapse && (
          <button
            className="flex items-center gap-1 text-xs text-brand mt-2 hover:underline"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`button-toggle-quoted-${m.id}`}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Hide quoted text" : "Show quoted text"}
          </button>
        )}
        {m.attachments.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {m.attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 text-xs border border-border rounded px-2 py-1 text-muted-foreground" data-testid={`attachment-${a.id}`}>
                <Paperclip className="w-3 h-3" />
                {a.filename}
                {a.filedAsDocumentId && <Badge variant="outline" className="text-xs h-4 px-1 ml-1">filed</Badge>}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MailPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<"matched" | "unassigned" | "not_business">("matched");
  const [personEmail, setPersonEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<string>("");
  const [hasAttachment, setHasAttachment] = useState(false);
  const [includeQuoted, setIncludeQuoted] = useState(false);
  // Deep link support: the per-owner triage dashboard links straight into a
  // specific thread ("click opens the actual email") via ?threadId=123.
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("threadId");
    return fromUrl ? parseInt(fromUrl, 10) : null;
  });

  const { data: counts } = useQuery<{ matched: number; unassigned: number; notBusiness: number }>({
    queryKey: ["/api/gmail-inbox/counts"],
  });
  const { data: domains } = useQuery<string[]>({ queryKey: ["/api/gmail-inbox/domains"] });
  const { data: clients } = useQuery<ClientOption[]>({ queryKey: ["/api/clients"] });

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("view", view);
    if (personEmail) p.set("personEmail", personEmail);
    if (domain && domain !== "_any") p.set("domain", domain);
    if (clientId && clientId !== "_any") p.set("clientId", clientId);
    if (text) p.set("text", text);
    if (direction && direction !== "_any") p.set("direction", direction);
    if (hasAttachment) p.set("hasAttachment", "true");
    if (includeQuoted) p.set("includeQuoted", "true");
    return p.toString();
  }, [view, personEmail, domain, clientId, text, direction, hasAttachment, includeQuoted]);

  const { data, isLoading } = useQuery<{ total: number; threads: ThreadListItem[] }>({
    queryKey: [`/api/gmail-inbox/threads?${params}`],
  });

  const sync = useMutation({
    mutationFn: () => apiRequest("POST", "/api/gmail-inbox/sync", {}),
    onSuccess: async (res: any) => {
      const summary = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/counts"] });
      toast({ title: "Sync complete", description: `${summary.messagesNew} new message(s) imported.` });
    },
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const threads = data?.threads || [];

  return (
    <div data-testid="mail-page" className="flex flex-col h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-brand flex items-center gap-2"><Mail className="w-5 h-5" /> Mail</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Full inbox for kim.anderson@simple.us, synced every few minutes.</p>
        </div>
        {user?.role === "ADMIN" && (
          <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()} data-testid="button-sync-now">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${sync.isPending ? "animate-spin" : ""}`} />
            Sync now
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Tabs value={view} onValueChange={(v) => { setView(v as any); setSelectedThreadId(null); }}>
          <TabsList>
            <TabsTrigger value="matched" data-testid="tab-matched">Inbox ({counts?.matched ?? 0})</TabsTrigger>
            <TabsTrigger value="unassigned" data-testid="tab-unassigned">Unassigned ({counts?.unassigned ?? 0})</TabsTrigger>
            <TabsTrigger value="not_business" data-testid="tab-not-business">Not business ({counts?.notBusiness ?? 0})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap text-xs">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
          <Input placeholder="Search subject & body" value={text} onChange={(e) => setText(e.target.value)} className="h-8 w-48 pl-7 text-xs" data-testid="input-search-text" />
        </div>
        <Input placeholder="Person email" value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} className="h-8 w-44 text-xs" data-testid="input-person-email" />
        <Select value={domain || "_any"} onValueChange={setDomain}>
          <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-domain"><SelectValue placeholder="Firm / domain" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_any">Any firm</SelectItem>
            {(domains || []).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clientId || "_any"} onValueChange={setClientId}>
          <SelectTrigger className="h-8 w-52 text-xs" data-testid="select-filter-client"><SelectValue placeholder="Client" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_any">Any client</SelectItem>
            {(clients || []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.clientName} ({c.clientCode})</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={direction || "_any"} onValueChange={setDirection}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-direction"><SelectValue placeholder="Direction" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_any">Sent & received</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="received">Received</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={hasAttachment} onCheckedChange={(v) => setHasAttachment(!!v)} data-testid="checkbox-has-attachment" />
          Has attachment
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={includeQuoted} onCheckedChange={(v) => setIncludeQuoted(!!v)} data-testid="checkbox-include-quoted" />
          Include quoted text
        </label>
      </div>

      <div className="flex-1 border border-border rounded-lg overflow-hidden flex min-h-0">
        <div className={`w-80 flex-shrink-0 border-r border-border overflow-y-auto ${selectedThreadId ? "hidden md:block" : ""}`}>
          {isLoading && <div className="p-3 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
          {!isLoading && threads.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">No mail matches these filters.</div>
          )}
          {threads.map((t) => (
            <ThreadRow key={t.id} t={t} active={t.id === selectedThreadId} onClick={() => setSelectedThreadId(t.id)} />
          ))}
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedThreadId ? (
            <div className="h-full flex flex-col">
              <button className="md:hidden flex items-center gap-1 text-xs text-muted-foreground p-2 border-b border-border" onClick={() => setSelectedThreadId(null)}>
                <ChevronLeft className="w-3.5 h-3.5" /> Back to list
              </button>
              <div className="flex-1 min-h-0">
                <ThreadPane threadId={selectedThreadId} />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a thread to read it</div>
          )}
        </div>
      </div>
    </div>
  );
}
