---
name: Plan identity is coverage plus name
description: Why a plan is identified by coverage AND name, the NULLS NOT DISTINCT trap when adding a nullable column to a unique key, and the rules for pairing plans across years while coverage is still being backfilled.
---

# Coverage and plan name are different things

Coverage is the benefit provided (dental, vision, dental and vision), in the same
sense as medical or life or disability. The plan name is the benefit level within
that coverage: Standard, Premium, Gold/Platinum/Silver, Low/High, Union/Non Union,
First Year, Retiree Standard.

A plan is therefore identified by **client + coverage + name + plan year**, never by
name alone. The same name legitimately recurs across coverages for one client: a
combined dental+vision "Standard" alongside a vision-only "Standard", or Standard
and Premium on dental and Standard and Premium again on vision.

**Why:** matching on name alone paired a client's Standard dental plan against
their Standard vision plan and presented two unrelated plans as a like for like
renewal.

**How to apply:** any new lookup, dedupe, import matcher, or cross-year pairing must
key on coverage and name together. The plan name field stays **free text** because
clients use their own vocabulary; do not turn it into an enum.

# The nullable-column-in-a-unique-key trap

Coverage was added as a nullable column long after plans existed, so every row
started NULL. Postgres treats NULLs as distinct, so naively adding a nullable column
to a unique key **removes** the old protection instead of adding a dimension: every
uncovered row becomes mutually unique and duplicates flow in.

The fix is `UNIQUE NULLS NOT DISTINCT`, which keeps the pre-existing protection
exactly for rows with no coverage. In Drizzle this forces `unique(...).nullsNotDistinct()`;
`uniqueIndex()` has no equivalent option.

**How to apply:** whenever a nullable column joins a unique key on a table with
existing rows, reach for NULLS NOT DISTINCT and make the schema declaration and the
raw migration produce byte-identical constraints, or drizzle-kit push will fight the
migration forever.

# Pairing across years while coverage is backfilled

During the backfill a plan can carry coverage this year and none last year. Strict
matching reports that as a new plan plus a discontinuation, two false alarms from a
records gap. The reconnect rule:

- Judge everything against the **immediately preceding plan year**, the same horizon
  the discontinuation check uses. Mixing horizons (eligibility over all earlier years,
  discontinuation over the prior year only) produces both a false discontinuation and
  a wrongly certified pairing.
- Of the plans this year sharing the name, count those with **no exact match in the
  prior year**. Exactly one means reconnect; more than one means the plan split into
  separate coverages and nothing is guessed.
- Prefer the prior year's uncovered record over an older exact match. Where coverage
  lapsed from the records for a year, last year's record is still the real predecessor.
- Being the only candidate is **not proof of identity**. The earlier plan could be a
  different coverage that ended, merely sharing a name. Render these pairings as
  explicitly provisional rather than as settled comparisons.

**Why:** the whole point of the change is multi-coverage clients, which are exactly
the clients where a shared name is ambiguous. Guessing there defeats the feature.
