---
name: Startup migration chain
description: Migrations re-run on every boot in source order — why column drops must go last and relocated ADDs must be deleted from earlier phases.
---

# Startup migrations re-run on EVERY boot

The migration phases execute in source order on each server start, guarded by
`IF NOT EXISTS` / `IF EXISTS` checks. They are not a versioned, run-once chain.

**Why this matters:** if a later phase DROPs a column that an earlier phase ADDs, the
two fight forever — every boot the column is added and then dropped (or dropped and
then re-added, depending on order). This is invisible in a single-boot test and shows
up as data vanishing on restart.

**How to apply** when relocating a column to a new table:
1. Delete the ADD from the original phase. If that leaves the phase empty, remove the
   phase but leave a comment explaining why the number is retired — otherwise someone
   re-adds it later.
2. Put the DROP in a new phase placed LAST in the source file.
3. Leave a comment on the dropping phase saying it must stay last.

Belt and braces: removing the ADDs alone is sufficient, but keeping drops last means a
future re-added column can't survive by being recreated after the drop.

**Verification that actually catches this:** restart twice and confirm the columns are
still gone after the second boot. A single restart passes even when the ordering is
wrong.

## A phase that ADDs a column must precede any ORM query touching that table

Drizzle selects every column the schema file declares, so the moment a new column
exists in the schema, any `db.select()` on that table fails until the ALTER has run.
A phase that runs an ORM-backed helper (a backfill, a catch-up pass) placed above the
ALTER throws `column ... does not exist`, and because the whole chain sits in one
try/catch, every later phase — including the ALTER itself — silently never runs.

**How to apply:** put DDL for a new column above every phase that reads that table
through the ORM, not merely above the code that uses the new column. Raw `pool.query`
with explicit column lists is unaffected; the ORM is the trap.

## Uniqueness belongs in the database

Where records are auto-created as a side effect of GET requests, concurrent page loads
race an application-level "does it exist" check. Add a UNIQUE index and use
`ON CONFLICT DO NOTHING`, then re-read the row rather than trusting the insert's return
value — the request that loses the race gets nothing back, and the winner's row is the
correct one to use.
