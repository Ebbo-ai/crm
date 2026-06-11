import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, formatDistanceToNow, isPast, isToday } from "date-fns";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, AlertCircle, ChevronDown, ChevronUp, Bell, ExternalLink, CalendarClock } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const FOLLOW_UP_OPTIONS = [
  { label: "4 hours",  value: "4h",  hours: 4 },
  { label: "1 day",   value: "1d",  hours: 24 },
  { label: "2 days",  value: "2d",  hours: 48 },
  { label: "3 days",  value: "3d",  hours: 72 },
  { label: "1 week",  value: "1w",  hours: 168 },
  { label: "2 weeks", value: "2w",  hours: 336 },
  { label: "30 days", value: "30d", hours: 720 },
];

function addHours(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d;
}

function followUpStatus(followUpAt: string | null): "overdue" | "today" | "upcoming" | "none" {
  if (!followUpAt) return "none";
  const d = new Date(followUpAt);
  if (isPast(d)) return "overdue";
  if (isToday(d)) return "today";
  return "upcoming";
}

function FollowUpBadge({ followUpAt }: { followUpAt: string | null }) {
  const status = followUpStatus(followUpAt);
  if (status === "none") return null;
  const label =
    status === "overdue" ? `Overdue by ${formatDistanceToNow(new Date(followUpAt!))}` :
    status === "today"   ? "Follow-up due today" :
    `Follow-up in ${formatDistanceToNow(new Date(followUpAt!))}`;
  const cls =
    status === "overdue" ? "bg-red-100 text-red-700 border-red-200" :
    status === "today"   ? "bg-amber-100 text-amber-700 border-amber-200" :
    "bg-blue-50 text-blue-700 border-blue-200";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      <CalendarClock className="w-3 h-3" />
      {label}
    </span>
  );
}

interface Issue {
  id: number;
  clientId: number;
  clientName: string;
  clientCode: string;
  title: string;
  description: string;
  status: "ACTIVE" | "RESOLVED";
  resolutionNotes: string | null;
  createdBy: string;
  createdAt: string;
  resolvedAt: string | null;
  followUpAt: string | null;
}

