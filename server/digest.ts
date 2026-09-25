/**
 * Daily 7:30 AM America/New_York digest: each owner (Kim, Steve) gets one
 * email listing their own open and overdue tasks. This is the only place
 * that currently pushes task state to a person instead of waiting for them
 * to open the shared list.
 *
 * node-cron's `timezone` option re-resolves the wall-clock time against the
 * IANA zone on every run, so this keeps firing at 7:30 AM local time straight
 * through the March/November DST changeovers without any date-math here.
 */
import cron from "node-cron";
import { storage } from "./storage";
import { errorLabel } from "./logRedaction";
import { sendEmail } from "./mailer";

const DIGEST_FROM = "Simple Benefits CRM <notifications@mg.simple.us>";

function formatTaskLine(t: { description: string; dueDate: string | Date | null; clientName: string | null }): string {
  const client = t.clientName ?? "General";
  if (!t.dueDate) return `  - [${client}] ${t.description} (no due date)`;
  const due = new Date(t.dueDate);
  const overdue = due.getTime() < Date.now();
  const dueStr = due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `  - [${client}] ${t.description} — due ${dueStr}${overdue ? " (OVERDUE)" : ""}`;
}

export async function sendDigestFor(ownerFullName: string, ownerEmail: string): Promise<void> {
  const tasks = await storage.getOpenTasksForOwner(ownerFullName);
  if (tasks.length === 0) return; // nothing owed to them today; do not send an empty email

  const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate).getTime() < Date.now());
  const upcoming = tasks.filter(t => !overdue.includes(t));

  const lines: string[] = [];
  lines.push(`Good morning, ${ownerFullName.split(" ")[0]}.`);
  lines.push("");
  lines.push(`You have ${tasks.length} open task${tasks.length === 1 ? "" : "s"} (${overdue.length} overdue).`);
  if (overdue.length) {
    lines.push("");
    lines.push("OVERDUE:");
    overdue.forEach(t => lines.push(formatTaskLine(t)));
  }
  if (upcoming.length) {
    lines.push("");
    lines.push("OPEN:");
    upcoming.forEach(t => lines.push(formatTaskLine(t)));
  }
  lines.push("");
  lines.push("Open the CRM to work these or hand any of them to the other person.");

  const result = await sendEmail({
    from: DIGEST_FROM,
    to: ownerEmail,
    subject: `Your to-do list: ${tasks.length} open (${overdue.length} overdue)`,
    text: lines.join("\n"),
  });
  if (!result.ok) {
    // Recipient addresses stay out of the log — the owner's name is enough to
    // tell whose digest failed without writing an address into the log store.
    console.error(`Digest email to ${ownerFullName} failed: ${errorLabel(result.error)}`);
  }
}

export async function runDailyDigest(): Promise<void> {
  const users = await storage.getAllUsers();
  for (const user of users.filter(u => u.isActive && u.fullName !== "System Administrator")) {
    try {
      await sendDigestFor(user.fullName, user.email);
    } catch (err: any) {
      console.error(`Digest run failed for user #${user.id}: ${errorLabel(err)}`);
    }
  }
}

/** Registers the 7:30 AM America/New_York cron job. Call once at server startup. */
export function scheduleDailyDigest(): void {
  cron.schedule("30 7 * * *", () => {
    runDailyDigest().catch(err => console.error(`Daily digest run threw: ${errorLabel(err)}`));
  }, { timezone: "America/New_York" });
}
