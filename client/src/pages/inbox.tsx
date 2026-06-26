import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import {
  Mail, Paperclip, CheckSquare, ChevronDown, ChevronUp, Sparkles,
  Loader2, Send, Download, Clock, CheckCircle2, UserPlus, Search, X
} from "lucide-react";

interface CommTask {
  id: number;
  description: string;
  dueDate: string | null;
  isCompleted: boolean;
}

interface CommAttachment {
  id: number;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

interface Communication {
  id: number;
  subject: string | null;
  senderEmail: string;
  senderName: string | null;
  senderDomain: string | null;
  bodyText: string | null;
  claudeSummary: string | null;
  claudeActionItems: string | null;
  receivedAt: string;
  isInternal: boolean;
  isUnmatched: boolean;
  source: string;
  clientNames: string[];
  attachments: CommAttachment[];
  tasks: CommTask[];
}

function taskDueStatus(dueDate: string | null) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  return "upcoming";
}

function AssignDialog({ commId, onClose }: { commId: number; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const { data: clients = [] } = useQuery<any[]>({ queryKey: ["/api/clients"] });

  const filtered = clients.filter((c: any) =>
    c.clientName.toLowerCase().includes(search.toLowerCase()) ||
    c.clientCode.toLowerCase().includes(search.toLowerCase())
  );

  const assign = useMutation({
    mutationFn: (clientId: number) => apiRequest("POST", `/api/communications/${commId}/assign`, { clientId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
      toast({ title: "Assigned to client" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign to Client</DialogTitle>
        </DialogHeader>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search client name or code..." className="pl-8" data-testid="input-assign-search" />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1 mt-2">
          {filtered.slice(0, 20).map((c: any) => (
            <button key={c.id} onClick={() => assign.mutate(c.id)}
              disabled={assign.isPending}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-[#F0F4F8] flex items-center justify-between"
              data-testid={`assign-client-${c.id}`}>
              <div>
                <p className="text-sm font-medium text-[#2C3E50]">{c.clientName}</p>
                <p className="text-xs text-[#94A3B8]">{c.clientCode}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-sm text-[#94A3B8] text-center py-4">No clients found</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InboxCard({ comm, showClientBadge = true }: { comm: Communication; showClientBadge?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const { toast } = useToast();

  const completeMutation = useMutation({
    mutationFn: (taskId: number) => apiRequest("POST", `/api/communication-tasks/${taskId}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication-tasks"] });
      toast({ title: "Task marked complete" });
    },
  });

  const timeAgo = formatDistanceToNow(new Date(comm.receivedAt), { addSuffix: true });
  const senderLabel = comm.senderName || comm.senderEmail;
  const openTasks = comm.tasks.filter(t => !t.isCompleted).length;

  return (
    <>
      <Card className="border border-gray-100 shadow-none" data-testid={`inbox-card-${comm.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${comm.isInternal ? "bg-[#1A5276]" : "bg-[#2E86C1]"}`}>
                {senderLabel.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[#2C3E50]">{senderLabel}</span>
                  {comm.senderDomain && (
                    <span className="text-[10px] text-[#94A3B8]">@{comm.senderDomain}</span>
                  )}
                  {comm.isInternal && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#1A5276] text-[#1A5276]">Internal</Badge>}
                  {comm.isUnmatched && <Badge className="text-[10px] h-4 px-1.5 bg-[#F5A623] text-white border-0">Unmatched</Badge>}
                </div>
                <p className="text-sm text-[#2C3E50] font-medium mt-0.5">{comm.subject || "(no subject)"}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="text-xs text-[#94A3B8]">{timeAgo}</span>
                  {showClientBadge && comm.clientNames.length > 0 && comm.clientNames.map((name, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#2E86C1]/10 text-[#2E86C1] font-medium">{name}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {comm.attachments.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-[#94A3B8]">
                  <Paperclip className="w-3 h-3" />{comm.attachments.length}
                </span>
              )}
              {openTasks > 0 && (
                <span className="flex items-center gap-1 text-xs text-[#F5A623] font-medium">
                  <CheckSquare className="w-3 h-3" />{openTasks}
                </span>
              )}
              {comm.isUnmatched && (
                <Button variant="outline" size="sm" onClick={() => setAssigning(true)}
                  className="h-7 px-2 text-xs gap-1 border-[#F5A623] text-[#F5A623] hover:bg-[#F5A623]/10"
                  data-testid={`button-assign-${comm.id}`}>
                  <UserPlus className="w-3 h-3" /> Assign
                </Button>
              )}
              <button onClick={() => setExpanded(v => !v)} className="text-[#94A3B8] hover:text-[#1A5276] p-1" data-testid={`button-expand-inbox-${comm.id}`}>
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {comm.claudeSummary && (
            <div className="mt-3 p-3 bg-[#F0F4F8] rounded-lg">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3 h-3 text-[#F5A623]" />
                <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wide">AI Summary</span>
              </div>
              <p className="text-sm text-[#2C3E50] leading-relaxed">{comm.claudeSummary}</p>
            </div>
          )}

          {expanded && (
            <div className="mt-3 space-y-3">
              {comm.bodyText && (
                <div className="border rounded-lg p-3 bg-white">
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-2">Full Email</p>
                  <pre className="text-xs text-[#2C3E50] whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">{comm.bodyText}</pre>
                </div>
              )}

              {comm.tasks.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-2">Follow-up Tasks</p>
                  <div className="space-y-1.5">
                    {comm.tasks.map(task => {
                      const status = taskDueStatus(task.dueDate);
                      return (
                        <div key={task.id} className={`flex items-start gap-2 p-2 rounded-md ${task.isCompleted ? "opacity-50" : "bg-white border"}`}>
                          <button onClick={() => !task.isCompleted && completeMutation.mutate(task.id)}
                            disabled={task.isCompleted || completeMutation.isPending} className="mt-0.5 flex-shrink-0">
                            {task.isCompleted
                              ? <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                              : <div className="w-4 h-4 rounded border-2 border-[#94A3B8] hover:border-[#1A5276]" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${task.isCompleted ? "line-through text-[#94A3B8]" : "text-[#2C3E50]"}`}>{task.description}</p>
                            {task.dueDate && !task.isCompleted && (
                              <span className={`text-[10px] font-medium flex items-center gap-1 mt-0.5 ${
                                status === "overdue" ? "text-[#EF4444]" : status === "today" ? "text-[#F5A623]" : "text-[#94A3B8]"
                              }`}>
                                <Clock className="w-2.5 h-2.5" />
                                {status === "overdue" ? "Overdue — " : status === "today" ? "Due today" : "Due "}
                                {status !== "today" && new Date(task.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {comm.attachments.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-2">Attachments</p>
                  <div className="flex flex-wrap gap-2">
                    {comm.attachments.map(att => (
                      <a key={att.id} href={`/api/communication-attachments/${att.id}/download`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md text-xs text-[#2E86C1] hover:bg-[#F0F4F8]">
                        <Download className="w-3 h-3" />{att.filename}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {assigning && <AssignDialog commId={comm.id} onClose={() => setAssigning(false)} />}
    </>
  );
}

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [filterDomain, setFilterDomain] = useState("all");
  const [filterName, setFilterName] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const { toast } = useToast();

  const params = new URLSearchParams();
  if (filterDomain && filterDomain !== "all") params.set("senderDomain", filterDomain);
  if (filterName) params.set("senderName", filterName);
  if (activeTab === "unmatched") params.set("unmatched", "true");

  const { data: comms = [], isLoading } = useQuery<Communication[]>({
    queryKey: ["/api/communications", activeTab, filterDomain, filterName],
    queryFn: () => fetch(`/api/communications?${params.toString()}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
  });

  const { data: senders = [] } = useQuery<any[]>({
    queryKey: ["/api/communications/senders"],
    staleTime: 0,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/communications/unread-count"],
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const unmatched = comms.filter(c => c.isUnmatched);

  const handleAsk = async () => {
    if (!askQuestion.trim()) return;
    setAskLoading(true);
    setAiAnswer(null);
    try {
      const res = await apiRequest("POST", "/api/communications/ask", {
        question: askQuestion,
        senderDomain: filterDomain !== "all" ? filterDomain : undefined,
        senderName: filterName || undefined,
      });
      const data = await res.json();
      setAiAnswer(data.answer);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAskLoading(false);
    }
  };

  const distinctDomains = [...new Set(senders.map((s: any) => s.senderDomain).filter(Boolean))];

  return (
    <div data-testid="inbox-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5276]" data-testid="text-inbox-title">Communications Inbox</h1>
        <p className="text-sm text-[#94A3B8] mt-1">All forwarded emails and communications across clients</p>
      </div>

      {/* AI Ask bar */}
      <Card className="border-0 shadow-sm mb-5">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#F5A623]" />
            <span className="text-sm font-semibold text-[#1A5276]">Ask AI about all communications</span>
            <span className="text-xs text-[#94A3B8]">(searches across all clients)</span>
          </div>
          <div className="flex gap-2">
            <Input value={askQuestion} onChange={e => setAskQuestion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleAsk()}
              placeholder='e.g. "Show me all content from Totem Solutions" or "All discussions with Annette Griffin about Thomas County"'
              className="flex-1 text-sm" data-testid="input-inbox-ask" />
            <Button onClick={handleAsk} disabled={!askQuestion.trim() || askLoading}
              className="bg-[#F5A623] hover:bg-[#e6971f] text-white gap-2 flex-shrink-0" data-testid="button-inbox-ask">
              {askLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Ask
            </Button>
          </div>
          {aiAnswer && (
            <div className="mt-3 p-3 bg-[#F0F4F8] rounded-lg border border-[#2E86C1]/20 relative">
              <button onClick={() => setAiAnswer(null)} className="absolute top-2 right-2 text-[#94A3B8] hover:text-[#2C3E50]"><X className="w-3.5 h-3.5" /></button>
              <p className="text-sm text-[#2C3E50] leading-relaxed whitespace-pre-wrap pr-6" data-testid="text-inbox-ai-answer">{aiAnswer}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={filterDomain} onValueChange={setFilterDomain}>
              <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-filter-domain">
                <SelectValue placeholder="All domains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {distinctDomains.map(d => (
                  <SelectItem key={d} value={d!}>@{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" />
              <Input value={filterName} onChange={e => setFilterName(e.target.value)}
                placeholder="Filter by sender name..." className="h-8 text-xs pl-8" data-testid="input-filter-name" />
            </div>
            {(filterDomain !== "all" || filterName) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-[#94A3B8]"
                onClick={() => { setFilterDomain("all"); setFilterName(""); }}>
                <X className="w-3 h-3" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border mb-4 h-auto">
          <TabsTrigger value="all" className="data-[state=active]:bg-[#1A5276] data-[state=active]:text-white" data-testid="tab-all-comms">
            All {comms.filter(c => !c.isUnmatched).length > 0 && `(${comms.filter(c => !c.isUnmatched).length})`}
          </TabsTrigger>
          <TabsTrigger value="unmatched" className="data-[state=active]:bg-[#F5A623] data-[state=active]:text-white" data-testid="tab-unmatched">
            Unmatched {(unreadData?.count ?? 0) > 0 && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EF4444] text-white">{unreadData?.count}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {isLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : comms.length === 0 ? (
            <Card className="border-dashed border-2 border-[#E2E8F0]">
              <CardContent className="py-16 text-center">
                <Mail className="w-12 h-12 text-[#94A3B8] mx-auto mb-3" />
                <p className="text-sm font-medium text-[#94A3B8]">No communications yet</p>
                <p className="text-xs text-[#94A3B8] mt-1 max-w-xs mx-auto">
                  Set up Mailgun inbound routing to your app's webhook URL, or add communications manually from a client record.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {comms.map(c => <InboxCard key={c.id} comm={c} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="unmatched">
          {isLoading ? (
            <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : unmatched.length === 0 ? (
            <Card className="border-dashed border-2 border-[#E2E8F0]">
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto mb-3" />
                <p className="text-sm font-medium text-[#94A3B8]">No unmatched emails</p>
                <p className="text-xs text-[#94A3B8] mt-1">All incoming emails have been matched to clients</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {unmatched.map(c => <InboxCard key={c.id} comm={c} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
