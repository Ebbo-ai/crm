import assert from "node:assert/strict";
import { pool } from "../server/db";
import { ingestEmailTask } from "../server/email-task-intake";
import { dailyWork,renderDailyWork,checkedDueDate } from "../shared/daily-work";
const now=new Date("2026-10-16T11:30:00Z");
const data={tasks:Array.from({length:20},(_,i)=>({id:i+1,owner:"Kim Anderson",description:`Ask ${i}`,status:"OPEN",origin:"AI",createdAt:"2026-10-15T15:00:00Z",clientIds:[],threadId:i})),renewals:[]};
const work=dailyWork(data,"Kim Anderson","2026-10-15T11:30:00Z",now);
assert.equal(work.suggestions.length,15);assert.equal(work.moreInTriage,5);
assert.ok(["My to-dos","Renewal steps","New from email"].every(s=>renderDailyWork(work).includes(s)));
assert.equal(checkedDueDate("2024-01-09","2026-10-15").dueDate,null);
assert.equal(checkedDueDate("2028-04-16","2026-10-15").dueDate,null);
assert.ok(checkedDueDate("2028-04-15","2026-10-15").dueDate);
const repeated=dailyWork({...data,tasks:[...data.tasks,{...data.tasks[0],id:99,createdAt:"2026-10-14T15:00:00Z"}]},"Kim Anderson","2026-10-15T11:30:00Z",now);
assert.ok(!repeated.suggestions.some((s:any)=>s.description==="Ask 0"),"An old open ask must not reappear via a fresh duplicate");
const unique=`batch3-test-${Date.now()}`;
let threadId:number|undefined;
const taskIds:number[]=[];
try {
  threadId=(await pool.query("INSERT INTO gmail_threads (gmail_thread_id,mailbox,latest_message_at) VALUES ($1,$2,now()) RETURNING id",[unique,"test@example.invalid"])).rows[0].id;
  const messageIds:number[]=[];
  for(let i=0;i<2;i++) messageIds.push((await pool.query("INSERT INTO gmail_messages (gmail_message_id,thread_id,mailbox,from_email,sent_at,direction) VALUES ($1,$2,$3,$3,$4,'RECEIVED') RETURNING id",[`${unique}-${i}`,threadId,"test@example.invalid","2026-10-15T10:00:00Z"])).rows[0].id);
  const first=await ingestEmailTask({gmailMessageId:messageIds[0],owner:unique,description:"Send the benefit summary.",dueDate:"2024-01-09"},[]);
  taskIds.push(first.id);
  const second=await ingestEmailTask({gmailMessageId:messageIds[1],owner:unique,description:"Send the benefit summary!",dueDate:null},[]);
  assert.equal(first.id,second.id);
  const rows=(await pool.query("SELECT * FROM communication_tasks WHERE owner=$1",[unique])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].due_date,null);assert.ok(rows[0].date_review);
  assert.deepEqual(rows[0].source_message_ids,messageIds);
  const client=(await pool.query("SELECT id FROM clients WHERE termination_date IS NOT NULL LIMIT 1")).rows[0];
  assert.ok(client,"Dev terminated-client fixture required");
  const refused=await ingestEmailTask({gmailMessageId:messageIds[0],owner:unique,description:"Send renewal proposal"},[{clientId:client.id,confidence:"test"}]);
  assert.equal(refused,null);
  const service=await ingestEmailTask({gmailMessageId:messageIds[0],owner:unique,description:"Resolve run-out claims"},[{clientId:client.id,confidence:"test"}]);
  taskIds.push(service.id);assert.ok(service);
  const {storage}=await import("../server/storage");
  assert.ok(await storage.moveTaskToTodo(first.id,"NORMAL",unique));
  assert.equal((await storage.resolveCommunicationTask(first.id,"Dismissed",unique,unique)).task,undefined);
  assert.ok((await storage.resolveCommunicationTask(service.id,"Test dismissal",unique,unique)).task);
  console.log("DEV PASS: three sections, 15 cap + 5 triage; repeated thread ask attaches to one task; 2024 due date on 2026 message stored NULL and flagged.");
  console.log("DEV PASS: terminated renewal suppressed; run-out allowed; Accept/Dismiss state transitions and stale-action rejection.");
}finally{
  await pool.query("DELETE FROM task_clients WHERE task_id=ANY($1::int[])",[taskIds]);
  await pool.query("DELETE FROM communication_tasks WHERE owner=$1",[unique]);
  if(threadId){await pool.query("DELETE FROM gmail_messages WHERE thread_id=$1",[threadId]);await pool.query("DELETE FROM gmail_threads WHERE id=$1",[threadId]);}
  await pool.end();
}
