import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ResolveDialog, AddToTodoDialog } from "@/components/resolution-dialogs";
import { CheckCircle2, ListPlus, Clock, User, Building2 } from "lucide-react";
import { format } from "date-fns";
import { PRIORITY_LABEL, PRIORITY_STYLE, type TaskPriority } from "@shared/communication-state";

export interface TaskLike {
  id: number;
  description: string;
  dueDate: string | null;
  status: string;
  priority: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  origin: string;
  /**
   * The clients the task covers. Absent on the older callers that never had
   * more than one; empty means the work belongs to the business.
   */
  clients?: { id: number; clientName: string; clientCode: string }[];
}

function dueStatus(dueDate: string | null) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  return "upcoming";
}

/** Query keys that go stale whenever a task changes state. */
const SHARED_KEYS = [
  ["/api/communication-tasks"],
  ["/api/todos"],
  ["/api/communications/feed"],
];

/**
 * One task, with the only two ways out of it.
 *
 * The old checkbox is gone. A task is either resolved with a note explaining
 * what was done, or pushed onto the to-do list under a priority. There is no
 * third path and nothing can be deleted, so every task ends up somewhere that
 * can be read back later.
 */
export function TaskRow({ task, extraKeys = [] }: { task: TaskLike; extraKeys?: unknown[][] }) {
  const { toast } = useToast();
  const [resolving, setResolving] = useState(false);
  const [prioritising, setPrioritising] = useState(false);

  const invalidate = () => {
    for (const key of [...SHARED_KEYS, ...extraKeys]) {
      queryClient.invalidateQueries({ queryKey: key as any });
    }
  };

  const resolve = useMutation({
    mutationFn: (note: string) => apiRequest("POST", `/api/communication-tasks/${task.id}/resolve`, { note }),
    onSuccess: () => {
      invalidate();
      setResolving(false);
      toast({ title: "Resolved", description: "Your note is saved on the record." });
    },
    onError: (e: any) => toast({ title: "Could not resolve", description: e.message, variant: "destructive" }),
  });

  const toTodo = useMutation({
    mutationFn: (priority: TaskPriority) => apiRequest("POST", `/api/communication-tasks/${task.id}/todo`, { priority }),
    onSuccess: (_r, priority) => {
      invalidate();
      setPrioritising(false);
      toast({ title: "Added to the to-do list", description: `Filed under ${PRIORITY_LABEL[priority]}.` });
    },
    onError: (e: any) => toast({ title: "Could not add to the list", description: e.message, variant: "destructive" }),
  });

  const isResolved = task.status === "RESOLVED";
  const onList = task.status === "TODO";
  const status = dueStatus(task.dueDate);
  const priorityStyle = task.priority ? PRIORITY_STYLE[task.priority as TaskPriority] : null;

  return (
    <div
      className={`p-2.5 rounded-md border ${isResolved ? "bg-surface-subtle border-border" : "bg-card border-border"}`}
      data-testid={`task-item-${task.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isResolved && <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />}
            {onList && priorityStyle && (
              <span
                className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color: priorityStyle.text, backgroundColor: priorityStyle.bg }}
                data-testid={`badge-priority-${task.id}`}
              >
                {PRIORITY_LABEL[task.priority as TaskPriority]}
              </span>
            )}
            {task.origin === "MANUAL" && (
              <span className="text-xs text-muted-foreground uppercase tracking-wider">added by hand</span>
            )}
            {/* Shown only when the task covers more than the record you are
                looking at, or no client at all. Repeating the current client's
                own name on its own record would just be noise. */}
            {task.clients && task.clients.length !== 1 && (
              task.clients.length === 0 ? (
                <span className="text-xs text-brand uppercase tracking-wider inline-flex items-center gap-0.5" data-testid={`badge-general-${task.id}`}>
                  <Building2 className="w-2.5 h-2.5" /> General
                </span>
              ) : (
                <span className="text-xs text-muted-foreground" data-testid={`badge-task-clients-${task.id}`}>
                  also on {task.clients.length - 1} other client{task.clients.length > 2 ? "s" : ""}
                </span>
              )
            )}
          </div>

          <p className={`text-xs mt-0.5 ${isResolved ? "text-muted-foreground" : "text-foreground"}`}>
            {task.description}
          </p>

          {task.dueDate && !isResolved && (
            <span className={`text-xs font-medium inline-flex items-center gap-1 mt-0.5 ${
              status === "overdue" ? "text-danger" : status === "today" ? "text-warning-strong" : "text-muted-foreground"
            }`}>
              <Clock className="w-2.5 h-2.5" />
              {status === "overdue" ? "Overdue — " : status === "today" ? "Due today" : "Due "}
              {status !== "today" && new Date(task.dueDate).toLocaleDateString()}
            </span>
          )}

          {isResolved && task.resolutionNote && (
            <div className="mt-1.5 pl-2 border-l-2 border-success/40" data-testid={`text-task-resolution-${task.id}`}>
              <p className="text-xs text-foreground leading-snug">{task.resolutionNote}</p>
              <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                {task.resolvedAt && format(new Date(task.resolvedAt), "MMM d, yyyy")}
                {task.resolvedBy && <><User className="w-2.5 h-2.5 ml-1" />{task.resolvedBy}</>}
              </p>
            </div>
          )}
        </div>

        {!isResolved && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {!onList && (
              <Button
                size="sm" variant="outline"
                onClick={() => setPrioritising(true)}
                className="h-6 px-2 text-xs gap-1 border-brand text-brand"
                data-testid={`button-task-todo-${task.id}`}
              >
                <ListPlus className="w-3 h-3" /> To-do
              </Button>
            )}
            <Button
              size="sm" variant="outline"
              onClick={() => setResolving(true)}
              className="h-6 px-2 text-xs gap-1 border-success-tint text-success hover:bg-success-tint"
              data-testid={`button-task-resolve-${task.id}`}
            >
              <CheckCircle2 className="w-3 h-3" /> Resolved
            </Button>
          </div>
        )}
      </div>

      {resolving && (
        <ResolveDialog
          title="Resolve this task"
          subject={task.description}
          isPending={resolve.isPending}
          onCancel={() => setResolving(false)}
          onConfirm={note => resolve.mutate(note)}
        />
      )}
      {prioritising && (
        <AddToTodoDialog
          subject={task.description}
          isPending={toTodo.isPending}
          onCancel={() => setPrioritising(false)}
          onConfirm={p => toTodo.mutate(p)}
        />
      )}
    </div>
  );
}
