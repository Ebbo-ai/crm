import assert from "node:assert/strict";
import { pool } from "../server/db";
import { renewalSteps, renewalIsComplete } from "../shared/renewal-progress";
import { computeRenewalBuckets } from "../server/renewal-buckets";
import { projectRenewal } from "./renewal-migration-model";
const { rows } = await pool.query("SELECT row_to_json(c) client, row_to_json(r) renewal FROM renewals r JOIN clients c ON c.id=r.client_id");
const eligible = rows.filter(r=>!r.client.termination_date && !r.renewal.suppressed).map(({client:c,renewal:r})=>({
  client:{id:c.id,clientName:c.client_name,clientCode:c.client_code,anniversaryDate:c.anniversary_date},
  renewal:{...r,planYear:r.plan_year,pipelineStep:r.pipeline_step,completedAt:r.completed_at,updatedAt:r.updated_at},
}));
const buckets=computeRenewalBuckets(eligible,new Date("2026-10-15T12:00:00Z"));
const all=[...buckets.upcoming,...buckets.current,...buckets.complete];
assert.equal(all.length,eligible.length);
assert.equal(new Set(all.map(r=>r.renewalId)).size,eligible.length);
assert.equal(buckets.upcoming.filter(r=>r.late).length,0);
console.log("DEV exactly one bucket per eligible renewal:",{eligible:eligible.length,upcoming:buckets.upcoming.length,current:buckets.current.length,complete:buckets.complete.length,suppressed:rows.length-eligible.length});
const steps=Object.fromEntries(renewalSteps.map(k=>[k,{status:"DONE",date:"2026-10-15",by:"Test"}]));
assert.equal(renewalIsComplete({steps,handouts:[{planId:1,planName:"Test",documentId:null,date:null}]} as any),false);
const handouts=[{planId:1,planName:"Test",documentId:1,date:"2026-10-15"}];
assert.equal(renewalIsComplete({steps,handouts} as any),true);
assert.equal(renewalIsComplete({steps:{...steps,REVISED:{status:"NA",reason:"No revision requested",date:"2026-10-15",by:"Test"}},handouts} as any),true);
assert.equal(renewalIsComplete({steps:{...steps,REVISED:{status:"NA",reason:""}},handouts} as any),false);
const merged=projectRenewal({client_id:1,plan_year:2026,pipeline_step:"SENT"}, {client_code:"S-999"},[{id:1,client_id:1,plan_year:2025}], [{plan_id:1,step1_date:"2026-01-01",step7_date:"2026-10-01"}]);
assert.equal(merged.steps.REQUESTED.date,"2026-01-01");
assert.equal(merged.pipeline_step,"EMAILED_TO_90D");
assert.deepEqual(projectRenewal(merged,{client_code:"S-999"},[],[]),merged);
console.log("PASS: completion requires every step and handout; N/A requires reason; migration merges furthest progress and preserves reruns.");
await pool.end();
