Build a client management system for a dental/vision/hearing benefits TPA company called "Simple Benefits." This is Phase 1 — project foundation, database, and authentication.

## Tech Stack

Use Next.js 14 with App Router, TypeScript, Tailwind CSS, PostgreSQL with Prisma ORM, and NextAuth.js for authentication. This is a full-stack app — all API routes live inside Next.js.

## Database Schema

Create a Prisma schema with the following models. Use PostgreSQL. All IDs should be auto-incrementing integers.

### User Model
- id: Int, auto-increment, primary key
- email: String, unique, required
- password: String, required (hashed with bcrypt)
- fullName: String, required
- role: Enum (ADMIN, STANDARD), default STANDARD
- isActive: Boolean, default true
- createdAt: DateTime, default now
- updatedAt: DateTime, auto-update

### Client Model
- id: Int, auto-increment, primary key
- clientName: String, unique, required
- streetAddress: String, required
- suiteUnit: String, optional
- city: String, required
- state: String, required
- zipCode: String, required
- industryType: String, required
- numberOfEmployees: Int, required
- isActive: Boolean, default true
- terminationDate: DateTime, optional
- planType: Enum (DENTAL, VISION, HEARING, DENTAL_VISION, HEARING_VISION, DENTAL_HEARING_VISION), required
- networkActive: Boolean, default false
- dentalNetworkName: String, optional, default "Dentemax"
- decisionMakerName: String, required
- decisionMakerTitle: String, required
- decisionMakerPhone: String, required
- decisionMakerEmail: String, required
- adminContactName: String, required
- adminContactTitle: String, required, default "Admin Contact"
- adminContactPhone: String, required
- adminContactEmail: String, required
- hasBroker: Boolean, default false
- brokerFirmName: String, optional
- brokerContactName: String, optional
- brokerPhone: String, optional
- brokerEmail: String, optional
- bankingType: Enum (CLIENT_BANK, NINETY_DEGREE_BANK), required
- fundingType: Enum (REQUIRES_APPROVAL, PROCESS_WITHOUT_APPROVAL), required
- createdAt: DateTime, default now
- updatedAt: DateTime, auto-update

Relations: Client has many Plans, Documents, Issues, PPRUploads

### Plan Model
- id: Int, auto-increment, primary key
- clientId: Int, foreign key to Client
- planName: String, required
- effectiveDate: DateTime, required
- planBasis: Enum (PROCEDURE_BASED, DOLLAR_BASED), required
- preventivePercent: Int, optional, default 100
- correctivePercent: Int, optional, default 80
- restorativePercent: Int, optional, default 50
- annualLimit: Decimal, default 1000
- deductible: Decimal, optional
- isArchived: Boolean, default false
- planYear: Int, required
- createdAt: DateTime, default now
- updatedAt: DateTime, auto-update

Relations: Plan has many RateCards

### RateCard Model
- id: Int, auto-increment, primary key
- planId: Int, foreign key to Plan
- tier: Enum (EE, EE_CHILD, EE_SPOUSE, FAMILY), required
- baseAdminFee: Decimal, required
- spreadAdminFee: Decimal, required
- networkFee: Decimal, optional, default 0
- brokerFee: Decimal, optional, default 0
- totalAdminFee: Decimal, required
- totalFee: Decimal, required
- expectedClaims: Decimal, required
- monthlyPremium: Decimal, required
- createdAt: DateTime, default now
- updatedAt: DateTime, auto-update

### Document Model
- id: Int, auto-increment, primary key
- clientId: Int, foreign key to Client
- documentName: String, required
- category: Enum (CLIENT_AGREEMENT, PROPOSAL, EMPLOYER_ACCEPTANCE, BROKER_COMPENSATION, BROKER_OF_RECORD, RENEWAL_PROPOSAL, OTHER), required
- filePath: String, required
- fileName: String, required
- notes: String, optional
- uploadedAt: DateTime, default now
- uploadedBy: String, required

### Issue Model
- id: Int, auto-increment, primary key
- clientId: Int, foreign key to Client
- title: String, required
- description: String, required (use Text type for long content)
- status: Enum (ACTIVE, RESOLVED), default ACTIVE
- resolutionNotes: String, optional (Text type)
- createdBy: String, required
- resolvedAt: DateTime, optional
- createdAt: DateTime, default now
- updatedAt: DateTime, auto-update

### PPRUpload Model
- id: Int, auto-increment, primary key
- clientId: Int, foreign key to Client
- reportMonth: Int, required
- reportYear: Int, required
- filePath: String, required
- fileName: String, required
- notes: String, optional
- uploadedBy: String, required
- uploadedAt: DateTime, default now

### AuditLog Model
- id: Int, auto-increment, primary key
- userId: Int, optional
- userName: String, required
- action: String, required
- entity: String, required
- entityId: Int, optional
- details: String, optional (Text type)
- createdAt: DateTime, default now

## Authentication Setup

Use NextAuth.js with a Credentials provider (email + password login). Set up:

1. A login page at /login with email and password fields
2. Password hashing with bcrypt (minimum 8 characters, must contain uppercase, lowercase, number, special character)
3. Session management with JWT
4. Session timeout of 30 minutes
5. Protect all routes except /login — redirect unauthenticated users to /login
6. Middleware that checks authentication on every request

## Seed Data

Create a seed script (prisma/seed.ts) that creates one admin user:
- Email: admin@simplebenefits.com
- Password: Admin123!
- Full Name: System Administrator
- Role: ADMIN

## Login Page Design

Make the login page look professional and modern:
- Centered card on a clean background
- "Simple Benefits" as the title in bold dark blue (#1A5276)
- "Client Management System" as subtitle in gold (#F5A623)
- Email and password fields with clear labels
- "Sign In" button in dark blue (#1A5276) with white text
- Show validation errors inline
- After login, redirect to /dashboard (just show a placeholder page that says "Welcome, [user name]" for now)

## Navigation Layout (placeholder for now)

After login, show a sidebar layout:
- Left sidebar with navigation links (dark blue #1A5276 background, white text):
  - Dashboard (icon: home)
  - Clients (icon: users)
  - Reports (icon: bar chart)
  - Settings (icon: gear) — only visible to ADMIN role
- Top bar showing the logged-in user name and a Logout button
- Main content area to the right of the sidebar
- The sidebar should be collapsible on smaller screens

Use Tailwind CSS for all styling. Make it clean, modern, and bright. Use the color palette: dark blue #1A5276, gold #F5A623, light background #F0F4F8, white cards, subtle gray borders.

Run the Prisma migration and seed after setup. Make sure the app starts, the login page displays, and you can log in with the seed credentials.
