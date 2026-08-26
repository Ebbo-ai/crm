/**
 * Acceptance test for the derived client-termination model, run against S-216
 * Consulting Radiologists (termination date 2026-09-30, i.e. still in the future).
 *
 * Answers the four questions asked of it:
 *   1. What state does it compute as?
 *   2. Does a renewal open for it, and is it out of the overdue queue?
 *   3. Would a claims row dated 2026-11 import or be held?
 *   4. Do PPRs still generate?
 */
import { db } from "../server/db";
import { storage } from "../server/storage";
import { clients, renewals } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  deriveClientState,
  runOutEndDate,
  runOutEndYearMonth,
  generatesPpr,
  suppressesRenewals,
} from "@shared/client-state";

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

async function main() {
  const all = await db.select().from(clients);
  const c = all.find((x) => x.clientCode.replace("-0", "-") === "S-216");
  if (!c) throw new Error("S-216 not found");

  const today = new Date();
  const state = deriveClientState(c, today);

  console.log(`\n=== 1. Computed state (today ${today.toISOString().slice(0, 10)}) ===`);
  line("client", `${c.clientCode} ${c.clientName}`);
  line("termination_date", c.terminationDate?.toISOString().slice(0, 10) ?? "null");
  line("is_active / client_status", `${c.isActive} / ${c.clientStatus}`);
  line("DERIVED STATE", state);
  line("run-out closes", runOutEndDate(c.terminationDate)?.toISOString().slice(0, 10));
  line("renewals suppressed", suppressesRenewals(state));
  line("PPRs generate", generatesPpr(state));

  console.log(`\n=== 2. Renewals ===`);
  const rows = await db.select().from(renewals).where(eq(renewals.clientId, c.id));
  line("renewal rows on file", rows.length);
  for (const r of rows) {
    line(`  plan year ${r.planYear}`, `pipeline_step=${r.pipelineStep ?? "NULL"} (kept as history)`);
  }

  const alerts = await storage.getDashboardRenewals();
  const inLegacyQueue = alerts.filter((a: any) => a.clientId === c.id || a.client?.id === c.id);
  line("in /api/dashboard/renewals", inLegacyQueue.length > 0 ? "YES (bad)" : "no");

  const stalled = await storage.getStalledPipelines();
  const inStalled = stalled.filter((s: any) => s.clientId === c.id || s.client?.id === c.id);
  line("in /api/dashboard/stalled", inStalled.length > 0 ? "YES (bad)" : "no");

  console.log(`\n=== 3. Claims import, row dated 2026-11 ===`);
  const cutoff = runOutEndYearMonth(c.terminationDate)!;
  const rowYm = 2026 * 12 + (11 - 1);
  line("client claims_cutoff_ym", `${cutoff} (${Math.floor(cutoff / 12)}-${(cutoff % 12) + 1})`);
  line("row 2026-11 ym", rowYm);
  line("VERDICT", rowYm > cutoff ? "HELD (bad)" : "IMPORTS NORMALLY");

  const past = 2027 * 12 + (2 - 1);
  line("control: row 2027-02", past > cutoff ? "HELD (correct, past run-out)" : "imports (bad)");

  console.log(`\n=== 4. Other clients unaffected ===`);
  const counts: Record<string, number> = {};
  for (const x of all) {
    const s = deriveClientState(x, today);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  console.log("  " + JSON.stringify(counts));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
