import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import {
  startRatingEngine,
  waitForRatingEngine,
  stopRatingEngine,
} from "./rating-engine";
import { scheduleDailyDigest } from "./digest";

const app = express();
const httpServer = createServer(app);

// Deployed behind Replit's proxy, which terminates TLS; without this, Express sees
// every request as plain HTTP and a "secure" session cookie would never be set.
app.set("trust proxy", 1);

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
  // Bring the report service up first so it boots in parallel with the startup
  // migrations below. This call cannot throw: if the engine will not start, the
  // CRM still comes up and only PDF/report generation is affected.
  startRatingEngine();

  // Startup migrations: add missing columns, tables, and enums.
  // The plans uniqueness constraint is declared in the Drizzle schema and applied
  // to production by the publish flow. Phase 12 below additionally migrates an
  // existing database from the older name-only key to the coverage-aware one,
  // because that swap has to happen in one statement and cannot be expressed as a
  // schema diff.
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

      -- NOTE: there was a back-fill here that set client_status = 'TERMINATED'
      -- wherever (is_active = false OR termination_date IS NOT NULL). It has been
      -- removed deliberately and must not come back.
      --
      -- Client lifecycle state is now derived from termination_date (see
      -- shared/client-state.ts). A date one to four months out means TERMINATING:
      -- the renewal stops but the client stays active and serviced. Because this
      -- statement re-ran on every boot, it would convert exactly that case into a
      -- flatly terminated client at the next restart, which is the opposite of
      -- what the date now means. Legacy dateless terminations are handled in the
      -- derivation instead, so nothing needs back-filling here.
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
        -- Emits the house standard labels (see Phase 11). EE_SPOUSE becomes EE+1, not
        -- EE+SP: the enum name was inaccurate, it covered a spouse OR a child.
        INSERT INTO plan_tiers (plan_id, label, display_order)
        SELECT DISTINCT
          rc.plan_id,
          CASE rc.tier::text
            WHEN 'EE'        THEN 'EE'
            WHEN 'EE_CHILD'  THEN 'EE+CH'
            WHEN 'EE_SPOUSE' THEN 'EE+1'
            WHEN 'FAMILY'    THEN 'EE+FAM'
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
            WHEN 'EE'        THEN 'EE'
            WHEN 'EE_CHILD'  THEN 'EE+CH'
            WHEN 'EE_SPOUSE' THEN 'EE+1'
            WHEN 'FAMILY'    THEN 'EE+FAM'
            ELSE rc.tier::text
          END;
      END $$;
    `);

    // Phase 9 intentionally removed. It added renewal_pipeline_step to clients and
    // accepted_rates / accepted_rates_engine_version to plans. Phase 10 relocated all
    // three onto the renewals / renewal_plan_options tables and drops them. Because
    // these migrations re-run on every boot, leaving the ADDs here would mean Phase 10
    // drops the columns and Phase 9 immediately recreates them, forever.

    // Phase 8: Renewal lead time on clients.
    // The other Phase 8 columns (proposal_sent_date, proposal_version,
    // acceptance_received_date on clients; renewal_option_accepted on plans) were
    // relocated to the renewals tables by Phase 10 and deliberately removed here —
    // same re-add-on-every-boot reason as Phase 9. renewal_lead_months stays because
    // it describes the client, not a single year's renewal.
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'clients' AND column_name = 'renewal_lead_months') THEN
          ALTER TABLE clients ADD COLUMN renewal_lead_months INTEGER NOT NULL DEFAULT 3;
        END IF;
      END $$;
    `);

    // Phase 7: Fixed-monthly fee component breakdown (90DB / Simple / Network).
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'flat_90db_fee') THEN
          ALTER TABLE plans ADD COLUMN flat_90db_fee NUMERIC(10,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'flat_simple_fee') THEN
          ALTER TABLE plans ADD COLUMN flat_simple_fee NUMERIC(10,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'flat_network_fee') THEN
          ALTER TABLE plans ADD COLUMN flat_network_fee NUMERIC(10,2);
        END IF;
      END $$;
    `);

    // Phase 6: Assignment of Benefits flag + plan design notes field.
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'assignment_of_benefits') THEN
          ALTER TABLE plans ADD COLUMN assignment_of_benefits BOOLEAN NOT NULL DEFAULT TRUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'plan_notes') THEN
          ALTER TABLE plans ADD COLUMN plan_notes TEXT;
        END IF;
      END $$;
    `);

    // Phase 5: Fixed Monthly flat fee on plans + drop retired total_fee column.
    await pool.query(`
      DO $$ BEGIN
        -- plans: flat_monthly_fee (Fixed Monthly plans only; null for PEPM plans)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'plans' AND column_name = 'flat_monthly_fee') THEN
          ALTER TABLE plans ADD COLUMN flat_monthly_fee DECIMAL(10,2);
        END IF;

        -- rate_cards: drop total_fee permanently — nothing reads it; monthlyPremium is canonical
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'rate_cards' AND column_name = 'total_fee') THEN
          ALTER TABLE rate_cards DROP COLUMN total_fee;
        END IF;
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

    // ── Phase 11: House standard tier labels ──────────────────────────────────
    // Sits before Phase 10 in the file despite the higher number, because Phase 10
    // must stay last. Order still matters: this has to run after Phase 4, which is
    // what creates plan_tiers rows from the retired rate_cards tier enum.
    //
    // Labels were free text, so the same tier was written differently by different
    // people and plans became hard to compare across years. Everything that clearly
    // corresponds to one of the five standard labels is normalised. Anything else is
    // left exactly as it is rather than forced into the nearest match, because real
    // pricing structures exist that the standard set cannot express, for example a
    // family tier split by dependent count.
    //
    // Re-runs every boot and is a no-op once labels are already standard.
    await pool.query(`
      WITH standard(norm, label) AS (VALUES
        ('ee','EE'), ('eeonly','EE'), ('employee','EE'), ('employeeonly','EE'),

        ('eesp','EE+SP'), ('ees','EE+SP'), ('eespouse','EE+SP'),
        ('employeespouse','EE+SP'), ('employeeplusspouse','EE+SP'),

        ('eech','EE+CH'), ('eec','EE+CH'), ('eechild','EE+CH'), ('eechildren','EE+CH'),
        ('employeechild','EE+CH'), ('employeechildren','EE+CH'),
        ('employeepluschild','EE+CH'), ('employeepluschildren','EE+CH'),

        ('ee1','EE+1'), ('eeone','EE+1'), ('employee1','EE+1'),
        ('employeeone','EE+1'), ('employeeplusone','EE+1'),

        ('eefam','EE+FAM'), ('eef','EE+FAM'), ('eefm','EE+FAM'), ('eefamily','EE+FAM'),
        ('family','EE+FAM'), ('employeefamily','EE+FAM'), ('employeeplusfamily','EE+FAM')
      )
      UPDATE plan_tiers pt
      SET label = s.label
      FROM standard s
      WHERE lower(regexp_replace(pt.label, '[^A-Za-z0-9]', '', 'g')) = s.norm
        AND pt.label <> s.label
        -- Never let normalising collapse two tiers on one plan into the same label.
        -- Skip if a sibling already holds the target label, or if a sibling maps to
        -- the same target and got there first.
        AND NOT EXISTS (
          SELECT 1 FROM plan_tiers other
          WHERE other.plan_id = pt.plan_id
            AND other.id <> pt.id
            AND (
              other.label = s.label
              OR (lower(regexp_replace(other.label, '[^A-Za-z0-9]', '', 'g')) = s.norm
                  AND other.id < pt.id)
            )
        );
    `);

    // ── Phase 12: Coverage-aware plan uniqueness ──────────────────────────────
    // Sits before Phase 10 in the file because Phase 10 must stay last. Must run
    // after Phase 2c, which is what adds the coverage_type column.
    //
    // Swaps the old (client, name, year) key for (client, coverage, name, year).
    // The old key treated the plan name as though it fully identified a plan, which
    // blocked legitimate real plans: a client can offer a combined dental and vision
    // "Standard" plus a vision only "Standard", or run Standard and Premium on dental
    // and again on vision.
    //
    // NULLS NOT DISTINCT is required, not cosmetic. Coverage is nullable and is still
    // being backfilled, and Postgres counts NULLs as distinct by default, so a plain
    // unique key would stop protecting every row with no coverage recorded. This keeps
    // the previous protection exactly intact for those rows.
    //
    // Guarded on the constraint name so it is a no-op on later boots.
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'plans_client_coverage_name_year_unique'
        ) THEN
          ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_client_name_year_unique;
          DROP INDEX IF EXISTS plans_client_name_year_unique;
          ALTER TABLE plans ADD CONSTRAINT plans_client_coverage_name_year_unique
            UNIQUE NULLS NOT DISTINCT (client_id, coverage_type, plan_name, plan_year);
        END IF;
      END $$;
    `);

    // ── Phase 13: Plan surplus/deficit + partial-data tolerance ───────────────
    // Sits before Phase 10 in the file because Phase 10 must stay last.
    //
    // surplus_deficit is the plan's financial position and is deliberately separate
    // from clients.account_balance, which is what the bank account actually holds.
    // Neither can be derived from the other: employers fund at their own discretion,
    // and administrative fees are drawn from the same account. Keeping both, each with
    // its own as-of date, is what lets the two be compared instead of conflated.
    await pool.query(`
      ALTER TABLE plans
        ADD COLUMN IF NOT EXISTS surplus_deficit NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS surplus_deficit_as_of_date TIMESTAMP;
    `);

    // Partial data is a valid state, not a defect. Records arrive from the plan
    // performance reports with genuine gaps: a client whose coverage is still being
    // confirmed with the administrator, or a tier that exists but whose rate has never
    // been published. Those records must be storable as-is so a later corrected import
    // fills them in. The alternative — refusing the row, or defaulting the number to
    // zero — either loses the client or invents a figure that reads as fact.
    await pool.query(`ALTER TABLE clients ALTER COLUMN plan_type DROP NOT NULL;`);
    // Orthodontia wording such as "Included in the $2,000 maximum" describes a benefit
    // without saying who is eligible. NONE would assert the plan has no orthodontia at
    // all, which is a stronger claim than the source makes, so the column has to be
    // able to hold nothing.
    await pool.query(`ALTER TABLE plans ALTER COLUMN ortho_eligibility DROP NOT NULL;`);
    // Likewise plan_basis: it is derived from the coinsurance wording, so a plan whose
    // coinsurance has not been supplied genuinely has no basis yet.
    await pool.query(`ALTER TABLE plans ALTER COLUMN plan_basis DROP NOT NULL;`);
    // The third coinsurance band had a percentage column but no limit column, so
    // "50% of the next $3,180" was stored as a bare 50% and read as unbounded.
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS dollar_tier3_limit NUMERIC(10,2);`);
    await pool.query(`
      ALTER TABLE rate_cards
        ALTER COLUMN base_admin_fee  DROP NOT NULL,
        ALTER COLUMN cobra_fee       DROP NOT NULL,
        ALTER COLUMN simple_fee      DROP NOT NULL,
        ALTER COLUMN total_admin_fee DROP NOT NULL,
        ALTER COLUMN expected_claims DROP NOT NULL,
        ALTER COLUMN monthly_premium DROP NOT NULL;
    `);

    // ── Phase 14: Plan-level termination date ─────────────────────────────────
    // Sits before Phase 10 in the file because Phase 10 must stay last.
    //
    // Nullable, empty by default. No date means active; a date means terminated as
    // of that date. Deliberately one column rather than a date plus a boolean, so a
    // status and a date can never disagree. Distinct from is_archived, which means
    // "superseded by a newer plan year" — a plan can be terminated mid-year while
    // still being the current record for that year. Terminating a plan never
    // touches the client record.
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS termination_date TIMESTAMP;`);

    // ── Phase 16: Communication triage state ──────────────────────────────────
    // Sits before Phase 10 in the file because Phase 10 must stay last.
    //
    // Two rules from the service desk are encoded here:
    //
    //   1. Nothing is deletable, only resolvable. There is no DELETE anywhere in
    //      this feature. A communication or task leaves the working views by
    //      moving to a terminal status, never by disappearing.
    //   2. A resolution carries a mandatory note. The column is nullable at the
    //      database level only because rows predating this phase have no note to
    //      backfill; every new resolution is validated before it is written.
    //
    // Existing communications all begin ACTIVE. That is the honest starting
    // state: nothing in the mailbox has been triaged yet, so nothing should
    // start out looking as if it had been.
    await pool.query(`
      ALTER TABLE communications
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS resolution_type TEXT,
        ADD COLUMN IF NOT EXISTS resolution_note TEXT,
        ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS resolved_by TEXT,
        ADD COLUMN IF NOT EXISTS is_follow_up BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS follow_up_reason TEXT;
    `);

    await pool.query(`
      ALTER TABLE communication_tasks
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN',
        ADD COLUMN IF NOT EXISTS priority TEXT,
        ADD COLUMN IF NOT EXISTS todo_added_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS resolution_note TEXT,
        ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS resolved_by TEXT,
        ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'AI',
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
    `);

    // Tasks ticked off under the old checkbox have no note and never will, but
    // their status must still agree with is_completed or they would reappear as
    // open work. The two columns are written in lockstep from here on; this
    // statement only repairs rows that predate the status column.
    await pool.query(`
      UPDATE communication_tasks SET status = 'RESOLVED'
       WHERE is_completed = true AND status = 'OPEN';
    `);

    // The feed reads every unresolved message on every load, and the to-do list
    // reads by status and priority. Both deserve an index rather than a scan.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS communications_status_received_idx
        ON communications (status, received_at DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS communication_tasks_status_idx
        ON communication_tasks (status, priority, sort_order);
    `);

    // ── Phase 17: To-dos that did not arrive as email ─────────────────────────
    // Sits before Phase 10 in the file because Phase 10 must stay last.
    //
    // Two structural limits are lifted here.
    //
    //   1. A task no longer needs an email behind it. Service work happens on
    //      the phone and in conversation, and none of it could be recorded
    //      while communication_id was NOT NULL.
    //
    //   2. A task can be about more than one client, through task_clients.
    //      Until now the email path faked that by writing one duplicate row per
    //      matched client, which meant the same job had to be resolved twice
    //      and the same note typed twice. One row, many clients, one resolution.
    //
    // No rows in task_clients means the to-do belongs to the business rather
    // than to an account. That is a legitimate outcome, not a failed match.
    await pool.query(`ALTER TABLE communication_tasks ALTER COLUMN communication_id DROP NOT NULL;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_clients (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES communication_tasks(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        match_confidence TEXT NOT NULL DEFAULT 'manual'
      );
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS task_clients_task_client_idx
        ON task_clients (task_id, client_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS task_clients_client_idx ON task_clients (client_id);
    `);

    // Every task that predates the join table carries its single client across,
    // so the client record keeps showing the same work it showed yesterday.
    await pool.query(`
      INSERT INTO task_clients (task_id, client_id, match_confidence)
      SELECT t.id, t.client_id, 'migrated'
        FROM communication_tasks t
       WHERE t.client_id IS NOT NULL
      ON CONFLICT (task_id, client_id) DO NOTHING;
    `);

    // Collapse the duplicates the old email path left behind, so history obeys
    // the same rule as new work: one job, one task, resolved once.
    //
    // A group is only touched when it is safe to touch: same message, identical
    // wording, every row still unresolved and not one of them carrying a note.
    // The rows being removed are machine-written copies of each other, so
    // nothing a person typed is lost. Any group where somebody has already
    // resolved a copy, or written a note on one, is left exactly as it is:
    // those notes are permanent and merging them would mean choosing which
    // account's account of events survives.
    //
    // The survivor is the row that has already been prioritised onto the to-do
    // list if there is one, otherwise the oldest, and it inherits every
    // client the group covered.
    const duplicateGroups = `
      SELECT communication_id, description,
             (array_agg(id ORDER BY (status = 'TODO') DESC, id))[1] AS keep_id,
             array_agg(id) AS all_ids
        FROM communication_tasks
       WHERE communication_id IS NOT NULL
       GROUP BY communication_id, description
      HAVING count(*) > 1
         AND bool_and(status IN ('OPEN', 'TODO'))
         AND bool_and(resolution_note IS NULL)
    `;
    await pool.query(`
      WITH grp AS (${duplicateGroups})
      INSERT INTO task_clients (task_id, client_id, match_confidence)
      SELECT g.keep_id, tc.client_id, 'migrated'
        FROM grp g
        JOIN task_clients tc ON tc.task_id = ANY(g.all_ids)
      ON CONFLICT (task_id, client_id) DO NOTHING;
    `);
    const collapsed = await pool.query(`
      WITH grp AS (${duplicateGroups})
      DELETE FROM communication_tasks t
       USING grp g
       WHERE t.id = ANY(g.all_ids) AND t.id <> g.keep_id;
    `);
    if (collapsed.rowCount) {
      log(`Startup migration: collapsed ${collapsed.rowCount} duplicate task row(s) onto shared tasks`);
    }

    // ── Phase 18: Renewal completion timestamp ────────────────────────────────
    // Sits immediately before Phase 10 because Phase 10 must remain last. On a
    // fresh database Phase 10 creates the column below; on an existing database
    // this adds it and dates already-complete rows from their last update.
    await pool.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'renewals'
        ) THEN
          ALTER TABLE renewals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
          UPDATE renewals
             SET completed_at = updated_at
           WHERE pipeline_step = 'EMAILED_TO_90D'
             AND completed_at IS NULL;
        END IF;
      END $$;
    `);

    // ── Phase 19: Task ownership and dedup grouping ───────────────────────────
    // Every task now belongs to a person (defaults to Kim, the service rep)
    // instead of sitting in one shared unowned list, and tasks that are really
    // the same job extracted more than once can be grouped under one id.
    await pool.query(`
      ALTER TABLE communication_tasks ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT 'Kim Anderson';
      ALTER TABLE communication_tasks ADD COLUMN IF NOT EXISTS group_id TEXT;
    `);

    // ── Phase 20: Backfill dedup groups on existing open tasks ────────────────
    // Going forward, new tasks get checked against a client's open tasks by
    // Claude at creation time (see dedupAgainstOpenTasks in routes.ts). That
    // does nothing for the backlog that already existed before this shipped,
    // so this backfills the same-client/same-due-date clusters that already
    // exist today (the Ware County / City of St. Peter / Burkhart repeats).
    // Only touches rows with group_id IS NULL, so it is safe to re-run and
    // never overwrites a grouping decision made since.
    await pool.query(`
      WITH grp AS (
        SELECT tc.client_id, ct.due_date, array_agg(DISTINCT ct.id ORDER BY ct.id) AS ids
          FROM communication_tasks ct
          JOIN task_clients tc ON tc.task_id = ct.id
         WHERE ct.status IN ('OPEN', 'TODO')
           AND ct.group_id IS NULL
           AND ct.due_date IS NOT NULL
         GROUP BY tc.client_id, ct.due_date
        HAVING count(DISTINCT ct.id) > 1
      )
      UPDATE communication_tasks ct
         SET group_id = 'bf-' || g.client_id || '-' || to_char(g.due_date, 'YYYY-MM-DD')
        FROM grp g
       WHERE ct.id = ANY(g.ids);
    `);

    // ── Phase 21: Shared 90 Degree Benefits vendor contacts ───────────────────
    // One list, not a per-client copy — every client shows the same six
    // people. Seeded with names/roles only; email and phone start blank and
    // stay editable since that information isn't in the system anywhere yet.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendor_contacts (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `);
    const { rows: vendorCount } = await pool.query(`SELECT count(*)::int AS n FROM vendor_contacts`);
    if (vendorCount[0]?.n === 0) {
      await pool.query(`
        INSERT INTO vendor_contacts (name, role, sort_order) VALUES
          ('Allison', 'Client Service Manager', 1),
          ('Ruby', 'Accounting Manager', 2),
          ('Crystal', 'Reporting Manager', 3),
          ('Jenn', 'Marketing and New Client Setup', 4),
          ('Datha', 'General Client Service Rep', 5),
          ('Holly', 'Web/Tech', 6);
      `);
      log("Startup migration: seeded 90 Degree Benefits vendor contacts");
    }

    // ── Phase 22: Auto-filed document attachments ─────────────────────────────
    // Marks which communication_attachments rows have already been promoted
    // to a client document, so the auto-file step (server/routes.ts) never
    // creates a duplicate for the same attachment on reprocessing.
    await pool.query(`
      ALTER TABLE communication_attachments ADD COLUMN IF NOT EXISTS filed_as_document_id INTEGER;
    `);

    // ── Phase 23: Gmail attachment ingestion + reviewed field extraction ──────
    // storageBackend distinguishes attachments already on local disk (pre-
    // migration) from anything filed through Object Storage (everything new,
    // including Gmail imports). gmailMessageId/gmailAttachmentId/gmailMailbox
    // let a re-run recognize an attachment it already pulled instead of
    // re-downloading and re-billing Claude for it.
    await pool.query(`
      ALTER TABLE communication_attachments ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE communication_attachments ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
      ALTER TABLE communication_attachments ADD COLUMN IF NOT EXISTS gmail_attachment_id TEXT;
      ALTER TABLE communication_attachments ADD COLUMN IF NOT EXISTS gmail_mailbox TEXT;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS communication_attachments_gmail_unique
        ON communication_attachments (gmail_message_id, gmail_attachment_id)
        WHERE gmail_message_id IS NOT NULL;
    `);

    // extractedText/ocrUsed on documents keep the raw source text so Claude
    // field-extraction can be re-run (after a prompt fix, or on failure)
    // without re-fetching the file from Gmail or re-running OCR.
    await pool.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_used BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_gmail_message_id TEXT;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash TEXT;
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS documents_content_hash_idx ON documents (client_id, content_hash) WHERE content_hash IS NOT NULL;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gmail_import_state (
        id SERIAL PRIMARY KEY,
        mailbox TEXT NOT NULL UNIQUE,
        backfill_start_date TIMESTAMP,
        last_processed_internal_date TEXT,
        last_run_at TIMESTAMP,
        last_run_summary TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Every extracted field sits here pending Kim/Steve's review — nothing
    // in document_field_proposals is ever applied to a client/plan/renewal
    // record automatically. See documentFieldProposals in shared/schema.ts.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_field_proposals (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        field_key TEXT NOT NULL,
        field_label TEXT NOT NULL,
        proposed_value TEXT NOT NULL,
        source_location TEXT,
        target_table TEXT NOT NULL,
        target_id INTEGER,
        target_field TEXT NOT NULL,
        current_value TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        reviewed_by TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS document_field_proposals_client_idx ON document_field_proposals (client_id);
      CREATE INDEX IF NOT EXISTS document_field_proposals_status_idx ON document_field_proposals (status);
    `);
    log("Startup migration: Gmail attachment ingestion + field-proposal review tables ready");

    // ── Phase 10: Renewals as year-specific records ───────────────────────────
    // MUST RUN LAST. This phase drops columns that earlier phases used to add.
    // Those ADDs have been removed from Phases 8 and 9, but keeping the drops at
    // the end of the chain means a future re-added column can never survive a
    // boot by being recreated after the drop.
    //
    // Renewal lifecycle data moves off clients/plans onto per-year records so
    // history survives across plan years instead of being overwritten annually.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS renewals (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        plan_year INTEGER NOT NULL,
        pipeline_step TEXT,
        proposal_sent_date TIMESTAMP,
        proposal_version TEXT,
        acceptance_received_date TIMESTAMP,
        incomplete_prior_flag BOOLEAN NOT NULL DEFAULT false,
        completed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // One renewal per client per plan year, enforced by the database.
    // Auto-creation fires on GET requests, so two concurrent page loads for the
    // same client would otherwise both pass the application-level existence check
    // and insert duplicates. The insert uses ON CONFLICT DO NOTHING against this.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS renewals_client_plan_year_unique
        ON renewals (client_id, plan_year);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS renewal_plan_options (
        id SERIAL PRIMARY KEY,
        renewal_id INTEGER NOT NULL REFERENCES renewals(id) ON DELETE CASCADE,
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        accepted_option TEXT,
        accepted_rates JSONB,
        rating_engine_version TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS renewal_plan_options_renewal_plan_unique
        ON renewal_plan_options (renewal_id, plan_id);
    `);

    // ── Phase 15: Broker contacts as their own rows ───────────────────────────
    //
    // A brokerage assigns a lead plus a service rep to an account, sometimes a third.
    // The four flat columns on clients hold exactly one person, so a second could only
    // be recorded by overwriting the first. Contacts are keyed to the client rather
    // than to a firm: the same firm serves different clients through different people.
    //
    // The flat columns stay, mirrored from whichever row is primary, so every existing
    // reader keeps working.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS broker_contacts (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        contact_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        role TEXT,
        notes TEXT,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        effective_date TIMESTAMP,
        termination_date TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Free-text notes on a contact. Separate ALTER because the table above is only
    // created once: installs that already ran Phase 15 would never see the column.
    await pool.query(`
      ALTER TABLE broker_contacts ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // Business key for the workbook import: one row per named person per client.
    // Re-running a corrections file must update that person, never add a second copy.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS broker_contacts_client_name_unique
        ON broker_contacts (client_id, lower(contact_name));
    `);

    // At most one serving primary per client. Enforced in the database because the
    // flat mirror on clients reads from it — two primaries would make the mirrored
    // value depend on row order.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS broker_contacts_one_primary_per_client
        ON broker_contacts (client_id)
        WHERE is_primary AND termination_date IS NULL;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS broker_contacts_client_idx ON broker_contacts (client_id);
    `);

    // Seed from the flat columns so the table is populated on first boot rather than
    // sitting empty the way broker_history did. Only for clients that have no rows
    // yet, so this cannot overwrite contacts entered later — it re-runs every boot.
    // COALESCE to the email: a client holding an address but no name would otherwise
    // be dropped from the contact list while still showing in the flat mirror.
    await pool.query(`
      INSERT INTO broker_contacts (client_id, contact_name, email, phone, is_primary, effective_date)
      SELECT c.id,
             COALESCE(NULLIF(TRIM(c.broker_contact_name), ''), TRIM(c.broker_email)),
             NULLIF(TRIM(c.broker_email), ''),
             NULLIF(TRIM(c.broker_phone), ''),
             true,
             c.created_at
      FROM clients c
      WHERE c.has_broker
        AND COALESCE(NULLIF(TRIM(c.broker_contact_name), ''), NULLIF(TRIM(c.broker_email), '')) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM broker_contacts bc WHERE bc.client_id = c.id)
      ON CONFLICT DO NOTHING;
    `);

    await pool.query(`
      DO $$ BEGIN
        -- Documents can attach to a specific renewal year (proposal, signed form,
        -- 90 Degree notification) rather than just to the client.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'documents' AND column_name = 'renewal_id') THEN
          ALTER TABLE documents ADD COLUMN renewal_id INTEGER REFERENCES renewals(id) ON DELETE SET NULL;
        END IF;

        -- Drop the relocated columns. Each lived for one plan year and was
        -- overwritten on the next cycle; they now live on renewals /
        -- renewal_plan_options where each year keeps its own row.
        ALTER TABLE clients DROP COLUMN IF EXISTS proposal_sent_date;
        ALTER TABLE clients DROP COLUMN IF EXISTS proposal_version;
        ALTER TABLE clients DROP COLUMN IF EXISTS acceptance_received_date;
        ALTER TABLE clients DROP COLUMN IF EXISTS renewal_pipeline_step;
        ALTER TABLE plans   DROP COLUMN IF EXISTS renewal_option_accepted;
        ALTER TABLE plans   DROP COLUMN IF EXISTS accepted_rates;
        ALTER TABLE plans   DROP COLUMN IF EXISTS accepted_rates_engine_version;
      END $$;
    `);

    log("Startup migration: duplicate plans cleaned, unique constraint ensured");

    // ── Phase 16: Field-review confirm-to-record ──────────────────────────────
    // Confirming a field proposal now writes the value onto the real client/plan
    // record instead of only marking it reviewed. mapping_status/confidence/
    // is_plan_design_field classify every proposal so the queue can tell a
    // reviewer "no matching field on record" instead of quietly dropping it, and
    // field_change_history is the permanent, undoable audit trail of every write.
    await pool.query(`
      ALTER TABLE document_field_proposals ADD COLUMN IF NOT EXISTS mapping_status TEXT NOT NULL DEFAULT 'UNMAPPED';
      ALTER TABLE document_field_proposals ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'normal';
      ALTER TABLE document_field_proposals ADD COLUMN IF NOT EXISTS is_plan_design_field BOOLEAN NOT NULL DEFAULT false;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS field_change_history (
        id SERIAL PRIMARY KEY,
        proposal_id INTEGER NOT NULL REFERENCES document_field_proposals(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL,
        target_table TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        target_field TEXT NOT NULL,
        field_label TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        source_document_id INTEGER,
        source_document_name TEXT,
        confirmed_by TEXT NOT NULL,
        confirmed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        undone_by TEXT,
        undone_at TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS field_change_history_client_idx ON field_change_history (client_id);
    `);
    log("Startup migration: field-review confirm-to-record columns and history table ready");

    const { storage } = await import("./storage");
    const backfill = await storage.backfillFieldProposalMappings();
    if (backfill.total > 0) {
      log(`Startup migration: field-proposal mapping backfill — ${backfill.mapped} mapped, ${backfill.unmapped} unmapped of ${backfill.total} pending`);
    }

    // ── Phase 17: dedupe the review queue by plan-year, not by document ────────
    // The Gmail backfill filed every version of every renewal cycle (prior-year
    // letters, monthly PPRs, corrected proposals) as its own document, so the
    // same field on the same plan proposed several times looked like several
    // fields needing review. documents.effective_date — the plan year / report
    // period the file's content describes, not when Gmail delivered it — is
    // what lets the review queue keep only the newest proposal per field and
    // push the rest into "superseded" history instead of the review count.
    await pool.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS effective_date TIMESTAMP;
    `);
    const dateBackfill = await storage.backfillDocumentEffectiveDates();
    if (dateBackfill.total > 0) {
      log(`Startup migration: document effective-date backfill — ${dateBackfill.dated} dated, ${dateBackfill.undated} left undated of ${dateBackfill.total}`);
    }

    // ── Phase 18: Gmail inbox inside the CRM ───────────────────────────────────
    // Full mail (not just has:attachment), full body storage, thread grouping,
    // client match / unassigned / not-business classification, AI summaries,
    // and a private-visibility flag. Tables only — the sync itself is kicked
    // off below, after routes are registered, and then re-run on a timer.
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE gmail_thread_business AS ENUM ('MATCHED', 'UNASSIGNED', 'NOT_BUSINESS');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE TYPE gmail_message_direction AS ENUM ('SENT', 'RECEIVED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gmail_threads (
        id SERIAL PRIMARY KEY,
        gmail_thread_id TEXT NOT NULL UNIQUE,
        mailbox TEXT NOT NULL,
        subject TEXT,
        latest_message_at TIMESTAMP NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        business_status gmail_thread_business NOT NULL DEFAULT 'UNASSIGNED',
        summary TEXT,
        summary_one_line TEXT,
        summary_generated_at TIMESTAMP,
        summary_for_message_count INTEGER,
        is_private BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS gmail_threads_latest_idx ON gmail_threads (latest_message_at DESC);
      CREATE TABLE IF NOT EXISTS gmail_thread_clients (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES gmail_threads(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL,
        match_confidence TEXT NOT NULL DEFAULT 'medium'
      );
      CREATE INDEX IF NOT EXISTS gmail_thread_clients_client_idx ON gmail_thread_clients (client_id);
      CREATE TABLE IF NOT EXISTS gmail_messages (
        id SERIAL PRIMARY KEY,
        gmail_message_id TEXT NOT NULL UNIQUE,
        thread_id INTEGER NOT NULL REFERENCES gmail_threads(id) ON DELETE CASCADE,
        mailbox TEXT NOT NULL,
        from_email TEXT NOT NULL,
        from_name TEXT,
        to_emails JSONB NOT NULL DEFAULT '[]',
        cc_emails JSONB NOT NULL DEFAULT '[]',
        subject TEXT,
        body_text TEXT,
        body_html_safe TEXT,
        snippet TEXT,
        sent_at TIMESTAMP NOT NULL,
        direction gmail_message_direction NOT NULL,
        has_attachments BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS gmail_messages_thread_idx ON gmail_messages (thread_id);
      CREATE INDEX IF NOT EXISTS gmail_messages_from_idx ON gmail_messages (from_email);
      CREATE TABLE IF NOT EXISTS gmail_attachments (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
        gmail_attachment_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        is_embedded_image BOOLEAN NOT NULL DEFAULT false,
        storage_path TEXT,
        filed_as_document_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS gmail_attachments_message_idx ON gmail_attachments (message_id);
    `);
    log("Startup migration: Gmail inbox tables ready");

    const imageCleanup = await storage.cleanupEmbeddedImageDocuments();
    if (imageCleanup.deleted > 0) {
      log(`Startup migration: removed ${imageCleanup.deleted} signature-logo/icon document(s) mistakenly filed by the original attachment backfill`);
    }

    // ── Phase 19: quoted-history trimming on Gmail messages ─────────────────
    await pool.query(`
      ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS body_text_new TEXT;
      ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS has_quoted_text BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS is_forward BOOLEAN NOT NULL DEFAULT false;
    `);
    const quoteBackfill = await storage.backfillGmailQuoteSplits();
    if (quoteBackfill > 0) {
      log(`Startup migration: computed quoted-text splits for ${quoteBackfill} previously-imported Gmail message(s)`);
    }
  } catch (err: any) {
    console.error("Startup migration error:", err.message);
  }

  await registerRoutes(httpServer, app);
  await seedDatabase().catch((err) => console.error("Seed error:", err));

  // Daily 7:30 AM America/New_York task digest — each owner gets their own
  // open/overdue items by email instead of the list only being visible if
  // someone opens the app.
  scheduleDailyDigest();

  // Gmail inbox: kick off an initial sync shortly after boot (never blocks
  // startup — a year of mail is many pages), then keep polling every 5
  // minutes so new mail shows up without a manual "sync now" click. True
  // Gmail push (Cloud Pub/Sub) needs a verified Google Cloud project and
  // domain ownership outside what the Replit connector grants, so polling is
  // the practical continuous-sync path here.
  const GMAIL_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  async function runGmailSyncSafely() {
    try {
      const { runGmailFullSync } = await import("./gmailFullSync");
      const summary = await runGmailFullSync();
      if (summary.messagesNew > 0 || summary.errors.length > 0) {
        log(`Gmail inbox sync: ${summary.messagesNew} new message(s), ${summary.threadsTouched} thread(s) touched, ${summary.errors.length} error(s)`);
      }
    } catch (err: any) {
      console.error("Gmail inbox sync error:", err?.message || err);
    }
  }
  setTimeout(runGmailSyncSafely, 10_000);
  setInterval(runGmailSyncSafely, GMAIL_SYNC_INTERVAL_MS);

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
      // Report-service readiness is polled only after the listener is open,
      // never before it. A renderer that is slow or dead must not delay the CRM
      // from accepting traffic or answering a deployment health check. Endpoints
      // that need the renderer return a clear 503 until it recovers.
      void waitForRatingEngine();
    },
  );

  // Graceful shutdown: finish in-flight requests before exiting
  const shutdown = () => {
    log("Shutting down gracefully…", "server");
    httpServer.close(async () => {
      // Wait for the report service to actually exit before this process does.
      // A child is not reaped automatically, so exiting first can leave an
      // orphaned Python holding port 5001 against the next instance.
      await stopRatingEngine();
      log("All connections closed — exiting", "server");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
