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

Consequence: the roll-forward endpoint copies only a subset of fields, so a
rolled-forward plan shows almost everything as changed. Reported as a notice
rather than guessed at.

## Name pairing cannot tell a rename from a new plan

A renamed plan and a genuinely new plan both simply fail to match, and only one of
them is correct to render as all new. **Never guess which.** Surface both sides
and let a person decide before the report goes out.

**Why:** rendering a rename as a brand new plan silently ships a document whose
every "changed" value is a false comparison, and 90DB acts on it.

**How to apply:** the two unmatched sets are deliberately asymmetric.
- *Dropped* (lost its counterpart) is scoped to the **immediately preceding plan
  year on record only**, so a plan discontinued three years ago is not raised
  again at every renewal.
- *Added* (no counterpart) is checked against **any earlier year**, matching how
  the prior plan is looked up, so a plan that skipped a year is not misreported
  as new.

Also remember the build loop iterates **accepted renewal options**, which only
ever live on new-year plans. Anything that needs flagging on the prior-year side,
or on new-year plans with no accepted option, has to be handled outside that loop
or it never gets visited at all.

## Style

Generated text uses no em or en dashes (see replit.md user preferences). Tiers are
matched between years positionally, not by label, so a relabelled tier reads as one
row carrying both labels instead of a spurious add plus remove.
