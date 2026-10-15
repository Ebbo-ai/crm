import fs from "node:fs";
import { projectRenewal } from "./renewal-migration-model";
const input = process.argv.find(a => a.endsWith(".json"));
const apply = process.argv.includes("--apply-dev");
if (!input) throw new Error("Pass a read-only JSON snapshot; optional --apply-dev writes DEVELOPMENT only");
if (apply && process.env.NODE_ENV === "production") throw new Error("Dev execution only");
const snapshot = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = snapshot.renewals.map((r:any) => projectRenewal(r, snapshot.clients.find((c:any)=>c.id===r.client_id), snapshot.plans ?? [], snapshot.progress ?? []));
if (process.argv.includes("--sql")) {
  const literal = (value:any) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  console.log("BEGIN;");
  for (const r of rows) console.log(`UPDATE renewals SET steps=${literal(r.steps)},handouts=${literal(r.handouts)},suppressed=${!!r.suppressed},pipeline_step=${r.pipeline_step ? "'"+r.pipeline_step+"'" : "NULL"},completed_at=NULL WHERE id=${Number(r.id)} AND client_id=${Number(r.client_id)} AND plan_year=${Number(r.plan_year)} AND steps='{}'::jsonb AND handouts='[]'::jsonb;`);
  console.log("COMMIT;");
  process.exit(0);
}
if (apply) {
  if (!input.includes("development")) throw new Error("Only a development snapshot may be applied");
  const { pool } = await import("../server/db");
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    for (const r of rows) {
      await conn.query("UPDATE renewals SET steps=$1,handouts=$2,suppressed=$3,pipeline_step=$4,completed_at=$5 WHERE id=$6 AND steps='{}'::jsonb AND handouts='[]'::jsonb", [JSON.stringify(r.steps),JSON.stringify(r.handouts),r.suppressed,r.pipeline_step,r.completed_at,r.id]);
    }
    await conn.query("COMMIT");
  } catch(e) {await conn.query("ROLLBACK"); throw e;} finally {conn.release();await pool.end();}
}
for (const r of rows) {
  const c=snapshot.clients.find((c:any)=>c.id===r.client_id);
  if (["S-459","S-174","S-200","S-480","S-465","S-216","S-27"].includes(c.client_code)) console.log(JSON.stringify({code:c.client_code,year:r.plan_year,before:snapshot.renewals.find((x:any)=>x.id===r.id).pipeline_step,after:r.pipeline_step,steps:r.steps,handouts:r.handouts.length,suppressed:r.suppressed,complete:r.completed_at}));
}
