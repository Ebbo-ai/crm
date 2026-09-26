---
name: Stored vs sorted mail
description: Why storing a Gmail message and sorting its thread are tracked as two separate facts, and the rules that keep the queue honest.
---

Storing a message and sorting its thread (client matching, 90DB filing, business
classification, action-item extraction) are separate facts with separate
markers: a thread-level "needs sorting" flag plus a per-message "extraction
decision made" timestamp.

**Why:** sorting used to be one pass at the end of a sync run. A run killed
after its messages were stored but before that pass left those threads matched
to nobody and in nobody's triage — permanently, because the messages already
existed and every later run skipped them. Mail was in the database and invisible
in the system of record, the same failure shape as a client message that gets
silently muted.

**How to apply:**
- Raise the thread flag BEFORE inserting the message, never after. Flagging a
  thread that turns out not to need sorting costs one idempotent re-sort;
  flagging after the insert reopens the gap on any crash between the two.
- Clear the flag only in a conditional UPDATE that checks, in the same
  statement, that no received non-historical message on the thread still lacks
  an extraction decision. That single predicate covers both a message whose
  extraction failed mid-pass and new mail another run stored on the thread while
  this pass was working it.
- Stamp the extraction decision per message, immediately, not batched at the end
  of the thread. Batching widens the crash window from one message to the whole
  thread, and the stamp is what a resumed pass reads to know which messages it
  has already judged.
- A deliberate non-decision is still a decision: a NOT_BUSINESS thread's messages
  are stamped so they are not reconsidered forever.
- Paused AI spend ceiling means the matching was a guess, not a decision — leave
  the thread flagged and re-sort it after the ceiling resets.
- Sort per page, not once per run, so an interruption costs one page of sorting.
- Recovery runs in two places (a bounded slice at the start of each mailbox's
  sync, and a bounded cross-mailbox sweep); the sweep must skip mailboxes whose
  sync is currently claimed or both pay Claude for the same threads.

**Retrofitting an existing database:** nothing recorded which old threads were
sorted, so any backfill is a heuristic and should over-select — a false positive
costs one re-sort, a false negative leaves mail invisible. Whatever the
heuristic, the same migration has to mark every pre-existing message as
already-decided, or the first recovery pass dumps a year of old mail into
today's triage.
