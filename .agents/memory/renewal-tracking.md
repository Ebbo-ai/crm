---
name: Renewal tracking architecture
description: How renewal status, proposal tracking, and PPR underwriting slots are implemented across the CRM.
---

## DB columns (Phase 8 migration)

**clients table:**
- `renewal_lead_months` INT NOT NULL DEFAULT 3 — months before anniversary the proposal is due (3–7)
- `proposal_sent_date` TIMESTAMP — when the proposal was actually sent
- `proposal_version` TEXT — e.g. "v1", "v2 revised"
- `acceptance_received_date` TIMESTAMP — when client confirmed renewal selection

**plans table:**
- `renewal_option_accepted` TEXT — 'VALUE' | 'RECOMMENDED' | 'PROTECTIVE' | null

## Shared logic: `client/src/lib/renewal.ts`

- `getRenewalStatus(client, today?)` → `RenewalStatus | null` — pure, no fetches needed
- `getProposalDueDate(client)` → `Date | null`
- `isAwaitingTooLong(client, today?)` → boolean (> 14 days since proposal sent)
- `getPprSlots(anniversaryDate, today?)` → 4 PprSlots (current + 3 prior plan-years)
- Status priority: ACCEPTED > OVERDUE > AWAITING_ACCEPTANCE > PROPOSAL_DUE > NOT_DUE

**Why:** server route (`GET /api/renewal-alerts`) replicates the same logic inline in TypeScript since it can't import from client/src/lib.

## Pages / components

- `client/src/pages/renewal-alerts.tsx` — internal alerts page at `/renewal-alerts`; sidebar shows live count badge (refetches every 2 min)
- `client/src/pages/clients.tsx` — renewal status badge shown on client card for PROPOSAL_DUE / AWAITING_ACCEPTANCE / OVERDUE only
- `client/src/pages/client-form.tsx` — "Renewal Tracking" card added (proposalSentDate, proposalVersion, acceptanceReceivedDate); renewalLeadMonths select added in Client Information card
- `client/src/pages/client-detail.tsx` — Renewal Tracking card shown in profile tab when anniversaryDate is set; passes `client` prop to PprTab
- `client/src/components/tabs/plans-tab.tsx` — renewalOptionAccepted select in PlanFormDialog renewal settings section; badge shown in plan detail card
- `client/src/components/tabs/ppr-tab.tsx` — accepts `client?: any` prop; renders "Renewal Underwriting" 4-slot section when anniversaryDate present; slots match against existing pprUploads by (reportMonth, reportYear)

## PPR slot logic

- Anniversary July → periods end June (same calendar year as anniversary)
- Anniversary January → periods end December (prior calendar year)
- Anniversary September (before Sep arrives) → periods end August of prior year
- Formula: `endMonth = annMonth - 1` (0 → 12); `currentSlotYear` adjusted when `endMonth > annMonth`

## Server date conversion

`PUT /api/clients/:id` now converts `proposalSentDate` and `acceptanceReceivedDate` from ISO strings to Date objects before passing to storage, same pattern as `terminationDate`.
