---
name: Rating Engine Python service
description: Architecture, startup/supervision, and failure-reporting decisions for the internal Python PDF/rating service.
---

## Rule
The rating engine lives in `rating_engine/` as a Flask service on `127.0.0.1:5001`. It is internal-only, never exposed to the browser. The Node backend calls it over loopback HTTP.

**Why:** Keeps Python actuarial/PDF logic separate from the Node CRM, avoids a second deployment, shares the same Repl.

## Startup: Node owns the engine, there is no second workflow
Node spawns and supervises Flask as a child process at boot. There is deliberately **no** separate workflow, **no** second port in the deployment config, and **no** shell script launching two processes.

**Why:** The deployment runs a single run command (`node ./dist/index.cjs`). A workspace-only workflow meant nothing started Flask in production, so every PDF endpoint failed there while working fine in dev. Making Node the supervisor gives one engine per instance, which is what autoscale needs since each instance has its own loopback.

**How to apply:**
- Spawn the interpreter the same way dev does (bare `python` on PATH, repo root as cwd) so dev and prod resolve the same interpreter and the same locked dependencies.
- The engine already exposes `GET /health`; use it, do not add another.
- Restart on exit with capped exponential backoff and a single named retry cap. Reset the tally after a stable run, or a service that dies once a day slowly exhausts its budget.
- Forward the child's stdout/stderr into the app log, and write the supervisor's own lines in plain English. Whoever reads deployment logs to find out whether reports are working is not a developer.

## The health poll must never gate the HTTP listener
Poll for readiness **after** `listen()` is open, never before it.

**Why:** A renderer that is slow or permanently dead would otherwise delay or fail the deployment health check and take the whole CRM down with it, which is the exact opposite of the goal. Report endpoints already degrade correctly on their own.

## Shutdown must await the child
Node does not reap children when it exits. Send SIGTERM, await the child's `exit`, fall back to SIGKILL on a bounded grace, and await the exit after that too, all before `process.exit()`.

**Why:** Exiting first strands Python holding port 5001, and the next instance then burns its whole restart budget on address-in-use failures.

**How to apply:** Also re-check the shutdown flag after any `await` inside the spawn path. A launch that awaits a health probe can otherwise spawn a child after shutdown has already stopped looking for one. A healthy survivor already listening on 5001 is adopted rather than fought for the port. Note the residual limit: nothing in Node can guarantee cleanup when Node itself is SIGKILLed; that relies on the platform tearing down the process group.

## Unreachable and failed are different faults
Calls to the engine go through one shared helper that throws two distinct typed errors, and every handler reports them before its generic catch:
- **cannot reach it** (connection refused, timeout) is **503** with a plain retry message aimed at a broker or account manager.
- **it answered and reported a failure** is **502** carrying the engine's own error text.

**Why:** A refused connection rejects before any response exists, so the old code never reached its `!res.ok` branch and fell through to a bare 500 reading "fetch failed". That told the user nothing and looked like a broken CRM rather than a renderer that was down.

**How to apply:** Never add a raw `fetch` to port 5001 in a route. Route it through the shared helper so a new endpoint cannot reintroduce the bare 500.

## Other setup facts
- WeasyPrint system deps come from Nix: `pango cairo gdk-pixbuf harfbuzz fontconfig freetype gobject-introspection libffi`.
- **Python 3.12 is required**: `generate_renewal.py` uses backslashes inside nested f-strings, valid only in 3.12+.
- `generate_renewal.py` interface: `validate(cfg)`, `advisories(cfg)`, `build_html(cfg)`, `compute(plan)`, `load_config(path)`. Entry: `build_html(cfg)` produces HTML, WeasyPrint turns it into PDF bytes.
- `config_sample.py` holds a validated single-plan dental CONFIG that passes `validate()` and `advisories()` with no errors or warnings.
