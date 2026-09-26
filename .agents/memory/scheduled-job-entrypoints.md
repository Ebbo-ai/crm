---
name: Scheduled job entry points
description: How the overnight mail sync and morning digest run on this autoscale project, and the constraints on adding more scheduled work.
---

Recurring work that must happen whether or not a human is using the app cannot
live on a timer inside the web process: the web deployment is autoscale, so its
timers only fire while an instance happens to be awake. Overnight mail sat
unread until someone opened the app.

The pattern: a short-lived entry point per job under `server/jobs/`, bundled to
its own `dist/jobs/*.cjs` by a second esbuild target, run by a Replit scheduled
deployment. Database layer plus the one function — no Express, no rating engine,
no startup migration chain (the web deployment owns the schema).

**Why these rules hold:**
- An agent cannot create the scheduled deployments. Writing deployment config
  edits the single `[deployment]` section in `.replit`, which would clobber the
  autoscale web app. One project can hold both, but the scheduled ones are
  created by the user in the Publishing tool. Give exact run command, cron
  expression, timezone and job timeout instead of attempting it.
- Scheduled deployments do inherit the project's secrets and DATABASE_URL.
- Set the job's own in-process deadline below the platform job timeout and check
  it at safe boundaries (between pages, between threads), so the run banks its
  cursor and releases its claim instead of being killed mid-work.
- Exit non-zero when the core work failed. The deployment's run history is the
  only place a failure shows, and a job that catches everything reports a green
  tick over an inbox that was never read.
- Any job that duplicates an in-process cron needs a send-once marker in the
  database, not an assumption that only one scheduler is awake.
