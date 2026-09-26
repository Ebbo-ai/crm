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

// ── The schedule this job runs on, mirrored here ──
// The two scheduled deployments are sync at 07:00 and the digest at 07:30,
// both America/New_York. The sync's own budget is long enough to cover a
// bad morning, which means it can still be working when the digest goes out —
// a mailbox that cannot finish (expired auth, a message that will not store)
// keeps the loop going until the budget expires.
//
// So the run also stops at a wall-clock time, ahead of the digest. A digest
// that is predictably a little short beats one that is usually complete and
// occasionally missing entirely. Whatever did not sync is not lost; it is on
// the next run. These live together so moving the schedule means moving the
// numbers here, not hunting for one in the loop.
const SCHEDULE_TIMEZONE = "America/New_York";
/** When the digest job runs. Not read by this process; it is the reason the hard stop exists and the number that moves it. */
const DIGEST_LOCAL_TIME = "07:30";
/** Wall-clock time by which the whole job must be done, a few minutes ahead of the digest. */
const HARD_STOP_LOCAL_TIME = "07:25";
/** Held back from the hard stop for the sorting sweep, so mail read this run is visible in the digest rather than just stored. */
const SWEEP_RESERVE_MINUTES = 5;
/**
 * Slack before the hard stop itself. Both deadlines are cooperative — the sync
 * checks between pages and the sweep between threads — so work already started
 * runs on a little past the moment it is told to stop.
 */
const COOPERATIVE_SLACK_MINUTES = 1;

/** Minutes past local midnight, in the schedule's timezone, with seconds carried as a fraction. */
function localMinutesOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return (at("hour") % 24) * 60 + at("minute") + at("second") / 60; // some runtimes render midnight as hour 24
}

