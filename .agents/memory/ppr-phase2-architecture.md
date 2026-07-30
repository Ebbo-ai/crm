---
name: PPR Phase 2 Architecture
description: Monthly import + report generation design decisions for the plan_performance_facts pipeline
---

## Python module interface contract

Two stub files in `rating_engine/` define the interface the user's real files must implement:

**ppr_import.py** — `process_file(file_bytes, file_ext, context) -> dict`
- context = {clients, plans, current_facts} passed from Node (Python has no DB access)
- Returns {accepted, unchanged, held} — all DB writes done by the Node layer
- Each accepted row has is_restatement bool; Node handles supersede-then-insert

**ppr_report.py** — `generate(payload, output_format="html") -> str|bytes`
- payload.plans[].months[].admin_fee_total = all-in single overhead figure (NEVER broken out)
- Plan year months derived by Node from plan.effectiveDate month, not assumed Jan–Dec
- GENERATOR_VERSION string must be present; stored on every saved PDF document record

## DB tables added (Phase 2)

- `ppr_import_batches` — one row per combined monthly file received
- `ppr_held_rows` — rows that failed validation; status PENDING→ACCEPTED|DISCARDED
- `PPR_REPORT` added to document_category enum
- `held_row_status` enum: PENDING, ACCEPTED, DISCARDED

## Node API surface

- POST /api/ppr/monthly-import — memUpload, sends file+context to Flask, writes facts to DB
- GET  /api/ppr/import-batches — history
- GET  /api/ppr/held-rows?batchId= — list held rows
- PATCH /api/ppr/held-rows/:id — accept (writes to plan_performance_facts) or discard
- GET  /api/clients/:id/ppr-report/plan-years — available years with data
- GET  /api/clients/:id/ppr-report?format=html|pdf&planYear= — generate on demand
- POST /api/clients/:id/ppr-report/save — archives PDF under uploads/ppr-reports/ + documents record

## Key constraints

- Admin fee = totalFee from rate_cards; computed per month as Σ(tier_enrollment × tier_total_fee)
- Rate card lookup: filter by tier + effectiveDate ≤ month_date, pick most recent; NULL effectiveDate = always valid
- Zero-paid flag: set on client when enrollment > 0 AND paid_claims = 0 AND no reason_code
- Restatements: supersede old row (set superseded_at) then insert new row with version+1
- Held rows are never silently dropped; stored in ppr_held_rows with hold_reasons[]
- "Plan position (as billed)" is the correct term — never "surplus/deficit", "cash balance", or "bank balance"
- account_balance is optional actual bank balance; when present report shows billed position vs real balance
- underfunding_flag set when account_balance < 0; shown as badge on client detail header
- Funding basis: ALL clients use CLAIMS_PLUS_ADMIN; column defaults to it; no client uses CLAIMS_ONLY

## Coverage type (plan-level)

- Stored in plans.coverage_type (plan_coverage_type enum, nullable)
- Four values only: DENTAL_ONLY, VISION_ONLY, DENTAL_VISION, DENTAL_VISION_HEARING
- Shared mapping in rating_engine/ppr_coverage.py — both import and report generator import from it
- Combined plans (one rate, one claims stream) are ONE plan; never split into separate dental/vision rows
- Import: if coverage_type in file is unrecognised → hold row; if it conflicts with plan's stored value → hold row
- Plans passed to Flask import context include coverage_type field

## UI

- /ppr-import page: drag-drop combined file → results with stat cards, restated delta table, held row accept/discard
- ppr-tab.tsx: "Performance Report" section at top with plan year selector, View Report button, iframe dialog
- Save to Documents stores PDF + generator version + "data current as of: YYYY-MM" in notes
- Plan form: Coverage Type dropdown (4 options); shown in plan card subtitle
