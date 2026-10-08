/**
 * Work that used to run during boot, moved behind the open port.
 *
 * The rule this file exists to enforce: nothing whose cost grows with the
 * data may run before the server is listening. A backfill that scans a
 * queue is fast on an empty database and fatal on a full one — the app
 * stopped booting entirely once one of those queues reached a few thousand
 * rows, because the platform gives a container a fixed window to open its
 * port and the migration chain was still working when the window closed.
 *
 * So each task here:
 *  - runs after the listener is open, never before;
 *  - records when it last finished, and is skipped on the next boot if it
 *    finished recently, so a restart loop does not re-scan the same backlog
 *    over and over;
 *  - cannot take the app down. A failure is caught, recorded with its
 *    reason, and surfaced in Settings where a person will see it.
 */

import { pool } from "./db";
import { errorLabel } from "./logRedaction";

function log(message: string): void {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [startup] ${message}`);
}

export interface DeferredStartupTask {
  /** Stable key. Renaming it loses the task's history and makes it run again. */
  name: string;
  /** What to call it in Settings. */
  label: string;
  /**
   * How long its result stays good. A boot inside this window skips the task
   * entirely — that is what stops a backlog being re-scanned on every
   * restart. Use 0 for work that must happen on every boot (clearing a stale
   * claim left by the previous process, for example).
   */
  minIntervalHours: number;
  /** Returns a one-line description of what it did, or null if there was nothing to do. */
  run: () => Promise<string | null>;
}

export async function ensureStartupTaskTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS startup_tasks (
      name TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      error TEXT,
      last_started_at TIMESTAMP,
      last_finished_at TIMESTAMP,
      last_completed_at TIMESTAMP,
      last_duration_ms INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

interface TaskRow {
  name: string;
  status: string;
  last_completed_at: Date | null;
  failure_count: number;
}

async function readRow(name: string): Promise<TaskRow | null> {
  const res = await pool.query(
    `SELECT name, status, last_completed_at, failure_count FROM startup_tasks WHERE name = $1`,
    [name],
  );
  return (res.rows[0] as TaskRow) ?? null;
}

/**
 * Runs the deferred tasks one after another.
 *
 * Sequential on purpose: these are database-heavy, and running them at once
 * would make the first minutes after a restart slower for the person who is
 * actually using the app.
 */
export async function runDeferredStartupTasks(tasks: DeferredStartupTask[]): Promise<void> {
  try {
    await ensureStartupTaskTable();
  } catch (err: any) {
    console.error(`[startup] could not prepare the task log, deferred work skipped: ${errorLabel(err)}`);
    return;
  }

  for (const task of tasks) {
    try {
      const row = await readRow(task.name);
      if (task.minIntervalHours > 0 && row?.last_completed_at) {
        const ageHours = (Date.now() - new Date(row.last_completed_at).getTime()) / 3_600_000;
        if (ageHours < task.minIntervalHours) {
          log(`${task.label}: skipped, last completed ${Math.round(ageHours)}h ago`);
          continue;
        }
      }

      await pool.query(
        `INSERT INTO startup_tasks (name, label, status, last_started_at, run_count)
         VALUES ($1, $2, 'RUNNING', now(), 1)
         ON CONFLICT (name) DO UPDATE
           SET label = EXCLUDED.label,
               status = 'RUNNING',
               last_started_at = now(),
               run_count = startup_tasks.run_count + 1`,
        [task.name, task.label],
      );

      const startedAt = Date.now();
      const detail = await task.run();
      const durationMs = Date.now() - startedAt;
      await pool.query(
        `UPDATE startup_tasks
            SET status = 'OK', detail = $2, error = NULL,
                last_finished_at = now(), last_completed_at = now(), last_duration_ms = $3
          WHERE name = $1`,
        [task.name, detail, durationMs],
      );
      if (detail) log(`${task.label}: ${detail} (${durationMs}ms)`);
      else log(`${task.label}: nothing to do (${durationMs}ms)`);
    } catch (err: any) {
      // A failed deferred task is a problem to look at, not a reason for the
      // CRM to be unavailable. It is recorded so Settings can show it; the
      // next boot (or the next interval) tries again.
      const reason = errorLabel(err);
      console.error(`[startup] ${task.label} failed: ${reason}`);
      await pool
        .query(
          `INSERT INTO startup_tasks (name, label, status, error, last_started_at, last_finished_at, run_count, failure_count)
           VALUES ($1, $2, 'FAILED', $3, now(), now(), 1, 1)
           ON CONFLICT (name) DO UPDATE
             SET status = 'FAILED',
                 error = EXCLUDED.error,
                 last_finished_at = now(),
                 failure_count = startup_tasks.failure_count + 1`,
          [task.name, task.label, reason],
        )
        .catch(() => {
          /* the failure is already on the console; losing the record must not throw here */
        });
    }
  }
}

export interface StartupTaskStatus {
  name: string;
  label: string;
  status: string;
  detail: string | null;
  error: string | null;
  lastFinishedAt: string | null;
  lastCompletedAt: string | null;
  lastDurationMs: number | null;
  runCount: number;
  failureCount: number;
}

/** For the Settings panel: what ran, when, how long it took, and what failed. */
export async function getStartupTaskStatus(): Promise<StartupTaskStatus[]> {
  await ensureStartupTaskTable();
  const res = await pool.query(
    `SELECT name, label, status, detail, error, last_finished_at, last_completed_at, last_duration_ms, run_count, failure_count
       FROM startup_tasks ORDER BY label`,
  );
  return res.rows.map((r: any) => ({
    name: r.name,
    label: r.label,
    status: r.status,
    detail: r.detail,
    error: r.error,
    lastFinishedAt: r.last_finished_at ? new Date(r.last_finished_at).toISOString() : null,
    lastCompletedAt: r.last_completed_at ? new Date(r.last_completed_at).toISOString() : null,
    lastDurationMs: r.last_duration_ms,
    runCount: r.run_count,
    failureCount: r.failure_count,
  }));
}
