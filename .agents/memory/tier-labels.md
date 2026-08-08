---
name: Rate card tier labels
description: The five-label house standard for plan tiers, why EE+1 is not EE+SP, and the rule that non-matching labels are never forced into the nearest match.
---

# Rate card tier labels

Tier labels are free text on `plan_tiers`, but the business standard is five
labels used across every client: **EE, EE+SP, EE+CH, EE+1, EE+FAM**. Offered as a
dropdown, with a Custom option behind an extra click.

**Why:** the older variation came from different staff filling in forms whatever
way was quickest. Inconsistent labels make plans hard to compare across plan
years, and year over year comparison is what the renewal report is built on.

## EE+1 is not a duplicate of EE+SP

EE+1 means employee plus **one other person, spouse or child**. Some employers
price a single add-on tier without distinguishing which. The retired
`rate_cards.tier` enum value `EE_SPOUSE` was inaccurate for the same reason and
maps to **EE+1**, not EE+SP.

## Custom labels must survive

**Never force a label that does not clearly correspond into the nearest match.**

**Why:** real pricing structures exist that the five cannot express. One client
splits family coverage by dependent count, four or fewer versus five or more, at
very different prices. Flattening that to EE+FAM would destroy a real rate
distinction, not tidy up a typo.

**How to apply:** normalisation matches on an exact key after stripping case and
punctuation. If a label does not match the list, leave it byte for byte alone.
Any bulk relabelling must also refuse to collapse two tiers on the same plan onto
one label, or a plan silently loses a rate row.

## Constraints

Up to 4 tiers per plan, and the set is not fixed. Some employers carry only EE
and EE+FAM. Nothing may assume a particular tier exists or that two plans share a
tier shape.
