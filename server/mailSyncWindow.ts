/**
 * How far back each mailbox's sync is allowed to reach.
 *
 * Lives on its own because two places need the same answer and must never
 * disagree: the sync itself (pinning the floor the first time a mailbox is
 * synced) and the startup migration (raising or lowering floors already
 * stored). A floor is written once per mailbox and then never recomputed —
 * recomputing "N back from now" every run creeps the floor forward a little
 * each day and quietly drops mail that was never synced.
 */

/**
 * The default window: thirty days. The CRM carries new mail; it is not an
 * archive. Any rolling window measured in months is the cancelled historical
 * import wearing a different hat — a six-month window had already put
 * thousands of messages of past correspondence into the database with
 * thousands more still to walk. Older correspondence stays in Google
 * Workspace, where it is one search away.
 */
export const BACKFILL_DAYS = 30;

/**
 * Mailboxes that get a fixed start date instead of the rolling window.
 *
 * This is a short list of exceptions, deliberately not a settings screen.
 * Kim's mailbox is work-only — its allow-list rejection rate is near zero —
 * so her whole history with the company is worth carrying, where a mailbox
 * mixing several businesses with personal mail is not.
 *
 * A date here is a floor, not a claim about when someone started: earlier than
 * the true start simply means the walk finds nothing further back.
 */
const MAILBOX_FLOOR_OVERRIDES: Record<string, string> = {
  "kim.anderson@simple.us": "2026-06-01",
};

/**
 * The floor this mailbox should be pinned at. `mailbox` is the bare address;
 * the sync's state key carries a "#full" suffix that is not part of it.
 */
export function mailboxFloorDate(mailbox: string, now: Date = new Date()): Date {
  const fixed = MAILBOX_FLOOR_OVERRIDES[mailbox.toLowerCase()];
  if (fixed) return new Date(`${fixed}T00:00:00Z`);
  return new Date(now.getTime() - BACKFILL_DAYS * 86_400_000);
}

/**
 * The policy in force for one mailbox, as a short string stored alongside its
 * floor: the rolling window ("30d") or the fixed date it was given.
 *
 * This, not the floor itself, is what says whether a mailbox needs rewriting.
 * A rolling mailbox pinned three weeks ago has a floor that no longer equals
 * "now minus thirty days", and comparing dates would drag it forward — losing
 * the stretch of window it had not walked yet — every time some OTHER
 * mailbox's exception changed.
 */
export function mailboxFloorPolicy(mailbox: string): string {
  return MAILBOX_FLOOR_OVERRIDES[mailbox.toLowerCase()] ?? `${BACKFILL_DAYS}d`;
}

