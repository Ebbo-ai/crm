import { renewalSteps, renewalIsComplete, nextRenewalStep, handoutsNotTracked } from "./renewal-progress";
import { computeRenewalBuckets } from "../server/renewal-buckets";
export const normalizeAsk = (text: string) => text.normalize("NFKC").toLowerCase().replace(new RegExp("[^\\p{L}\\p{N}]+","gu")," ").trim();
export const isRenewalAsk=(task:any)=>(task.taskKind==="RENEWAL" || /\b(renewal|renewals|renewing|transmittal|signed acceptance|employee handout)\b/i.test(task.description)) && !/\b(claim|claims|run.?out|refund|reconciliation)\b/i.test(task.description);
export function checkedDueDate(value: string | null | undefined, sent: string | Date) {
  if (!value) return {dueDate:null, dateReview:null};
  const day = new Date(sent).toISOString().slice(0,10);
  const ceiling = new Date(day);
  const dayOfMonth=ceiling.getUTCDate();
  ceiling.setUTCDate(1);ceiling.setUTCMonth(ceiling.getUTCMonth()+19);ceiling.setUTCDate(0);
  ceiling.setUTCDate(Math.min(dayOfMonth,ceiling.getUTCDate()));
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value || value<day || date>ceiling)
    return {dueDate:null,dateReview:`Review extracted date ${value}: outside message-date / 18-month window`};
  return {dueDate:date,dateReview:null};
}
export function easternDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
export function dailyWork(data:any, owner:string, since:string, now=new Date()) {
  const today=easternDay(now);
  const end=new Date(today); end.setUTCDate(end.getUTCDate()+7);
  const max=end.toISOString().slice(0,10);
  const tasks=data.tasks.filter((t:any)=>t.owner===owner && ["OPEN","TODO"].includes(t.status));
  const line=(t:any)=>({...t,client:(t.clientNames||[]).join(", ")||"General",due:t.dueDate ? String(t.dueDate).slice(0,10):null});
  const todos=tasks.filter((t:any)=>t.status==="TODO" && (!t.dueDate || String(t.dueDate).slice(0,10)<=max)).map(line)
    .sort((a:any,b:any)=>(a.due||"9999").localeCompare(b.due||"9999")||a.id-b.id);
  const fresh=tasks.filter((t:any)=>t.origin!=="MANUAL" && new Date(t.createdAt)<=now)
    .sort((a:any,b:any)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()||a.id-b.id);
  const seen=new Set<string>();
  const suggestions=fresh.filter((t:any)=>{
    const key=t.groupId || JSON.stringify([t.clientIds||[],t.threadId||t.communicationId||"",normalizeAsk(t.description)]);
    if(seen.has(key)) return false; seen.add(key); return true;
  }).filter((t:any)=>t.status==="OPEN" && new Date(t.createdAt)>new Date(since)).map(line);
  const renewals:any[]=[];
  // Ownership is by step, as approved: production/revision to Steve, all else to Kim.
  const sources=data.renewals.filter((r:any)=>!r.terminationDate && !r.suppressed).map((r:any)=>({
    client:{id:r.clientId,clientName:r.clientName,clientCode:r.clientCode||"",anniversaryDate:r.anniversaryDate},renewal:{...r,updatedAt:r.updatedAt||now},
  }));
  const current=new Set(computeRenewalBuckets(sources,now).current.map(r=>r.renewalId));
  for(const r of data.renewals) {
    if(!current.has(r.id)) continue;
    if(r.suppressed || r.terminationDate || renewalIsComplete(r)) continue;
    const anniversary=String(r.anniversaryDate||`${r.planYear}-01-01`).slice(0,10);
    const due=new Date(anniversary); due.setUTCFullYear(r.planYear);
    const date=due.toISOString().slice(0,10);
    const send=new Date(due); send.setUTCDate(send.getUTCDate()-14);
    const step=nextRenewalStep(r.steps);
    if(step) renewals.push({id:r.id,clientId:r.clientId,client:r.clientName,owner:step==="PROCESSED" || step==="REVISED" ? "Steve Schultz":"Kim Anderson",description:step.replaceAll("_"," ").replace("90D","90 Degree"),due:renewalSteps.indexOf(step)<=2 ? send.toISOString().slice(0,10):date});
    const accepted = r.steps?.ACCEPTED?.status === "DONE" || r.steps?.ACCEPTED?.status === "NA";
    if(accepted && !handoutsNotTracked(r,today)) for(const h of r.handouts||[]) if(!h.documentId || !h.date) renewals.push({id:r.id,clientId:r.clientId,client:r.clientName,owner:"Kim Anderson",description:`Employee handout: ${h.planName}`,due:date});
  }
  renewals.sort((a,b)=>a.due.localeCompare(b.due)||a.client.localeCompare(b.client));
  const waitingOnKim=owner==="Steve Schultz" ? new Set(renewals.filter(r=>r.owner==="Kim Anderson").map(r=>r.id)).size : null;
  return {owner,today,since,totalOpen:tasks.length,todos,renewals:renewals.filter(r=>r.owner===owner),waitingOnKim,suggestions:suggestions.slice(0,15),moreInTriage:Math.max(0,suggestions.length-15)};
}
export function renderDailyWork(work:ReturnType<typeof dailyWork>) {
  const format=(t:any)=>`- ${t.client}: ${t.description} — ${t.due ? `due ${t.due}`:"no due date"}${t.dateReview ? " [DATE REVIEW]":""}`;
  return [`Your daily work list — ${work.today}`,`Total open: ${work.totalOpen}`,"","My to-dos",...(work.todos.length?work.todos.map(format):["None due."]),"","Renewal steps",...(work.waitingOnKim!==null?[`${work.waitingOnKim} renewals waiting on Kim`]:[]),...(work.renewals.length?work.renewals.map(format):["None."]),"","New from email",...(work.suggestions.length?work.suggestions.map(format):["None."]),`${work.moreInTriage} more in triage`].join("\n");
}
