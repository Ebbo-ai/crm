---
name: Blank vs zero in reports
description: Why report output must never coerce a missing number to 0, and how totals over partly-missing data are presented.
---

# A missing number renders blank, never zero

In any client-facing report, an unknown value renders as an empty cell. Not 0,
not a dash, not a guess. A recorded zero still renders "0" and must stay
distinguishable from "we do not know", so every check is an explicit
null/undefined test and never a falsy one.

**Why:** the employee headcount is unpopulated for the entire book. Three
reports rendered it with a `?? 0` fallback, so every client was stated to have
0 employees and a broker report printed a whole-book headcount of 0. Nobody
noticed, because a zero looks like data. A blank looks like a gap and gets
chased.

**How to apply:** when a report shows a nullable numeric, route it through the
shared formatter rather than writing a fallback at the call site. Fee and rate
fields are the arguable exception, since a zero fee is often a real default, but
a count or a measurement is not.

## Totals never sum a null as zero

Missing inputs are excluded from the sum, not added as 0. If nothing at all is
recorded, the total is blank. If only some inputs are present, the total shows
the sum of those present and is labelled with how many contributed, so a partial
figure cannot be read as a full-book number.

**Why:** silently summing nulls as zeroes produces a confident total that is
wrong by exactly the amount of data you are missing, and it looks identical to
a correct one.

## The formatter lives in one place

Every report imports the same helper. Reports drift when each one carries its
own copy of the rule, which is how the on-screen preview and the print builder
of the same report ended up needing separate fixes.

**How to apply:** a report has two output paths, an on-screen preview and a
print-HTML string builder. Both need changing. Search for the field, do not
assume the preview and the print version share code, because they usually do not.
