import { db } from "./db";
import { communications, gmailMessages } from "@shared/schema";
import { sql, isNull, eq } from "drizzle-orm";

/**
 * One-time (idempotent) reconciliation between the legacy Mailgun-era
 * `communications` table and the Gmail-native `gmail_messages` table.
 *
 * Both pipelines ran side by side for a stretch before the Mailgun inbound
 * webhook was retired, so the same physical email can exist as a row in
 * each store. `communications` rows from that era were never given a
 * Message-ID header (that field didn't exist yet), so an exact key match is
 * impossible — instead this matches on sender address + exact subject +
 * a tight send-time window. Real replies in a busy thread reuse the same
 * subject line many times over minutes or hours, so the window is kept
 * short (5 minutes) specifically to avoid pairing a `communications` row
 * with the wrong message in that thread.
 *
 * Matches are marked, never deleted: `supersededByGmailMessageId` is set on
 * the legacy row, which keeps its resolution note/audit trail intact while
 * telling any Gmail-native-only screen (the new triage dashboard) to treat
 * it as already represented. Screens that still read `communications`
 * directly are unaffected; this is additive.
 */
export async function reconcileLegacyCommunicationsWithGmail(): Promise<{ matched: number; scanned: number }> {
  const result = await db.execute<{ matched: string }>(sql`
    WITH candidate AS (
      SELECT DISTINCT ON (c.id)
        c.id AS comm_id,
        g.id AS gmail_id
      FROM communications c
      JOIN gmail_messages g
        ON lower(c.sender_email) = lower(g.from_email)
       AND c.subject IS NOT DISTINCT FROM g.subject
       AND abs(extract(epoch FROM (c.received_at - g.sent_at))) < 300
      WHERE c.superseded_by_gmail_message_id IS NULL
        AND g.thread_id IN (SELECT id FROM gmail_threads WHERE mailbox = 'kim.anderson@simple.us')
      ORDER BY c.id, abs(extract(epoch FROM (c.received_at - g.sent_at))) ASC
    )
    UPDATE communications
    SET superseded_by_gmail_message_id = candidate.gmail_id
    FROM candidate
    WHERE communications.id = candidate.comm_id
    RETURNING communications.id
  `);
  const matched = (result.rows as any[]).length;
  const [{ count: scanned }] = (await db.execute<{ count: string }>(sql`
    SELECT count(*)::int AS count FROM communications WHERE superseded_by_gmail_message_id IS NULL
  `)).rows as any[];
  return { matched, scanned: Number(scanned) };
}
