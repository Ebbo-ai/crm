# Simple Benefits CMS

A comprehensive client management system for a dental/vision/hearing benefits TPA company.

## Tech Stack
- **Frontend:** React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Express.js API routes
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** Passport.js with local strategy + express-session
- **Routing:** wouter (frontend)
- **State Management:** TanStack Query

## Project Structure
```
client/src/
  App.tsx                    - Main app with routing
  lib/auth.tsx              - Auth context/provider
  lib/constants.ts          - Shared constants, labels, formatting utilities
  lib/queryClient.ts        - API client setup
  pages/
    login.tsx               - Login page
    dashboard.tsx           - Dashboard with stats/activity
    clients.tsx             - Client list page
    client-form.tsx         - Add/edit client form
    client-detail.tsx       - Client detail with tabbed view
    settings-users.tsx      - User management (admin only)
  components/
    app-layout.tsx          - Main layout wrapper
    app-sidebar.tsx         - Sidebar navigation with global search
    tabs/
      plans-tab.tsx         - Plans & rates management
      documents-tab.tsx     - Document uploads
      issues-tab.tsx        - Issue tracking with pulsing indicator
      ppr-tab.tsx           - PPR upload management

server/
  index.ts                  - Express server entry point
  db.ts                     - Database connection
  auth.ts                   - Authentication setup (passport + sessions)
  routes.ts                 - All API routes
  storage.ts                - Database storage layer (CRUD)
  seed.ts                   - Seed data script

shared/
  schema.ts                 - Drizzle ORM schema + types
```

## Features
- User authentication (email/password) with role-based access
- Client CRUD with full profile management
- Plan configuration with rate cards (up to 6 active plans per client)
- Document management with file uploads
- Issue tracking with pulsing red dot indicator
- PPR (performance report) uploads
- Banking/funding summary
- Dashboard with stats, activity feed, and alerts
- User management (admin only)
- Global client search
- CRM spreadsheet import (admin only, `/settings/crm-import`). Upserts on business keys,
  so the same workbook can be run repeatedly as corrections come back without creating
  duplicates. Clients match on client code; plans and rate cards on client code, plan
  name, coverage type and plan year. A workbook only writes the columns it actually
  contains, so a partial correction file leaves everything it does not mention alone.
  Always run "Check file" first: it validates against the database inside a transaction
  and rolls back, so nothing is written until the import is run deliberately.

## Mail pipeline consolidation
The Mailgun inbound-parse webhook (`/api/email/inbound`) has been removed. Its MX
record (mg.simple.us) was never verified and never carried real traffic, so it
never received real client mail. All real inbound/outbound client mail flows
through the Gmail-native pipeline (`server/gmailFullSync.ts`), which now also
does the AI action-item/task extraction the webhook used to do. Mailgun is kept
only for outbound system mail (digests, notifications) via `server/mailer.ts`.

**Known double-write, not yet a problem today:** outbound sends
(`/api/communications/send`) and Gmail-attachment ingestion (`server/gmailIngestion.ts`)
still write to both the legacy `communications` table and, separately, into
`gmailMessages`/`gmailThreads` via the full sync's own pass over the same mailbox.
This is harmless right now because `inbox.tsx`, `communication-feed.tsx`, and
`communications-tab.tsx` all read only from `communications` — the Gmail-native
copy just sits alongside, unread by any screen. It becomes a visible duplicate
the moment a future screen switches to reading `gmailMessages`/`gmailThreads`
instead. When that happens: dedupe on `messageIdHeader` (present on both tables),
and treat `communications` rows created before the Gmail-native pipeline existed
as the authoritative historical record for anything that has no matching
`gmailMessages` row (see the "Backfill Message-ID headers" project task) —
`gmailMessages` should win for any message that exists in both.

## Document model
`documents.category` now includes per-client variable types beyond the original
set: SPD, HANDOUT, RENEWAL_ACCEPTANCE, NEW_PROPOSAL, RATE_NOTICE, and the
internal-only PLAN_TRANSMITTAL (carries the admin fee breakdown — never
client/broker-facing). Filing a new document in one of these categories for a
client flips any prior document in the same category to `isCurrent = false`
instead of deleting it (see `DatabaseStorage.SUPERSEDING_DOCUMENT_CATEGORIES` in
`server/storage.ts`). `globalDocuments` is a separate, data-driven table for
fixed marketing/reference documents shared by every client (e.g. "Simple vs
Traditional Plans") — not per-client copies, and not squeezed into the enum.

`server/documentGuards.ts` has a pure `checkDocumentRecipientGuard` function
that hard-blocks PLAN_TRANSMITTAL from being sent to any recipient outside
Simple's own domain and 90 Degree Benefits. It is not wired into any route
yet — that belongs to the future compose/attach flow (client Communications
tab work) — but the check must be a hard block there, never a dismissible
warning, once wired in.

## Seed Credentials
- Email: admin@simplebenefits.com
- Password: Admin123!

## Color Palette
- Primary Blue: #1A5276
- Medium Blue: #2E86C1
- Gold: #F5A623
- Success Green: #22C55E
- Error Red: #EF4444
- Background: #F0F4F8

## User Preferences

- **No em dashes or en dashes in generated documents or outgoing text.** Use short, plain, declarative sentences. This applies to every document the app generates.
- **Broker compensation is never broken out on anything client facing.** On proposals, plan performance reports and employee handouts it is folded into a single combined administrative fee. The one deliberate exception is the renewal report sent to 90 Degree Benefits, where every component must be listed separately so they can set up billing.
