import assert from "node:assert/strict";
import fs from "node:fs";
import { dailyWork, renderDailyWork } from "../shared/daily-work";
import { nextRenewalStep, handoutsNotTracked } from "../shared/renewal-progress";
import { projectRenewal } from "./renewal-migration-model";
const now=new Date("2026-10-16T11:30:00Z");
const done={status:"DONE" as const,date:"2026-09-02",by:"Test"};
assert.equal(nextRenewalStep({EMAILED_TO_90D:done}),undefined);
assert.equal(nextRenewalStep({SENT:done}),"ACCEPTED");
assert.equal(nextRenewalStep({SENT:done,REVISED:{...done,status:"REQUESTED"}}),"REVISED");
assert.equal(nextRenewalStep({ACCEPTED:done}),"SIGNED_FORM_ATTACHED");
assert.equal(nextRenewalStep({SIGNED_FORM_ATTACHED:{...done,status:"NA",reason:"No signature"}}),"EMAILED_TO_90D");
const old={planYear:2026,anniversaryDate:"2026-09-15",steps:{EMAILED_TO_90D:done}};
assert.equal(handoutsNotTracked(old,"2026-10-16"),true);
assert.equal(handoutsNotTracked({...old,anniversaryDate:"2026-09-16"},"2026-10-16"),false);
assert.equal(handoutsNotTracked({...old,steps:{}},"2026-10-16"),false);
const fixture=(id:number,step:string|null,steps:any,anniversaryDate="2026-11-01")=>({id,clientId:id,clientName:`Test ${id}`,planYear:2026,pipelineStep:step,steps,anniversaryDate,handouts:[{planId:id,planName:"Dental",documentId:null,date:null}]});
const rows=[fixture(1,"EMAILED_TO_90D",{ACCEPTED:done,EMAILED_TO_90D:done},"2026-09-01"),
  fixture(2,"EMAILED_TO_90D",{ACCEPTED:done,EMAILED_TO_90D:done},"2026-10-01"),
  fixture(3,"REQUESTED",{REQUESTED:done}),fixture(4,"SENT",{SENT:done,REVISED:{...done,status:"REQUESTED"}}),
  fixture(5,null,{},"2026-12-01"),fixture(6,null,{},"2026-10-01")];
const kim=dailyWork({tasks:[],renewals:rows},"Kim Anderson",now.toISOString(),now);
const steve=dailyWork({tasks:[],renewals:rows},"Steve Schultz",now.toISOString(),now);
assert.ok(![...kim.renewals,...steve.renewals].some(r=>[1,5].includes(r.id)));
assert.deepEqual(steve.renewals.map(r=>r.description).sort(),["PROCESSED","REVISED"]);
assert.equal(kim.renewals.filter(r=>r.id===2).length,1);
assert.ok(kim.renewals.some(r=>r.id===6&&r.description==="REQUESTED"));
assert.equal(steve.waitingOnKim,2); // distinct renewals, not handout lines
assert.ok(renderDailyWork(steve).includes("2 renewals waiting on Kim"));
const gatingRows=[
  fixture(11,"REQUESTED",{REQUESTED:done}),
  fixture(12,"SENT",{SENT:done}),
  fixture(13,"EMAILED_TO_90D",{EMAILED_TO_90D:done}),
  fixture(14,"ACCEPTED",{ACCEPTED:done}),
  fixture(15,"ACCEPTED",{ACCEPTED:{...done,status:"NA",reason:"Proceeded without signing"}}),
  fixture(16,"ACCEPTED",{ACCEPTED:{...done,status:"OPEN"}}),
];
const gated=dailyWork({tasks:[],renewals:gatingRows},"Kim Anderson",now.toISOString(),now);
assert.deepEqual(gated.renewals.filter(r=>r.description.startsWith("Employee handout:")).map(r=>r.id),[14,15]);
assert.ok(gated.renewals.some(r=>r.id===12&&r.description==="ACCEPTED"));
console.log("PASS: handouts require explicitly DONE/NA Accepted; absent/open Accepted and later completion alone do not qualify.");
console.log("PASS: later-step precedence, optional/requested revision, 30/31-day boundary, Current/LATE only, ownership and distinct-renewal summary.");
if(process.argv[2]){
  const s=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
  const renewals=s.renewals.map((raw:any)=>{
    const c=s.clients.find((c:any)=>c.id===raw.client_id);
    const r=projectRenewal(raw,c,s.plans,s.progress||[]);
    return {...r,clientId:c.id,clientName:c.client_name,clientCode:c.client_code,anniversaryDate:c.anniversary_date,terminationDate:c.termination_date,planYear:r.plan_year,pipelineStep:r.pipeline_step};
  });
  console.log(`Fresh production snapshot: ${s.capturedAt}; projected for ${now.toISOString()}, after pending batch-2 migration (in memory only).`);
  for(const owner of ["Kim Anderson","Steve Schultz"]){
    const work=dailyWork({tasks:[],renewals},owner,now.toISOString(),now);
    console.log(JSON.stringify({owner,count:work.renewals.length,waitingOnKim:work.waitingOnKim,lines:work.renewals.slice(0,25)},null,2));
  }
}
