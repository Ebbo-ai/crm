import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskRow, type TaskLike } from "@/components/task-actions";
import { AddTodoDialog } from "@/components/add-todo-dialog";
import { Building2, Plus, ListTodo, CheckCircle2 } from "lucide-react";

type GeneralTodo = TaskLike & {
  todoAddedAt: string | null;
  createdAt: string;
};

function TodoColumn({
  resolved, todos, isLoading,
}: {
  resolved: boolean;
  todos: GeneralTodo[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  }

  if (todos.length === 0) {
    return (
      <div className="py-10 text-center" data-testid={`empty-general-${resolved ? "resolved" : "active"}`}>
        {resolved
          ? <CheckCircle2 className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
          : <ListTodo className="w-7 h-7 text-muted-foreground mx-auto mb-2" />}
        <p className="text-sm text-muted-foreground">
          {resolved ? "Nothing resolved yet." : "Nothing on the general list."}
        </p>
        {!resolved && (
          <p className="text-xs text-muted-foreground mt-1">
            Work that is not about one client goes here.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {todos.map(t => (
        <TaskRow key={t.id} task={t} extraKeys={[["/api/general/todos"], ["/api/general/todos", "resolved"]]} />
      ))}
    </div>
  );
}

/**
 * The general record: the business's own to-do list.
 *
 * It reads like a client record, but nothing here belongs to an account. ID
 * card design, a process question for 90 Degree, a vendor call: real work that
 * used to have nowhere to live, so it lived in somebody's head.
 *
 * These items also appear on the main to-do list under the same priority rules,
 * labelled General, so nothing has to be checked in two places.
 */
export default function GeneralPage() {
  const [adding, setAdding] = useState(false);

  const { data: active = [], isLoading: loadingActive } = useQuery<GeneralTodo[]>({
    queryKey: ["/api/general/todos"],
  });
  const { data: resolved = [], isLoading: loadingResolved } = useQuery<GeneralTodo[]>({
    queryKey: ["/api/general/todos", "resolved"],
    queryFn: () => fetch("/api/general/todos?resolved=true", { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="space-y-4" data-testid="page-general">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-brand-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-brand" data-testid="text-general-title">General</h1>
            <p className="text-xs text-muted-foreground">
              Work that belongs to the business, not to a client.
            </p>
          </div>
        </div>
        <Button
          onClick={() => setAdding(true)}
          className="bg-brand text-brand-foreground gap-1.5"
          data-testid="button-add-general-todo"
        >
          <Plus className="w-4 h-4" /> Add a to-do
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active" data-testid="tab-general-active" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">
                To do {active.length > 0 && <span className="ml-1.5 text-xs">{active.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="resolved" data-testid="tab-general-resolved" className="data-[state=active]:bg-brand data-[state=active]:text-brand-foreground">
                Resolved {resolved.length > 0 && <span className="ml-1.5 text-xs">{resolved.length}</span>}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="mt-3">
              <TodoColumn resolved={false} todos={active} isLoading={loadingActive} />
            </TabsContent>
            <TabsContent value="resolved" className="mt-3">
              <TodoColumn resolved todos={resolved} isLoading={loadingResolved} />
            </TabsContent>
          </Tabs>
        </CardHeader>
        <CardContent className="pt-0" />
      </Card>

      {adding && <AddTodoDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
