---
name: Renewal tracking architecture
description: Renewals are year-specific records, not fields on clients/plans — plus the NULL-safe and plan-year rules that govern them.
---

# Renewals are year-specific records

Renewal lifecycle data lives on `renewals` (one row per client per plan year) and
`renewal_plan_options` (one row per plan per renewal). It is NOT on the clients or
plans tables.

**Why:** lifecycle values (pipeline step, proposal dates, accepted option, accepted
rates) change every plan year while the client and plan persist. Stored on the
client/plan they were overwritten each cycle, so last year's renewal history was
destroyed. `anniversaryDate` and `renewalLeadMonths` legitimately stay on the client
— they describe the client, not one year.

**How to apply:** anything year-specific about a renewal belongs on `renewals` or
`renewal_plan_options`. Accepted option is per *plan*, not per renewal — a multi-plan
client can accept a different tier on each plan.

## Auto-creation must iterate clients, never query renewals

A renewal opens automatically 30 days before its proposal due date, triggered from
GET handlers.

**Why:** any endpoint that needs to surface renewals must loop over active clients and
call the ensure-helper for each. Querying existing renewals first is a chicken-and-egg
trap: a client with no renewal row can't match the query, so the helper never fires,
so the row is never created — the client silently never appears.

**How to apply:** creation is a side effect of iterating clients. If you add an endpoint
that lists renewals, iterate clients first.

## An unfinished year must never block the next one

The new renewal opens on schedule even if the prior year never reached the final step;
the prior-incomplete case is recorded on a flag and surfaced, not used as a gate.

## "Open renewal" predicate must be NULL-safe in SQL

A not-yet-started renewal has `pipeline_step = NULL`, and in SQL
`NULL <> 'EMAILED_TO_90D'` evaluates to NULL, not TRUE.

**Why:** a plain inequality silently drops every unstarted renewal — the single most
common state. This bug hid renewals from list views and made the prior-incomplete flag
compute as false.

**How to apply:** always `pipeline_step IS NULL OR pipeline_step <> <final>`. Keep it in
one shared predicate rather than re-spelling the comparison per query. Note JS-side
`!==` does NOT have this problem, so the bug only appears in the SQL layer — easy to
miss when the JS path tests fine.

## Timing warnings measure against the renewal's own plan year

Use the anniversary projected onto `renewal.planYear`, not the *upcoming* anniversary.

**Why:** the upcoming anniversary is always in the future by construction, so
`today > anniversary` can never be true and OVERDUE becomes unreachable. A renewal for
plan year N left unfinished into N+1 is overdue against its own year-N anniversary.

**How to apply:** the next-occurrence projection is only for deciding *which* plan year
to open. All warning math uses the renewal's own plan year.
