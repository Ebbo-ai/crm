import cron from "node-cron";
import { storage } from "./storage";
import { errorLabel } from "./logRedaction";
import { sendEmail } from "./mailer";
import { pool } from "./db";
import { getDailyWork } from "./daily-work";
import { easternDay, renderDailyWork } from "../shared/daily-work";
const DIGEST_FROM="Simple Benefits CRM <notifications@mg.simple.us>";
// Verified through the deployment metadata service, not a dev-preview domain.
const TODAY_URL="https://simplebenefits.replit.app/today";
const escape=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
export async function sendDigestFor(ownerFullName:string,ownerEmail:string,userId?:number|string) {
  if(!userId) {
    const user=(await storage.getAllUsers()).find(u=>u.fullName===ownerFullName);
    if(!user) throw new Error("Digest owner not found");
    userId=user.id;
  }
  const now=new Date();
  const work=await getDailyWork({id:userId,fullName:ownerFullName},false,now);
  const text=renderDailyWork(work);
  const sections=([["My to-dos",work.todos],["Renewal steps",work.renewals],["New from email",work.suggestions]] as const).map(([title,rows])=>`<h2>${title}</h2><ul>${rows.map((t:any)=>`<li><b>${escape(t.client)}</b>: ${escape(t.description)} — ${t.due?`due ${escape(t.due)}`:"no due date"}${t.dateReview?" [DATE REVIEW]":""}${title==="New from email"?`<br><a href="${TODAY_URL}#suggestion-${t.id}">Accept</a> · <a href="${TODAY_URL}#suggestion-${t.id}">Dismiss</a> (in Today)`:""}</li>`).join("")||"<li>None.</li>"}</ul>`).join("");
  const result=await sendEmail({from:DIGEST_FROM,to:ownerEmail,subject:`Your daily work list — ${work.today}`,
    text:`${text}\n\nAccept or dismiss suggestions: ${TODAY_URL}`,
    html:`<h1>Your daily work list — ${work.today}</h1><p>Total open: ${work.totalOpen}</p>${sections}<p>${work.moreInTriage} more in triage</p><p><a href="${TODAY_URL}">Open Today</a></p>`});
  if(!result.ok) throw new Error(`Digest delivery failed: ${errorLabel(result.error)}`);
  // Advance only after a successful send. Failed sends retain their whole window.
  await storage.setAppSetting(`digest:windowStart:${userId}`,work.since,"system");
  await storage.setAppSetting(`digest:lastSuccessAt:${userId}`,now.toISOString(),"system");
  await storage.setAppSetting(`digest:lastSentDate:${userId}`,easternDay(now),"system");
}
export async function runDailyDigest() {
  const users=await storage.getAllUsers();
  let sent=0,skipped=0,failed=0;
  for(const user of users.filter(u=>u.isActive && u.fullName!=="System Administrator")) {
    const conn=await pool.connect();let locked=false;
    try {
      locked=(await conn.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked",[`daily-digest:${user.id}`])).rows[0].locked;
      if(!locked){skipped++;continue;}
      if((await storage.getAppSetting(`digest:lastSentDate:${user.id}`))?.value===easternDay(new Date())){skipped++;continue;}
      await sendDigestFor(user.fullName,user.email,user.id);sent++;
    }catch(e){failed++;console.error(`Digest failed for user #${user.id}: ${errorLabel(e)}`);}
    finally {if(locked)await conn.query("SELECT pg_advisory_unlock(hashtext($1))",[`daily-digest:${user.id}`]);conn.release();}
  }
  return {sent,skipped,failed};
}
export function scheduleDailyDigest() {
  cron.schedule("30 7 * * *",()=>{runDailyDigest().catch(e=>console.error(errorLabel(e)));},{timezone:"America/New_York"});
}
