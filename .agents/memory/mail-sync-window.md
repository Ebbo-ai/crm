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
- The window is not one number for everyone. A mailbox that is work-only can
  justify a fixed start date where a mailbox mixing businesses and personal
  mail cannot, so the policy is "rolling default plus a short list of fixed-date
  exceptions" held in ONE module that both the sync and the startup migration
  read. Two copies of the policy is how the migration and the sync end up
  disagreeing about a mailbox's floor.
- Store the policy that produced each floor ALONGSIDE the floor, per mailbox
  ("30d", or the fixed date), and rewrite a mailbox only when ITS policy string
  changed. Two wrong ways to decide this, both tried:
  - By comparing the stored floor against what the rolling window would compute
    today. A rolling mailbox pinned weeks ago always fails that comparison, so
    changing one mailbox's exception drags every other floor forward over the
    stretch of window it had not walked yet, and resets its cursor with it.
  - By one global "already applied" marker in a settings table. It says nothing
    about a row that did not exist when it was written — during a deploy an
    old instance still draining creates one — and once committed it stops
    anything from ever looking at that row again. Read the rows every boot
    instead; there are a handful of them.
- Rewriting happens in either direction. Widening one mailbox's window is a
  legitimate change, so an "only if the new floor is newer" predicate is wrong.
- Startup is not the only place that can repin a floor, and it must not be: a
  row can be created or claimed after the boot check looked at it. The sync
  itself compares the stored policy before it reads a page and repins if it
  differs, so a mailbox converges on its own next run instead of waiting for a
  reboot. That also lets startup skip a mailbox mid-sync (whose in-flight run
  would write its old floor back) without holding up the idle ones.
- The steady-state overlap must stay well under the per-run cap, or a routine
  run caps out on overlap alone and never advances the mark.
- Mail judged and deliberately not stored (allow-list) needs its id recorded, or
  every re-walk re-downloads it to reach the same verdict. That ledger is a
  verdict under the current rules: changing the allow-list must clear it and
  send the mailboxes back for a fresh walk.
- The per-run cap applies to scheduled jobs too, so a scheduled catch-up has to
  call the sync repeatedly until every mailbox reports caught up or its time
  budget runs out. One call is one capped page-set, not a long crawl.
