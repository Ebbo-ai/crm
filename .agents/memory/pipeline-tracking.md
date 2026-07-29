---
name: Pipeline tracking architecture
description: Renewal pipeline (per plan, 7 steps) and prospect pipeline (per client, 3 steps) — schema, API, stall logic.
---

## Tables
- `renewal_progress` — one row per plan. Columns: `step1_date` … `step7_date`, `step4_revisions` JSONB (string[]). `step6_document_id` FK → documents.
- `prospect_progress` — one row per client. Columns: `step1_date`, `step2_date`, `step3_date`.

## Renewal steps (required order for stall detection)
1. Renewal Requested
2. Renewal Processed
3. Renewal Sent
4. (Optional) Renewal Revised — stored as `step4_revisions` JSONB array of ISO date strings; multiple entries allowed
5. Renewal Accepted
6. Signed Form Attached — also triggers step6-upload endpoint; `step6_document_id` FK set
7. Form Emailed to 90 Degree ← marking this syncs `plans.isRenewalComplete = true`

## Prospect steps
1. New Proposal Requested
2. Proposal Received
3. Proposal Sent

## Stall logic (getStalledPipelines)
- Required step sequence for renewal: 1, 2, 3, 5, 6, 7 (step 4 skipped for stall detection)
- Clock start for step 1 = renewalDueDate (nextAnniversary(effectiveDate) - renewalDueMonthsBefore months)
- Clock start for steps 2–7 = previous required step's date; for step 5 also check latest step4 revision
- Stalled if today > clockStart + 14 days
- Prospect: clock starts at previous step's date (only tracked once step 1 is done)

## API endpoints
- `GET/PATCH /api/plans/:planId/renewal-progress`
- `POST /api/plans/:planId/renewal-progress/step6-upload` (multer, saves to uploads/signed-forms/general/)
- `GET/PATCH /api/clients/:id/prospect-progress`
- `GET /api/dashboard/stalled`

## Frontend
- `plans-tab.tsx`: `RenewalPipeline` component renders the 7-step stepper inline in PlanCard's renewal section
- `pipeline-tab.tsx`: `PipelineTab` component — shows ProspectPipeline for PROSPECT clients, redirect message for ACTIVE
- `client-detail.tsx`: "Pipeline" tab added (all clients); "Generate Renewal Draft" button removed (engine route still exists)
- `dashboard.tsx`: Stalled pipelines table above PPR table; queries `/api/dashboard/stalled`

**Why:** Tracks workflow state per-plan (renewal) and per-client (prospect) so managers can see what step is stalled and for how long, with automatic 14-day flag on the dashboard.
