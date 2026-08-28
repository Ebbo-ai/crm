---
name: Communication triage state machine
description: The resolve/undo/no-delete rules behind the dashboard feed, tasks and to-do list, and why they are enforced server-side.
---

# Communication triage

Communications and their tasks carry an explicit `status`, and the only way out
of any list is an explicit resolution. There is no delete anywhere in this
workflow, and no "complete" that skips a note.

## The rules

- A resolution note is mandatory and capped at 500 characters. It is the audit
  trail of how something was handled, so it can never be blanked or overwritten.
- "Read: no task needed" is a resolution (`resolutionType = READ_NO_TASK`) with
  a standard auto-note, not a separate dismissal. It is the *only* resolution
  that undo can reverse, and only inside a short server-enforced window.
- Resolving a communication auto-resolves its untouched OPEN tasks but leaves
  TODO items alone: those were queued deliberately and are worked separately.
  Undo revives only tasks whose `resolvedAt` exactly matches the
  communication's, so it cannot disturb anything resolved earlier by hand.
- Resolving a task resolves its parent communication only when no OPEN or TODO
  siblings remain.
- A resolved communication cannot take new tasks, and a resolved task cannot be
  moved back onto the to-do list.
- Drag-reorder payloads must be the exact current contents of that priority
  section, or the write is rejected as stale.

**Why:** the note is the whole point of the workflow — a part-time rep needs to
be able to read back what happened months later, and anyone else needs to trust
that what they see is complete. Every one of these rules exists because the
state could otherwise be reached through an ordinary authenticated request: an
undo that erases a typed note, a resolved task revived without one, a resolved
message left with open work hanging off it, or a partial drag payload leaving
half the section on stale positions.

**How to apply:** enforce the legal transition in the SQL predicate itself
(`where status = 'ACTIVE'`, `where status in ('OPEN','TODO')`) rather than in a
read-then-write, and keep the parent/child cascade inside one transaction. A
conditional update that returns no row means someone else got there first —
answer 409 and leave their note alone. Never add a delete endpoint here.

`isCompleted` is kept in lockstep with `RESOLVED` purely so older callers that
predate the status column keep working; it is not the source of truth.
