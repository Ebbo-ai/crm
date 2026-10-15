import { pool } from "./db";
import { dailyWork } from "../shared/daily-work";
export async function dailyWorkData() {
  const tasks=(await pool.query(`SELECT t.id,t.owner,t.description,t.status,t.origin,t.due_date AS "dueDate",t.created_at AS "createdAt",t.group_id AS "groupId",t.date_review AS "dateReview",t.communication_id AS "communicationId",g.thread_id AS "threadId",
    COALESCE((SELECT json_agg(c.client_name ORDER BY c.id) FROM task_clients tc JOIN clients c ON c.id=tc.client_id WHERE tc.task_id=t.id),'[]') AS "clientNames",
    COALESCE((SELECT json_agg(tc.client_id ORDER BY tc.client_id) FROM task_clients tc WHERE tc.task_id=t.id),'[]') AS "clientIds"
    FROM communication_tasks t LEFT JOIN gmail_messages g ON g.id=t.gmail_message_id WHERE t.status IN ('OPEN','TODO')`)).rows;
  const renewals=(await pool.query(`SELECT r.id,r.client_id AS "clientId",r.plan_year AS "planYear",r.pipeline_step AS "pipelineStep",r.steps,r.handouts,r.suppressed,c.client_name AS "clientName",c.anniversary_date AS "anniversaryDate",c.termination_date AS "terminationDate" FROM renewals r JOIN clients c ON c.id=r.client_id`)).rows;
  return JSON.parse(JSON.stringify({tasks,renewals}));
}
export async function cutoffFor(userId:number|string, now:Date, forView=false) {
  const keys=[`digest:lastSuccessAt:${userId}`,`digest:lastSentDate:${userId}`,`digest:windowStart:${userId}`];
  const settings=(await pool.query("SELECT key,value FROM app_settings WHERE key=ANY($1::text[])",[keys])).rows;
  const get=(k:string)=>settings.find((s:any)=>s.key===k)?.value;
  if(forView && get(keys[2])) return get(keys[2]);
  if(get(keys[0])) return get(keys[0]);
  const old=get(keys[1]);
  if(old && /^\d{4}-\d{2}-\d{2}$/.test(old)) {
    // Resolve 07:30 Eastern in both standard and daylight time.
    const noon=new Date(`${old}T12:00:00Z`);
    const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",hourCycle:"h23"}).format(noon));
    return `${old}T${String(7+12-hour).padStart(2,"0")}:30:00.000Z`;
  }
  return new Date(now.getTime()-86400000).toISOString();
}
export async function getDailyWork(user:any,forView=false,now=new Date()) {
  return dailyWork(await dailyWorkData(),user.fullName,await cutoffFor(user.id,now,forView),now);
}
