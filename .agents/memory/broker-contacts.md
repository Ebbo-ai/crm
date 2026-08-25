---
name: Broker contacts
description: Why broker contacts are keyed to the client rather than the firm, why the flat columns are a mirror, and the firm-name drift that makes firm-level keying unsafe.
---

# Broker contacts

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
