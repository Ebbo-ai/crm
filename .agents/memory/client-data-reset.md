---
name: Client data reset and re-import
description: Rules for wiping and re-importing the client book without orphaning the mail, and why re-attach normalises padding when nothing else may.
---

# Wiping and re-importing the client book

The client book is periodically deleted and re-imported from the CRM workbook. Database
ids do not survive that. Client code strings do. Every part of the procedure is built on
that one fact.

## The mail is the fragile part

Emails, attachments and tasks are never deleted by a reset, but their links to clients
are: `communication_clients` cascades from `clients`, and `communication_tasks.client_id`
is set null. Those links are the only thing that has to be carried across the gap, and
they are carried by client **code**, never by id.

**Rule:** the link snapshot must be taken inside the same transaction that performs the
deletes.

**Why:** the mailbox keeps receiving. A snapshot taken as a separate earlier request —
even minutes earlier — silently misses anything that arrived in between, and those links
are then unrecoverable. A pre-flight export is still worth taking as a second copy in
case the reset response is lost, but it is not the authoritative one.

**How to apply:** any future variant of this procedure returns its own in-transaction
snapshot to the caller and expects that file to be the one fed back in.

## Re-attach normalises padding; nothing else ever does

Matching a code at re-attach time is exact first, then padding-insensitive, and the
padding-insensitive match is accepted **only** when it resolves to exactly one client.
Every such match is reported in the result rather than performed quietly.

**Why:** the wipe exists partly to correct code spelling — the stored book has held
padded codes like `S-020` while the workbook and every downstream matcher use `S-20`. So
the export written before the wipe is guaranteed to disagree with the book written after
it. Exact-only matching would orphan the entire mail history of every re-spelled client,
which defeats the purpose of the export. See `crm-import.md` for why the stored spelling
must be the unpadded one.

**How to apply:** normalise in the *lookup*. Never rewrite a stored `client_code` to make
a match work — the monthly claims importer and the PPR filename matcher both compare the
stored string exactly, so re-spelling a stored code breaks them silently. Report an
ambiguous code and attach nothing rather than guessing between candidates.

## Client-keyed tables are wider than the obvious list

Beyond the client/plan/rate-card/renewal/document/PPR tables, these also key on a client
or plan and must go in the same wipe or they survive pointing at ids that have been
reissued to different clients: `renewal_progress`, `prospect_progress`, `ppr_metrics`,
`broker_history`, `plan_performance_facts`. Several are unconstrained, so the database
will not complain — they just quietly become another client's history.

`issues` is deliberately **not** deleted, and can therefore hold references to clients
that no longer exist. Check it after any reset.

`plan_performance_facts` and `ppr_held_rows` are NO ACTION against their parents, so they
must be deleted before `clients`/`plans` and `ppr_import_batches` respectively.

## Seeding does not come back

`seedDatabase` returns early when an admin user already exists. Users survive a reset, so
a wipe does **not** resurrect the `S-001`–`S-005` demo clients. Do not add a guard for
something that cannot happen.

## Verifying a change to this procedure

The delete ordering and the in-transaction snapshot can both be rehearsed against real
data without destroying any: run the real `DELETE_ORDER` inside a transaction and throw
to roll it back, checking counts inside the transaction and again after. This catches
foreign-key ordering mistakes, which are the main failure mode.
