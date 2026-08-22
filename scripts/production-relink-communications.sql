-- ============================================================================
-- Restore communication links after the production wipe and re-import
-- ============================================================================
--
-- Counterpart to scripts/production-wipe.sql STEP 2. Run this only AFTER the
-- client import has completed and been reconciled.
--
-- The backups key on a padding-normalised client_code, so a client stored as
-- S-020 before the wipe re-links correctly to S-20 after the import.
--
-- Nothing here guesses. A code that resolves to zero clients, or to more than
-- one, is reported and left unlinked rather than attached to the wrong client.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — Dry run. Read this before writing anything.
-- ----------------------------------------------------------------------------
with resolved as (
  select b.norm_code,
         b.client_code as old_code,
         b.client_name as old_name,
         count(c.id)   as matches,
         min(c.client_code) as new_code
  from (select distinct norm_code, client_code, client_name
        from _backup_communication_clients
        union
        select distinct norm_code, client_code, client_name
        from _backup_communication_tasks) b
  left join clients c
    on regexp_replace(upper(trim(c.client_code)), '^([A-Z]+)[-\s]*0*([0-9]+)$', '\1-\2') = b.norm_code
  group by 1,2,3
)
select case when matches = 1 then 'ok'
            when matches = 0 then 'NO MATCH - will stay unlinked'
            else 'AMBIGUOUS - will stay unlinked' end as status,
       old_code, old_name, new_code, matches
from resolved
order by matches = 1, old_code;

-- Codes whose spelling changed across the wipe. Expected where production held
-- a padded code and the import file spells it unpadded; worth reading anyway.
select b.client_code as before_wipe, c.client_code as after_import, c.client_name
from (select distinct norm_code, client_code from _backup_communication_clients) b
join clients c
  on regexp_replace(upper(trim(c.client_code)), '^([A-Z]+)[-\s]*0*([0-9]+)$', '\1-\2') = b.norm_code
where c.client_code <> b.client_code
order by 1;


-- ----------------------------------------------------------------------------
-- STEP 2 — Replay the links.
-- ----------------------------------------------------------------------------
begin;

-- Email-to-client links. Only unambiguous single matches are restored.
insert into communication_clients (communication_id, client_id)
select b.communication_id, m.client_id
from _backup_communication_clients b
join (
  select b2.norm_code, min(c.id) as client_id
  from (select distinct norm_code from _backup_communication_clients) b2
  join clients c
    on regexp_replace(upper(trim(c.client_code)), '^([A-Z]+)[-\s]*0*([0-9]+)$', '\1-\2') = b2.norm_code
  group by b2.norm_code
  having count(c.id) = 1
) m on m.norm_code = b.norm_code
where exists (select 1 from communications x where x.id = b.communication_id)
on conflict do nothing;

-- Task-to-client links.
update communication_tasks t
set client_id = m.client_id
from _backup_communication_tasks b
join (
  select b2.norm_code, min(c.id) as client_id
  from (select distinct norm_code from _backup_communication_tasks) b2
  join clients c
    on regexp_replace(upper(trim(c.client_code)), '^([A-Z]+)[-\s]*0*([0-9]+)$', '\1-\2') = b2.norm_code
  group by b2.norm_code
  having count(c.id) = 1
) m on m.norm_code = b.norm_code
where t.id = b.task_id
  and t.client_id is null;

commit;


-- ----------------------------------------------------------------------------
-- STEP 3 — Reconcile against what was saved.
-- ----------------------------------------------------------------------------
select
  (select count(*) from _backup_communication_clients) as links_saved,
  (select count(*) from communication_clients)         as links_restored,
  (select count(*) from _backup_communication_tasks)   as tasks_saved,
  (select count(*) from communication_tasks
     where client_id is not null)                      as tasks_restored;

-- Anything still unlinked, named so it can be decided by hand.
select b.client_code, b.client_name, count(*) as orphaned_emails
from _backup_communication_clients b
where not exists (
  select 1 from clients c
  where regexp_replace(upper(trim(c.client_code)), '^([A-Z]+)[-\s]*0*([0-9]+)$', '\1-\2') = b.norm_code
)
group by 1,2
order by 3 desc;

-- Once the counts above reconcile and the orphan list is understood or empty:
--   drop table _backup_communication_clients, _backup_communication_tasks;
