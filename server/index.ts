import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Startup migrations: add missing columns, tables, and enums.
  // The plans uniqueness constraint (client_id, plan_name, plan_year) is managed
  // by the Drizzle schema and applied to production by the publish flow; it is not
  // added here. Plan data is guaranteed unique by the constraint itself once in place.
  try {
    const { pool } = await import("./db");
    await pool.query(`
      DO $$ BEGIN
        -- client_status enum + column
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_status') THEN
          CREATE TYPE client_status AS ENUM ('PROSPECT', 'ACTIVE', 'TERMINATED');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'client_status') THEN
          ALTER TABLE clients ADD COLUMN client_status client_status NOT NULL DEFAULT 'ACTIVE';
        END IF;

        -- ortho_eligibility enum + column
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ortho_eligibility') THEN
          CREATE TYPE ortho_eligibility AS ENUM ('NONE', 'CHILDREN', 'ALL');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'ortho_eligibility') THEN
          ALTER TABLE plans ADD COLUMN ortho_eligibility ortho_eligibility NOT NULL DEFAULT 'NONE';
        END IF;

        -- ortho_max_type enum + columns
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ortho_max_type') THEN
          CREATE TYPE ortho_max_type AS ENUM ('SHARED_ANNUAL', 'SEPARATE_LIFETIME');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'ortho_max_type') THEN
          ALTER TABLE plans ADD COLUMN ortho_max_type ortho_max_type DEFAULT 'SHARED_ANNUAL';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'ortho_coinsurance_percent') THEN
          ALTER TABLE plans ADD COLUMN ortho_coinsurance_percent INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'ortho_lifetime_max') THEN
          ALTER TABLE plans ADD COLUMN ortho_lifetime_max DECIMAL(10,2);
        END IF;

        -- renewal_progress table
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'renewal_progress' AND table_schema = 'public') THEN
          CREATE TABLE renewal_progress (
            id SERIAL PRIMARY KEY,
            plan_id INTEGER NOT NULL UNIQUE,
            client_id INTEGER NOT NULL,
            step1_date TIMESTAMP,
            step2_date TIMESTAMP,
            step3_date TIMESTAMP,
            step4_revisions JSONB NOT NULL DEFAULT '[]'::jsonb,
            step5_date TIMESTAMP,
            step6_date TIMESTAMP,
            step6_document_id INTEGER,
            step7_date TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );
        END IF;

        -- prospect_progress table
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prospect_progress' AND table_schema = 'public') THEN
          CREATE TABLE prospect_progress (
            id SERIAL PRIMARY KEY,
            client_id INTEGER NOT NULL UNIQUE,
            step1_date TIMESTAMP,
            step2_date TIMESTAMP,
            step3_date TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );
        END IF;

        -- ── Phase 1: Monthly PPR data model ──────────────────────────────────

        -- ppr_reason_code enum (drives client-facing report wording)
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ppr_reason_code') THEN
          CREATE TYPE ppr_reason_code AS ENUM (
            'CLERICAL_CORRECTION',
            'CLAIMS_HELD_FUNDING',
            'CLAIMS_HELD_PROCESSING',
            'ENROLLMENT_RESTATEMENT',
            'OTHER'
          );
        END IF;

        -- funding_basis enum: CLAIMS_PLUS_ADMIN is the only basis used in practice
        -- (the administrator draws all fees from the plan account, so admin is always
        -- funded in together with claims — never eroding the claims budget separately)
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'funding_basis') THEN
          CREATE TYPE funding_basis AS ENUM ('CLAIMS_ONLY', 'CLAIMS_PLUS_ADMIN');
        END IF;

        -- clients: funding_basis
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'funding_basis') THEN
          ALTER TABLE clients ADD COLUMN funding_basis funding_basis;
        END IF;

        -- clients: zero_paid_flag — surfaces months where enrollment is present
        --   but zero claims were paid and no reason code is on file (collections signal)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'zero_paid_flag') THEN
          ALTER TABLE clients ADD COLUMN zero_paid_flag BOOLEAN NOT NULL DEFAULT false;
        END IF;

        -- rate_cards: effective_date — so prior months use the rates actually in force
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'rate_cards' AND column_name = 'effective_date') THEN
          ALTER TABLE rate_cards ADD COLUMN effective_date TIMESTAMP;
        END IF;

        -- plan_performance_facts: append-only versioned monthly facts table
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'plan_performance_facts' AND table_schema = 'public') THEN
          CREATE TABLE plan_performance_facts (
            id               SERIAL PRIMARY KEY,
            client_id        INTEGER NOT NULL REFERENCES clients(id),
            plan_id          INTEGER NOT NULL REFERENCES plans(id),
            report_month     INTEGER NOT NULL,
            report_year      INTEGER NOT NULL,
            version          INTEGER NOT NULL DEFAULT 1,

            -- Enrollment by tier (mirrors rate_cards tiers)
            ee_count         INTEGER,
            ee_spouse_count  INTEGER,
            ee_child_count   INTEGER,
            family_count     INTEGER,

            -- Claims figures
            submitted_charges DECIMAL(14, 2),
            paid_claims       DECIMAL(14, 2),
            claim_count       INTEGER,

            -- Why a month was held or revised (drives client-facing report wording)
            reason_code       ppr_reason_code,
            reason_note       TEXT,

            -- For held months: the later month when those claims were released
            release_month     INTEGER,
            release_year      INTEGER,

            -- Provenance
            received_date     TIMESTAMP,
            loaded_by         TEXT NOT NULL,

            -- Versioning: NULL = current row; non-NULL = superseded on that date
            superseded_at     TIMESTAMP,
            created_at        TIMESTAMP NOT NULL DEFAULT NOW(),

            -- report_month must be a valid calendar month
            CONSTRAINT ppf_valid_report_month
              CHECK (report_month BETWEEN 1 AND 12),

            -- release_month, when set, must also be valid
            CONSTRAINT ppf_valid_release_month
              CHECK (release_month IS NULL OR release_month BETWEEN 1 AND 12),

            -- 'OTHER' reason code requires a non-empty explanatory note
            CONSTRAINT ppf_reason_note_required
              CHECK (reason_code <> 'OTHER'
                     OR (reason_note IS NOT NULL AND trim(reason_note) <> ''))
          );

          -- Only one current row per client/plan/month (partial unique index)
          CREATE UNIQUE INDEX ppf_current_version_unique
            ON plan_performance_facts (client_id, plan_id, report_month, report_year)
            WHERE superseded_at IS NULL;

        END IF;
      END $$;

      -- Current-version view (superseded_at IS NULL = the live row for each month)
      -- CREATE OR REPLACE VIEW is idempotent so no IF NOT EXISTS needed
      CREATE OR REPLACE VIEW plan_performance_current AS
        SELECT * FROM plan_performance_facts
        WHERE superseded_at IS NULL;

      -- Back-fill clientStatus for existing terminated clients
      UPDATE clients
        SET client_status = 'TERMINATED'
        WHERE (is_active = false OR termination_date IS NOT NULL)
          AND client_status = 'ACTIVE';
    `);

    // Phase 2: Import batches & held rows
    // ALTER TYPE ... ADD VALUE cannot run inside a PL/pgSQL block, so it runs
    // here at the top level.  CREATE TABLE statements go in a separate DO block.
    try {
      await pool.query(`ALTER TYPE document_category ADD VALUE IF NOT EXISTS 'PPR_REPORT'`);
    } catch (_) { /* already exists */ }

    await pool.query(`
      DO $$ BEGIN
        -- held_row_status enum for import staging
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'held_row_status') THEN
          CREATE TYPE held_row_status AS ENUM ('PENDING', 'ACCEPTED', 'DISCARDED');
        END IF;

        -- ppr_import_batches: one row per combined monthly file received
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'ppr_import_batches' AND table_schema = 'public'
        ) THEN
          CREATE TABLE ppr_import_batches (
            id            SERIAL PRIMARY KEY,
            file_name     TEXT NOT NULL,
            uploaded_by   TEXT NOT NULL,
            uploaded_at   TIMESTAMP NOT NULL DEFAULT NOW(),
            rows_total    INTEGER NOT NULL DEFAULT 0,
            rows_accepted INTEGER NOT NULL DEFAULT 0,
            rows_unchanged INTEGER NOT NULL DEFAULT 0,
            rows_restated INTEGER NOT NULL DEFAULT 0,
            rows_held     INTEGER NOT NULL DEFAULT 0,
            notes         TEXT
          );
        END IF;

        -- ppr_held_rows: rows that failed validation, kept for later review
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'ppr_held_rows' AND table_schema = 'public'
        ) THEN
          CREATE TABLE ppr_held_rows (
            id                  SERIAL PRIMARY KEY,
            batch_id            INTEGER NOT NULL REFERENCES ppr_import_batches(id),
            client_code         TEXT,
            plan_name           TEXT,
            report_month        INTEGER,
            report_year         INTEGER,
            raw_data            JSONB,
            hold_reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
            status              held_row_status NOT NULL DEFAULT 'PENDING',
            reviewed_at         TIMESTAMP,
            reviewed_by         TEXT,
            review_note         TEXT,
            resolved_client_id  INTEGER,
            resolved_plan_id    INTEGER,
            created_at          TIMESTAMP NOT NULL DEFAULT NOW()
          );
        END IF;
      END $$;
    `);

    // Phase 2b: account_balance on facts, underfunding_flag on clients,
    // and set CLAIMS_PLUS_ADMIN as the default + backfill for funding_basis.
    // These are plain ALTER TABLE statements so they run outside the DO block.
    await pool.query(`
      DO $$ BEGIN
        -- account_balance: optional actual bank balance at month end, supplied by the
        -- administrator for groups whose workbooks carry it. When present, the report
        -- shows billed plan position alongside the real balance and the gap.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plan_performance_facts'
                         AND column_name = 'account_balance') THEN
          ALTER TABLE plan_performance_facts
            ADD COLUMN account_balance DECIMAL(14, 2);
        END IF;

        -- underfunding_flag: set when an actual account_balance is on file and the
        -- account is materially below the billed plan position (collections signal,
        -- parallel to zero_paid_flag)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients'
                         AND column_name = 'underfunding_flag') THEN
          ALTER TABLE clients
            ADD COLUMN underfunding_flag BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;

      -- Backfill: every client on the book uses CLAIMS_PLUS_ADMIN; set it explicitly
      -- so the column is never NULL going forward.
      UPDATE clients
        SET funding_basis = 'CLAIMS_PLUS_ADMIN'
        WHERE funding_basis IS NULL;

      -- Make CLAIMS_PLUS_ADMIN the default for new clients.
      ALTER TABLE clients
        ALTER COLUMN funding_basis SET DEFAULT 'CLAIMS_PLUS_ADMIN';
    `);

    // Phase 2c: plan coverage type — four-value closed enum stored on each plan.
    // Combined plans (dental+vision on one rate/claims stream) use DENTAL_VISION or
    // DENTAL_VISION_HEARING and are never split into separate rows.
    try {
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_coverage_type') THEN
            CREATE TYPE plan_coverage_type AS ENUM (
              'DENTAL_ONLY',
              'VISION_ONLY',
              'DENTAL_VISION',
              'DENTAL_VISION_HEARING'
            );
          END IF;

          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'plans' AND column_name = 'coverage_type') THEN
            ALTER TABLE plans ADD COLUMN coverage_type plan_coverage_type;
          END IF;
        END $$;
      `);
    } catch (_) { /* already exists */ }

    // Phase 4: per-plan tiers, broker mode, fee basis.
    await pool.query(`
      DO $$ BEGIN
        -- plan_tiers table
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'plan_tiers' AND table_schema = 'public') THEN
          CREATE TABLE plan_tiers (
            id SERIAL PRIMARY KEY,
            plan_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );
        END IF;

        -- rate_cards: plan_tier_id column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'rate_cards' AND column_name = 'plan_tier_id') THEN
          ALTER TABLE rate_cards ADD COLUMN plan_tier_id INTEGER;
        END IF;

        -- rate_cards: cobra_fee column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'rate_cards' AND column_name = 'cobra_fee') THEN
          ALTER TABLE rate_cards ADD COLUMN cobra_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00;
        END IF;

        -- rate_cards: make tier nullable (replaced by plan_tier_id)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'rate_cards' AND column_name = 'tier'
                     AND is_nullable = 'NO') THEN
          ALTER TABLE rate_cards ALTER COLUMN tier DROP NOT NULL;
        END IF;

        -- rate_cards: make total_fee nullable (retired; monthlyPremium holds the same value)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'rate_cards' AND column_name = 'total_fee'
                     AND is_nullable = 'NO') THEN
          ALTER TABLE rate_cards ALTER COLUMN total_fee DROP NOT NULL;
        END IF;

        -- plans: broker_mode
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'broker_mode') THEN
          ALTER TABLE plans ADD COLUMN broker_mode TEXT NOT NULL DEFAULT 'NONE';
        END IF;

        -- plans: broker_value
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'broker_value') THEN
          ALTER TABLE plans ADD COLUMN broker_value DECIMAL(10,4) DEFAULT 0.0000;
        END IF;

        -- plans: fee_basis
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'fee_basis') THEN
          ALTER TABLE plans ADD COLUMN fee_basis TEXT NOT NULL DEFAULT 'PEPM';
        END IF;

        -- Data migration: create plan_tiers rows from existing rate_cards tier enum values.
        -- EE_SPOUSE is relabelled to "Employee + One" (it was mislabelled; it covers a spouse
        -- OR a child, making "Employee + One" the accurate label).
        INSERT INTO plan_tiers (plan_id, label, display_order)
        SELECT DISTINCT
          rc.plan_id,
          CASE rc.tier::text
            WHEN 'EE'        THEN 'Employee Only'
            WHEN 'EE_CHILD'  THEN 'Employee + Child'
            WHEN 'EE_SPOUSE' THEN 'Employee + One'
            WHEN 'FAMILY'    THEN 'Employee + Family'
            ELSE rc.tier::text
          END,
          CASE rc.tier::text
            WHEN 'EE'        THEN 0
            WHEN 'EE_CHILD'  THEN 1
            WHEN 'EE_SPOUSE' THEN 2
            WHEN 'FAMILY'    THEN 3
            ELSE 99
          END
        FROM rate_cards rc
        WHERE rc.tier IS NOT NULL
          AND rc.plan_tier_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM plan_tiers pt WHERE pt.plan_id = rc.plan_id);

        -- Map rate_cards.plan_tier_id back from the old tier enum values.
        UPDATE rate_cards rc
        SET plan_tier_id = pt.id
        FROM plan_tiers pt
        WHERE pt.plan_id = rc.plan_id
          AND rc.plan_tier_id IS NULL
          AND rc.tier IS NOT NULL
          AND pt.label = CASE rc.tier::text
            WHEN 'EE'        THEN 'Employee Only'
            WHEN 'EE_CHILD'  THEN 'Employee + Child'
            WHEN 'EE_SPOUSE' THEN 'Employee + One'
            WHEN 'FAMILY'    THEN 'Employee + Family'
            ELSE rc.tier::text
          END;
      END $$;
    `);

    // Phase 3: client schema relaxation + new client fields + rate_cards rename.
    await pool.query(`
      DO $$ BEGIN
        -- Relax NOT NULL on client fields that are now optional.
        -- DROP NOT NULL is a no-op if the column is already nullable.
        ALTER TABLE clients ALTER COLUMN street_address    DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN city              DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN state             DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN zip_code          DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN industry_type     DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN number_of_employees DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN decision_maker_name  DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN decision_maker_title DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN decision_maker_phone DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN decision_maker_email DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN admin_contact_name   DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN admin_contact_title  DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN admin_contact_phone  DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN admin_contact_email  DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN banking_type         DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN funding_type         DROP NOT NULL;

        -- New client fields
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'anniversary_date') THEN
          ALTER TABLE clients ADD COLUMN anniversary_date TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'cobra_administered_by_90d') THEN
          ALTER TABLE clients ADD COLUMN cobra_administered_by_90d BOOLEAN NOT NULL DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'cobra_fee') THEN
          ALTER TABLE clients ADD COLUMN cobra_fee DECIMAL(10,2) DEFAULT 1.00;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'account_balance') THEN
          ALTER TABLE clients ADD COLUMN account_balance DECIMAL(14,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'account_balance_as_of_date') THEN
          ALTER TABLE clients ADD COLUMN account_balance_as_of_date TIMESTAMP;
        END IF;

        -- Rename spread_admin_fee → simple_fee on rate_cards
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'rate_cards' AND column_name = 'spread_admin_fee') THEN
          ALTER TABLE rate_cards RENAME COLUMN spread_admin_fee TO simple_fee;
        END IF;
      END $$;
    `);

    log("Startup migration: duplicate plans cleaned, unique constraint ensured");
  } catch (err: any) {
    console.error("Startup migration error:", err.message);
  }

  await registerRoutes(httpServer, app);
  await seedDatabase().catch((err) => console.error("Seed error:", err));

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  // Graceful shutdown: finish in-flight requests before exiting
  const shutdown = () => {
    log("Shutting down gracefully…", "server");
    httpServer.close(() => {
      log("All connections closed — exiting", "server");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
