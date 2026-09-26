/**
 * Entry point for the 7:30 AM America/New_York digest, run as a Replit
 * scheduled deployment rather than by the web process.
 *
 * The web process only runs its own cron while an autoscale instance happens
 * to be awake, which is exactly when nobody is using the app at 7:30 in the
 * morning. This runs the same `runDailyDigest()` in its own short-lived
 * process: database layer and the one function, no Express, no rating engine,
 * no startup migration chain (the web deployment owns the schema).
 *
 * Scheduled deployments inherit the project's secrets and DATABASE_URL, so
 * Mailgun and the database work here exactly as they do in the web process.
 */
import { pool } from "../db";
import { runDailyDigest } from "../digest";
import { errorLabel } from "../logRedaction";

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log("[job:digest] Starting the daily digest run.");
  const { sent, skipped, failed } = await runDailyDigest();
  console.log(`[job:digest] ${sent} sent, ${skipped} already sent today, ${failed} failed — finished in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
  // A digest nobody received is a failed run, and the deployment's run history
  // is the only place that shows it.
  if (failed > 0) throw new Error(`${failed} digest(s) failed to send`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: any) => {
    // A scheduled run that fails must exit non-zero: that is the only signal
    // the deployment's run history has to show the job did not do its job.
    console.error(`[job:digest] Run failed: ${errorLabel(err)}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
