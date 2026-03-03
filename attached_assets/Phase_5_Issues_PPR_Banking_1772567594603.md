This is Phase 5 of the Simple Benefits CMS build. Phases 1-4 are complete. Now build issue tracking with the flashing indicator, PPR uploads, and the banking/funding summary tab.

## Issue Tracking — Issues Tab

Replace the "Coming soon" placeholder on the Issues tab.

### Issue List View

Display all issues for this client, split into two sections:

**Active Issues** (top section):
- Show each active issue as a card with a pulsing red dot indicator on the left
- Display: Issue Title, Created Date, Created By, and a truncated description
- Sorted by created date, newest first
- Each card is expandable to show full description

**Resolved Issues** (bottom section, collapsible):
- Header: "Resolved Issues" with a toggle to expand/collapse, collapsed by default
- Show each resolved issue with a green checkmark
- Display: Issue Title, Created Date, Resolved Date, Created By
- Expandable to show full description and resolution notes

### Create Issue

"Report Issue" button (prominent, red/orange color) that opens a modal:

- Issue Title: text input, required
- Description / Notes: large text area, required, allow multiple lines
- Created By: auto-filled from logged-in user
- Status: automatically set to ACTIVE
- Date Created: auto-generated

On save, the issue is created and the flashing indicator activates.

### Resolve Issue

Each active issue card has a "Resolve" button:

1. Clicking Resolve opens a small modal/dialog:
   - "Resolution Notes" text area (optional but encouraged)
   - "Confirm Resolve" button and "Cancel" button
2. On confirm:
   - Status changes to RESOLVED
   - resolvedAt timestamp is set
   - Resolution notes are saved
   - Show success toast: "Issue resolved"
3. If this was the last active issue for the client, the flashing indicator on the client list stops

### THE FLASHING INDICATOR — Critical Feature

This is the most important visual feature of the entire app. It must work as follows:

**On the Client List page (/clients):**
- Any client that has at least one issue with status = ACTIVE must show a pulsing/flashing red dot
- The dot should pulse continuously (CSS animation, red glow that fades in and out)
- Next to the dot, show a count badge: e.g., "3" if there are 3 active issues
- This indicator must be visible without clicking into the client — it shows on the card/row in the client list

**On the Client Detail page:**
- Show the same pulsing indicator next to the client name at the top if there are active issues
- The Issues tab label should also show the count: "Issues (3)"

**CSS for the pulsing dot:**
```css
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}
.pulse-dot {
  width: 12px;
  height: 12px;
  background: #ef4444;
  border-radius: 50%;
  animation: pulse 2s infinite;
}
```

Make sure this animation runs smoothly and is clearly noticeable.

## PPR Uploads — PPR Tab

Replace the "Coming soon" placeholder on the PPR tab.

### PPR List View

Display all PPR uploads for this client:
- Table format with columns: Report Period (Month/Year), File Name, Upload Date, Uploaded By, Notes, Actions
- Sorted by report period, newest first
- Clicking the file name downloads the file

### Upload PPR

"Upload PPR" button that opens a modal:

- Report Month: dropdown (January through December), required
- Report Year: dropdown (current year and previous 5 years), required
- File: file upload, required. Accept PDF, XLSX, CSV.
  - Drag-and-drop zone, same style as document uploads
  - Max 25 MB
- Notes: text area, optional
- Uploaded By: auto-filled from logged-in user
- Upload Date: auto-generated

Validation: warn (but allow) if a PPR already exists for the selected month/year. Show: "A PPR for [Month Year] already exists. Upload anyway?"

### File Storage

Store PPR files at: /uploads/ppr/[clientId]/
Same naming convention as documents: [timestamp]-[originalFilename]

### PPR Actions

- **Download**: download the file
- **Preview**: for PDFs, show inline preview
- **Delete**: confirmation dialog, then delete

## Banking Tab (Summary View)

Replace the placeholder on the Banking tab with a simple summary view:

- Display a card showing:
  - **Banking Type**: "Client Bank Account" or "90 Degree Bank Account" with a bank icon
  - **Funding Type**: "Client Requires Approval" or "Process Without Approval" with appropriate icon
- "Edit" link that navigates to the client edit form scrolled to the Banking section
- This is a read-only summary since the actual editing happens on the client profile form

## API Routes

New routes:
- GET /api/clients/[id]/issues — list issues for a client
- POST /api/clients/[id]/issues — create a new issue
- PUT /api/issues/[issueId] — update an issue (resolve)
- GET /api/clients/[id]/issues/count — get active issue count (for the badge)
- GET /api/clients/[id]/ppr — list PPR uploads
- POST /api/clients/[id]/ppr — upload a PPR (multipart form data)
- GET /api/ppr/[pprId]/download — download a PPR file
- DELETE /api/ppr/[pprId] — delete a PPR

All routes require authentication. Log actions to AuditLog.

## Styling

- Active issue cards: white background with a red left border (4px solid #ef4444)
- Resolved issue cards: white background with a green left border (4px solid #22c55e)
- The pulsing red dot must be highly visible — this is the key alert mechanism for the business
- PPR table: clean and simple, consistent with document table styling
- Banking summary: use icons (bank icon, approval/checkmark icon) for visual clarity
- All modals should have smooth open/close transitions
- Consistent with the existing design system from previous phases
