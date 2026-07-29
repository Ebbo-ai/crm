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
      END $$;

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
