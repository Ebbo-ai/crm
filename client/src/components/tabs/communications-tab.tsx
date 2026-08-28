import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ResolveDialog } from "@/components/resolution-dialogs";
import { TaskRow, type TaskLike } from "@/components/task-actions";
import { formatDistanceToNow, format } from "date-fns";
import {
  Mail, Paperclip, CheckSquare, ChevronDown, ChevronUp, AlertTriangle,
  Plus, Send, Sparkles, Loader2, Download, CheckCircle2, User, ListTodo,
} from "lucide-react";

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
  source: string;
  status: string;
  resolutionType: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  isFollowUp: boolean;
  followUpReason: string | null;
  attachments: CommAttachment[];
  tasks: TaskLike[];
}

/** Inline free-form task, for the things the AI did not spot. */
function AddTaskForm({ commId, clientId, onDone }: { commId: number; clientId: number; onDone: () => void }) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/communication-tasks", {
      communicationId: commId,
      clientId,
      description: description.trim(),
      dueDate: dueDate || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "communications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communications/feed"] });
      toast({ title: "Task added" });
      onDone();
    },
    onError: (e: any) => toast({ title: "Could not add the task", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-2.5 rounded-md border border-dashed border-[#CBD5E1] bg-[#F8FAFC] space-y-2">
      <Textarea
        autoFocus
        value={description}
        onChange={e => setDescription(e.target.value.slice(0, 500))}
        rows={2}
        placeholder="What needs doing?"
        className="text-xs bg-white"
        data-testid={`textarea-new-task-${commId}`}
      />
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="h-7 text-xs w-40"
          data-testid={`input-new-task-due-${commId}`}
        />
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onDone} className="h-7 text-xs" data-testid={`button-cancel-task-${commId}`}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => create.mutate()}
            disabled={!description.trim() || create.isPending}
            className="h-7 text-xs bg-[#1A5276] text-white gap-1.5"
            data-testid={`button-save-task-${commId}`}
          >
            {create.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Add task
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommCard({
  comm, clientId, focused,
}: {
  comm: Communication;
  clientId: number;
  focused: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [resolving, setResolving] = useState(false);
  const { toast } = useToast();
  const ref = useRef<HTMLDivElement>(null);

  // A deep link from the dashboard should land on the message itself.
  useEffect(() => {
    if (!focused || !ref.current) return;
    ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setExpanded(true);
  }, [focused]);

  const resolve = useMutation({
    mutationFn: (note: string) =>
      apiRequest("POST", `/api/communications/${comm.id}/resolve`, { resolutionType: "RESOLVED", note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "communications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communications/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      setResolving(false);
      toast({ title: "Resolved", description: "Your note is saved on the record." });
    },
    onError: (e: any) => toast({ title: "Could not resolve", description: e.message, variant: "destructive" }),
  });

  const senderLabel = comm.senderName || comm.senderEmail;
  const timeAgo = formatDistanceToNow(new Date(comm.receivedAt), { addSuffix: true });
  const isResolved = comm.status === "RESOLVED";
  const openTasks = comm.tasks.filter(t => t.status !== "RESOLVED").length;

  return (
    <div ref={ref}>
      <Card
        className={`border shadow-none transition-all ${
          focused ? "border-[#2E86C1] ring-2 ring-[#2E86C1]/30" :
          comm.isFollowUp && !isResolved ? "border-[#FECACA] bg-[#FEF2F2]" : "border-gray-100"
        }`}
        data-testid={`comm-card-${comm.id}`}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${comm.isInternal ? "bg-[#1A5276]" : "bg-[#2E86C1]"}`}>
                {senderLabel.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[#2C3E50]" data-testid={`text-sender-${comm.id}`}>{senderLabel}</span>
                  {comm.isFollowUp && !isResolved && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#EF4444] uppercase tracking-wide">
                      <AlertTriangle className="w-3 h-3" /> Chasing us
                    </span>
                  )}
                  {comm.isInternal && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#1A5276] text-[#1A5276]">Internal</Badge>}
                  {comm.source === "manual" && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#94A3B8] text-[#94A3B8]">Manual</Badge>}
                  {comm.senderDomain && !comm.isInternal && (
                    <span className="text-[10px] text-[#94A3B8]">@{comm.senderDomain}</span>
                  )}
                </div>
                <p className="text-sm text-[#2C3E50] font-medium mt-0.5 truncate">{comm.subject || "(no subject)"}</p>
                <p className="text-xs text-[#94A3B8] mt-0.5" title={format(new Date(comm.receivedAt), "PPpp")}>{timeAgo}</p>
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
              <button onClick={() => setExpanded(v => !v)} className="text-[#94A3B8] hover:text-[#1A5276] p-1" data-testid={`button-expand-${comm.id}`}>
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {comm.isFollowUp && comm.followUpReason && !isResolved && (
            <p className="text-[11px] text-[#EF4444] mt-2 leading-snug" data-testid={`text-followup-reason-${comm.id}`}>
              {comm.followUpReason}
            </p>
          )}

          {comm.claudeSummary && (
            <div className="mt-3 p-3 bg-[#F0F4F8] rounded-lg">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3 h-3 text-[#F5A623]" />
                <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wide">AI Summary</span>
              </div>
              <p className="text-sm text-[#2C3E50] leading-relaxed">{comm.claudeSummary}</p>
            </div>
          )}

          {/* How it was closed out, kept visible on the resolved list. */}
          {isResolved && (
            <div className="mt-3 p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]" data-testid={`text-resolution-${comm.id}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="w-3 h-3 text-[#22C55E]" />
                <span className="text-[10px] font-semibold text-[#22C55E] uppercase tracking-wide">
                  {comm.resolutionType === "READ_NO_TASK" ? "Read, no task needed" : "Resolved"}
                </span>
              </div>
              <p className="text-sm text-[#2C3E50] leading-relaxed">{comm.resolutionNote}</p>
              <p className="text-[10px] text-[#94A3B8] mt-1 inline-flex items-center gap-1">
                {comm.resolvedAt && format(new Date(comm.resolvedAt), "MMMM d, yyyy 'at' h:mm a")}
                {comm.resolvedBy && <><User className="w-2.5 h-2.5 ml-1" />{comm.resolvedBy}</>}
              </p>
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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide">Tasks</p>
                  {!addingTask && (
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setAddingTask(true)}
                      className="h-6 px-2 text-[10px] gap-1 text-[#1A5276] hover:bg-[#F0F4F8]"
                      data-testid={`button-add-task-${comm.id}`}
                    >
                      <Plus className="w-3 h-3" /> Add new
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {comm.tasks.length === 0 && !addingTask && (
                    <p className="text-xs text-[#94A3B8]">No tasks on this message.</p>
                  )}
                  {comm.tasks.map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      extraKeys={[["/api/clients", String(clientId), "communications"]]}
                    />
                  ))}
                  {addingTask && (
                    <AddTaskForm commId={comm.id} clientId={clientId} onDone={() => setAddingTask(false)} />
                  )}
                </div>
              </div>

              {comm.attachments.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-2">Attachments</p>
                  <div className="flex flex-wrap gap-2">
                    {comm.attachments.map(att => (
                      <a
                        key={att.id}
                        href={`/api/communication-attachments/${att.id}/download`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md text-xs text-[#2E86C1] hover:bg-[#F0F4F8] transition-colors"
                        data-testid={`attachment-link-${att.id}`}
                      >
                        <Download className="w-3 h-3" />
                        {att.filename}
                        {att.sizeBytes && <span className="text-[#94A3B8]">({Math.round(att.sizeBytes / 1024)}KB)</span>}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isResolved && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm" variant="outline"
                onClick={() => setResolving(true)}
                className="h-7 text-xs gap-1.5 text-[#22C55E] border-[#BBF7D0] hover:bg-[#F0FDF4]"
                data-testid={`button-resolve-comm-${comm.id}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {resolving && (
        <ResolveDialog
          title="Resolve this communication"
          subject={comm.subject}
          isPending={resolve.isPending}
          onCancel={() => setResolving(false)}
          onConfirm={note => resolve.mutate(note)}
        />
      )}
    </div>
  );
}

function AddManualDialog({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ subject: "", senderEmail: "", senderName: "", bodyText: "" });

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append("clientIds", String(clientId));
      const res = await fetch("/api/communications/manual", {
        method: "POST", body: fd, credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "communications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communications/feed"] });
      toast({ title: "Communication added", description: "AI has summarized and extracted action items." });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Communication</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Sender Email *</Label>
              <Input value={form.senderEmail} onChange={e => setForm(f => ({ ...f, senderEmail: e.target.value }))}
                placeholder="broker@example.com" className="mt-1" data-testid="input-sender-email" />
            </div>
            <div>
              <Label className="text-xs">Sender Name</Label>
              <Input value={form.senderName} onChange={e => setForm(f => ({ ...f, senderName: e.target.value }))}
                placeholder="Jane Smith" className="mt-1" data-testid="input-sender-name" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Subject</Label>
            <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Re: 2027 dental renewal" className="mt-1" data-testid="input-comm-subject" />
          </div>
          <div>
            <Label className="text-xs">Email Content *</Label>
            <Textarea value={form.bodyText} onChange={e => setForm(f => ({ ...f, bodyText: e.target.value }))}
              placeholder="Paste the email content here..." rows={8} className="mt-1 font-mono text-xs" data-testid="textarea-comm-body" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-comm">Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.senderEmail || !form.bodyText || mutation.isPending}
              className="bg-[#1A5276] text-white gap-2" data-testid="button-submit-comm">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {mutation.isPending ? "Processing with AI..." : "Save & Summarize"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CommunicationsTab({ clientId, focusCommId = null }: { clientId: number; focusCommId?: number | null }) {
  const [showAdd, setShowAdd] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [view, setView] = useState<"active" | "resolved">("active");
  const { toast } = useToast();

  const { data: comms = [], isLoading } = useQuery<Communication[]>({
    queryKey: ["/api/clients", String(clientId), "communications"],
    staleTime: 0,
  });

  const { data: manualTodos = [] } = useQuery<TaskLike[]>({
    queryKey: ["/api/clients", String(clientId), "manual-todos"],
    queryFn: () => fetch(`/api/clients/${clientId}/manual-todos`, { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
  });

  const { active, resolved } = useMemo(() => ({
    active: comms.filter(c => c.status !== "RESOLVED"),
    resolved: comms.filter(c => c.status === "RESOLVED"),
  }), [comms]);

  // If the deep link points at something already resolved, show that list
  // rather than an empty-looking Active tab.
  useEffect(() => {
    if (!focusCommId) return;
    const target = comms.find(c => c.id === focusCommId);
    if (target) setView(target.status === "RESOLVED" ? "resolved" : "active");
  }, [focusCommId, comms]);

  const handleAsk = async () => {
    if (!askQuestion.trim()) return;
    setAskLoading(true);
    setAiAnswer(null);
    try {
      const res = await apiRequest("POST", `/api/clients/${clientId}/communications/ask`, { question: askQuestion });
      const data = await res.json();
      setAiAnswer(data.answer);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAskLoading(false);
    }
  };

  const shown = view === "active" ? active : resolved;

  return (
    <div className="space-y-4" data-testid="communications-tab">
      {/* Ask AI */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#F5A623]" />
            <span className="text-sm font-semibold text-[#1A5276]">Ask AI about communications</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={askQuestion}
              onChange={e => setAskQuestion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleAsk()}
              placeholder='e.g. "What was the last request about the 2027 dental renewal?"'
              className="flex-1 text-sm"
              data-testid="input-ask-ai"
            />
            <Button onClick={handleAsk} disabled={!askQuestion.trim() || askLoading}
              className="bg-[#F5A623] hover:bg-[#e6971f] text-white gap-2 flex-shrink-0" data-testid="button-ask-ai">
              {askLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Ask
            </Button>
          </div>
          {aiAnswer && (
            <div className="mt-3 p-3 bg-[#F0F4F8] rounded-lg border border-[#2E86C1]/20">
              <p className="text-sm text-[#2C3E50] leading-relaxed whitespace-pre-wrap" data-testid="text-ai-answer">{aiAnswer}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active / Resolved split */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white">
          <button
            onClick={() => setView("active")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === "active" ? "bg-[#1A5276] text-white" : "text-[#94A3B8] hover:text-[#1A5276]"
            }`}
            data-testid="button-view-active"
          >
            Active {isLoading ? "" : `(${active.length})`}
          </button>
          <button
            onClick={() => setView("resolved")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === "resolved" ? "bg-[#1A5276] text-white" : "text-[#94A3B8] hover:text-[#1A5276]"
            }`}
            data-testid="button-view-resolved"
          >
            Resolved {isLoading ? "" : `(${resolved.length})`}
          </button>
        </div>
        <Button onClick={() => setShowAdd(true)} variant="outline" size="sm"
          className="gap-1.5 text-[#1A5276] border-[#1A5276]" data-testid="button-add-communication">
          <Plus className="w-3.5 h-3.5" /> Add Communication
        </Button>
      </div>

      {/* Work captured by hand: a phone call, a conversation. There is no
          message to nest it under, so it gets its own section rather than
          disappearing because nothing was emailed. */}
      {manualTodos.length > 0 && (
        <Card className="border-0 shadow-sm" data-testid="card-manual-todos">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <ListTodo className="w-4 h-4 text-[#1A5276]" />
              <span className="text-sm font-semibold text-[#1A5276]">Added by hand</span>
              <span className="text-xs text-[#94A3B8]">{manualTodos.length}</span>
              <span className="text-[10px] text-[#94A3B8] ml-1">no email behind these</span>
            </div>
            <div className="space-y-1.5">
              {manualTodos.map(t => (
                <TaskRow
                  key={t.id}
                  task={t}
                  extraKeys={[
                    ["/api/clients", String(clientId), "communications"],
                    ["/api/clients", String(clientId), "manual-todos"],
                  ]}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : comms.length === 0 ? (
        <Card className="border-dashed border-2 border-[#E2E8F0]">
          <CardContent className="py-12 text-center">
            <Mail className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#94A3B8]">No communications yet</p>
            <p className="text-xs text-[#94A3B8] mt-1">Forward emails to your Mailgun address or add them manually</p>
            <Button onClick={() => setShowAdd(true)} className="mt-4 bg-[#1A5276] text-white gap-2" size="sm" data-testid="button-add-first-comm">
              <Plus className="w-3.5 h-3.5" /> Add Communication
            </Button>
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <Card className="border-dashed border-2 border-[#E2E8F0]">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-[#94A3B8]">
              {view === "active" ? "Nothing outstanding for this client." : "Nothing has been resolved yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map(c => (
            <CommCard key={c.id} comm={c} clientId={clientId} focused={c.id === focusCommId} />
          ))}
        </div>
      )}

      {showAdd && <AddManualDialog clientId={clientId} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
