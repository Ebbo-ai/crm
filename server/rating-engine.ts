/**
 * Rating engine supervisor.
 *
 * The rating engine is a small Python/Flask service that renders every PDF the
 * CRM produces: renewal reports, renewal drafts, and performance reports. It
 * also parses uploaded PPR workbooks. It listens on loopback only and is never
 * exposed to the browser.
 *
 * In the workspace it runs as its own workflow. In production the deployment
 * runs a single Node process, so nothing was starting it and every PDF endpoint
 * failed with a refused connection. This module makes the Node server start and
 * supervise the engine itself, which keeps one copy per instance. That matters
 * on autoscale, where instances come and go and each one needs its own engine
 * reachable on its own loopback.
 *
 * Two rules shape the design:
 *
 *   1. A broken PDF renderer must never take the CRM down. Startup waits for
 *      the engine but never fails on it, and a permanently dead engine leaves
 *      the rest of the application serving normally.
 *   2. "Cannot reach the engine" and "the engine ran and returned an error" are
 *      different faults and must not be reported the same way. The first is a
 *      503 the user can retry, the second is a 502 describing a real failure.
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

// ── Where the engine lives ───────────────────────────────────────────────────

export const RATING_ENGINE_HOST = "127.0.0.1";
export const RATING_ENGINE_PORT = 5001;
export const RATING_ENGINE_BASE_URL = `http://${RATING_ENGINE_HOST}:${RATING_ENGINE_PORT}`;

/** Resolved against the working directory, which is the repo root in both environments. */
const ENGINE_SCRIPT = path.resolve(process.cwd(), "rating_engine", "main.py");

/**
 * Interpreters to try, in order. Bare `python` is first because that is exactly
 * what the workspace "Rating Engine" workflow runs, so development and
 * production execute the same interpreter against the same locked dependencies.
 */
const PYTHON_CANDIDATES = [
  process.env.RATING_ENGINE_PYTHON,
  "python",
  "python3",
].filter((c): c is string => Boolean(c));

// ── Supervision policy ───────────────────────────────────────────────────────

/** How many times a crashed engine is restarted before the supervisor gives up. */
export const MAX_RESTART_ATTEMPTS = 5;

/** Backoff between restarts: doubles each attempt, capped, so a service that cannot start does not spin. */
const RESTART_BACKOFF_BASE_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 30_000;

/** Running this long counts as healthy and clears the restart tally. */
const STABLE_UPTIME_MS = 60_000;

/** Boot health check: how long to wait for the first response, and how often to poll. */
// Kept well under the deployment health-check grace period: if the engine never
// answers, the CRM must still start listening promptly rather than fail to publish.
const BOOT_HEALTH_TIMEOUT_MS = 15_000;
const BOOT_HEALTH_POLL_MS = 500;
const HEALTH_REQUEST_TIMEOUT_MS = 2_000;

/** How long a stopping engine is given to exit before it is forced down. */
const SHUTDOWN_GRACE_MS = 5_000;

/** After SIGKILL, how long to wait for the kernel to reap it before giving up. */
const FORCE_KILL_GRACE_MS = 2_000;

/** Default per-request budget for a render call. */
export const RATING_ENGINE_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Shown to the user when the engine cannot be reached. Deliberately free of
 * ports, process names, and stack language: the person reading it is a broker
 * or an account manager, and the only useful action is to try again.
 */
export const RATING_ENGINE_UNAVAILABLE_MESSAGE =
  "The report service is temporarily unavailable, so this report could not be generated. Please try again in a few moments. If it keeps happening, contact support.";

// ── Logging ──────────────────────────────────────────────────────────────────

/**
 * Deliberately plain English. Someone scanning deployment logs who does not
 * write code should be able to tell whether reports are working.
 */
