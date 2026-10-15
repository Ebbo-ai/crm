import { pool } from "./db";

const sources = {
  "field-proposal-mapping-backfill": { table: "document_field_proposals", date: "created_at" },
  "document-effective-date-backfill": { table: "documents", date: "uploaded_at" },
} as const;

/** Durable per-record cursor, including rows where no mapping/date was found.
 * A previous successful task supplies a conservative baseline: only records
 * present BEFORE that run started are considered processed.
 */
export async function backfillCursor(name: keyof typeof sources): Promise<number> {
  const key = `backfill-cursor:${name}`;
  const existing = await pool.query("SELECT value FROM app_settings WHERE key=$1", [key]);
  if (existing.rows.length) return Number(existing.rows[0].value);
  const source = sources[name];
  const baseline = await pool.query(
    `SELECT coalesce(max(id),0) AS id FROM ${source.table}
     WHERE ${source.date} <= (SELECT last_started_at FROM startup_tasks WHERE name=$1 AND last_completed_at IS NOT NULL AND status='OK')`,
    [name],
  );
  const id = Number(baseline.rows[0].id);
  await saveBackfillCursor(name, id);
  return id;
}

export async function saveBackfillCursor(name: keyof typeof sources, id: number): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key,value,updated_by) VALUES ($1,$2,'backfill')
     ON CONFLICT (key) DO UPDATE SET value=greatest(app_settings.value::bigint,EXCLUDED.value::bigint)::text,updated_at=now()`,
    [`backfill-cursor:${name}`, String(id)],
  );
}
