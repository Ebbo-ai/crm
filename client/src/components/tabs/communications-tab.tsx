import { useState } from "react";
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
import { formatDistanceToNow } from "date-fns";
import {
  Mail, Paperclip, CheckSquare, ChevronDown, ChevronUp,
  Plus, Send, Sparkles, Loader2, Download, Clock, CheckCircle2, Building2
} from "lucide-react";

interface CommTask {
  id: number;
  description: string;
  dueDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
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
  source: string;
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

function CommCard({ comm, clientId }: { comm: Communication; clientId: number }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const completeMutation = useMutation({
    mutationFn: (taskId: number) => apiRequest("POST", `/api/communication-tasks/${taskId}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "communications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication-tasks"] });
      toast({ title: "Task marked complete" });
    },
  });

  const actionItems: { description: string; dueDate?: string | null }[] = (() => {
    try { return JSON.parse(comm.claudeActionItems ?? "[]"); } catch { return []; }
  })();

  const senderLabel = comm.senderName || comm.senderEmail;
  const timeAgo = formatDistanceToNow(new Date(comm.receivedAt), { addSuffix: true });

  return (
    <Card className="border border-gray-100 shadow-none" data-testid={`comm-card-${comm.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${comm.isInternal ? "bg-[#1A5276]" : "bg-[#2E86C1]"}`}>
              {(comm.senderName || comm.senderEmail).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#2C3E50]" data-testid={`text-sender-${comm.id}`}>{senderLabel}</span>
                {comm.isInternal && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#1A5276] text-[#1A5276]">Internal</Badge>}
                {comm.source === "manual" && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#94A3B8] text-[#94A3B8]">Manual</Badge>}
                {comm.senderDomain && !comm.isInternal && (
                  <span className="text-[10px] text-[#94A3B8]">@{comm.senderDomain}</span>
                )}
              </div>
              <p className="text-sm text-[#2C3E50] font-medium mt-0.5 truncate">{comm.subject || "(no subject)"}</p>
              <p className="text-xs text-[#94A3B8] mt-0.5">{timeAgo}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {comm.attachments.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-[#94A3B8]">
                <Paperclip className="w-3 h-3" />{comm.attachments.length}
              </span>
            )}
            {comm.tasks.filter(t => !t.isCompleted).length > 0 && (
              <span className="flex items-center gap-1 text-xs text-[#F5A623] font-medium">
                <CheckSquare className="w-3 h-3" />{comm.tasks.filter(t => !t.isCompleted).length}
              </span>
            )}
            <button onClick={() => setExpanded(v => !v)} className="text-[#94A3B8] hover:text-[#1A5276] p-1" data-testid={`button-expand-${comm.id}`}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* AI Summary always visible */}
        {comm.claudeSummary && (
          <div className="mt-3 p-3 bg-[#F0F4F8] rounded-lg">
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles className="w-3 h-3 text-[#F5A623]" />
              <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wide">AI Summary</span>
            </div>
            <p className="text-sm text-[#2C3E50] leading-relaxed">{comm.claudeSummary}</p>
          </div>
        )}

        {/* Expanded: full body, tasks, attachments */}
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
                      <div key={task.id} className={`flex items-start gap-2 p-2 rounded-md ${task.isCompleted ? "opacity-50" : "bg-white border"}`} data-testid={`task-item-${task.id}`}>
                        <button
                          onClick={() => !task.isCompleted && completeMutation.mutate(task.id)}
                          disabled={task.isCompleted || completeMutation.isPending}
                          className="mt-0.5 flex-shrink-0"
                          data-testid={`button-complete-task-${task.id}`}
                        >
                          {task.isCompleted
                            ? <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                            : <div className="w-4 h-4 rounded border-2 border-[#94A3B8] hover:border-[#1A5276]" />
                          }
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
      </CardContent>
    </Card>
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

export default function CommunicationsTab({ clientId }: { clientId: number }) {
  const [showAdd, setShowAdd] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const { toast } = useToast();

  const { data: comms = [], isLoading } = useQuery<Communication[]>({
    queryKey: ["/api/clients", String(clientId), "communications"],
    staleTime: 0,
  });

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

      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#1A5276]">
          {isLoading ? "Loading..." : `${comms.length} Communication${comms.length !== 1 ? "s" : ""}`}
        </h3>
        <Button onClick={() => setShowAdd(true)} variant="outline" size="sm"
          className="gap-1.5 text-[#1A5276] border-[#1A5276]" data-testid="button-add-communication">
          <Plus className="w-3.5 h-3.5" /> Add Communication
        </Button>
      </div>

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
      ) : (
        <div className="space-y-3">
          {comms.map(c => <CommCard key={c.id} comm={c} clientId={clientId} />)}
        </div>
      )}

      {showAdd && <AddManualDialog clientId={clientId} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
