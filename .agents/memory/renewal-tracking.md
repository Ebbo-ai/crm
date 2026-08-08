---
name: Renewal tracking architecture
description: How renewal status, proposal tracking, and PPR underwriting slots are implemented across the CRM.
---

## DB columns

### Phase 9 (added in correction)
**clients table:**
- `renewal_pipeline_step` TEXT (nullable) — manually set; one of the 7 steps or null

**plans table:**
- `accepted_rates` JSONB (nullable) — snapshot of tier rates the client signed; nothing reads it yet from CRM side
- `accepted_rates_engine_version` TEXT (nullable) — rating engine version string (e.g. "7.3.1"); critical for knowing whether a future re-render matches the signed document

### Phase 8 migration

**clients table:**
- `renewal_lead_months` INT NOT NULL DEFAULT 3 — months before anniversary the proposal is due (3–7)
- `proposal_sent_date` TIMESTAMP — when the proposal was actually sent
- `proposal_version` TEXT — e.g. "v1", "v2 revised"
- `acceptance_received_date` TIMESTAMP — when client confirmed renewal selection

**plans table:**
- `renewal_option_accepted` TEXT — 'VALUE' | 'RECOMMENDED' | 'PROTECTIVE' | null

## Two independent renewal concepts (do not conflate)

**RenewalPipelineStep** — set manually by staff; never derived from dates.
Steps in order: REQUESTED → PROCESSED → SENT → REVISED → ACCEPTED → SIGNED_FORM_ATTACHED → EMAILED_TO_90D.
A null step means the renewal cycle has not been started yet for this client.

**RenewalTimingWarning** — derived from dates only; coexists with any pipeline step.
Values: OVERDUE (anniversary passed) | PROPOSAL_DUE (due date passed, step is early) | LATE_RESPONSE (sent >14 days ago, no acceptance).
A client can show SENT + LATE_RESPONSE simultaneously — these are two different facts.

**Why this split:** the five-status approach (derived from dates alone) was replaced because several real renewal states (Processed, Revised, Signed Form) cannot be inferred from dates at all. Staff must advance the pipeline manually.

## Shared logic: `client/src/lib/renewal.ts`

- `getRenewalTimingWarning(client, today?)` → `RenewalTimingWarning | null`
- `getProposalDueDate(client)` → `Date | null`
- `getNextPipelineStep(current)` → next step or null (for the advance button)
- `pipelineStepIndex(step)` → 0-based index (for progress bar)
- `getPprSlots(anniversaryDate, today?)` → 4 PprSlots (current + 3 prior plan-years)

**Why:** server route (`GET /api/renewal-alerts`) replicates timing-warning logic inline in TypeScript since it can't import from client/src/lib.

## Pages / components

- `client/src/pages/renewal-alerts.tsx` — groups clients by timing warning (OVERDUE → PROPOSAL_DUE → LATE_RESPONSE); within each group shows pipeline step badge; sidebar badge refetches every 2 min
- `client/src/pages/clients.tsx` — shows pipeline step + timing warning chips on client card; both can appear at once; hidden for EMAILED_TO_90D
- `client/src/pages/client-form.tsx` — "Renewal Tracking" card: pipeline step select at top, then dates (proposalSentDate, proposalVersion, acceptanceReceivedDate); renewalLeadMonths in Client Information card
- `client/src/pages/client-detail.tsx` — "Renewal Pipeline" card (lg:col-span-2): 7-segment progress bar, one-click advance button, step select dropdown, timing warning badge, date facts; `advancePipelineMutation` invalidates both /api/clients and /api/renewal-alerts; passes `client` prop to PprTab
- `client/src/components/tabs/plans-tab.tsx` — renewalOptionAccepted + acceptedRatesEngineVersion in PlanFormDialog renewal settings; engine version input only shown when option is selected; badge in plan detail; accepted_rates JSONB stored but not exposed in UI yet
- `client/src/components/tabs/ppr-tab.tsx` — accepts `client?: any` prop; renders "Renewal Underwriting" 4-slot section when anniversaryDate present

## PPR slot logic

- Anniversary July → periods end June (same calendar year as anniversary)
- Anniversary January → periods end December (prior calendar year)
- Anniversary September (before Sep arrives) → periods end August of prior year
- Formula: `endMonth = annMonth - 1` (0 → 12); `currentSlotYear` adjusted when `endMonth > annMonth`

## Server date conversion

`PUT /api/clients/:id` now converts `proposalSentDate` and `acceptanceReceivedDate` from ISO strings to Date objects before passing to storage, same pattern as `terminationDate`.
