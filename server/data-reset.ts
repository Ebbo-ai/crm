/**
 * Production data reset, and the communication-link export that has to bracket it.
 *
 * The client book is deleted and re-imported from the corrected workbook. Database
 * ids do not survive that; client code strings do. Everything here is built on that
 * one fact:
 *
 *   1. Export the communication-to-client links, keyed by client CODE.
 *   2. Reset the client data.
 *   3. Import the workbook.
 *   4. Re-attach the links from the export file.
 *
 * The emails, their attachments and their tasks are never deleted. Only the links
 * between them and the client records are lost, because `communication_clients`
 * cascades from `clients` and `communication_tasks.client_id` is set null. Steps 1
 * and 4 exist to carry those links across the gap.
 */

import { db } from "./db";
import { sql, eq, isNull, and } from "drizzle-orm";
import {
  clients,
  plans,
  planTiers,
  rateCards,
  renewals,
  renewalPlanOptions,
  prospectProgress,
  documents,
  pprUploads,
  pprImportBatches,
  pprHeldRows,
  pprMetrics,
  planPerformanceFacts,
  brokerHistory,
  brokerContacts,
  communicationClients,
  communicationTasks,
  communications,
} from "@shared/schema";
import { normalizeCode } from "./crm-import";

// ─── Export format ──────────────────────────────────────────────────────────

export const EXPORT_FORMAT = "simple-benefits/communication-links";
export const EXPORT_VERSION = 1;

export interface CommunicationLinkRow {
  communicationId: number;
  clientCode: string;
  clientName: string;
  matchConfidence: string;
  subject: string | null;
}

export interface TaskLinkRow {
  taskId: number;
  clientCode: string;
  clientName: string;
  description: string;
}

export interface CommunicationLinkExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  counts: {
    communicationLinks: number;
    taskLinks: number;
    distinctClients: number;
  };
  communicationLinks: CommunicationLinkRow[];
  taskLinks: TaskLinkRow[];
}

/**
 * Snapshot every communication-to-client link and every task that carries a client,
 * paired with the client's code rather than its id.
 *
 * The mailbox keeps receiving while this runs, so the export is only as good as the
 * moment it was taken. It is meant to be run immediately before the reset, not kept.
 */
export async function buildCommunicationLinkExport(
  runner: any = db,
): Promise<CommunicationLinkExport> {
  const linkRows = await runner
    .select({
      communicationId: communicationClients.communicationId,
      clientCode: clients.clientCode,
      clientName: clients.clientName,
      matchConfidence: communicationClients.matchConfidence,
      subject: communications.subject,
    })
    .from(communicationClients)
    .innerJoin(clients, eq(clients.id, communicationClients.clientId))
    .leftJoin(communications, eq(communications.id, communicationClients.communicationId));

  const taskRows = await runner
    .select({
      taskId: communicationTasks.id,
      clientCode: clients.clientCode,
      clientName: clients.clientName,
      description: communicationTasks.description,
    })
    .from(communicationTasks)
    .innerJoin(clients, eq(clients.id, communicationTasks.clientId));

  const distinct = new Set<string>();
  linkRows.forEach((r: any) => distinct.add(r.clientCode));
  taskRows.forEach((r: any) => distinct.add(r.clientCode));

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      communicationLinks: linkRows.length,
      taskLinks: taskRows.length,
      distinctClients: distinct.size,
    },
    communicationLinks: linkRows.map((r: any) => ({
      communicationId: r.communicationId,
      clientCode: r.clientCode,
      clientName: r.clientName,
      matchConfidence: r.matchConfidence,
      subject: r.subject ?? null,
    })),
    taskLinks: taskRows.map((r: any) => ({
      taskId: r.taskId,
      clientCode: r.clientCode,
      clientName: r.clientName,
      description: r.description,
    })),
  };
}

// ─── Reset ──────────────────────────────────────────────────────────────────

/** Typed in full, exactly, or the reset does not run. */
export const RESET_CONFIRMATION_PHRASE = "DELETE ALL CLIENT DATA";

/**
 * Tables emptied by the reset, in an order that respects the foreign keys.
 *
 * `plan_performance_facts` and `ppr_held_rows` are NO ACTION against their parents,
 * so they have to go before `clients`/`plans` and `ppr_import_batches` respectively,
 * or the delete errors instead of cascading. Most of the other relationships are not
 * constrained at all, which is exactly why this order is written down rather than
 * left to the database to work out.
 */
