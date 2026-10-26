import { sql } from "drizzle-orm";
import { SYNC_MAILBOX } from "./mailboxSyncPolicy";

/** Automatic document maintenance must not alter retained, disabled-mailbox data.
 * If a source message occurs in both mailboxes, conservatively preserve the document.
 */
export const maintainableDocument = sql`NOT EXISTS (
  SELECT 1 FROM gmail_messages gm JOIN gmail_threads gt ON gt.id = gm.thread_id
  WHERE gm.gmail_message_id = documents.source_gmail_message_id
    AND gt.mailbox <> ${SYNC_MAILBOX}
)`;