export default function IssuesPage() {
  const { toast } = useToast();
  const [showResolved, setShowResolved] = useState(false);
  const [resolveIssue, setResolveIssue] = useState<Issue | null>(null);
  const [followUpIssue, setFollowUpIssue] = useState<Issue | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [selectedFollowUp, setSelectedFollowUp] = useState("");

  const { data: activeIssues, isLoading: activeLoading } = useQuery<Issue[]>({
    queryKey: ["/api/issues", "ACTIVE"],
    queryFn: () => fetch("/api/issues?status=ACTIVE", { credentials: "include" }).then(r => r.json()),
  });

  const { data: resolvedIssues, isLoading: resolvedLoading } = useQuery<Issue[]>({
    queryKey: ["/api/issues", "RESOLVED"],
    queryFn: () => fetch("/api/issues?status=RESOLVED", { credentials: "include" }).then(r => r.json()),
    enabled: showResolved,
  });

  const resolveMutation = useMutation({
    mutationFn: (data: { id: number; resolutionNotes: string }) =>
      apiRequest("PATCH", `/api/issues/${data.id}/resolve`, { resolutionNotes: data.resolutionNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/issues/followups-due-count"] });
      setResolveIssue(null);
      setResolutionNotes("");
      toast({ title: "Issue marked as resolved" });
    },
    onError: () => toast({ title: "Failed to resolve issue", variant: "destructive" }),
  });

  const followUpMutation = useMutation({
    mutationFn: (data: { id: number; followUpAt: string }) =>
      apiRequest("PATCH", `/api/issues/${data.id}/followup`, { followUpAt: data.followUpAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/issues/followups-due-count"] });
      setFollowUpIssue(null);
      setSelectedFollowUp("");
      toast({ title: "Follow-up reminder set" });
    },
    onError: () => toast({ title: "Failed to set follow-up", variant: "destructive" }),
  });

  const clearFollowUpMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("PATCH", `/api/issues/${id}/followup`, { followUpAt: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/issues/followups-due-count"] });
      toast({ title: "Follow-up reminder cleared" });
    },
  });

  const overdueFollowUps = (activeIssues ?? []).filter(i => followUpStatus(i.followUpAt) === "overdue");
  const todayFollowUps  = (activeIssues ?? []).filter(i => followUpStatus(i.followUpAt) === "today");
  const alertCount = overdueFollowUps.length + todayFollowUps.length;

  function handleSetFollowUp() {
    if (!followUpIssue || !selectedFollowUp) return;
    const opt = FOLLOW_UP_OPTIONS.find(o => o.value === selectedFollowUp);
    if (!opt) return;
    followUpMutation.mutate({ id: followUpIssue.id, followUpAt: addHours(opt.hours).toISOString() });
  }

  return (
    <div data-testid="issues-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5276]" data-testid="text-page-title">Issues</h1>
        <p className="text-sm text-[#94A3B8] mt-1">Track and resolve active issues across all clients</p>
      </div>

      {alertCount > 0 && (
        <div className="mb-5 p-4 rounded-lg border border-red-200 bg-red-50 flex items-start gap-3" data-testid="followup-alert-banner">
          <Bell className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">
              {alertCount} follow-up{alertCount !== 1 ? "s" : ""} require attention
            </p>
            <div className="mt-1 space-y-0.5">
              {overdueFollowUps.map(i => (
                <p key={i.id} className="text-xs text-red-600">
                  <span className="font-medium">{i.clientName}</span> — {i.title}
                  {" "}<span className="text-red-400">(overdue by {formatDistanceToNow(new Date(i.followUpAt!))})</span>
                </p>
              ))}
              {todayFollowUps.map(i => (
                <p key={i.id} className="text-xs text-amber-700">
                  <span className="font-medium">{i.clientName}</span> — {i.title}
                  {" "}<span className="text-amber-500">(due today)</span>
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      <Card className="border-0 shadow-sm mb-6">
        <CardHeader className="pb-3 pt-5 px-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1A5276]">Active Issues</h2>
            {activeIssues && (
              <Badge variant="secondary" className="text-xs">{activeIssues.length} open</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {activeLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
          ) : !activeIssues?.length ? (
            <div className="text-center py-10">
              <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
              <p className="text-sm text-[#94A3B8]">No active issues — all clear!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeIssues.map(issue => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onResolve={() => { setResolveIssue(issue); setResolutionNotes(""); }}
                  onSetFollowUp={() => { setFollowUpIssue(issue); setSelectedFollowUp(""); }}
                  onClearFollowUp={() => clearFollowUpMutation.mutate(issue.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <button
          className="flex items-center gap-2 text-sm font-medium text-[#94A3B8] hover:text-[#2C3E50] transition-colors mb-3"
          onClick={() => setShowResolved(v => !v)}
          data-testid="button-toggle-resolved"
        >
          {showResolved ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {showResolved ? "Hide" : "Show"} resolved issues
        </button>

        {showResolved && (
          <Card className="border-0 shadow-sm">
            <CardContent className="px-5 py-5">
              {resolvedLoading ? (
                <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-16" />)}</div>
              ) : !resolvedIssues?.length ? (
                <p className="text-sm text-[#94A3B8] text-center py-6">No resolved issues yet</p>
              ) : (
                <div className="space-y-3">
                  {resolvedIssues.map(issue => (
                    <ResolvedCard key={issue.id} issue={issue} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!resolveIssue} onOpenChange={open => !open && setResolveIssue(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-resolve-issue">
          <DialogHeader>
            <DialogTitle>Mark Issue as Resolved</DialogTitle>
          </DialogHeader>
          {resolveIssue && (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-[#F0F4F8]">
                <p className="text-sm font-medium text-[#2C3E50]">{resolveIssue.title}</p>
                <p className="text-xs text-[#94A3B8] mt-1">{resolveIssue.clientName}</p>
              </div>
              <div>
                <Label htmlFor="resolution-notes" className="text-sm font-medium">Resolution Notes</Label>
                <Textarea
                  id="resolution-notes"
                  placeholder="Describe how this issue was resolved..."
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  className="mt-1.5 min-h-[100px]"
                  data-testid="textarea-resolution-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveIssue(null)} data-testid="button-cancel-resolve">Cancel</Button>
            <Button
              className="bg-[#22C55E] hover:bg-[#16A34A] text-white"
              onClick={() => resolveIssue && resolveMutation.mutate({ id: resolveIssue.id, resolutionNotes })}
              disabled={resolveMutation.isPending}
              data-testid="button-confirm-resolve"
            >
              {resolveMutation.isPending ? "Resolving..." : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!followUpIssue} onOpenChange={open => !open && setFollowUpIssue(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-followup">
          <DialogHeader>
            <DialogTitle>{followUpIssue?.followUpAt ? "Change" : "Set"} Follow-up Reminder</DialogTitle>
          </DialogHeader>
          {followUpIssue && (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-[#F0F4F8]">
                <p className="text-sm font-medium text-[#2C3E50]">{followUpIssue.title}</p>
                <p className="text-xs text-[#94A3B8] mt-1">{followUpIssue.clientName}</p>
                {followUpIssue.followUpAt && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" />
                    Current: {format(new Date(followUpIssue.followUpAt), "MMM d, yyyy h:mm a")}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-sm font-medium">Remind me in</Label>
                <Select value={selectedFollowUp} onValueChange={setSelectedFollowUp}>
                  <SelectTrigger className="mt-1.5" data-testid="select-followup-duration">
                    <SelectValue placeholder="Select a time period..." />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOW_UP_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} data-testid={`option-followup-${opt.value}`}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedFollowUp && (
                  <p className="text-xs text-[#94A3B8] mt-1.5">
                    Follow-up will be set for:{" "}
                    <span className="font-medium text-[#2C3E50]">
                      {format(addHours(FOLLOW_UP_OPTIONS.find(o => o.value === selectedFollowUp)!.hours), "MMM d, yyyy h:mm a")}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpIssue(null)} data-testid="button-cancel-followup">Cancel</Button>
            <Button
              className="bg-[#1A5276] hover:bg-[#154360] text-white"
              onClick={handleSetFollowUp}
              disabled={!selectedFollowUp || followUpMutation.isPending}
              data-testid="button-confirm-followup"
            >
              {followUpMutation.isPending ? "Saving..." : followUpIssue?.followUpAt ? "Update Reminder" : "Set Reminder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IssueCard({ issue, onResolve, onSetFollowUp, onClearFollowUp }: {
  issue: Issue;
  onResolve: () => void;
  onSetFollowUp: () => void;
  onClearFollowUp: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = followUpStatus(issue.followUpAt);
  const isOverdue = status === "overdue";
  const isToday_ = status === "today";

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        isOverdue ? "border-red-200 bg-red-50/50" :
        isToday_  ? "border-amber-200 bg-amber-50/30" :
        "border-gray-200 bg-white"
      }`}
      data-testid={`issue-card-${issue.id}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isOverdue ? "text-red-500" : "text-[#EF4444]"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#2C3E50] leading-tight">{issue.title}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Link href={`/clients/${issue.clientId}`}>
                  <span className="text-xs text-[#2E86C1] hover:underline font-medium flex items-center gap-0.5">
                    {issue.clientCode} — {issue.clientName}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </span>
                </Link>
                <span className="text-xs text-[#94A3B8]">·</span>
                <span className="text-xs text-[#94A3B8] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
                </span>
              </div>
              {issue.followUpAt && (
                <div className="mt-1.5">
                  <FollowUpBadge followUpAt={issue.followUpAt} />
                </div>
              )}
            </div>
          </div>

          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-sm text-[#4A5568] whitespace-pre-wrap">{issue.description}</p>
              <p className="text-xs text-[#94A3B8] mt-1">Reported by {issue.createdBy}</p>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setExpanded(v => !v)}
              data-testid={`button-expand-issue-${issue.id}`}
            >
              {expanded ? "Less" : "Details"}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-[#22C55E] hover:bg-[#16A34A] text-white border-0"
              onClick={onResolve}
              data-testid={`button-resolve-issue-${issue.id}`}
            >
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Resolve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={`h-7 text-xs ${issue.followUpAt ? "border-amber-300 text-amber-700 hover:bg-amber-50" : "text-[#2E86C1] border-[#2E86C1]/30 hover:bg-blue-50"}`}
              onClick={onSetFollowUp}
              data-testid={`button-followup-issue-${issue.id}`}
            >
              <Bell className="w-3 h-3 mr-1" />
              {issue.followUpAt ? "Change Reminder" : "Set Reminder"}
            </Button>
            {issue.followUpAt && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-[#94A3B8] hover:text-[#EF4444]"
                onClick={onClearFollowUp}
                data-testid={`button-clear-followup-${issue.id}`}
              >
                Clear Reminder
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResolvedCard({ issue }: { issue: Issue }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4" data-testid={`resolved-card-${issue.id}`}>
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-4 h-4 mt-0.5 text-[#22C55E] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#64748B]">{issue.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Link href={`/clients/${issue.clientId}`}>
              <span className="text-xs text-[#94A3B8] hover:text-[#2E86C1]">
                {issue.clientCode} — {issue.clientName}
              </span>
            </Link>
            {issue.resolvedAt && (
              <>
                <span className="text-xs text-[#94A3B8]">·</span>
                <span className="text-xs text-[#94A3B8]">
                  Resolved {format(new Date(issue.resolvedAt), "MMM d, yyyy")}
                </span>
              </>
            )}
          </div>
          {issue.resolutionNotes && (
            <p className="text-xs text-[#64748B] mt-1.5 italic">"{issue.resolutionNotes}"</p>
          )}
        </div>
      </div>
    </div>
  );
}