export const DELETE_ORDER = [
  { table: "plan_performance_facts", rel: planPerformanceFacts },
  { table: "ppr_held_rows", rel: pprHeldRows },
  { table: "ppr_import_batches", rel: pprImportBatches },
  { table: "ppr_uploads", rel: pprUploads },
  // Client-keyed PPR history. Not constrained, so nothing would complain if it were
  // left behind — it would just sit there pointing at client ids that no longer mean
  // anything, and be misread as the new clients' history.
  { table: "ppr_metrics", rel: pprMetrics },
  { table: "broker_history", rel: brokerHistory },
  // Cascades from clients, but deleted explicitly so the row count is reported like
  // every other table rather than vanishing silently in the client delete.
  { table: "broker_contacts", rel: brokerContacts },
  { table: "documents", rel: documents },
  { table: "renewal_plan_options", rel: renewalPlanOptions },
  { table: "prospect_progress", rel: prospectProgress },
  { table: "renewals", rel: renewals },
  { table: "rate_cards", rel: rateCards },
  { table: "plan_tiers", rel: planTiers },
  { table: "plans", rel: plans },
  // Last. Cascades communication_clients and nulls communication_tasks.client_id.
  { table: "clients", rel: clients },
] as const;

/** Counted before and after so the outcome is verified rather than assumed. */
const PRESERVED_TABLES = [
  "users",
  "session",
  "audit_logs",
  "communications",
  "communication_attachments",
  "communication_tasks",
  "issues",
] as const;

export interface ResetReport {
  confirmed: true;
  ranAt: string;
  deleted: { table: string; rows: number }[];
  preserved: { table: string; before: number; after: number; unchanged: boolean }[];
  emptied: { table: string; before: number; after: number }[];
  communicationLinksLost: number;
  taskLinksCleared: number;
  /**
   * The links as they stood in the same transaction that deleted them, so an email
   * that arrived after the step-1 export is still recoverable. Download and keep.
   */
  snapshot: CommunicationLinkExport;
}

type Counts = Record<string, number>;

async function countAll(runner: any): Promise<Counts> {
  // `session` is created by the session store rather than by the schema, so it is
  // counted defensively: a missing table must not take down the whole report.
  let sessionCount = -1;
  try {
    const s = await runner.execute(sql`select count(*)::int as n from session`);
    sessionCount = Number(s.rows?.[0]?.n ?? -1);
  } catch {
    sessionCount = -1;
  }

  const r = await runner.execute(sql`
    select
      (select count(*) from clients)::int                  as clients,
      (select count(*) from plans)::int                    as plans,
      (select count(*) from plan_tiers)::int               as plan_tiers,
      (select count(*) from rate_cards)::int               as rate_cards,
      (select count(*) from renewals)::int                 as renewals,
      (select count(*) from renewal_plan_options)::int     as renewal_plan_options,
      (select count(*) from prospect_progress)::int        as prospect_progress,
      (select count(*) from documents)::int                as documents,
      (select count(*) from ppr_uploads)::int              as ppr_uploads,
      (select count(*) from ppr_import_batches)::int       as ppr_import_batches,
      (select count(*) from ppr_held_rows)::int            as ppr_held_rows,
      (select count(*) from plan_performance_facts)::int   as plan_performance_facts,
      (select count(*) from ppr_metrics)::int              as ppr_metrics,
      (select count(*) from broker_history)::int           as broker_history,
      (select count(*) from users)::int                    as users,
      (select count(*) from audit_logs)::int               as audit_logs,
      (select count(*) from communications)::int           as communications,
      (select count(*) from communication_attachments)::int as communication_attachments,
      (select count(*) from communication_tasks)::int      as communication_tasks,
      (select count(*) from communication_tasks
         where client_id is not null)::int                 as communication_tasks_linked,
      (select count(*) from communication_clients)::int    as communication_clients,
      (select count(*) from issues)::int                   as issues
  `);
  const row = r.rows?.[0] ?? {};
  const out: Counts = { session: sessionCount };
  for (const [k, v] of Object.entries(row)) out[k] = Number(v);
  return out;
}

export interface ResetPreview {
  confirmationPhrase: string;
  willDelete: { table: string; rows: number }[];
  willPreserve: { table: string; rows: number }[];
  linksAtRisk: { communicationLinks: number; taskLinks: number };
}

