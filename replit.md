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
