import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { errorLabel } from "./logRedaction";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Without a listener here, an 'error' event on the pool's underlying socket
 * (Postgres/Neon dropping an idle connection — "terminating connection due
 * to administrator command" is routine, not a bug) is unhandled and Node
 * rethrows it, crashing the whole process. That crash bypasses the graceful
 * shutdown path entirely (no SIGTERM, no awaited child exit), which is what
 * orphaned the rating-engine Flask child on port 5001 and destabilized its
 * restart timing in production. Logging and letting the pool recover the
 * connection on its own is correct here — pg.Pool already retries.
 */
pool.on("error", (err) => {
  console.error(`[db] pool error (connection dropped, recovering): ${errorLabel(err)}`);
});

export const db = drizzle(pool, { schema });
