---
name: Client termination and run-out
description: Why a client termination date does not end the account, the five derived states, and the run-out window that keeps PPRs and claims flowing after it.
---

# A termination date does not end the relationship

It means only that **no renewal is needed**. Services continue, monthly PPRs continue,
and claims continue to import, right through the termination date and for a fixed
run-out window after it, because run-out claims are still being paid in that window.

**Why:** the business knows about a departure one to four months ahead. Treating the
date as an off switch cuts the account dead while it is still being serviced, and hides
exactly the months whose claims still need reporting.

## State is derived from the date, never stored alongside it

Five states come out of one nullable `clients.termination_date`: PROSPECT, ACTIVE,
TERMINATING, RUN_OUT, CLOSED. Renewals stop from TERMINATING onward; PPRs and claims
continue until CLOSED.

**Why:** a stored status and a date can disagree, and did. There was a startup migration
that forced `client_status = 'TERMINATED'` whenever a termination date existed, which
re-ran on every boot, so recording a *future* departure silently killed the account at
the next restart. Deriving removes the class of bug rather than fixing one instance.

**How to apply:** never add a status column that duplicates the date, and never
reintroduce a migration that reconciles one to the other. PROSPECT is the one axis a
date cannot express, which is why `client_status` still exists at all.

## The run-out window is a fixed constant, deliberately

Three months, same for every client. Not per-client, not configurable.

**Why:** explicitly decided against. With roughly 50 groups and about five departures a
year, per-client windows buy nothing and cost a settings screen, a migration, and a
per-client answer to "why is this one different".

## Everything compares whole calendar months

Termination dates are always month-end and the claims file carries only a report month
and year, so the boundary is month arithmetic, never day arithmetic.

**Why:** it also dodges a real timezone trap. A `"2026-09-30"` string parsed into a Date
lands on UTC midnight and reads back as the 29th in a negative-offset zone, which would
move a client's state by a whole month. Date strings are read as written, not parsed.

## The run-out length is defined once and passed down

The Python claims parser does not know the window length. Node computes a
`claims_cutoff_ym` per client and per plan and passes it in the import context; the
parser only compares.

**Why:** the same rule spelled in two languages drifts, and the drift is invisible until
a month of real claims is wrongly held.

## Both plan-level and client-level termination extend through run-out

A plan terminating 30 September still renders October, November and December on the PPR,
and still accepts claims for them. A plan is also no longer dropped from a plan-year
window that begins after its termination month, because the run-out months can fall in
that later window.

**How to apply:** any new gate keyed off a termination date must ask "does run-out apply
here" before suppressing. Suppressing at the termination date itself is the bug this
model exists to prevent.