function engineLog(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [rating-engine] ${message}`);
}

/** Forward the engine's own stdout/stderr so its tracebacks reach the deployment logs. */
function forwardOutput(stream: NodeJS.ReadableStream | null, label: string) {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) console.log(`  [rating-engine ${label}] ${line}`);
    }
  });
}

// ── Supervisor state ─────────────────────────────────────────────────────────

let child: ChildProcess | null = null;
let restartCount = 0;
let candidateIndex = 0;
let shuttingDown = false;
let adopted = false;
let launching = false;
let abandoned = false;
let restartTimer: NodeJS.Timeout | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffFor(attempt: number): number {
  return Math.min(RESTART_BACKOFF_BASE_MS * 2 ** (attempt - 1), RESTART_BACKOFF_MAX_MS);
}

function abandon(reason: string) {
  abandoned = true;
  engineLog(
    `Giving up: ${reason} PDF and report generation will stay unavailable until the app is restarted. ` +
      `Everything else in the CRM continues to work normally.`,
  );
}

async function launch() {
  // The in-flight guard matters because launch() awaits a health probe: without
  // it a scheduled restart could overlap a launch that has not spawned yet.
  if (shuttingDown || abandoned || launching) return;
  launching = true;
  try {
    await launchInner();
  } finally {
    launching = false;
  }
}

async function launchInner() {
  // If a healthy engine is already listening, use it rather than fight for the
  // port. This is the survivor case: a previous Node process exited without
  // reaping its child, and spawning a second copy would only fail to bind and
  // burn the restart budget. Supervision is given up here, and logged, because
  // the surviving process is not ours to watch.
  if (await pingRatingEngine()) {
    if (!adopted) {
      adopted = true;
      engineLog(
        `A report service is already running on port ${RATING_ENGINE_PORT}, left over from a previous start. ` +
          `Using it instead of starting a second copy. Restart the app if reports misbehave.`,
      );
    }
    return;
  }

  // Shutdown can begin while the probe above is in flight. Spawning now would
  // create a child that stopRatingEngine has already stopped looking for, and
  // that nothing would ever stop.
  if (shuttingDown || abandoned) return;

  const bin = PYTHON_CANDIDATES[candidateIndex];
  const startedAt = Date.now();
  let settled = false; // 'error' and 'exit' can both fire; only react once

  engineLog(`Starting the report service on port ${RATING_ENGINE_PORT}.`);

  let proc: ChildProcess;
  try {
    proc = spawn(bin, ["-u", ENGINE_SCRIPT], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: any) {
    engineLog(`Could not launch "${bin}": ${err?.message ?? err}`);
    tryNextInterpreterOrRestart();
    return;
  }

  child = proc;
  forwardOutput(proc.stdout, "out");
  forwardOutput(proc.stderr, "log"); // Flask logs to stderr; it is not all errors

  proc.on("error", (err: any) => {
    if (settled) return;
    settled = true;
    if (err?.code === "ENOENT") {
      engineLog(`Interpreter "${bin}" was not found on this machine.`);
      tryNextInterpreterOrRestart();
      return;
    }
    engineLog(`The report service failed to start: ${err?.message ?? err}`);
    scheduleRestart();
  });

  proc.on("exit", (code, signal) => {
    if (settled) return;
    settled = true;
    child = null;

    if (shuttingDown) {
      engineLog("The report service stopped as part of shutdown.");
      return;
    }

    const ranFor = Date.now() - startedAt;
    const how = signal ? `signal ${signal}` : `exit code ${code}`;

    // A process that stayed up a good while and then died is a fresh incident,
    // not a continuation of a failing start, so the tally resets.
    if (ranFor >= STABLE_UPTIME_MS) {
      restartCount = 0;
      engineLog(`The report service stopped unexpectedly after running normally (${how}).`);
    } else {
      engineLog(`The report service stopped ${Math.round(ranFor / 1000)}s after starting (${how}).`);
    }

    scheduleRestart();
  });
}

/**
 * A missing interpreter is a configuration problem, not a crash, so it walks the
 * candidate list immediately instead of burning the restart budget on waiting.
 */
function tryNextInterpreterOrRestart() {
  child = null;
  if (candidateIndex < PYTHON_CANDIDATES.length - 1) {
    candidateIndex += 1;
    engineLog(`Trying interpreter "${PYTHON_CANDIDATES[candidateIndex]}" instead.`);
    launch();
    return;
  }
  abandon(`no working Python interpreter was found (tried ${PYTHON_CANDIDATES.join(", ")}).`);
}

function scheduleRestart() {
  if (shuttingDown || abandoned) return;

  restartCount += 1;
  if (restartCount > MAX_RESTART_ATTEMPTS) {
    abandon(`the report service failed ${MAX_RESTART_ATTEMPTS} restart attempts in a row.`);
    return;
  }

  const delay = backoffFor(restartCount);
  engineLog(
    `Restarting the report service in ${Math.round(delay / 1000)}s ` +
      `(attempt ${restartCount} of ${MAX_RESTART_ATTEMPTS}).`,
  );
  restartTimer = setTimeout(launch, delay);
  restartTimer.unref?.();
}

// ── Public control surface ───────────────────────────────────────────────────

/** Start the engine. Safe to call once at boot; never throws. */
export function startRatingEngine(): void {
  if (!fs.existsSync(ENGINE_SCRIPT)) {
    engineLog(
      `Cannot find the report service at ${ENGINE_SCRIPT}. ` +
        `PDF and report generation will be unavailable. Everything else in the CRM works normally.`,
    );
    abandoned = true;
    return;
  }
  // Last-ditch cleanup. Node does not kill child processes when it exits, so
  // without this an uncaught crash or a bare process.exit() strands Python.
  process.once("exit", () => {
    child?.kill("SIGKILL");
  });

  void launch();
}

/**
 * Stop supervising and shut the engine down, waiting for it to actually exit.
 *
 * Resolves once the child is gone or the grace period expires, whichever comes
 * first. Callers must await this before exiting: a child is not reaped when its
 * parent dies, so returning early can strand Python on port 5001.
 */
export async function stopRatingEngine(timeoutMs = SHUTDOWN_GRACE_MS): Promise<void> {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);

  const proc = child;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(graceTimer);
      resolve();
    };
    const graceTimer = setTimeout(() => {
      engineLog("The report service did not stop in time. Forcing it down.");
      proc.kill("SIGKILL");
      // SIGKILL cannot be caught, so 'exit' follows almost immediately. Keep
      // waiting for it rather than resolving straight away, so Node does not
      // exit before the child is actually reaped. The backstop keeps shutdown
      // bounded even if the process is wedged in uninterruptible sleep.
      setTimeout(finish, FORCE_KILL_GRACE_MS);
    }, timeoutMs);
    proc.once("exit", finish);
    proc.kill("SIGTERM");
  });
}

/** One health probe. Returns false rather than throwing. */
export async function pingRatingEngine(
  timeoutMs = HEALTH_REQUEST_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const res = await fetch(`${RATING_ENGINE_BASE_URL}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Poll until the engine answers or the deadline passes.
 *
 * Returns whether it came up. The caller must not treat false as fatal: the CRM
 * has to serve with or without a PDF renderer.
 */
export async function waitForRatingEngine(
  timeoutMs = BOOT_HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingRatingEngine()) {
      engineLog("Ready. PDF and report generation is available.");
      return true;
    }
    if (abandoned) break;
    await sleep(BOOT_HEALTH_POLL_MS);
  }
  engineLog(
    `Did not answer within ${Math.round(timeoutMs / 1000)}s. ` +
      `The CRM is starting anyway; PDF and report generation will be unavailable until the service recovers.`,
  );
  return false;
}

