---
name: Client date fields on the wire
description: Why date coercion belongs at the API boundary rather than per call site, and why a bare calendar day is pinned to UTC midnight.
---

# Client date fields on the wire

## Coerce dates once at the API boundary, never per field at the call site

JSON has no date type, so every date arrives as a string, and the timestamp columns
call `.toISOString()` on whatever they are handed. A string that reaches a column
throws `value.toISOString is not a function` from deep inside the write, with nothing
in the message naming the field or the row.

**Why:** the per-field approach was tried and failed silently. Two of the three client
date fields were converted at the call site and the third was forgotten, so saving any
client that carried that field returned a 500 whose message named a missing method
rather than a date. The screen showed the raw message as a red error, which made it
look like a validation rule about whatever else the operator had just edited. The real
fault was months old and unrelated to the field being blamed.

**How to apply:** keep one list of the date columns a caller may write and one helper
that walks it, applied by every create and update route. Adding a date column means
adding it to the list, not remembering a conversion in two handlers. A value that is
not a date at all should be a 400 naming the field.

## A bare calendar day is stored as UTC midnight

`YYYY-MM-DD` from a date input is a calendar day, not an instant.

**Why:** pinning it to UTC midnight stores that exact day whatever zone the server runs
in, and it round-trips exactly: the value comes back as `...T00:00:00.000Z` and the form
reads the day straight off the front of the string with no zone conversion. Local
midnight would drift the stored hour with the server's zone, and west of Greenwich could
land the value on the previous day.

**How to apply:** build it with `Date.UTC`, not `new Date("...T00:00:00")`. A full ISO
string carrying an actual instant is passed through as given, because that is what a
serialized `Date` looks like coming back from the client.

## Identity and audit stamps are not the caller's to send

`id`, `createdAt` and `updatedAt` are stripped from an incoming client body.

**Why:** readers hand back whole rows they fetched, so those fields ride along in the
next write without anyone intending it.
