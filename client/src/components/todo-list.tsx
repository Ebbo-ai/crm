import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ResolveDialog } from "@/components/resolution-dialogs";
import { formatDistanceToNow } from "date-fns";
import { AddTodoDialog } from "@/components/add-todo-dialog";
import { GripVertical, CheckCircle2, ListTodo, ArrowRight, Clock, Plus, Building2, User } from "lucide-react";
import {
  TASK_PRIORITIES, PRIORITY_LABEL, PRIORITY_STYLE, type TaskPriority,
} from "@shared/communication-state";
import { useAuth } from "@/lib/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The two people work can belong to. Kept in sync with server/routes.ts TASK_OWNERS. */
export const TASK_OWNERS = ["Kim Anderson", "Steve Schultz"] as const;

export interface Todo {
  id: number;
  /** Null when Kim typed the to-do herself: there is no email behind it. */
  communicationId: number | null;
  /** Every client this to-do touches. Empty means it belongs to the business. */
  clients: { id: number; clientName: string; clientCode: string }[];
  clientId: number | null;
  clientName: string | null;
  clientCode: string | null;
  description: string;
  dueDate: string | null;
  priority: string | null;
  todoAddedAt: string | null;
  createdAt: string;
  sortOrder: number;
  origin: string;
  owner: string;
  communicationSubject: string | null;
  communicationSender: string | null;
  /** Other tasks judged to be the same underlying job, folded under this one. */
  relatedTasks: { id: number; description: string; communicationSubject: string | null }[];
}

