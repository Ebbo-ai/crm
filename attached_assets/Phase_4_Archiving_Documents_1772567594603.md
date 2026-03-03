This is Phase 4 of the Simple Benefits CMS build. Phases 1-3 are complete (database, auth, clients, plans, rates). Now build plan archiving and document management.

## Plan History & Archiving

### Automatic Archiving Logic

Create a utility function (and optionally a cron job or check-on-load) that handles plan archiving:

1. When any page loads that displays plans, OR when the Plans & Rates tab is opened, check all active plans for the current client
2. For each non-archived plan: if today's date is past the Effective Date + 12 months, automatically set isArchived = true
3. When a plan is archived:
   - The plan and its rate cards become read-only
   - The plan is tagged with its plan year
   - It moves to the "Archived Plans" section of the plans list

### Renewal / New Plan Year Workflow

Add a "Renew Plan" button on each current (non-archived) plan that is approaching its anniversary (within 60 days of the 12-month mark), and also on archived plans:

1. Clicking "Renew Plan" creates a copy of the plan with:
   - Same plan name
   - New effective date = old effective date + 12 months
   - Same plan basis, same co-insurance percentages, same annual limit, same deductible
   - New plan year (old year + 1)
   - isArchived = false
   - Rate cards are copied but all fee values are blank (user must enter new rates)
2. The user can then edit the new plan's details if anything changed (e.g., new co-insurance percentages)
3. The user fills in the new year's rate card

### Plan History View

On the Plans & Rates tab, add a "Plan History" section or a toggle to "Show History View":

- Show a timeline or year-by-year dropdown that lists all plan versions
- Selecting a year shows the plan details and rate card for that year
- Each historical entry shows: Plan Year, Effective Date, Plan Basis, co-insurance tiers, limits, and the full rate card
- All historical data is read-only
- Make it easy to compare year-over-year by showing the data clearly

## Document Management — Documents Tab

Replace the "Coming soon" placeholder on the Documents tab with full document management.

### Document List View

- Display all documents for this client in a table/list format
- Sort by upload date, newest first (reverse chronological)
- Columns: Document Name, Category, Upload Date, Uploaded By, Notes (truncated), Actions
- Filter dropdown by category: All, Client Agreement, Proposal, Employer Acceptance, Broker Compensation, Broker of Record, Renewal Proposal, Other
- Search bar to filter by document name

### Upload Document

Add an "Upload Document" button that opens a modal or inline form:

- Document Name / Title: text input, required
- Category: dropdown, required, options:
  - Client Agreement
  - Proposal
  - Employer Acceptance
  - Broker Compensation
  - Broker of Record Letter
  - Renewal Proposal
  - Other
- File: file upload input, required. Accept PDF, DOCX, XLSX, PNG, JPG, JPEG
  - Show a drag-and-drop zone with a dashed border that also has a "Browse files" button
  - Show file name and size after selection
  - Maximum file size: 25 MB. Show error if exceeded.
- Notes: text area, optional
- Upload Date: auto-generated (display but don't allow edit)
- Uploaded By: auto-filled from current logged-in user name

### File Storage

Store uploaded files on the Replit filesystem:
- Create a directory: /uploads/documents/[clientId]/
- Save files with a unique name: [timestamp]-[originalFilename]
- Store the file path and original file name in the database

### Document Actions

For each document in the list:
- **Download**: download the original file
- **Preview**: for PDFs and images, open a preview modal. For other file types, just offer download.
- **Delete**: confirm dialog, then delete the file and database record

### Document Detail

Clicking a document name shows:
- Full document name
- Category badge
- Upload date and uploaded by
- Notes (full text)
- Preview (if PDF or image) or download button

## API Routes

New routes:
- GET /api/clients/[id]/documents — list documents for a client, with optional category filter
- POST /api/clients/[id]/documents — upload a new document (multipart form data)
- GET /api/documents/[docId]/download — download a document file
- DELETE /api/documents/[docId] — delete a document
- PUT /api/plans/[planId]/archive — manually archive a plan
- POST /api/plans/[planId]/renew — create a renewed copy of a plan

All routes require authentication. Log uploads and deletions to AuditLog.

## Styling

- Document upload drag-and-drop zone: dashed border (#1A5276), light blue background on hover
- Category badges with distinct colors:
  - Client Agreement: blue
  - Proposal: gold
  - Employer Acceptance: green
  - Broker Compensation: purple
  - Broker of Record: orange
  - Renewal Proposal: teal
  - Other: gray
- Document table with clean rows, hover highlight
- Preview modal should be large enough to read PDF content
- Plan history timeline: use a clean vertical timeline or accordion with year labels
- Archived plan cards should have a subtle "Archived" watermark or muted styling
