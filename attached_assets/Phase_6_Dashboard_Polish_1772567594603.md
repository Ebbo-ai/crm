This is Phase 6 — the final phase of the Simple Benefits CMS build. Phases 1-5 are complete. Now build the dashboard, user management, global search, and final UI polish.

## Dashboard (/dashboard)

Replace the placeholder dashboard with a full operational overview.

### Summary Statistics Row
Show 4-5 stat cards across the top:
- **Total Clients**: count of all clients
- **Active Clients**: count where isActive = true
- **Terminated Clients**: count where isActive = false
- **Active Issues**: total count of all issues with status = ACTIVE across all clients (show in red if > 0)
- **Plans Expiring Soon**: count of non-archived plans where effective date + 12 months is within the next 60 days

Each stat card should be a white card with a large number, label below, and a subtle colored icon (use the brand colors).

### Clients Needing Attention Section
Show a list/table of clients that have active issues:
- Client name (clickable, goes to client detail)
- Number of active issues (with the pulsing red dot)
- Most recent issue title and date
- Sorted by issue count (most issues first)
- If no clients have active issues, show a green checkmark with "All clear — no active issues"

### Plans Expiring Soon Section
Show plans approaching their 12-month anniversary (within 60 days):
- Client name, Plan name, Effective date, Days until expiration
- "Renew" quick action button (triggers the renewal flow from Phase 4)
- Sorted by expiration date (soonest first)

### Recent Activity Feed
Show the last 15 audit log entries:
- Display as a vertical timeline
- Each entry shows: timestamp, user name, action description
- Examples: "Admin created client ABC Corp", "Admin uploaded document for XYZ Inc", "Admin resolved issue for Delta Group"

## Settings — User Management (/settings/users)

This page is only accessible to users with role = ADMIN. If a non-admin tries to access it, redirect to dashboard.

### User List
Display all users in a table:
- Full Name, Email, Role (Admin/Standard), Status (Active/Inactive), Last Login (if tracked)
- Active users in normal text; inactive users in gray/muted

### Add User
"Add User" button opens a form:
- Full Name: text, required
- Email: text, required, must be unique, validate email format
- Password: text, required, minimum 8 characters, must contain uppercase + lowercase + number + special character. Show password strength indicator.
- Confirm Password: must match password
- Role: dropdown — Admin or Standard
- On save, hash the password with bcrypt and create the user

### Edit User
Click a user row to edit:
- Can change: Full Name, Email, Role, Active/Inactive status
- "Reset Password" button: generates a temporary password or allows admin to set a new one
- Cannot delete users — only deactivate (set isActive = false)

### User Actions
- Deactivated users cannot log in (check isActive in the auth flow)
- The currently logged-in admin cannot deactivate themselves

## Global Search

Enhance the search functionality:
- The search bar in the sidebar/top navigation should search across client names
- Show a dropdown of matching results as the user types (autocomplete/typeahead)
- Minimum 2 characters to trigger search
- Results show client name, city/state, and active/terminated badge
- Clicking a result navigates directly to that client's detail page
- If no results, show "No clients found"

## Final UI Polish

Go through the entire app and ensure consistency:

### Color System (use these exact values everywhere):
- Primary Blue: #1A5276 (sidebar, headers, primary buttons)
- Medium Blue: #2E86C1 (links, secondary headers)
- Gold/Amber: #F5A623 (accents, highlights, important badges)
- Success Green: #22C55E (active badges, resolved indicators)
- Error Red: #EF4444 (error messages, pulsing dots, terminated badges)
- Light Background: #F0F4F8 (page background)
- White: #FFFFFF (cards, content areas)
- Dark Text: #2C3E50 (body text)
- Muted Gray: #94A3B8 (helper text, disabled elements)

### Typography
- Page titles: 24px, bold, Primary Blue
- Section headers: 18px, semibold, Dark Text
- Body text: 14px, regular, Dark Text
- Helper/caption text: 12px, regular, Muted Gray

### Component Consistency
- All cards: white background, rounded-lg, shadow-sm, consistent padding (p-6)
- All buttons: rounded-md, consistent sizing, hover states
  - Primary buttons: blue #1A5276 bg, white text
  - Secondary buttons: white bg, blue border and text
  - Danger buttons: red bg for destructive actions
- All tables: consistent header styling, hover row highlights, alternating row colors
- All form inputs: consistent border, focus ring in blue, consistent label styling
- All modals: consistent sizing, backdrop blur, smooth transitions
- All toast notifications: bottom-right position, auto-dismiss after 4 seconds
- All badges: consistent rounded-full pill style

### Loading & Empty States
- Show skeleton loading placeholders while data is being fetched
- Show meaningful empty states with icons:
  - No clients yet: "Add your first client to get started"
  - No plans: "No plans configured for this client yet"
  - No documents: "No documents uploaded yet"
  - No issues: "No issues reported — looking good!"
  - No PPRs: "No performance reports uploaded yet"

### Navigation Polish
- Active sidebar item should be highlighted (lighter blue background or gold left border)
- Breadcrumbs on detail pages: Clients > Client Name > Tab Name
- Page transitions should feel smooth (no jarring full-page reloads)
- The sidebar should show the "Simple Benefits" name/logo at the top and "Client Management System" below it in smaller text

### Responsive Behavior
- Sidebar collapses to a hamburger menu on screens smaller than 1024px
- Tables switch to card layout on mobile
- Forms stack to single column on mobile
- Modals become full-screen on mobile

## Final Checks

After completing this phase, verify:
1. Login works with seed credentials (admin@simplebenefits.com / Admin123!)
2. Can create, edit, view clients
3. All form validations work (termination date = last of month, effective date = 1st of month, email format, phone format)
4. Plans can be added (up to 6), edited, and rate cards entered
5. Plan archiving works (set a test plan with an old effective date)
6. Documents can be uploaded, previewed, downloaded, deleted
7. Issues can be created, show the pulsing dot on client list, and be resolved
8. PPRs can be uploaded and viewed
9. Dashboard shows correct counts and lists
10. User management works (admin can add/edit/deactivate users)
11. Non-admin users cannot access Settings
12. Global search works
13. All pages look consistent and professional
14. Logout works and redirects to login
