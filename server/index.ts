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
  // Idempotent startup migration: remove duplicate plans then enforce uniqueness
  try {
    const { pool } = await import("./db");
    await pool.query(`
      DELETE FROM plans
      WHERE id IN (
        SELECT MAX(id) FROM plans
        WHERE is_archived = false
        GROUP BY client_id, plan_name, plan_year
        HAVING COUNT(*) > 1
      );
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'plans_client_name_year_unique'
        ) THEN
          ALTER TABLE plans
            ADD CONSTRAINT plans_client_name_year_unique
            UNIQUE (client_id, plan_name, plan_year);
        END IF;

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

        -- funding_basis enum (affects how account balance is calculated)
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
