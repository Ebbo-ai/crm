/**
 * Log redaction helpers.
 *
 * This app handles a TPA's client mail, which routinely carries protected
 * health information — member names, dates of birth, enrollment and claim
 * detail. None of that may reach the deployment log store, which is retained
 * outside the database and is not covered by the app's own access controls.
 *
 * The rule enforced here: logs carry identifiers, counts, durations and error
 * classes only. Never message bodies, snippets, subjects, header blocks,
 * sender/recipient addresses, attachment filenames or AI summary text.
 *
 * Error strings are the sneaky case — an upstream error can quote the payload
 * that caused it, so every logged error goes through `errorLabel` rather than
 * being interpolated raw.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Document filenames are PHI in this app — "Smith John enrollment.pdf" names a
 * member. Upstream errors quote them freely (a failed Object Storage upload
 * quotes the whole object key), so a filename-shaped token is redacted the same
 * way an address is. Extensions cover what actually arrives as mail
 * attachments here; the category, not the name, is what a log needs.
 */
const FILENAME_RE = /[^\s/\\]+\.(pdf|docx?|xlsx?|xlsm|csv|txt|pptx?|png|jpe?g|gif|zip|eml|msg|rtf|htm|html)\b/gi;
const MAX_ERROR_CHARS = 200;

/** Strips anything that looks like an address out of a string bound for the log. */
export function redactEmails(text: string): string {
  return text.replace(EMAIL_RE, "[email]");
}

/** Strips anything that looks like a document filename (which in this app can carry a member's name). */
export function redactFilenames(text: string): string {
  return text.replace(FILENAME_RE, "[file]");
}

/**
 * A stable, content-free bucket for an error, used both for the log line and
 * for the per-run "errors by class" tally. Classification is by shape of the
 * failure, never by the payload that triggered it.
 */
export function errorClass(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
  const text = raw.toLowerCase();

  if (/\btimed? ?out\b|etimedout|timeout/.test(text)) {
    if (/auth/.test(text)) return "AuthTimeout";
    return "Timeout";
  }
  if (/econnreset|econnrefused|enotfound|socket hang up|network/.test(text)) return "Network";
  if (/rate ?limit|\b429\b|quota/.test(text)) return "RateLimit";
  if (/unauthorized|invalid_grant|\b401\b|\b403\b|needs_reauth/.test(text)) return "Auth";
  if (/duplicate key|unique constraint|23505/.test(text)) return "DuplicateKey";
  if (/\b404\b|not found/.test(text)) return "NotFound";
  if (/\b5\d\d\b|internal error|backend error/.test(text)) return "UpstreamServerError";
  if (err instanceof Error && err.name && err.name !== "Error") return err.name;
  return "Other";
}

/**
 * The only approved way to put an error into a log line: class first so runs
 * can be tallied by failure shape, then a redacted and truncated message so a
 * novel failure is still diagnosable without leaking what it was processing.
 */
export function errorLabel(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const cleaned = redactFilenames(redactEmails(message)).replace(/\s+/g, " ").trim();
  const clipped = cleaned.length > MAX_ERROR_CHARS ? `${cleaned.slice(0, MAX_ERROR_CHARS)}…` : cleaned;
  return `${errorClass(err)}${clipped ? `: ${clipped}` : ""}`;
}

/**
 * Renders an error-class tally as `AuthTimeout=1, RateLimit=3`, or "none".
 * Used at the end of a sync run so a recurring upstream failure shows up as a
 * rate rather than as a one-off line buried in the stream.
 */
export function formatErrorClassTally(classes: string[]): string {
  if (classes.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const c of classes) counts.set(c, (counts.get(c) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
}
