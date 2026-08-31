import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, ListPlus } from "lucide-react";
import {
  RESOLUTION_NOTE_MAX, checkResolutionNote,
  TASK_PRIORITIES, PRIORITY_LABEL, PRIORITY_STYLE, type TaskPriority,
} from "@shared/communication-state";

/**
 * The mandatory resolution note.
 *
 * There is no way to dismiss this dialog into a resolved state without typing
 * something. That is the whole point: a resolution with no note leaves nobody
 * able to answer "what happened to that?" later on.
 */
export function ResolveDialog({
  title = "Resolve",
  subject,
  onCancel,
  onConfirm,
  isPending,
}: {
  title?: string;
  subject?: string | null;
  onCancel: () => void;
  onConfirm: (note: string) => void;
  isPending?: boolean;
}) {
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const check = checkResolutionNote(note);
  const remaining = RESOLUTION_NOTE_MAX - note.length;
  const showError = touched && !check.ok;

  const submit = () => {
    setTouched(true);
    if (!check.ok) return;
    onConfirm(check.value);
  };

  return (
    <Dialog open onOpenChange={() => !isPending && onCancel()}>
      <DialogContent className="max-w-lg" data-testid="dialog-resolve">
        <DialogHeader>
          <DialogTitle className="text-brand">{title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {subject ? <span className="block truncate mb-1 text-foreground">{subject}</span> : null}
            Record what was done. This note is kept permanently as the record of how it was handled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-1">
          <Label className="text-xs" htmlFor="resolution-note">What was done? <span className="text-danger">*</span></Label>
          <Textarea
            id="resolution-note"
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value.slice(0, RESOLUTION_NOTE_MAX))}
            onBlur={() => setTouched(true)}
            rows={5}
            placeholder="e.g. Called Christina at Leavitt and re-sent the 2027 renewal packet."
            className={`text-sm ${showError ? "border-danger focus-visible:ring-danger" : ""}`}
            data-testid="textarea-resolution-note"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-danger" data-testid="text-resolution-error">
              {showError ? check.error : ""}
            </span>
            <span className={`text-xs tabular-nums ${remaining < 50 ? "text-warning-strong" : "text-muted-foreground"}`} data-testid="text-note-remaining">
              {remaining} left
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending} data-testid="button-cancel-resolve">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending || !check.ok}
            className="bg-success hover:bg-success text-success-foreground gap-2"
            data-testid="button-confirm-resolve"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Resolve
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Priority picker for pushing a task onto the to-do list. A priority is
 * required, so the list always sorts into a section rather than a limbo pile.
 */
export function AddToTodoDialog({
  subject,
  onCancel,
  onConfirm,
  isPending,
}: {
  subject?: string | null;
  onCancel: () => void;
  onConfirm: (priority: TaskPriority) => void;
  isPending?: boolean;
}) {
  const [priority, setPriority] = useState<TaskPriority | null>(null);

  return (
    <Dialog open onOpenChange={() => !isPending && onCancel()}>
      <DialogContent className="max-w-md" data-testid="dialog-add-todo">
        <DialogHeader>
          <DialogTitle className="text-brand">Add to to-do list</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {subject ? <span className="block truncate mb-1 text-foreground">{subject}</span> : null}
            How urgent is this? It will sit in that section until it is resolved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-1">
          {TASK_PRIORITIES.map(p => {
            const style = PRIORITY_STYLE[p];
            const selected = priority === p;
            return (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className="w-full text-left px-3 py-2.5 rounded-lg border-2 transition-colors"
                style={{
                  borderColor: selected ? style.text : style.border,
                  backgroundColor: selected ? style.bg : "white",
                }}
                data-testid={`button-priority-${p.toLowerCase()}`}
              >
                <span className="text-sm font-semibold" style={{ color: style.text }}>
                  {PRIORITY_LABEL[p]}
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {p === "URGENT" && "Needs chasing today."}
                  {p === "NORMAL" && "Work it in the usual course."}
                  {p === "CASUAL" && "No deadline pressure."}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending} data-testid="button-cancel-todo">
            Cancel
          </Button>
          <Button
            onClick={() => priority && onConfirm(priority)}
            disabled={isPending || !priority}
            className="bg-brand hover:bg-brand-dark text-brand-foreground gap-2"
            data-testid="button-confirm-todo"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListPlus className="w-4 h-4" />}
            Add to list
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
