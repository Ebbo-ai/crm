import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { format } from "date-fns";

const ISSUE_TYPES = [
  { value: "FUNDING",     label: "Funding" },
  { value: "CLAIMS",      label: "Claims" },
  { value: "CALL_CENTER", label: "Call Center" },
  { value: "REPORTING",   label: "Reporting" },
  { value: "OTHER",       label: "Other" },
];

const ISSUE_TYPE_COLORS: Record<string, string> = {
  FUNDING:     "bg-blue-100 text-blue-700",
  CLAIMS:      "bg-purple-100 text-purple-700",
  CALL_CENTER: "bg-amber-100 text-amber-700",
  REPORTING:   "bg-teal-100 text-teal-700",
  OTHER:       "bg-gray-100 text-gray-600",
};

function IssueTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const label = ISSUE_TYPES.find(t => t.value === type)?.label ?? type;
  const color = ISSUE_TYPE_COLORS[type] ?? "bg-gray-100 text-gray-600";
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>{label}</span>;
}

export default function IssuesTab({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [editTypeId, setEditTypeId] = useState<number | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  const { data: issues = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", String(clientId), "issues"],
  });

  const activeIssues = issues.filter(i => i.status === "ACTIVE");
  const resolvedIssues = issues.filter(i => i.status === "RESOLVED");

  return (
    <div data-testid="issues-tab">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[#1A5276]">
          Issues
          {activeIssues.length > 0 && (
            <span className="ml-2 text-sm font-bold text-white bg-[#EF4444] rounded-full px-2 py-0.5">{activeIssues.length}</span>
          )}
        </h2>
        <Button onClick={() => setShowCreate(true)} className="bg-[#EF4444] text-white gap-2" data-testid="button-report-issue">
          <Plus className="w-4 h-4" /> Report Issue
        </Button>
      </div>

      {activeIssues.length === 0 && !isLoading ? (
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
            <p className="text-sm text-[#94A3B8]">No issues reported -- looking good!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 mb-6">
          {activeIssues.map((issue: any) => (
            <Card key={issue.id} className="border-0 shadow-sm border-l-4 border-l-[#EF4444]" data-testid={`issue-card-${issue.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="pulse-dot mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-[#2C3E50] cursor-pointer truncate" onClick={() => setExpandedIssue(expandedIssue === issue.id ? null : issue.id)}>
                          {issue.title}
                        </h3>
                        <button onClick={() => setEditTypeId(issue.id)} className="flex-shrink-0" data-testid={`button-edit-type-${issue.id}`}>
                          <IssueTypeBadge type={issue.issueType} />
                        </button>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setEditTypeId(issue.id)} className="text-[#94A3B8] text-xs h-7 px-2" data-testid={`button-edit-type-btn-${issue.id}`}>
                          Edit Type
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setResolveId(issue.id)} className="text-[#22C55E] border-[#22C55E]" data-testid={`button-resolve-${issue.id}`}>
                          Resolve
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-[#94A3B8] mt-1">
                      Created by {issue.createdBy} on {format(new Date(issue.createdAt), "MMM d, yyyy")}
                    </p>
                    {expandedIssue === issue.id && (
                      <p className="text-sm text-[#2C3E50] mt-3 whitespace-pre-wrap bg-[#F0F4F8] p-3 rounded-md">{issue.description}</p>
                    )}
                    {expandedIssue !== issue.id && (
                      <p className="text-sm text-[#94A3B8] mt-1 truncate">{issue.description}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {resolvedIssues.length > 0 && (
        <Collapsible open={showResolved} onOpenChange={setShowResolved}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-sm font-medium text-[#94A3B8] mb-3 hover:text-[#2C3E50] transition-colors" data-testid="button-toggle-resolved">
              {showResolved ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Resolved Issues ({resolvedIssues.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3">
              {resolvedIssues.map((issue: any) => (
                <Card key={issue.id} className="border-0 shadow-sm border-l-4 border-l-[#22C55E]" data-testid={`resolved-issue-${issue.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-4 h-4 text-[#22C55E] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-[#2C3E50] cursor-pointer truncate" onClick={() => setExpandedIssue(expandedIssue === issue.id ? null : issue.id)}>
                            {issue.title}
                          </h3>
                          <IssueTypeBadge type={issue.issueType} />
                        </div>
                        <p className="text-xs text-[#94A3B8] mt-1">
                          Created {format(new Date(issue.createdAt), "MMM d, yyyy")} | Resolved {issue.resolvedAt ? format(new Date(issue.resolvedAt), "MMM d, yyyy") : ""}
                        </p>
                        {expandedIssue === issue.id && (
                          <div className="mt-3 space-y-2">
                            <p className="text-sm text-[#2C3E50] whitespace-pre-wrap bg-[#F0F4F8] p-3 rounded-md">{issue.description}</p>
                            {issue.resolutionNotes && (
                              <div className="bg-green-50 p-3 rounded-md">
                                <p className="text-xs font-semibold text-green-700 mb-1">Resolution Notes</p>
                                <p className="text-sm text-green-800">{issue.resolutionNotes}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <CreateIssueDialog open={showCreate} onClose={() => setShowCreate(false)} clientId={clientId} />
      <ResolveIssueDialog open={resolveId !== null} onClose={() => setResolveId(null)} issueId={resolveId} clientId={clientId} />
      <EditIssueTypeDialog open={editTypeId !== null} onClose={() => setEditTypeId(null)} issueId={editTypeId} clientId={clientId} currentType={issues.find(i => i.id === editTypeId)?.issueType ?? null} />
    </div>
  );
}

function CreateIssueDialog({ open, onClose, clientId }: { open: boolean; onClose: () => void; clientId: number }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<string>("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/issues`, { title, description, issueType: issueType || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/issues", "ACTIVE"] });
      toast({ title: "Issue reported successfully" });
      onClose();
      setTitle("");
      setDescription("");
      setIssueType("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Report Issue</DialogTitle>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (title && description) mutation.mutate(); }} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Issue Type</Label>
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger data-testid="select-issue-type">
                <SelectValue placeholder="Select type (optional)" />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium">Issue Title <span className="text-[#EF4444]">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} data-testid="input-issue-title" />
          </div>
          <div>
            <Label className="text-sm font-medium">Description <span className="text-[#EF4444]">*</span></Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} data-testid="input-issue-description" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending || !title || !description} className="bg-[#EF4444] text-white" data-testid="button-submit-issue">
              {mutation.isPending ? "Creating..." : "Report Issue"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditIssueTypeDialog({ open, onClose, issueId, clientId, currentType }: { open: boolean; onClose: () => void; issueId: number | null; clientId: number; currentType: string | null }) {
  const { toast } = useToast();
  const [issueType, setIssueType] = useState<string>(currentType ?? "");

  useEffect(() => {
    if (open) setIssueType(currentType ?? "");
  }, [open, currentType]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/issues/${issueId}`, { issueType: issueType || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/issues", "ACTIVE"] });
      toast({ title: "Issue type updated" });
      onClose();
      setIssueType("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setIssueType(""); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Edit Issue Type</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-sm font-medium">Issue Type</Label>
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger data-testid="select-edit-issue-type">
                <SelectValue placeholder="Select type (or clear)" />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="bg-[#1A5276] text-white" data-testid="button-save-issue-type">
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => { onClose(); setIssueType(""); }}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResolveIssueDialog({ open, onClose, issueId, clientId }: { open: boolean; onClose: () => void; issueId: number | null; clientId: number }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/issues/${issueId}`, { status: "RESOLVED", resolutionNotes: notes || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/issues", "ACTIVE"] });
      toast({ title: "Issue resolved" });
      onClose();
      setNotes("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Resolve Issue</DialogTitle>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Resolution Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Optional but encouraged..." data-testid="input-resolution-notes" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending} className="bg-[#22C55E] text-white" data-testid="button-confirm-resolve">
              {mutation.isPending ? "Resolving..." : "Confirm Resolve"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
