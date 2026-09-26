/**
 * Entry point for the scheduled mailbox sync pass, run as a Replit scheduled
 * deployment rather than by the web process's five-minute timer.
 *
 * Why it exists: the web deployment is autoscale, so its timer only fires
 * while an instance happens to be awake serving someone. Overnight mail
 * therefore sits unread until a person opens the app. This process runs the
 * same sync, on a schedule, whether or not anyone is using the CRM.
 *
 * It takes the same per-mailbox database claim as every other run, marked
 * SCHEDULED, so it can never stack on top of a poller run or a manual
 * "Sync mail" press — whichever gets there first does the work, the other
 * reports it as already running.
 *
 * Database layer plus the one function: no Express, no rating engine, no
 * startup migration chain (the web deployment owns the schema).
 */
import { pool } from "../db";
import { runGmailFullSyncAllMailboxes, sortPendingThreads } from "../gmailFullSync";
import { errorLabel, formatErrorClassTally } from "../logRedaction";

/**
 * This run's own time budget, deliberately under the deployment's job
 * timeout. Reaching it stops the run between pages, with the page cursor
 * already banked and the claim released, instead of letting the platform
 * kill the process mid-page and leave a claim to expire on its own.
 */
const RUN_BUDGET_MINUTES = 90;
/** The sorting sweep gets the remainder of the budget, so the job as a whole still finishes inside the deployment's timeout. */
const TOTAL_BUDGET_MINUTES = 105;
/** Belt and braces against a mailbox that can never report itself caught up: the clock is the real governor. */
const MAX_PASSES = 200;

async function main(): Promise<void> {
  const startedAt = Date.now();
  const deadlineAt = new Date(startedAt + RUN_BUDGET_MINUTES * 60_000);
  const sweepDeadlineAt = new Date(startedAt + TOTAL_BUDGET_MINUTES * 60_000);
  console.log(`[job:sync] Starting a scheduled mail sync (budget ${RUN_BUDGET_MINUTES} minutes).`);

  // One call reads at most a few hundred messages — a deliberate bound on the
  // in-app poller, where a long pass would hold a claim while someone is
  // waiting on the sync button. A scheduled run has nobody waiting, so it
  // keeps calling until every mailbox reports it has walked its whole window
  // or the budget runs out. This is what turns a catch-up that would otherwise
  // trickle across hours of app usage into one overnight pass.
  let results: Awaited<ReturnType<typeof runGmailFullSyncAllMailboxes>> = [];
  let passes = 0;
  for (; passes < MAX_PASSES; passes++) {
    results = await runGmailFullSyncAllMailboxes({ trigger: "SCHEDULED", deadlineAt });
    for (const r of results) {
      if (r.skipped) {
        console.log(`[job:sync] ${r.mailbox}: skipped — a sync was already running for this mailbox.`);
        continue;
      }
      console.log(
        `[job:sync] ${r.mailbox}: ${r.messagesScanned} scanned, ${r.messagesNew} new, ${r.threadsSorted} threads sorted`
        + `${r.threadsRecovered ? ` (${r.threadsRecovered} recovered from an earlier run)` : ""}`
        + `, ${r.threadsPendingSort} awaiting sorting, ${r.tasksCreated} tasks, ${r.errors.length} errors`
        + `${r.errors.length ? ` (${formatErrorClassTally(r.errorClasses)})` : ""}`
        + `${r.caughtUp ? " — caught up" : " — still catching up"}`
        + `${r.stoppedAtDeadline ? ", stopped at the run's time budget" : ""}.`,
      );
    }
    const attemptedThisPass = results.filter((r) => !r.skipped);
    if (attemptedThisPass.length === 0) break; // every mailbox is busy elsewhere
    if (attemptedThisPass.every((r) => r.caughtUp)) break;
    if (attemptedThisPass.some((r) => r.stoppedAtDeadline)) break;
    if (new Date() >= deadlineAt) break;
  }
  if (passes >= MAX_PASSES) {
    console.warn(`[job:sync] Stopped after ${MAX_PASSES} passes without every mailbox reaching a caught-up state; the next run continues from the banked cursor.`);
  }

  // Mail that is stored but not yet sorted is invisible in triage, so the
  // scheduled pass drains that queue too — across every mailbox, not just the
  // ones that had new mail this run.
  const recovery = await sortPendingThreads({ deadlineAt: sweepDeadlineAt });
  if (recovery.before > 0) {
    console.log(
      `[job:sync] Sorting recovery: ${recovery.before} thread(s) were stored but unsorted, ${recovery.sorted} sorted this run, ${recovery.remaining} remaining`
      + `${recovery.paused ? " (stopped early: the daily AI spend ceiling was reached)" : ""}.`,
    );
  }

  console.log(`[job:sync] Finished in ${Math.round((Date.now() - startedAt) / 1000)}s.`);

  // A mailbox that scanned nothing and only produced errors did not sync at
  // all (expired auth, Gmail unreachable). If that is true of every connected
  // mailbox, the run failed, and the deployment's run history should say so
  // rather than showing a green tick over an inbox that never got read.
  const attempted = results.filter((r) => !r.skipped);
  const deadMailboxes = attempted.filter((r) => r.messagesScanned === 0 && r.errors.length > 0);
  if (attempted.length > 0 && deadMailboxes.length === attempted.length) {
    throw new Error(`no mailbox could be synced (${deadMailboxes.length} failed outright)`);
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: any) => {
    console.error(`[job:sync] Run failed: ${errorLabel(err)}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
