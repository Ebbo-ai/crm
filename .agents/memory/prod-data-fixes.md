---
name: Production data fixes vs schema
description: How to get a one-time production data correction (not a schema change) applied, given executeSql's production environment is read-only.
---

`executeSql({ environment: "production" })` only allows SELECT — no INSERT/UPDATE/DELETE, even for plain data (not schema). This project's dev and production databases are genuinely separate (confirmed by querying both directly), so a row present in dev never automatically reaches production.

**Why:** Replit's Publish flow is the supported path for schema changes reaching production, and there's no equivalent one-off channel for arbitrary data writes — direct writes from the agent would bypass that flow and risk silently corrupting live data.

**How to apply:** for a data correction that must land in production (e.g. re-asserting rows a user already reviewed in dev, like an approved allow-list), add it as an idempotent seed in the app's own startup migration code path (`ON CONFLICT DO NOTHING` / equivalent upsert), the same pattern already used for other startup seeds in this codebase. It runs in dev immediately and reaches production on the user's next deploy — tell the user that explicitly, since it's not instantaneous like a direct DB write would be.