// ── Calling the engine ───────────────────────────────────────────────────────

/** The engine could not be reached at all: not running, or not answering in time. */
export class RatingEngineUnavailableError extends Error {
  readonly status = 503;
  readonly reason: unknown;
  constructor(reason?: unknown) {
    super(RATING_ENGINE_UNAVAILABLE_MESSAGE);
    this.name = "RatingEngineUnavailableError";
    this.reason = reason;
  }
}

/** The engine answered, and reported a failure. The message describes the real problem. */
export class RatingEngineFailedError extends Error {
  readonly status = 502;
  constructor(message: string) {
    super(message);
    this.name = "RatingEngineFailedError";
  }
}

export function isRatingEngineError(
  err: unknown,
): err is RatingEngineUnavailableError | RatingEngineFailedError {
  return (
    err instanceof RatingEngineUnavailableError || err instanceof RatingEngineFailedError
  );
}

/**
 * Reply with the right status for a rating-engine failure.
 * Returns false when the error came from somewhere else, so the caller can fall
 * through to its own handling.
 */
export function sendRatingEngineError(res: any, err: unknown): boolean {
  if (!isRatingEngineError(err)) return false;
  res.status(err.status).json({ message: err.message });
  return true;
}

/**
 * POST to the engine and return its parsed JSON.
 *
 * A refused connection or a timeout throws RatingEngineUnavailableError (503).
 * An HTTP error response throws RatingEngineFailedError (502) carrying the
 * engine's own error text. Previously the first case rejected before any
 * response existed, fell to an outer catch, and surfaced as a bare 500 reading
 * "fetch failed", which told the user nothing and looked like a broken CRM.
 */
export async function callRatingEngine<T = any>(
  endpoint: string,
  body: unknown,
  options: { timeoutMs?: number; failureMessage?: string } = {},
): Promise<T> {
  const {
    timeoutMs = RATING_ENGINE_REQUEST_TIMEOUT_MS,
    failureMessage = "Report generation failed",
  } = options;

  let res: Response;
  try {
    res = await fetch(`${RATING_ENGINE_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Connection refused, DNS, socket reset, or the abort timer firing.
    throw new RatingEngineUnavailableError(err);
  }

  let parsed: any;
  try {
    parsed = await res.json();
  } catch (err) {
    // Answered but not with JSON. If the status was already bad, report the
    // failure; otherwise the response is unusable and retrying is the best advice.
    if (!res.ok) throw new RatingEngineFailedError(failureMessage);
    throw new RatingEngineUnavailableError(err);
  }

  if (!res.ok) throw new RatingEngineFailedError(parsed?.error || failureMessage);
  return parsed as T;
}
