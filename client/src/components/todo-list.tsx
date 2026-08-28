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
import { GripVertical, CheckCircle2, ListTodo, ArrowRight, Clock } from "lucide-react";
import {
  TASK_PRIORITIES, PRIORITY_LABEL, PRIORITY_STYLE, type TaskPriority,
} from "@shared/communication-state";

export interface Todo {
  id: number;
  communicationId: number;
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
  communicationSubject: string | null;
  communicationSender: string | null;
}

function SortableTodoRow({
  todo, onResolve, onOpen,
}: {
  todo: Todo;
  onResolve: () => void;
  onOpen: () => void;
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
      className="flex items-start gap-2 p-2.5 bg-white border border-gray-100 rounded-lg"
      data-testid={`todo-row-${todo.id}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 text-[#CBD5E1] hover:text-[#94A3B8] cursor-grab active:cursor-grabbing flex-shrink-0"
        aria-label="Reorder"
        data-testid={`button-drag-${todo.id}`}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left" data-testid={`button-open-todo-${todo.id}`}>
        <p className="text-sm text-[#2C3E50] leading-snug">{todo.description}</p>
        <p className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
          {todo.clientName ?? "No client"}
          {todo.communicationSubject && <span className="mx-1.5">·</span>}
          {todo.communicationSubject}
        </p>
        <p className="text-[10px] text-[#94A3B8] mt-0.5 inline-flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          waiting {formatDistanceToNow(new Date(waitingSince))}
          {todo.origin === "MANUAL" && <span className="ml-1.5 text-[#1A5276]">· added by hand</span>}
        </p>
      </button>

      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          size="sm" variant="ghost" onClick={onOpen}
          className="h-7 w-7 p-0 text-[#94A3B8] hover:text-[#1A5276]"
          title="Go to client"
          data-testid={`button-todo-goto-${todo.id}`}
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost" onClick={onResolve}
          className="h-7 w-7 p-0 text-[#22C55E] hover:bg-[#F0FDF4]"
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
  priority, todos, onResolve, onOpen,
}: {
  priority: TaskPriority;
  todos: Todo[];
  onResolve: (t: Todo) => void;
  onOpen: (t: Todo) => void;
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
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{ color: style.text, backgroundColor: style.bg }}
        >
          {PRIORITY_LABEL[priority]}
        </span>
        <span className="text-[10px] text-[#94A3B8]">{todos.length}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {order.map(t => (
              <SortableTodoRow key={t.id} todo={t} onResolve={() => onResolve(t)} onOpen={() => onOpen(t)} />
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
  const [resolving, setResolving] = useState<Todo | null>(null);

  const { data: todos = [], isLoading } = useQuery<Todo[]>({ queryKey: ["/api/todos"] });

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

  const open = (t: Todo) => {
    if (!t.clientId) return;
    setLocation(`/clients/${t.clientId}?tab=communications&comm=${t.communicationId}`);
  };

  return (
    <Card className="border-0 shadow-sm" data-testid="card-todo-list">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-[#1A5276]" />
          <h3 className="text-sm font-semibold text-[#1A5276]">To-do list</h3>
          <span className="text-xs text-[#94A3B8]" data-testid="text-todo-count">
            {isLoading ? "" : todos.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : todos.length === 0 ? (
          <div className="py-8 text-center">
            <ListTodo className="w-7 h-7 text-[#CBD5E1] mx-auto mb-2" />
            <p className="text-sm text-[#94A3B8]">Nothing on the list.</p>
            <p className="text-xs text-[#94A3B8] mt-1">Tasks land here when you add them from a communication.</p>
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
              />
            ))}
          </div>
        )}
      </CardContent>

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
