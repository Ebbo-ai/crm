---
name: Rolling mail sync window
description: How far back mailbox sync reaches, why the floor is stored rather than computed, and the rules that let a mailbox declare itself caught up.
---

The window a mailbox syncs is a **stored floor per mailbox**, written once and
never recomputed. Two modes run off it: a mailbox that has not yet walked its
whole window asks for the entire window and pages backwards across however many
runs it takes; once a walk finishes, later runs ask only for mail since that
walk began, less a small overlap, still floored at the stored date.

**Why:** recomputing "N months before now" every run crept the floor forward a
little each day and quietly dropped mail that had never been synced. Storing it
also means changing the constant alone does nothing for mailboxes already
syncing — their floor is already written — so any change of window needs a
one-time, marker-guarded migration that raises the stored floors, clears the
page cursor (a cursor belongs to the query that produced it) and clears the
caught-up mark.

**How to apply:**
- The caught-up mark must be stamped with the time the WALK started, not the
  run that finished it. A walk spans several runs; mail that arrives mid-walk is
  newer than pages already read and would otherwise fall outside every later
  request.
- Any message the run failed to store blocks the mark, and that fact has to
  survive to the end of the walk — not just the run that hit it. Otherwise a
  later clean run declares the mailbox caught up and the failed message ends up
  behind the window with nothing pointing at it.
- A per-run message cap only counts as "stopped short" when there was a next
  page. A final page that crosses the cap has still finished the window.
- Shrinking the window never deletes stored mail. Older mail stays; the sync
  just stops reaching back for more.
- The one-time migration is guarded by a marker that stores the window it last
  applied (e.g. "30d"), not by a key whose NAME carries the unit. A key called
  "...FloorMonths" cannot express the next change and forces a second key that
  can disagree with the first.
- The steady-state overlap must stay well under the per-run cap, or a routine
  run caps out on overlap alone and never advances the mark.
- Mail judged and deliberately not stored (allow-list) needs its id recorded, or
  every re-walk re-downloads it to reach the same verdict. That ledger is a
  verdict under the current rules: changing the allow-list must clear it and
  send the mailboxes back for a fresh walk.
- The per-run cap applies to scheduled jobs too, so a scheduled catch-up has to
  call the sync repeatedly until every mailbox reports caught up or its time
  budget runs out. One call is one capped page-set, not a long crawl.
