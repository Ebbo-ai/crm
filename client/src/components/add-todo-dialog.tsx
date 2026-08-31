import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, X, Plus, Building2 } from "lucide-react";
import {
  TASK_PRIORITIES, PRIORITY_LABEL, PRIORITY_STYLE, type TaskPriority,
} from "@shared/communication-state";

interface MatchedClient {
  clientId: number;
  clientName: string;
  clientCode: string;
  confidence: string;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "named in the note",
  medium: "matched on a contact or broker",
  low: "inferred from context",
  manual: "you added this",
};

/**
 * Adds a to-do that never arrived as an email.
 *
 * Kim types one plain sentence. There is no client dropdown to work through
 * first, because most of these are written down mid-phone-call and anything
 * slower than a sentence does not get written down at all.
 *
 * The AI then reads the sentence and says which clients it thinks it is about,
 * and she confirms before anything is saved. It shows its work rather than
 * filing silently: a to-do quietly attached to the wrong account is worse than
 * one attached to none.
 */
export function AddTodoDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState<"write" | "confirm">("write");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("NORMAL");
  const [attached, setAttached] = useState<MatchedClient[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: allClients = [] } = useQuery<any[]>({ queryKey: ["/api/clients"], enabled: step === "confirm" });

  const match = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/todos/match", { text: text.trim() });
      return (await res.json()) as { matches: MatchedClient[] };
    },
    onSuccess: data => {
      setAttached(data.matches);
      setStep("confirm");
    },
    // A matcher that is down must not block the work being recorded. She goes
    // to the confirm step with nothing attached and picks the clients herself.
    onError: (e: any) => {
      toast({
        title: "Could not read that automatically",
        description: `${e.message}. Attach the clients yourself below.`,
        variant: "destructive",
      });
      setAttached([]);
      setStep("confirm");
    },
  });

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/todos/manual", {
        description: text.trim(),
        priority,
        clients: attached.map(c => ({ clientId: c.clientId, confidence: c.confidence })),
      }),
    onSuccess: () => {
      for (const key of [["/api/todos"], ["/api/general/todos"], ["/api/communication-tasks"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast({
        title: "Added to the list",
        description: attached.length === 0
          ? `Filed under ${PRIORITY_LABEL[priority]} as a general to-do.`
          : `Filed under ${PRIORITY_LABEL[priority]} on ${attached.map(c => c.clientName).join(" and ")}.`,
      });
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const attachedIds = useMemo(() => new Set(attached.map(c => c.clientId)), [attached]);
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allClients
      .filter(c => !attachedIds.has(c.id))
      .filter(c =>
        c.clientName?.toLowerCase().includes(q) ||
        c.clientCode?.toLowerCase().includes(q) ||
        c.brokerFirmName?.toLowerCase().includes(q))
      .slice(0, 6);
  }, [search, allClients, attachedIds]);

  const busy = match.isPending || save.isPending;

  return (
    <Dialog open onOpenChange={() => !busy && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-add-todo-manual">
        <DialogHeader>
          <DialogTitle className="text-brand">Add a to-do</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === "write"
              ? "Write it the way you would say it. The client is worked out for you."
              : "Check who this belongs to before it is saved."}
          </DialogDescription>
        </DialogHeader>

        {step === "write" ? (
          <div className="space-y-4">
            <Textarea
              autoFocus
              rows={3}
              value={text}
              onChange={e => setText(e.target.value.slice(0, 500))}
              placeholder="Call Annette to discuss the Ware and Thomas renewals"
              className="text-sm"
              data-testid="textarea-todo-text"
            />
            <p className="text-xs text-muted-foreground -mt-3">{text.length}/500</p>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Priority</p>
              <div className="grid grid-cols-3 gap-2">
                {TASK_PRIORITIES.map(p => {
                  const style = PRIORITY_STYLE[p];
                  const selected = priority === p;
                  return (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className="px-2 py-2 rounded-lg border-2 transition-colors text-center"
                      style={{
                        borderColor: selected ? style.text : style.border,
                        backgroundColor: selected ? style.bg : "white",
                      }}
                      data-testid={`button-new-todo-priority-${p.toLowerCase()}`}
                    >
                      <span className="text-xs font-semibold" style={{ color: style.text }}>
                        {PRIORITY_LABEL[p]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy} data-testid="button-cancel-new-todo">
                Cancel
              </Button>
              <Button
                onClick={() => match.mutate()}
                disabled={!text.trim() || busy}
                className="bg-brand text-brand-foreground gap-1.5"
                data-testid="button-find-clients"
              >
                {match.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-2.5 rounded-md bg-surface-subtle border border-border">
              <p className="text-sm text-foreground leading-snug">{text.trim()}</p>
              <span
                className="inline-block mt-1.5 text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color: PRIORITY_STYLE[priority].text, backgroundColor: PRIORITY_STYLE[priority].bg }}
              >
                {PRIORITY_LABEL[priority]}
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {attached.length === 0 ? "No client" : attached.length === 1 ? "Client" : "Clients"}
              </p>

              {attached.length === 0 ? (
                <div className="p-2.5 rounded-md border border-dashed border-border bg-card" data-testid="text-todo-general">
                  <p className="text-xs text-foreground inline-flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-brand" />
                    This is a general to-do
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    It goes on the general list and on the main to-do list, not on a client record.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {attached.map(c => (
                    <div
                      key={c.clientId}
                      className="flex items-center gap-2 p-2 rounded-md border border-border bg-card"
                      data-testid={`chip-todo-client-${c.clientId}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{c.clientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.clientCode} · {CONFIDENCE_LABEL[c.confidence] ?? c.confidence}
                        </p>
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setAttached(prev => prev.filter(x => x.clientId !== c.clientId))}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-danger"
                        title="Remove"
                        data-testid={`button-remove-todo-client-${c.clientId}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {adding ? (
                <div className="mt-2">
                  <Input
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by client, code or broker"
                    className="h-8 text-xs"
                    data-testid="input-search-todo-client"
                  />
                  {searchResults.length > 0 && (
                    <div className="mt-1 border rounded-md divide-y bg-card max-h-44 overflow-y-auto">
                      {searchResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setAttached(prev => [...prev, {
                              clientId: c.id, clientName: c.clientName,
                              clientCode: c.clientCode, confidence: "manual",
                            }]);
                            setSearch("");
                            setAdding(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-subtle"
                          data-testid={`button-pick-todo-client-${c.id}`}
                        >
                          {c.clientName} <span className="text-muted-foreground">{c.clientCode}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setAdding(true)}
                    className="h-7 px-2 text-xs gap-1 text-brand hover:bg-surface-subtle"
                    data-testid="button-add-todo-client"
                  >
                    <Plus className="w-3 h-3" /> Add a client
                  </Button>
                  {attached.length > 0 && (
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setAttached([])}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-brand"
                      data-testid="button-make-todo-general"
                    >
                      Make it general
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2">
              <Button
                variant="ghost" onClick={() => setStep("write")} disabled={busy}
                className="text-xs text-muted-foreground"
                data-testid="button-back-new-todo"
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={busy} data-testid="button-cancel-new-todo-confirm">
                  Cancel
                </Button>
                <Button
                  onClick={() => save.mutate()}
                  disabled={busy}
                  className="bg-brand text-brand-foreground gap-1.5"
                  data-testid="button-save-new-todo"
                >
                  {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add to list
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
