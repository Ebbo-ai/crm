/**
 * Checks the two PPR halves of the run-out change, using temporary data that is
 * always reverted:
 *
 *   A. A plan terminating 2026-09-30 must still render Oct, Nov and Dec 2026 in
 *      the 2026 plan year. Before this change the whole plan was dropped from
 *      that window, because the window starts after the termination month.
 *   B. A client past run-out must go archive-only: no new PPR generated.
 */
import { db } from "../server/db";
import { clients, plans } from "@shared/schema";
import { eq } from "drizzle-orm";

const BASE = "http://127.0.0.1:5000";

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@simplebenefits.com", password: "Admin123!" }),
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("no session cookie");
  return cookie.split(";")[0];
}

async function main() {
  const cookie = await login();
  const CLIENT_ID = 22; // S-216
  const PLAN_ID = 30;

  // ── A. plan-level run-out ──────────────────────────────────────────────────
  console.log("=== A. Plan terminating 2026-09-30, PPR for plan year 2026 ===");
  await db.update(plans).set({ terminationDate: new Date("2026-09-30T00:00:00") }).where(eq(plans.id, PLAN_ID));
  try {
    const res = await fetch(`${BASE}/api/clients/${CLIENT_ID}/ppr-report?planYear=2026`, { headers: { cookie } });
    const html = await res.text();
    console.log(`  HTTP ${res.status}`);
    const months = ["Oct 2026", "Nov 2026", "Dec 2026", "Jan 2027", "Sep 2026"];
    for (const m of months) {
      const short = m.slice(0, 3);
      const year = m.slice(4);
      // The report labels months in a few possible shapes; look for the pair.
      const present = new RegExp(`${short}[^<]{0,8}${year}|${year}-${String(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(short) + 1).padStart(2, "0")}`, "i").test(html);
      console.log(`  ${m.padEnd(10)} ${present ? "RENDERED" : "absent"}`);
    }
    if (res.status !== 200) console.log("  body:", html.slice(0, 300));
  } finally {
    await db.update(plans).set({ terminationDate: null }).where(eq(plans.id, PLAN_ID));
    console.log("  (plan termination reverted to null)");
  }

  // ── B. client past run-out is archive-only ────────────────────────────────
  console.log("\n=== B. Client past run-out (termination 2025-01-31) ===");
  const [before] = await db.select().from(clients).where(eq(clients.id, CLIENT_ID));
  await db.update(clients).set({ terminationDate: new Date("2025-01-31T00:00:00") }).where(eq(clients.id, CLIENT_ID));
  try {
    const res = await fetch(`${BASE}/api/clients/${CLIENT_ID}/ppr-report`, { headers: { cookie } });
    const body = await res.text();
    console.log(`  HTTP ${res.status} (expect 409)`);
    console.log(`  ${body.slice(0, 220)}`);
  } finally {
    await db.update(clients).set({ terminationDate: before.terminationDate }).where(eq(clients.id, CLIENT_ID));
    const [after] = await db.select().from(clients).where(eq(clients.id, CLIENT_ID));
    console.log(`  (client termination restored to ${after.terminationDate?.toISOString().slice(0, 10)})`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
