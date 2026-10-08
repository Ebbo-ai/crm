import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

/**
 * Background maintenance work, and whether any of it failed.
 *
 * These tasks run after the app is already serving, so a failure is silent
 * by design — the app stays up. That is only safe if the failure is visible
 * somewhere a person actually looks, which is what this is.
 */

export interface StartupTask {
  name: string;
  label: string;
  status: string;
  detail: string | null;
  error: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  runCount: number;
  failureCount: number;
}

function when(iso: string | null): string {
  if (!iso) return "never";
  try {
    return format(new Date(iso), "PP 'at' p");
  } catch {
    return iso;
  }
}

/** The one-line warning for a page where staff will see it. Renders nothing when all is well. */
export function StartupTaskWarning() {
  const { data: tasks = [] } = useQuery<StartupTask[]>({ queryKey: ["/api/system/startup-tasks"] });
  const failing = tasks.filter((t) => t.status === "FAILED");
  if (failing.length === 0) return null;
  return (
    <div
      className="flex items-start gap-2 border border-destructive/40 bg-destructive/5 rounded-md p-3 mb-4"
      data-testid="banner-startup-task-failed"
    >
      <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
      <div className="text-xs">
        <p className="font-semibold text-destructive">
          Background maintenance failed: {failing.map((t) => t.label).join(", ")}
        </p>
        <p className="text-muted-foreground mt-0.5">
          The CRM is working normally. This is housekeeping that did not finish — details in Settings → Mail Accounts.
        </p>
      </div>
    </div>
  );
}

export default function StartupTasksCard() {
  const { data: tasks = [], isLoading } = useQuery<StartupTask[]>({ queryKey: ["/api/system/startup-tasks"] });

  return (
    <Card data-testid="card-startup-tasks">
      <CardHeader className="pb-3">
        <h3 className="font-semibold">Background maintenance</h3>
        <p className="text-xs text-muted-foreground">
          Housekeeping that runs after the app starts, never before it. A failure here does not take the CRM down.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing has run yet since the last restart.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.name} className="flex items-start justify-between gap-3 text-xs" data-testid={`startup-task-${t.name}`}>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    {t.status === "FAILED" ? (
                      <AlertTriangle className="w-3 h-3 text-destructive" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
                    )}
                    <span className="text-foreground">{t.label}</span>
                    {t.status === "FAILED" && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px] border-destructive text-destructive">
                        failed
                      </Badge>
                    )}
                  </span>
                  <span className="block text-muted-foreground mt-0.5">
                    {t.status === "FAILED" ? t.error : t.detail || "nothing to do"}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-right">
                  {when(t.lastFinishedAt)}
                  {t.lastDurationMs != null && <span className="block">{(t.lastDurationMs / 1000).toFixed(1)}s</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