function parseLocalTime(localTime: string): number {
  const [hour, minute] = localTime.split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * Where this run sits relative to the morning schedule.
 *
 * `hardStopAt` is the exact instant of HARD_STOP_LOCAL_TIME (to the second,
 * not "the start time plus N minutes", which would carry the start's seconds
 * past the cutoff). `tooLateForToday` is a run that began inside the window
 * between the hard stop and the digest: there is no useful work it can finish
 * before the digest goes out, and running anyway is the overrun the hard stop
 * exists to prevent. A run at any other hour — someone starting it by hand at
 * noon — has no digest to stay ahead of and keeps its ordinary budget.
 */
function scheduleWindow(now: Date): { hardStopAt: Date | null; tooLateForToday: boolean } {
  const nowMinutes = localMinutesOfDay(now, SCHEDULE_TIMEZONE);
  const hardStopMinutes = parseLocalTime(HARD_STOP_LOCAL_TIME);
  const digestMinutes = parseLocalTime(DIGEST_LOCAL_TIME);
  if (nowMinutes < hardStopMinutes) {
    return { hardStopAt: new Date(now.getTime() + Math.round((hardStopMinutes - nowMinutes) * 60_000)), tooLateForToday: false };
  }
  if (nowMinutes < digestMinutes) return { hardStopAt: now, tooLateForToday: true };
  return { hardStopAt: null, tooLateForToday: false };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { hardStopAt, tooLateForToday } = scheduleWindow(new Date(startedAt));
  // Nothing new starts after these, and the slack absorbs the page or thread
  // already in flight when they pass.
  const deadlineAt = new Date(
    Math.min(
      startedAt + RUN_BUDGET_MINUTES * 60_000,
      hardStopAt ? hardStopAt.getTime() - (SWEEP_RESERVE_MINUTES + COOPERATIVE_SLACK_MINUTES) * 60_000 : Infinity,
    ),
  );
  const sweepDeadlineAt = new Date(
    Math.min(
      startedAt + TOTAL_BUDGET_MINUTES * 60_000,
      hardStopAt ? hardStopAt.getTime() - COOPERATIVE_SLACK_MINUTES * 60_000 : Infinity,
    ),
  );
  const hardStopApplies = hardStopAt != null && hardStopAt.getTime() <= startedAt + TOTAL_BUDGET_MINUTES * 60_000;
  console.log(
    `[job:sync] Starting a scheduled mail sync (budget ${RUN_BUDGET_MINUTES} minutes`
    + `${hardStopApplies ? `, hard stop ${HARD_STOP_LOCAL_TIME} ${SCHEDULE_TIMEZONE} ahead of the digest` : ""}).`,
  );

  // One call reads at most a few hundred messages — a deliberate bound on the
  // in-app poller, where a long pass would hold a claim while someone is
  // waiting on the sync button. A scheduled run has nobody waiting, so it
  // keeps calling until every mailbox reports it has walked its whole window
  // or the budget runs out. This is what turns a catch-up that would otherwise
  // trickle across hours of app usage into one overnight pass.
  let results: Awaited<ReturnType<typeof runGmailFullSyncAllMailboxes>> = [];
  let passes = 0;
  /** Why the loop ended. Stated in the summary rather than left to be inferred from the per-mailbox lines. */
  let stopReason: "caught up" | "out of time" | "all busy" | "pass limit" | "no time" | "nothing connected" = "pass limit";
  // A run starting within minutes of the hard stop (a hand-started one; the
  // schedule fires at 07:00) has no room to read mail and still sort it. Say
  // so plainly rather than handing the sync a deadline already in the past.
  if (deadlineAt.getTime() <= startedAt) {
    stopReason = "no time";
    console.warn(`[job:sync] Started too close to the ${HARD_STOP_LOCAL_TIME} ${SCHEDULE_TIMEZONE} hard stop to read mail; skipping the mail pass and going straight to the sorting sweep.`);
  }
  for (; stopReason !== "no time" && passes < MAX_PASSES; passes++) {
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
    if (attemptedThisPass.length === 0) { stopReason = results.length === 0 ? "nothing connected" : "all busy"; break; }
    if (attemptedThisPass.every((r) => r.caughtUp)) { stopReason = "caught up"; break; }
    if (attemptedThisPass.some((r) => r.stoppedAtDeadline)) { stopReason = "out of time"; break; }
    if (new Date() >= deadlineAt) { stopReason = "out of time"; break; }
  }

  // Ending on the clock and ending because every mailbox finished its window
  // look identical in a list of per-mailbox lines, and they mean very
  // different things: one is a normal morning, the other is mail that will
  // not be in the 07:30 digest. Say which, and name the mailboxes.
  const stillCatchingUp = results.filter((r) => !r.skipped && !r.caughtUp).map((r) => r.mailbox);
  // A mailbox claimed by another run was never looked at here, so it is not
  // evidence of anything being caught up — it has to be named separately or
  // the summary overstates what this run finished.
  const skipped = results.filter((r) => r.skipped).map((r) => r.mailbox);
  const skippedNote = skipped.length ? ` (${skipped.join(", ")} was being synced elsewhere and was not read by this run)` : "";
  if (stopReason === "no time") {
    // Already logged above; nothing to add about mailboxes that were never read.
  } else if (stopReason === "caught up") {
    console.log(`[job:sync] Every mailbox this run read walked its whole window, in ${passes + 1} pass(es)${skippedNote}.`);
  } else if (stopReason === "all busy") {
    console.log(`[job:sync] Stopped: every mailbox was already being synced elsewhere.`);
  } else if (stopReason === "nothing connected") {
    console.log(`[job:sync] Stopped: no mailbox is connected to sync.`);
  } else {
    const cap = stopReason === "pass limit"
      ? `the ${MAX_PASSES}-pass limit`
      : hardStopApplies
        ? `the ${HARD_STOP_LOCAL_TIME} ${SCHEDULE_TIMEZONE} hard stop (ahead of the ${DIGEST_LOCAL_TIME} digest)`
        : `the ${RUN_BUDGET_MINUTES}-minute budget`;
    console.warn(
      `[job:sync] Stopped on ${cap}, NOT because every mailbox was caught up`
      + `${stillCatchingUp.length ? ` — still catching up: ${stillCatchingUp.join(", ")}` : ""}`
      + `${skippedNote}`
      + `. Their next run resumes from the banked page cursor; nothing is lost, it is late.`,
    );
  }

  // Mail that is stored but not yet sorted is invisible in triage, so the
  // scheduled pass drains that queue too — across every mailbox, not just the
  // ones that had new mail this run.
  //
  // Not started at all once its cutoff has passed: the sweep does its own
  // database and enrichment setup before it first looks at the clock, so
  // handing it an expired deadline still means work running towards the
  // digest. Nothing new starts after the cutoff.
  if (tooLateForToday || new Date() >= sweepDeadlineAt) {
    console.warn(`[job:sync] Past the sorting sweep's cutoff (${HARD_STOP_LOCAL_TIME} ${SCHEDULE_TIMEZONE}, less the slack); not starting it. Unsorted threads are sorted by the next run or by the app's own poller.`);
  } else {
    const recovery = await sortPendingThreads({ deadlineAt: sweepDeadlineAt });
    if (recovery.before > 0) {
      console.log(
        `[job:sync] Sorting recovery: ${recovery.before} thread(s) were stored but unsorted, ${recovery.sorted} sorted this run, ${recovery.remaining} remaining`
        + `${recovery.paused ? " (stopped early: the daily AI spend ceiling was reached)" : ""}.`,
      );
    }
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
