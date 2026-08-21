---
name: Plan termination date
description: How mid-lifecycle plan termination is modeled and where it's enforced, vs isArchived and client-level status.
---

`plans.terminationDate` (nullable timestamp) marks a plan terminated as of that date. No date = active. Deliberately a single date, not a boolean + date pair, so status and date can never disagree.

**Distinct from three other concepts it's easy to confuse with:**
- `plans.isArchived` — means "superseded by a newer plan year" (set by the renew flow). A plan can be terminated mid-year while still being the current, non-archived record for that year.
- `clients.isActive` / `clients.terminationDate` / `clients.clientStatus` — client-level lifecycle, entirely separate. Terminating a plan never touches the client record; a client with one terminated and one active plan stays fully active and keeps an open renewal for the surviving plan(s).

**Enforced in four places:**
- Renewals — `ensureOpenRenewal` (server/routes.ts) skips opening a renewal only when *every* plan on the client is terminated; the client itself is never marked terminated. The per-plan "accepted option" section on the client detail page filters out terminated plans client-side.
- Monthly claims import (`rating_engine/ppr_import.py`) — a claims row for a terminated plan is held (not imported, not dropped) if its report month/year falls after the termination month; the termination month itself and earlier import normally (legitimate run-out claims). Node passes `termination_date` through the import context.
- PPR generation (`buildPprReportPayload` in server/routes.ts) — a terminated plan's month array is truncated at the termination month, and the plan is skipped entirely once the report's plan-year window starts after the termination date.
- Client detail plans list (plans-tab.tsx) — terminated plans stay visible (never hidden), badge shows "Terminated <date>" instead of "Current"/"Archived", and they sort below still-active plans within the current (non-archived) group.

**Why:** the business fixed cost is real — a plan can legitimately stop mid-year while the client keeps other coverage, and prior-year reports must still reproduce exactly (no plan or rate card is ever deleted on termination).

**Testing tip:** the seed admin login (`admin@simplebenefits.com` / password in `server/seed.ts`) lets you `curl` authenticated requests against `requireAuth` routes locally without a browser session — useful for exercising renewal/PPR logic directly. Remember the dev server has no watch flag (see dev-server-reload.md); restart the workflow after any server-side edit before testing, not just after schema changes.
