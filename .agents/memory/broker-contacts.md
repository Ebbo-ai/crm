---
name: Broker contacts
description: Why broker contacts are keyed to the client rather than the firm, why the flat columns are a mirror, and the firm-name drift that makes firm-level keying unsafe.
---

# Broker contacts

## Broker classification migration

Colquitt (S-271) is an explicit Broker override: Totem Solutions is its broker.
Unknown status must warn but permit general mail; only renewal proposal/package
sends are blocked. Internal-only attachment restrictions remain independent.

**Why:** Steve confirmed Colquitt's broker and that onboarding/general
correspondence must continue even before classification is complete.

Explicit N/A broker names mean Direct and take precedence over the legacy true
flag. Otherwise true or any broker-contact row means Broker; remaining clients
are Not set, never implicitly Direct. Keep the legacy column unused for rollback.

**Why:** Steve confirmed that the N/A entries were deliberate human answers and
the conflicting true flags were import artifacts.

**How to apply:** run the classification once outside app startup, never as a
boot backfill. Do not force dev data to match production counts when their client
sets differ.

## Keyed to the client, not the firm

**Why:** one brokerage serves many clients through different people — HUB International
covers six clients through three separate advisors. A firm-level table would still need
an assignment per client, so it buys nothing and invites the wrong join.

**How to apply:** a person is only meaningful alongside the client they serve. Never
offer "the contacts at firm X" as a list to pick from; there is no such thing here.

## The flat broker columns on `clients` are a mirror

They are written from whichever contact is primary, never edited directly.

**Why:** readers that predate the contacts table keep working, and they keep showing the
lead rather than whoever happened to be written last.

**How to apply:** anything that changes the contact set must recompute the mirror in the
same transaction, and must pick the lead only from contacts still serving — a terminated
primary would publish a departed person as the client's broker. When no one is serving,
clear the mirror rather than leaving the last name in place.

## `broker_history` is a different thing

It is a broker-of-**record** succession log — which firm held the account and when. It
carries the same four flat fields, which makes it look like a contact store; it is not,
and it sat empty for the life of the project.

**How to apply:** recording a firm change must also retire the serving contacts and
install the new lead, in the same transaction, or the two tables start telling different
stories about who the broker is.

## Two entry points, two different writes

Replacing the broker and correcting the broker are separate operations with separate
screens, and both now say so on the screen itself.

A replacement is a succession event: it writes a history row with an effective date,
retires the serving contacts and installs the new lead. A correction mutates the
existing row in place with no history and no effective date. Feeding a correction
through the replacement path invents a succession that never happened; feeding a
replacement through the correction path loses the date the account actually moved.

**How to apply:** if a change alters who the broker is, it is a replacement. If it
alters how the same broker is spelled or reached, it is a correction. Never merge the
two paths into one "save broker" action.

## Every door onto the broker of record, and which ones may write it

The firm is reachable from four places, and three of them had no business writing it.
Only the broker-change path may change a firm on a client that already has one, because
only it takes an effective date and writes the succession.

**Why:** helper text asking the operator to choose the right screen is not a control. The
office runs on one person; picking the wrong screen silently replaced the broker of
record with no trace of when the account moved.

**How to apply:** the client-update path refuses any change to the firm, including
clearing it, and the form renders the field read-only; the importer refuses a firm that
differs from the stored one, and refuses a blank cell that would clear one; the
broker-change path refuses a same-firm change and points back at the correction screen.
Two carve-outs, both because they supersede nothing: naming a firm on a client that has
none *and* no history, and setting the firm at creation.

**Also:** validate the field on read and drop it before the write rather than trusting the
comparison. A firm read for comparison and then written back from a stale form body can
revert a succession that committed in between, leaving the flat column and the history
disagreeing.

## A seeded outgoing row needs a floor, not a guess

When a firm change is recorded on a client with no history, the outgoing row has to be
invented from the flat columns, and nothing records when that relationship began. The
record's creation month is the only available proxy and it is often wrong: a book
imported all at once carries creation dates long after the brokers actually started.

**Why:** used unclamped, the proxy produces a row that terminates before it begins
whenever the change is backdated, which is the normal case for catching history up.

**How to apply:** floor the seeded start to the month the relationship ended, so the row
is at worst a single-month placeholder. Report such a start date as a floor on an unknown
start, never as the date the relationship began.

## Firm identity comes from usage, not from a table

There is no brokerage table. A firm is text on the clients that carry it, so the list of
firms offered by the picker is simply what is already in use, folded together with the
firms in history so a firm a client has moved away from does not vanish and get retyped.

**Why:** free text is what produced three spellings of one firm. The picker makes reuse
the easy path and makes creating a firm take a deliberate choice, a typed name and a
confirmation past a near-match warning.

**How to apply:** the picker never merges anything. It collapses pure case variants in
the list it displays, because offering both spellings as separate choices is nonsense,
but a stored value only changes when an operator clicks a different one. Anything beyond
case is surfaced as a warning and left for a human. Bulk import is deliberately outside
this: forcing canonical names during import would be exactly the silent merging the
picker exists to avoid.

## Firm names drift, so never key on them

The same brokerage is stored several ways: "HUB International" vs "Alexander & Company,
a division of HUB International Gulf South"; "USI" vs "USI Insurance Services". Some
clients carry the literal string "N/A" instead of a null.

**How to apply:** match brokerage identity on the **email domain**, never the firm name.
When correcting one client's firm string, resist normalising it to a shorter or longer
form — that just mints another variant. "N/A" means no broker: clear it to null and set
`has_broker` false.

## Never auto-correct a suspect broker address

Addresses are hand-entered and several are provably wrong — a comma for a period, a
missing TLD, a transposed letter in a domain.

**Why:** a guessed domain that happens to resolve is worse than a blank, because it
becomes a plausible-looking match target for incoming mail.

**How to apply:** store the value as given, warn, and let a human decide.

## A contact set write must distinguish "omitted" from "explicitly null"

The whole contact set is replaced on every write, so a caller that does not know about a
field still sends a row without it. Treating that silence as null is what loses data.

**Why:** the contact editor carries name, role, email, phone and notes but not the dates.
Reading its silence as "clear the termination date" meant saving any unrelated field
resurrected a departed contact — and because the flat columns mirror the primary, that
person could then be republished as the client's broker.

**How to apply:** at the API boundary check whether the key is *present*, not whether the
value is truthy, and pass `undefined` through when it is absent. The writer keeps the
stored value on `undefined` and only clears on an explicit `null`. The workbook importer
already encodes the same idea one level up, per column rather than per cell: a column
absent from the sheet is never written, a present-but-blank cell is a real null.