/** What the reset would destroy right now, for the warning shown before confirming. */
export async function buildResetPreview(): Promise<ResetPreview> {
  const counts = await countAll(db);
  return {
    confirmationPhrase: RESET_CONFIRMATION_PHRASE,
    willDelete: DELETE_ORDER.map(({ table }) => ({ table, rows: counts[table] ?? 0 })),
    willPreserve: PRESERVED_TABLES.map((table) => ({ table, rows: counts[table] ?? 0 })),
    linksAtRisk: {
      communicationLinks: counts.communication_clients ?? 0,
      taskLinks: counts.communication_tasks_linked ?? 0,
    },
  };
}

export class ResetNotConfirmedError extends Error {
  constructor() {
    super(
      `The confirmation phrase did not match. Type "${RESET_CONFIRMATION_PHRASE}" exactly to proceed.`,
    );
    this.name = "ResetNotConfirmedError";
  }
}

/**
 * Empty the client-data tables. Everything runs in one transaction: if the guard at
 * the end finds that a preserved table was touched, the whole thing rolls back.
 */
export async function runDataReset(confirmPhrase: unknown): Promise<ResetReport> {
  if (typeof confirmPhrase !== "string" || confirmPhrase.trim() !== RESET_CONFIRMATION_PHRASE) {
    throw new ResetNotConfirmedError();
  }

  const before = await countAll(db);
  const deleted: { table: string; rows: number }[] = [];
  let snapshot!: CommunicationLinkExport;

  await db.transaction(async (tx) => {
    // Taken here rather than trusting the step-1 download. The mailbox keeps
    // receiving, so anything that arrived since that download would otherwise be
    // deleted without ever appearing in a file. This snapshot and the deletes are
    // the same transaction, so it cannot miss a link and it cannot survive a
    // rollback.
    snapshot = await buildCommunicationLinkExport(tx);

    for (const { table, rel } of DELETE_ORDER) {
      const res: any = await tx.delete(rel as any);
      deleted.push({ table, rows: Number(res?.rowCount ?? 0) });
    }

    // The reset must never reach a login, a session, an audit entry or the mail.
    // Checked inside the transaction so a failure rolls the deletes back.
    const mid = await countAll(tx);
    const mustSurvive: [string, number][] = [
      ["users", before.users],
      ["audit_logs", before.audit_logs],
      ["communications", before.communications],
      ["communication_attachments", before.communication_attachments],
      ["communication_tasks", before.communication_tasks],
      ["issues", before.issues],
    ];
    for (const [table, expected] of mustSurvive) {
      if (mid[table] !== expected) {
        throw new Error(
          `Aborted and rolled back: ${table} went from ${expected} to ${mid[table]} rows. ` +
            `This table must not be touched by a reset.`,
        );
      }
    }
    if (before.session >= 0 && mid.session !== before.session) {
      throw new Error(
        `Aborted and rolled back: session went from ${before.session} to ${mid.session} rows.`,
      );
    }
  });

  const after = await countAll(db);

  return {
    confirmed: true,
    ranAt: new Date().toISOString(),
    deleted,
    emptied: DELETE_ORDER.map(({ table }) => ({
      table,
      before: before[table] ?? 0,
      after: after[table] ?? 0,
    })),
    preserved: PRESERVED_TABLES.map((table) => ({
      table,
      before: before[table] ?? 0,
      after: after[table] ?? 0,
      unchanged: (before[table] ?? 0) === (after[table] ?? 0),
    })),
    communicationLinksLost: (before.communication_clients ?? 0) - (after.communication_clients ?? 0),
    taskLinksCleared:
      (before.communication_tasks_linked ?? 0) - (after.communication_tasks_linked ?? 0),
    snapshot,
  };
}

// ─── Re-attach ──────────────────────────────────────────────────────────────

export interface ReattachReport {
  ok: boolean;
  exportedAt: string | null;
  links: {
    inFile: number;
    restored: number;
    alreadyPresent: number;
    skippedMissingCommunication: number;
  };
  tasks: {
    inFile: number;
    restored: number;
    alreadyAssigned: number;
    skippedMissingTask: number;
  };
  matchedOnPadding: { fileCode: string; storedCode: string; clientName: string; links: number; tasks: number }[];
  unmatched: { clientCode: string; clientName: string; links: number; tasks: number }[];
  ambiguous: { clientCode: string; candidates: string[]; links: number; tasks: number }[];
}

