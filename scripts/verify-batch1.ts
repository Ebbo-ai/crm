import assert from "node:assert/strict";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import { callRatingEngine } from "../server/rating-engine";

// Run only in the workspace against DEVELOPMENT; no credentials or auth bypass.
async function main() {
  const before = await pool.query("SELECT count(*)::int AS n FROM clients");
  for (const brokerStatus of [undefined, null, "", "NOT_SET"]) {
    await assert.rejects(storage.createClient({ clientCode: "BATCH1-INVALID", clientName: "Validation only", brokerStatus } as any), /Choose Direct or Broker/);
  }
  const after = await pool.query("SELECT count(*)::int AS n FROM clients");
  assert.equal(before.rows[0].n, after.rows[0].n);
  console.log("DEV: missing, null, blank and NOT_SET new-client choices rejected; no rows inserted.");
  const result = await callRatingEngine<{ pdf_b64: string }>("/generate-renewal-sample", { group_name: "Development verification", group_id: "TEST" });
  const pdf = Buffer.from(result.pdf_b64, "base64");
  assert.equal(pdf.subarray(0,5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);
  console.log(`DEV: renewal proposal PDF generated through Node → Flask → WeasyPrint: ${pdf.length} bytes.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
