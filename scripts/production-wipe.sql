-- ============================================================================
-- Production data wipe
-- ============================================================================
--
-- PREREQUISITE: the app must be published first. This script assumes the
-- post-publish schema (plan_tiers, renewals, renewal_plan_options,
-- plan_performance_facts, ppr_import_batches, ppr_held_rows all present).
-- Running it against the old production schema will error on the first
-- missing table, which is the intended safety behaviour.
--
-- WHAT THIS REMOVES: clients, plans, plan tiers, rate cards, renewals and
-- their plan options, documents, PPR uploads, PPR import batches and held
-- rows, and plan performance facts.
--
-- WHAT THIS PRESERVES: users, sessions, audit_logs, issues, and the
-- communications graph itself (communications and their attachments).
-- No foreign key anywhere in the schema references users or session, so no
-- deletion below can reach a login.
--
-- Run STEP 1 and STEP 2 first and read their output. STEP 3 is destructive
-- and irreversible. STEP 4 proves what survived.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — Inventory. Read this before going further.
-- ----------------------------------------------------------------------------
select 'clients'                 as table_name, count(*) from clients
union all select 'plans',                       count(*) from plans
union all select 'plan_tiers',                  count(*) from plan_tiers
union all select 'rate_cards',                  count(*) from rate_cards
union all select 'renewals',                    count(*) from renewals
union all select 'renewal_plan_options',        count(*) from renewal_plan_options
union all select 'documents',                   count(*) from documents
union all select 'ppr_uploads',                 count(*) from ppr_uploads
union all select 'ppr_import_batches',          count(*) from ppr_import_batches
union all select 'ppr_held_rows',               count(*) from ppr_held_rows
union all select 'plan_performance_facts',      count(*) from plan_performance_facts
union all select '-- preserved below --',       null
union all select 'users',                       count(*) from users
union all select 'session',                     count(*) from session
union all select 'communications',              count(*) from communications
union all select 'communication_attachments',   count(*) from communication_attachments
union all select 'communication_clients',       count(*) from communication_clients
union all select 'communication_tasks (linked)',count(*) from communication_tasks where client_id is not null
union all select 'issues',                      count(*) from issues
order by 1;


-- ----------------------------------------------------------------------------
-- STEP 2 — Preserve the communication links.
--
-- communication_clients CASCADEs from clients and communication_tasks.client_id
-- is SET NULL, so deleting clients destroys every tie between an inbound email
-- and the client it concerns. The emails survive; the links do not.
--
-- These backup tables key on client_code, NOT client_id, because the import
-- assigns fresh ids. The codes are stored normalised (padding stripped) so the
-- replay still matches if a code is re-spelled by the import.
-- ----------------------------------------------------------------------------

create table if not exists _backup_communication_clients (
  communication_id integer not null,
  client_code      text    not null,
  client_name      text,
  norm_code        text    not null
);

create table if not exists _backup_communication_tasks (
  task_id     integer not null,
  client_code text    not null,
  client_name text,
  norm_code   text    not null
);

truncate _backup_communication_clients, _backup_communication_tasks;

insert into _backup_communication_clients (communication_id, client_code, client_name, norm_code)
select cc.communication_id,
       c.client_code,
       c.client_name,
       regexp_replace(upper(trim(c.client_code)), '^([A-Z]+)[-\s]*0*([0-9]+)$', '\1-\2')
from communication_clients cc
join clients c on c.id = cc.client_id;

insert into _backup_communication_tasks (task_id, client_code, client_name, norm_code)
select ct.id,
       c.client_code,
       c.client_name,
       regexp_replace(upper(trim(c.client_code)), '^([A-Z]+)[-\s]*0*([0-9]+)$', '\1-\2')
from communication_tasks ct
join clients c on c.id = ct.client_id
where ct.client_id is not null;

-- Confirm every link was captured. Both differences must be zero before STEP 3.
select
  (select count(*) from communication_clients)              as links_now,
  (select count(*) from _backup_communication_clients)      as links_saved,
  (select count(*) from communication_tasks
     where client_id is not null)                           as tasks_now,
  (select count(*) from _backup_communication_tasks)        as tasks_saved;


-- ----------------------------------------------------------------------------
-- STEP 3 — DESTRUCTIVE. Deletes in foreign-key-safe order.
--
-- plan_performance_facts and ppr_held_rows are NO ACTION against their parents,
-- so they must go first or the delete errors rather than cascading.
-- ----------------------------------------------------------------------------
begin;

delete from plan_performance_facts;
delete from ppr_held_rows;
delete from ppr_import_batches;
delete from ppr_uploads;
delete from documents;
delete from renewal_plan_options;
delete from renewals;
delete from rate_cards;
delete from plan_tiers;
delete from plans;
delete from clients;   -- cascades communication_clients, nulls communication_tasks.client_id

-- Guard: nothing above may touch a login. Aborts the transaction if it did.
do $$
declare u integer; s integer;
begin
  select count(*) into u from users;
  select count(*) into s from session;
  if u = 0 then raise exception 'ABORT: users table was emptied'; end if;
  if s = 0 then raise exception 'ABORT: session table was emptied'; end if;
end $$;

commit;


-- ----------------------------------------------------------------------------
-- STEP 4 — What survived.
-- ----------------------------------------------------------------------------
select 'clients'                        as table_name, count(*) as should_be_zero from clients
union all select 'plans',                              count(*) from plans
union all select 'plan_tiers',                         count(*) from plan_tiers
union all select 'rate_cards',                         count(*) from rate_cards
union all select 'renewals',                           count(*) from renewals
union all select 'ppr_uploads',                        count(*) from ppr_uploads
order by 1;

select 'users'                          as table_name, count(*) as should_be_unchanged from users
union all select 'session',                            count(*) from session
union all select 'communications',                     count(*) from communications
union all select 'communication_attachments',          count(*) from communication_attachments
union all select 'issues',                             count(*) from issues
union all select 'audit_logs',                         count(*) from audit_logs
union all select 'links held for replay',              count(*) from _backup_communication_clients
union all select 'task links held for replay',         count(*) from _backup_communication_tasks
order by 1;
