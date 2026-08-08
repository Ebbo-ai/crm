---
name: Renewal report
description: The document sent to 90 Degree Benefits at the end of a renewal. Covers the broker compensation exception, the year-paired plan diff, and the fee traps that make components invisible.
---

# Renewal report

The artifact produced at the final renewal pipeline step ("Emailed to 90 Degree").
It tells 90 Degree Benefits (90DB, the third party claims administrator) what to
change in their claims system for the new plan year, replacing a manual process.

## The broker compensation exception

Broker compensation is normally **never** shown separately anywhere client facing.
It is folded into a single combined administrative fee on proposals, plan
performance reports and employee handouts.

**The renewal report is the one deliberate exception, and that exception is the
entire point of the document.** 90DB sets up the billing, so every component must
be broken out: 90D base admin fee, COBRA fee, Simple fee, network fee, broker
compensation, then total admin fee, expected claims and resulting premium.

**Why:** if the report hides broker compensation it fails at its only job, because
90DB cannot bill what they cannot see.

**How to apply:** if you ever refactor fee rendering to share code with the client
facing documents, do not let the suppression rule leak into this report.

## Two traps that make broker compensation vanish

1. **`brokerMode = FIXED_MONTHLY` on a `feeBasis = PEPM` plan.** The rate card
   writer deliberately stores **$0 broker on every tier row** and keeps the real
   amount only on the plan record (`brokerValue`). Reading rate cards alone
   reports the broker as being paid nothing. Any group level broker charge has to
   be pulled off the plan record and reported as its own block.
2. **`brokerValue` is a fraction for `PERCENT_OF_PREMIUM`** (0.08 means 8%) but
   **dollars** for the flat modes. Also, `flatMonthlyFee` is admin only and
   excludes broker, so broker must be added back to get a true total.

## Prior plan years are usually archived

A plan year is routinely archived once superseded. Any year over year comparison
must **include archived plans on the prior side** and only require the new year's
plan to be active. Filtering `isArchived` everywhere erases the "current" column.

## Where the component split actually lives

`rate_cards` is the **only** source of the per-component fee split. The rating
engine returns all-in tier rates with no breakdown, and `renewalPlanOptions.
acceptedRates` is unconstrained JSONB that is null in practice. So "current vs
new" is built by pairing plans **by name across plan years** (plans are unique on
client, name, year), not from anything stored on the renewal itself.

Consequence: a plan renamed between years cannot be paired, and the roll-forward
endpoint copies only a subset of fields, so a rolled-forward plan shows almost
everything as changed. Both are reported as notices rather than guessed at.

## Style

Generated text uses no em or en dashes (see replit.md user preferences). Tiers are
matched between years positionally, not by label, so a relabelled tier reads as one
row carrying both labels instead of a spurious add plus remove.
