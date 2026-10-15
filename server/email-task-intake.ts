import { pool } from "./db";
import { checkedDueDate, normalizeAsk, isRenewalAsk } from "../shared/daily-work";
import { findDuplicateTask } from "./claude";
export async function ingestEmailTask(task:any, matches:{clientId:number;confidence:string}[]) {
  const conn=await pool.connect();
  try {
    await conn.query("BEGIN");
    const msg=(await conn.query("SELECT thread_id,sent_at FROM gmail_messages WHERE id=$1",[task.gmailMessageId])).rows[0];
    if(!msg) throw new Error("Source email not found");
    const clients=(await conn.query("SELECT id,termination_date FROM clients WHERE id=ANY($1::int[])",[matches.map(m=>m.clientId)])).rows;
    const renewal=isRenewalAsk(task);
    const allowed=renewal ? matches.filter(m=>!clients.find(c=>c.id===m.clientId)?.termination_date):matches;
    if(renewal && matches.length && !allowed.length) {await conn.query("COMMIT");return null;}
    const ids=allowed.map(m=>m.clientId).sort((a,b)=>a-b);
    const key=JSON.stringify([task.owner,msg.thread_id,ids]);
    await conn.query("SELECT pg_advisory_xact_lock(hashtext($1))",[key]);
    const candidates=(await conn.query(`SELECT t.id,t.description FROM communication_tasks t JOIN gmail_messages g ON g.id=t.gmail_message_id
      WHERE t.owner=$1 AND g.thread_id=$2 AND t.status IN ('OPEN','TODO')
      AND ARRAY(SELECT client_id FROM task_clients WHERE task_id=t.id ORDER BY client_id)=$3::int[] FOR UPDATE OF t`,[task.owner,msg.thread_id,ids])).rows;
    let same=candidates.find(c=>normalizeAsk(c.description)===normalizeAsk(task.description));
    if(!same && candidates.length) {
      const matched=await findDuplicateTask(task.description,candidates);
      same=candidates.find(c=>c.id===matched);
    }
    const dates=checkedDueDate(task.extractedDueDate !== undefined ? String(task.extractedDueDate || "") || null : task.dueDate ? new Date(task.dueDate).toISOString().slice(0,10):null,msg.sent_at);
    if(same) {
      await conn.query(`UPDATE communication_tasks SET source_message_ids=CASE WHEN source_message_ids @> $2::jsonb THEN source_message_ids ELSE source_message_ids || $2::jsonb END WHERE id=$1`,[same.id,JSON.stringify([task.gmailMessageId])]);
      await conn.query("COMMIT");return {...same,attached:true};
    }
    const row=(await conn.query(`INSERT INTO communication_tasks (gmail_message_id,client_id,description,due_date,owner,ai_priority,date_review,source_message_ids)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[task.gmailMessageId,ids[0]??null,task.description,dates.dueDate,task.owner,task.aiPriority,dates.dateReview,JSON.stringify([task.gmailMessageId])])).rows[0];
    for(const m of allowed) await conn.query("INSERT INTO task_clients (task_id,client_id,match_confidence) VALUES ($1,$2,$3)",[row.id,m.clientId,m.confidence]);
    await conn.query("COMMIT"); return row;
  }catch(e){await conn.query("ROLLBACK");throw e;}finally{conn.release();}
}
