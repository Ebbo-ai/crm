---
name: Plan termination date
description: How plan-level termination differs from archival and from the client's own lifecycle, and why terminated plans are never hidden or deleted.
---

`plans.terminationDate` (nullable timestamp) marks a plan terminated as of that date. No
date = active. Deliberately a single date, not a boolean plus date pair, so status and
date can never disagree.

**Distinct from two things it is easy to confuse with:**

- `plans.isArchived` means "superseded by a newer plan year", set by the renew flow. A
  plan can be terminated mid-year while still being the current, non-archived record for
  that year. The two are independent.
- The client's own lifecycle, which is derived from `clients.termination_date` (see
  client-termination.md). Terminating a plan never touches the client record: a client
  with one terminated and one active plan stays fully active and keeps an open renewal
  for the surviving plans.

**A terminated plan is suppressed only where a renewal decision is involved.** It still
reports, still accepts run-out claims, and is never hidden from the client's plan list or
deleted. Renewal is skipped only when *every* plan on the client is terminated.

**Why:** a plan can legitimately stop mid-year while the client keeps other coverage, and
prior-year reports must still reproduce exactly, so no plan or rate card is ever removed
on termination.

**Testing tip:** the seed admin login in `server/seed.ts` lets you curl authenticated
requests against `requireAuth` routes without a browser session, which is the quickest way
to exercise renewal and PPR logic. The dev server has no watch flag (see
dev-server-reload.md), so restart the workflow after any server-side edit before testing.