function parseExport(raw: unknown): CommunicationLinkExport {
  let payload: any = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("That file is not valid JSON.");
    }
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("That file is not a communication link export.");
  }
  if (payload.format !== EXPORT_FORMAT) {
    throw new Error(
      "That file is not a communication link export. Use the file produced by the export step.",
    );
  }
  if (!Array.isArray(payload.communicationLinks) || !Array.isArray(payload.taskLinks)) {
    throw new Error("The export file is missing its link lists.");
  }
  return payload as CommunicationLinkExport;
}

/**
 * Put the links back after the import.
 *
 * Matching is on the client code string. An exact match is used when there is one.
 * Failing that, a padding-insensitive match is accepted only when it resolves to
 * exactly one client, and every such match is reported rather than performed
 * quietly — the wipe and re-import deliberately re-spells codes like S-020 as S-20,
 * so this is the expected path for those clients, not an anomaly to hide.
 *
 * Stored client codes are never modified here. The normalisation is a lookup, not a
 * rewrite: the monthly claims importer and the PPR filename matcher both compare the
 * stored string exactly, so re-spelling a stored code would break them.
 */
export async function reattachCommunicationLinks(raw: unknown): Promise<ReattachReport> {
  const payload = parseExport(raw);

  type Tally = { links: number; tasks: number };
  let report!: ReattachReport;
  let padded!: Map<string, Tally & { storedCode: string; clientName: string }>;
  let missing!: Map<string, Tally & { clientName: string }>;
  let ambiguous!: Map<string, Tally & { candidates: string[] }>;

  // Reads and writes share one transaction so the "is this link already there?"
  // check cannot be invalidated between deciding and inserting. Tallies are built
  // inside the callback so a retried transaction restarts them from zero rather
  // than doubling.
  await db.transaction(async (tx) => {
    const allClients = await tx
      .select({ id: clients.id, clientCode: clients.clientCode, clientName: clients.clientName })
      .from(clients);

    const byExact = new Map<string, { id: number; clientCode: string; clientName: string }>();
    const byNorm = new Map<string, { id: number; clientCode: string; clientName: string }[]>();
    for (const c of allClients) {
      byExact.set(c.clientCode, c);
      const k = normalizeCode(c.clientCode);
      byNorm.set(k, [...(byNorm.get(k) ?? []), c]);
    }

    type Resolution =
      | { kind: "exact"; client: { id: number; clientCode: string; clientName: string } }
      | { kind: "padding"; client: { id: number; clientCode: string; clientName: string } }
      | { kind: "none" }
      | { kind: "ambiguous"; candidates: string[] };

    const resolutionCache = new Map<string, Resolution>();
    function resolve(code: string): Resolution {
      const cached = resolutionCache.get(code);
      if (cached) return cached;
      let r: Resolution;
      const exact = byExact.get(code);
      if (exact) {
        r = { kind: "exact", client: exact };
      } else {
        const candidates = byNorm.get(normalizeCode(code)) ?? [];
        if (candidates.length === 1) r = { kind: "padding", client: candidates[0] };
        else if (candidates.length === 0) r = { kind: "none" };
        else r = { kind: "ambiguous", candidates: candidates.map((c) => c.clientCode) };
      }
      resolutionCache.set(code, r);
      return r;
    }

    // Existing state, so a second run is a no-op rather than a pile of duplicates.
    const existingLinks = new Set(
      (
        await tx
          .select({
            communicationId: communicationClients.communicationId,
            clientId: communicationClients.clientId,
          })
          .from(communicationClients)
      ).map((r) => `${r.communicationId}:${r.clientId}`),
    );
    const existingCommunications = new Set(
      (await tx.select({ id: communications.id }).from(communications)).map((r) => r.id),
    );
    const existingTasks = new Map(
      (
        await tx
          .select({ id: communicationTasks.id, clientId: communicationTasks.clientId })
          .from(communicationTasks)
      ).map((r) => [r.id, r.clientId] as const),
    );

    report = {
      ok: true,
      exportedAt: payload.exportedAt ?? null,
      links: { inFile: payload.communicationLinks.length, restored: 0, alreadyPresent: 0, skippedMissingCommunication: 0 },
      tasks: { inFile: payload.taskLinks.length, restored: 0, alreadyAssigned: 0, skippedMissingTask: 0 },
      matchedOnPadding: [],
      unmatched: [],
      ambiguous: [],
    };

    // Tallies keyed by the code as spelled in the file.
    padded = new Map();
    missing = new Map();
    ambiguous = new Map();

    const linkInserts: { communicationId: number; clientId: number; matchConfidence: string }[] = [];
    const taskUpdates: { taskId: number; clientId: number }[] = [];

    for (const row of payload.communicationLinks) {
      const r = resolve(row.clientCode);
      if (r.kind === "none") {
        const e = missing.get(row.clientCode) ?? { clientName: row.clientName, links: 0, tasks: 0 };
        e.links++;
        missing.set(row.clientCode, e);
        continue;
      }
      if (r.kind === "ambiguous") {
        const e = ambiguous.get(row.clientCode) ?? { candidates: r.candidates, links: 0, tasks: 0 };
        e.links++;
        ambiguous.set(row.clientCode, e);
        continue;
      }
      if (r.kind === "padding") {
        const e =
          padded.get(row.clientCode) ??
          { storedCode: r.client.clientCode, clientName: r.client.clientName, links: 0, tasks: 0 };
        e.links++;
        padded.set(row.clientCode, e);
      }
      if (!existingCommunications.has(row.communicationId)) {
        report.links.skippedMissingCommunication++;
        continue;
      }
      const key = `${row.communicationId}:${r.client.id}`;
      if (existingLinks.has(key)) {
        report.links.alreadyPresent++;
        continue;
      }
      existingLinks.add(key);
      linkInserts.push({
        communicationId: row.communicationId,
        clientId: r.client.id,
        matchConfidence: row.matchConfidence || "high",
      });
    }

    for (const row of payload.taskLinks) {
      const r = resolve(row.clientCode);
      if (r.kind === "none") {
        const e = missing.get(row.clientCode) ?? { clientName: row.clientName, links: 0, tasks: 0 };
        e.tasks++;
        missing.set(row.clientCode, e);
        continue;
      }
      if (r.kind === "ambiguous") {
        const e = ambiguous.get(row.clientCode) ?? { candidates: r.candidates, links: 0, tasks: 0 };
        e.tasks++;
        ambiguous.set(row.clientCode, e);
        continue;
      }
      if (r.kind === "padding") {
        const e =
          padded.get(row.clientCode) ??
          { storedCode: r.client.clientCode, clientName: r.client.clientName, links: 0, tasks: 0 };
        e.tasks++;
        padded.set(row.clientCode, e);
      }
      if (!existingTasks.has(row.taskId)) {
        report.tasks.skippedMissingTask++;
        continue;
      }
      // A task that already carries a client was reassigned after the export. The
      // stored assignment wins; the file does not overwrite it.
      if (existingTasks.get(row.taskId) !== null) {
        report.tasks.alreadyAssigned++;
        continue;
      }
      taskUpdates.push({ taskId: row.taskId, clientId: r.client.id });
    }

    let inserted = 0;
    for (let i = 0; i < linkInserts.length; i += 500) {
      const res: any = await tx.insert(communicationClients).values(linkInserts.slice(i, i + 500));
      inserted += Number(res?.rowCount ?? linkInserts.slice(i, i + 500).length);
    }

    // The guard in the WHERE is what actually protects a task that was reassigned
    // between the read above and this write, so the report counts rows the database
    // says it changed, not rows we intended to change.
    let updated = 0;
    for (const u of taskUpdates) {
      const res: any = await tx
        .update(communicationTasks)
        .set({ clientId: u.clientId })
        .where(and(eq(communicationTasks.id, u.taskId), isNull(communicationTasks.clientId)));
      updated += Number(res?.rowCount ?? 0);
    }

    report.links.restored = inserted;
    report.tasks.restored = updated;
    // Anything we queued but the database declined had been claimed in the meantime.
    report.links.alreadyPresent += linkInserts.length - inserted;
    report.tasks.alreadyAssigned += taskUpdates.length - updated;
  });

  report.matchedOnPadding = Array.from(padded.entries()).map(([fileCode, v]) => ({ fileCode, ...v }));
  report.unmatched = Array.from(missing.entries()).map(([clientCode, v]) => ({ clientCode, ...v }));
  report.ambiguous = Array.from(ambiguous.entries()).map(([clientCode, v]) => ({ clientCode, ...v }));
  report.ok = report.ambiguous.length === 0;

  return report;
}
