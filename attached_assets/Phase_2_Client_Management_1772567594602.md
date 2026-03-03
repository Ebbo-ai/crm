This is Phase 2 of the Simple Benefits CMS build. Phase 1 (database, auth, login, sidebar layout) is already complete. Now build the client management features.

## Client List Page (/clients)

Create a page that displays all clients in a card grid or table view:

- Show client name, city/state, industry type, number of employees, plan type, and account status
- Active clients show a green "Active" badge; Terminated clients show a red "Terminated" badge
- Include a search bar at the top that filters clients by name in real time
- Add filter toggles: "All", "Active", "Terminated"
- Sort alphabetically by client name by default
- Each client card/row is clickable and navigates to the client detail page
- "Add New Client" button in the top right (blue #1A5276, prominent)
- If a client has active issues, show a small pulsing red dot indicator on their card (we will build the issue system later, but wire up the indicator now based on the Issue model — count where status = ACTIVE)

## Add/Edit Client Form

Create a form page for adding a new client (/clients/new) and editing an existing client (/clients/[id]/edit). Use the same form component for both.

### Client Information Section
- Client Name: text input, required, validate uniqueness
- Street Address: text input, required
- Suite/Unit: text input, optional
- City: text input, required
- State: dropdown with all 50 US states plus DC, required
- ZIP Code: text input, required, validate format (00000 or 00000-0000)
- Type of Industry: text input, required
- Number of Employees: number input, required, minimum 1

### Plan Type Section
- Radio button group or dropdown, required, options:
  - Dental
  - Vision
  - Hearing
  - Dental / Vision
  - Hearing / Vision
  - Dental / Hearing / Vision

### Network Section
- Network Active: toggle switch (Y/N), default No
- When toggled to Yes, show a text field for "Dental Network Name" with default value "Dentemax"
- When toggled to No, hide the network name field

### Decision Maker Section
Header: "Decision Maker (Primary Contact)"
- Full Name: text, required
- Title: text, required
- Phone: text, required, format as (XXX) XXX-XXXX on blur
- Email: text, required, validate email format

### Administrative Support Contact Section
Header: "Administrative Support Contact"
- Full Name: text, required
- Title: text, required, default pre-filled with "Admin Contact"
- Phone: text, required, format as (XXX) XXX-XXXX on blur
- Email: text, required, validate email format

### Broker Section
- Has Broker: toggle switch (Y/N), default No
- When Yes is selected, expand and show:
  - Broker Firm Name: text, required
  - Broker Contact Name: text, required
  - Broker Phone: text, required, format as phone
  - Broker Email: text, required, validate email
- When No is selected, hide all broker fields

### Banking & Funding Section
- Banking: dropdown, required, options:
  - "Client Bank Account"
  - "90 Degree Bank Account"
- Funding: dropdown, required, options:
  - "Client Requires Approval"
  - "Process Without Approval"

### Account Status Section
- Status: toggle switch, default Active
- When toggled to Terminated, show a date picker for "Termination Date"
- Termination Date validation: the selected date MUST be the last day of a month. If the user picks any other day, show an error: "Termination date must be the last day of a calendar month."
- When toggled back to Active, hide and clear the termination date

### Form Behavior
- Show inline validation errors below each field
- "Save Client" button — on success, show a toast notification "Client saved successfully" and redirect to the client detail page
- "Cancel" button returns to the client list
- For edit mode, pre-populate all fields with existing data

## Client Detail Page (/clients/[id])

Create a detail view with a tabbed layout. For now, build the first tab only (Profile). The other tabs will be built in later phases.

### Tab Navigation
Show tabs across the top of the content area:
- **Profile** (active now)
- Plans & Rates (placeholder, show "Coming soon")
- Documents (placeholder)
- Issues (placeholder)
- PPR (placeholder)
- Banking (placeholder — but banking fields are already on the Profile tab, so this tab can show a summary view later)

### Profile Tab Content
Display all client information in organized sections with a clean card-based layout:

**Client Information Card**
- Display all fields in a readable format (not a form — display mode)
- Show plan type with a colored badge
- Show status with green Active / red Terminated badge

**Contacts Card**
- Decision Maker details
- Admin Support details
- Display phone numbers formatted, emails as mailto links

**Broker Card** (only shown if hasBroker = true)
- Broker firm, contact, phone, email

**Banking & Funding Card**
- Banking type and funding type displayed clearly

**Action Buttons**
- "Edit Client" button (navigates to edit form)
- "Back to Clients" link

## API Routes

Create Next.js API routes:
- GET /api/clients — list all clients with optional search and status filter
- POST /api/clients — create a new client
- GET /api/clients/[id] — get single client with issue count
- PUT /api/clients/[id] — update a client
- All routes require authentication (check session)
- Log create and update actions to the AuditLog table

## Styling

- Use white cards with subtle shadows and rounded corners
- Section headers in dark blue #1A5276
- Form labels in dark gray, required fields marked with a red asterisk
- Toggle switches should be visually clear (green when on, gray when off)
- Responsive: stack sections vertically on smaller screens
- Use Tailwind CSS throughout
- Toast notifications for success/error messages (green for success, red for error)
