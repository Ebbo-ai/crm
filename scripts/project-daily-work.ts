import fs from "node:fs";
import { dailyWork,renderDailyWork } from "../shared/daily-work";
import { projectRenewal } from "./renewal-migration-model";
const snapshot=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const now=new Date("2026-10-16T11:30:00Z");
const markdown=process.argv.includes("--markdown");
if(markdown) console.log("# Batch 3: read-only production projection\n\nFor October 16, 2026, 7:30 AM Eastern. Uses the October 15 snapshot, the previous recorded digest date (October 15 at 7:30 AM Eastern), and the pending batch-2 renewal migration projection. Assumes publication and that migration; future mail, accepts, dismissals and renewal changes are unknown. No production data was changed.\n\nRenewal work has no assignee and is shared in both lists. Requested/Processed/Sent are due 14 days before anniversary; later steps/handouts by anniversary. Undated accepted to-dos remain visible. Existing task dates are preserved; the new date guard applies to future extraction. Email links open the matching Today row; actions require an authenticated POST, never a GET that a mail scanner can follow.\n");
const renewals=snapshot.renewals.map((raw:any)=>{
  const c=snapshot.clients.find((c:any)=>c.id===raw.client_id);
  const r=projectRenewal(raw,c,snapshot.plans,snapshot.progress||[]);
  return {...r,clientId:c.id,clientName:c.client_name,anniversaryDate:c.anniversary_date,terminationDate:c.termination_date,planYear:r.plan_year,pipelineStep:r.pipeline_step};
});
for(const owner of ["Kim Anderson","Steve Schultz"]) {
  const user=snapshot.users.find((u:any)=>u.full_name===owner);
  const cutoff=snapshot.settings.find((s:any)=>s.key===`digest:lastSuccessAt:${user.id}`)?.value ||
    `${snapshot.settings.find((s:any)=>s.key===`digest:lastSentDate:${user.id}`)?.value || "2026-10-15"}T11:30:00Z`;
  const work=dailyWork({tasks:snapshot.tasks,renewals},owner,cutoff,now);
  if(markdown) {
    console.log(`## ${owner}\n\nTotal open: ${work.totalOpen}. My to-dos: ${work.todos.length}; renewal lines: ${work.renewals.length}; new email displayed: ${work.suggestions.length}; more in triage: ${work.moreInTriage}.\n`);
    for(const [title,rows] of [["My to-dos",work.todos],["Renewal steps",work.renewals],["New from email",work.suggestions]] as const) {
      console.log(`### ${title} — first ten\n`);
      if(!rows.length) console.log("None.\n");
      rows.slice(0,10).forEach((t:any,i:number)=>console.log(`${i+1}. **${t.client}:** ${t.description} — ${t.due ? `due ${t.due}`:"no due date"}.`));
      console.log("");
    }
  } else console.log(JSON.stringify({owner,cutoff,totalOpen:work.totalOpen,counts:{todos:work.todos.length,renewals:work.renewals.length,email:work.suggestions.length,more:work.moreInTriage},firstTen:{todos:work.todos.slice(0,10),renewals:work.renewals.slice(0,10),email:work.suggestions.slice(0,10)}},null,2));
}
