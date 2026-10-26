/** Ingestion policy is independent of OAuth/sending permissions.
 * Reconnecting or seeding an account must never enable its ingestion.
 */
export const SYNC_MAILBOX = "kim.anderson@simple.us";
export function isMailboxSyncEnabled(mailbox: string): boolean {
  return mailbox.trim().toLowerCase().replace(/#full$/, "") === SYNC_MAILBOX;
}
export function requireMailboxSyncEnabled(mailbox: string): void {
  if (!isMailboxSyncEnabled(mailbox)) {
    throw new Error(`Mail ingestion is disabled for ${mailbox}. Only ${SYNC_MAILBOX} syncs; sending remains available.`);
  }
}