function SortableTodoRow({
  todo, onResolve, onOpen, onOpenClient, onReassign,
}: {
  todo: Todo;
  onResolve: () => void;
  onOpen: () => void;
  onOpenClient: (clientId: number) => void;
  onReassign: (owner: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const waitingSince = todo.todoAddedAt ?? todo.createdAt;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 p-2.5 bg-card border border-border rounded-lg"
      data-testid={`todo-row-${todo.id}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 text-muted-foreground hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0"
        aria-label="Reorder"
        data-testid={`button-drag-${todo.id}`}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="flex-1 min-w-0">
        <button onClick={onOpen} className="w-full text-left" data-testid={`button-open-todo-${todo.id}`}>
          <p className="text-sm text-foreground leading-snug">{todo.description}</p>
        </button>

        {/* Each client is its own link: a to-do covering two accounts has two
            places to go, and picking one for her would be a guess. */}
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {todo.clients.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-brand" data-testid={`text-todo-general-${todo.id}`}>
              <Building2 className="w-2.5 h-2.5" /> General
            </span>
          ) : (
            todo.clients.map((c, i) => (
              <span key={c.id}>
                {i > 0 && <span className="mx-1">·</span>}
                <button
                  onClick={() => onOpenClient(c.id)}
                  className="hover:text-brand hover:underline"
                  data-testid={`button-todo-client-${todo.id}-${c.id}`}
                >
                  {c.clientName}
                </button>
              </span>
            ))
          )}
          {todo.communicationSubject && <span className="mx-1.5">·</span>}
          {todo.communicationSubject}
        </p>

        <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          waiting {formatDistanceToNow(new Date(waitingSince))}
          {todo.origin === "MANUAL" && <span className="ml-1.5 text-brand">· added by hand</span>}
        </p>

        {todo.relatedTasks.length > 0 && (
          <div className="mt-1.5 pl-2 border-l-2 border-border space-y-0.5">
            <p className="text-[11px] text-muted-foreground font-medium">
              +{todo.relatedTasks.length} related item{todo.relatedTasks.length === 1 ? "" : "s"} — same job, raised again:
            </p>
            {todo.relatedTasks.map(r => (
              <p key={r.id} className="text-[11px] text-muted-foreground truncate" data-testid={`text-related-task-${r.id}`}>
                · {r.description}{r.communicationSubject ? ` (${r.communicationSubject})` : ""}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <Select value={todo.owner} onValueChange={onReassign}>
          <SelectTrigger
            className="h-7 w-[84px] text-xs px-2 gap-1 border-0 bg-surface-subtle"
            data-testid={`select-todo-owner-${todo.id}`}
          >
            <User className="w-3 h-3 flex-shrink-0" />
            <SelectValue>{todo.owner.split(" ")[0]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TASK_OWNERS.map(o => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm" variant="ghost" onClick={onOpen}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-brand"
          title="Go to client"
          data-testid={`button-todo-goto-${todo.id}`}
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost" onClick={onResolve}
          className="h-7 w-7 p-0 text-success hover:bg-success-tint"
          title="Resolve"
          data-testid={`button-todo-resolve-${todo.id}`}
        >
          <CheckCircle2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function PrioritySection({
  priority, todos, onResolve, onOpen, onOpenClient, onReassign,
}: {
  priority: TaskPriority;
  todos: Todo[];
  onResolve: (t: Todo) => void;
  onOpen: (t: Todo) => void;
  onOpenClient: (clientId: number) => void;
  onReassign: (t: Todo, owner: string) => void;
}) {
  const { toast } = useToast();
  const style = PRIORITY_STYLE[priority];

  // Local copy so a drag lands instantly instead of waiting on the round trip.
  const [order, setOrder] = useState<Todo[]>(todos);
  useEffect(() => { setOrder(todos); }, [todos]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = useMutation({
    mutationFn: (orderedIds: number[]) =>
      apiRequest("POST", "/api/todos/reorder", { priority, orderedIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/todos"] }),
    onError: (e: any) => {
      setOrder(todos); // put it back where it was
      toast({ title: "Could not save the new order", description: e.message, variant: "destructive" });
    },
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex(t => t.id === active.id);
    const newIndex = order.findIndex(t => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = [...order];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    setOrder(next);
    reorder.mutate(next.map(t => t.id));
  };

  if (todos.length === 0) return null;

  return (
    <div data-testid={`todo-section-${priority.toLowerCase()}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{ color: style.text, backgroundColor: style.bg }}
        >
          {PRIORITY_LABEL[priority]}
        </span>
        <span className="text-xs text-muted-foreground">{todos.length}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {order.map(t => (
              <SortableTodoRow
                key={t.id}
                todo={t}
                onResolve={() => onResolve(t)}
                onOpen={() => onOpen(t)}
                onOpenClient={onOpenClient}
                onReassign={owner => onReassign(t, owner)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/**
 * The to-do list: Urgent, then Normal, then Casual, oldest first inside each
 * section unless Kim has dragged things into an order she prefers. Items leave
 * only by being resolved with a note.
 */
export default function TodoList() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [resolving, setResolving] = useState<Todo | null>(null);
  const [adding, setAdding] = useState(false);
  // Everyone lands on their own list first; "All tasks" is the admin overview.
  const [view, setView] = useState<"mine" | "all">("mine");

  const queryKey = view === "mine" ? ["/api/todos/mine"] : ["/api/todos"];
  const { data: todos = [], isLoading } = useQuery<Todo[]>({ queryKey });

  const reassignMutation = useMutation({
    mutationFn: ({ id, owner }: { id: number; owner: string }) =>
      apiRequest("PATCH", `/api/tasks/${id}/owner`, { owner }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/todos/mine"] });
    },
    onError: (e: any) => toast({ title: "Could not reassign", description: e.message, variant: "destructive" }),
  });

  const bySection = useMemo(() => {
    const map: Record<TaskPriority, Todo[]> = { URGENT: [], NORMAL: [], CASUAL: [] };
    for (const t of todos) {
      const p = (t.priority as TaskPriority) ?? "NORMAL";
      (map[p] ?? map.NORMAL).push(t);
    }
    return map;
  }, [todos]);

  const resolveMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiRequest("POST", `/api/communication-tasks/${id}/resolve`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communications/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication-tasks"] });
      setResolving(null);
      toast({ title: "Resolved", description: "Your note is saved on the record." });
    },
    onError: (e: any) => toast({ title: "Could not resolve", description: e.message, variant: "destructive" }),
  });

  const openClient = (clientId: number) => setLocation(`/clients/${clientId}?tab=communications`);

  /**
   * Where clicking the to-do itself goes.
   *
   * With no client it belongs to the business, so it goes to the general list.
   * With clients it goes to the first one, and the message it came from when
   * there was one. Where there are several clients she picks by name instead:
   * the row lists them all.
   */
  const open = (t: Todo) => {
    const first = t.clients[0];
    if (!first) {
      setLocation("/general");
      return;
    }
    setLocation(
      t.communicationId
        ? `/clients/${first.id}?tab=communications&comm=${t.communicationId}`
        : `/clients/${first.id}?tab=communications`,
    );
  };

  return (
    <Card className="border-0 shadow-sm" data-testid="card-todo-list">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-semibold text-brand">To-do list</h3>
          <span className="text-xs text-muted-foreground" data-testid="text-todo-count">
            {isLoading ? "" : todos.length}
          </span>
          <Button
            size="sm" variant="ghost"
            onClick={() => setAdding(true)}
            className="ml-auto h-7 px-2 text-xs gap-1 text-brand hover:bg-surface-subtle"
            data-testid="button-add-todo"
          >
            <Plus className="w-3.5 h-3.5" /> Add new
          </Button>
        </div>
        <div className="flex items-center gap-1 mt-2">
          <Button
            size="sm"
            variant={view === "mine" ? "secondary" : "ghost"}
            onClick={() => setView("mine")}
            className="h-7 px-2.5 text-xs"
            data-testid="button-todo-view-mine"
          >
            {user?.fullName ? `${user.fullName.split(" ")[0]}'s tasks` : "My tasks"}
          </Button>
          <Button
            size="sm"
            variant={view === "all" ? "secondary" : "ghost"}
            onClick={() => setView("all")}
            className="h-7 px-2.5 text-xs"
            data-testid="button-todo-view-all"
          >
            All tasks
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : todos.length === 0 ? (
          <div className="py-8 text-center">
            <ListTodo className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nothing on the list.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Tasks land here from a communication, or use Add new for a phone call.
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
            {TASK_PRIORITIES.map(p => (
              <PrioritySection
                key={p}
                priority={p}
                todos={bySection[p]}
                onResolve={setResolving}
                onOpen={open}
                onOpenClient={openClient}
                onReassign={(t, owner) => reassignMutation.mutate({ id: t.id, owner })}
              />
            ))}
          </div>
        )}
      </CardContent>

      {adding && <AddTodoDialog onClose={() => setAdding(false)} />}

      {resolving && (
        <ResolveDialog
          title="Resolve this to-do"
          subject={resolving.description}
          isPending={resolveMutation.isPending}
          onCancel={() => setResolving(null)}
          onConfirm={note => resolveMutation.mutate({ id: resolving.id, note })}
        />
      )}
    </Card>
  );
}
