/**
 * End-to-end check of the run-out rule in the real claims parser: builds the
 * same context the monthly-import route builds, posts a small CSV to the Flask
 * service, and reports which rows import and which are held.
 *
 * Rows cover the boundary deliberately: inside run-out, the last run-out month,
 * and one month past it.
 */
import { storage } from "../server/storage";
import { runOutEndYearMonth } from "@shared/client-state";

async function main() {
  const [allClients, allPlans, allFacts] = await Promise.all([
    storage.getClients(),
    storage.getAllActivePlans(),
    storage.getAllCurrentFacts(),
  ]);

  const s216 = allClients.find((c) => c.clientCode.replace("-0", "-") === "S-216")!;
  const plan = allPlans.find((p) => p.clientId === s216.id)!;
  console.log(`client ${s216.clientCode}, plan "${plan.planName}", client termination ${s216.terminationDate?.toISOString().slice(0, 10)}`);

  const context = {
    clients: allClients.map((c) => ({
      id: c.id, client_code: c.clientCode, client_name: c.clientName,
      termination_date: c.terminationDate ?? null,
      claims_cutoff_ym: runOutEndYearMonth(c.terminationDate),
    })),
    plans: allPlans.map((p) => ({
      id: p.id, client_id: p.clientId, plan_name: p.planName,
      effective_date: p.effectiveDate, plan_year: p.planYear,
      coverage_type: p.coverageType ?? null,
      termination_date: p.terminationDate ?? null,
      claims_cutoff_ym: runOutEndYearMonth(p.terminationDate),
    })),
    current_facts: allFacts.map((f) => ({
      id: f.id, client_id: f.clientId, plan_id: f.planId,
      report_month: f.reportMonth, report_year: f.reportYear,
      version: f.version, paid_claims: f.paidClaims, submitted_charges: f.submittedCharges,
    })),
  };

  const header = "client_code,plan_name,report_month,report_year,paid_claims,submitted_charges,ee,ee_sp,ee_ch,fam";
  const rows = [
    `${s216.clientCode},${plan.planName},11,2026,1200.00,1500.00,10,2,1,3`,  // inside run-out
    `${s216.clientCode},${plan.planName},12,2026,900.00,1100.00,10,2,1,3`,   // last run-out month
    `${s216.clientCode},${plan.planName},1,2027,800.00,1000.00,10,2,1,3`,    // past run-out
  ];
  const csv = [header, ...rows].join("\n");

  const res = await fetch("http://127.0.0.1:5001/parse-ppr-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_b64: Buffer.from(csv).toString("base64"),
      file_ext: "csv",
      context,
    }),
  });
  const out: any = await res.json();

  console.log(`\naccepted rows: ${(out.rows ?? out.accepted ?? []).length}`);
  for (const r of out.rows ?? out.accepted ?? []) {
    console.log(`  IMPORTS  ${r.report_year}-${String(r.report_month).padStart(2, "0")}  paid=${r.paid_claims}`);
  }
  console.log(`held rows: ${(out.held ?? []).length}`);
  for (const h of out.held ?? []) {
    console.log(`  HELD     ${h.report_year}-${String(h.report_month).padStart(2, "0")}  ${h.hold_reasons.join(" | ")}`);
  }
  if (out.error) console.log("parser error:", out.error);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
