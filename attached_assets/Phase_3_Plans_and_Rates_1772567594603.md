This is Phase 3 of the Simple Benefits CMS build. Phases 1-2 (database, auth, client CRUD) are complete. Now build the plan configuration and rate/fee management.

## Plans & Rates Tab (/clients/[id] — "Plans & Rates" tab)

Replace the "Coming soon" placeholder on the Plans & Rates tab with full plan management.

### Plan List View

When the tab loads, show all plans for this client:

- Display plans as expandable cards, organized by status:
  - **Current Plans** section at top (isArchived = false)
  - **Archived Plans** section below (isArchived = true), collapsed by default
- Each plan card shows: Plan Name, Effective Date, Plan Basis (Procedure/Dollar), Plan Year, and status badge (Current/Archived)
- "Add New Plan" button — only enabled if the client has fewer than 6 active (non-archived) plans
- If 6 active plans exist, show a disabled button with tooltip: "Maximum of 6 active plans reached"
- Clicking a plan card expands it to show full plan details and rate card

### Add/Edit Plan Form

Create a form (modal or separate page) for adding/editing a plan.

**Plan Identification:**
- Plan Name: text, required, must be unique for this client
- Effective Date: date picker, required. VALIDATION: The selected date must be the 1st of a month. If any other day is selected, show error: "Effective date must be the first day of a month."
- Plan Basis: radio buttons — "Procedure Based" or "Dollar Based", required

**Procedure-Based Fields** (only shown when Plan Basis = "Procedure Based"):
- Preventive: percentage input (0-100), default 100
- Corrective: percentage input (0-100), default 80
- Restorative: percentage input (0-100), default 50
- Show helper text: "Deductible is waived for Preventive tier"

**Additional Parameters:**
- Annual Limit: currency input, default $1,000.00
- Deductible: currency input, optional
- Helper text under deductible: "Applied to Corrective and Restorative tiers only. Waived for Preventive."

**Plan Year:**
- Auto-calculate from the effective date. If effective date is 03/01/2025, plan year = 2025
- Display but don't allow manual edit

### Rate Card Entry

After saving the plan basics, show the rate card entry section. This is a grid/table where the user enters fees for each of the 4 coverage tiers.

**Coverage Tiers (columns):**
- EE (Employee Only)
- EE+C (Employee + Children)
- EE+S (Employee + Spouse)
- FAM (Family)

**Fee Rows (rows in the grid):**
All values are currency (dollars and cents), per employee per month:

| Row | EE | EE+C | EE+S | Family |
|-----|----|----- |------|--------|
| Base Admin Fee (required) | $ input | $ input | $ input | $ input |
| Spread Admin Fee (required) | $ input | $ input | $ input | $ input |
| Network Fee (optional — only show this row if client's networkActive = true) | $ input | $ input | $ input | $ input |
| Broker Fee (conditional — only show this row if client's hasBroker = true) | $ input | $ input | $ input | $ input |
| Total Admin Fee | $ input | $ input | $ input | $ input |
| Total Fee | $ input | $ input | $ input | $ input |
| Expected Claims (required) | $ input | $ input | $ input | $ input |
| Monthly Premium | $ input | $ input | $ input | $ input |

**Important notes about the rate grid:**
- ALL fields are manual entry. The app does NOT auto-calculate totals. The user types in every value.
- However, display the formulas as helper text below the grid:
  - "Total Admin Fee = Base Admin + Spread Admin + Network Fee (excludes Broker Fee)"
  - "Total Fee = Total Admin Fee + Broker Fee"
  - "Monthly Premium = Total Fee + Expected Claims"
- Format all inputs as currency with 2 decimal places
- The Network Fee row should only appear if the client has networkActive = true
- The Broker Fee row should only appear if the client has hasBroker = true
- Save creates 4 RateCard records (one per tier) linked to this plan

### Plan Detail View (Expanded Card)

When a plan card is expanded, show:

**Plan Information section:**
- Plan Name, Effective Date, Plan Year, Plan Basis
- If Procedure Based: show Preventive %, Corrective %, Restorative %
- Annual Limit, Deductible

**Rate Card section:**
- Display the full rate grid in a read-only formatted table
- Same layout as the entry form but in display mode
- Highlight the Monthly Premium row (bold, slightly larger, blue background)

**Action buttons on each plan:**
- "Edit Plan" — opens the edit form (only for non-archived plans)
- "Edit Rates" — opens just the rate card for editing (only for non-archived plans)
- Archived plans show all data as read-only with no edit buttons

## API Routes

- GET /api/clients/[id]/plans — list all plans for a client (include rate cards)
- POST /api/clients/[id]/plans — create a new plan (validate max 6 active, validate effective date is 1st of month)
- PUT /api/plans/[planId] — update plan details
- POST /api/plans/[planId]/rates — create or update rate cards (upsert 4 tier records)
- GET /api/plans/[planId] — get single plan with rate cards
- All routes require authentication
- Log actions to AuditLog

## Styling

- Rate card grid should be a clean table with alternating row colors (white and light blue #F0F4F8)
- Header row in dark blue #1A5276 with white text
- Currency inputs should show $ prefix inside the input
- Monthly Premium row highlighted with gold (#F5A623) left border
- Use card-based layout consistent with Phase 2
- Archived plans section should have a slightly muted appearance (lighter text, gray header)
- Smooth expand/collapse animation on plan cards
