/**
 * Splits a message body into "new text the sender actually wrote" vs.
 * quoted history, reply headers, and a trailing signature block.
 *
 * Deliberately conservative: if no boundary pattern is recognized, or the
 * text left after cutting is suspiciously empty, the whole message is
 * returned unmodified rather than risk hiding real content.
 *
 * Forwards are a special case — the forwarded content is the point of the
 * message, so a detected forward is never trimmed.
 */

export interface QuoteSplitResult {
  /** The sender's new text (or the full body, for forwards / low-confidence cases). */
  newText: string;
  /** True only when newText is a strict, non-trivial subset of the original body. */
  hasQuotedText: boolean;
  isForward: boolean;
}

const FORWARD_SUBJECT_RE = /^\s*(fwd|fw)\s*:/i;
const FORWARD_BODY_RE = /^-{2,}\s*forwarded message\s*-{2,}/im;
const BEGIN_FORWARDED_RE = /^begin forwarded message:\s*$/im;

// "On Mon, Jan 5, 2026 at 3:04 PM Alexis Rivera <alexis@firm.com> wrote:"
// Sometimes wraps onto a second line before "wrote:".
const ON_WROTE_RE = /^On[\s\S]{0,300}?wrote:[ \t]*$/im;

const ORIGINAL_MESSAGE_RE = /^-{2,}\s*Original Message\s*-{2,}/im;

// A run of two or more consecutive lines quoted with "> ".
const QUOTE_RUN_RE = /^(?:>.*\n){2,}/m;

// RFC 3676 signature delimiter — a line that is exactly "--" or "-- ".
const SIG_DELIM_RE = /^-- ?$/m;

function findOutlookHeaderBlockIndex(text: string): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^From:\s*\S/i.test(line)) {
      const window = lines.slice(i + 1, i + 6).join("\n");
      const hasSentOrDate = /^(Sent|Date):\s*\S/im.test(window);
      const hasTo = /^To:\s*\S/im.test(window);
      if (hasSentOrDate && hasTo) return offset;
    }
    offset += line.length + 1;
  }
  return -1;
}

function firstMatchIndex(text: string, re: RegExp): number {
  const m = text.match(re);
  return m && m.index !== undefined ? m.index : -1;
}

export function splitQuotedText(bodyText: string | null | undefined, subject: string | null | undefined): QuoteSplitResult {
  const text = (bodyText || "").replace(/\r\n/g, "\n");

  const isForward =
    FORWARD_SUBJECT_RE.test(subject || "") ||
    FORWARD_BODY_RE.test(text) ||
    BEGIN_FORWARDED_RE.test(text);

  if (isForward || !text.trim()) {
    return { newText: text, hasQuotedText: false, isForward };
  }

  const candidates = [
    firstMatchIndex(text, ON_WROTE_RE),
    firstMatchIndex(text, ORIGINAL_MESSAGE_RE),
    firstMatchIndex(text, QUOTE_RUN_RE),
    findOutlookHeaderBlockIndex(text),
  ].filter((i) => i >= 0);

  if (candidates.length === 0) {
    return { newText: text, hasQuotedText: false, isForward: false };
  }

  const boundary = Math.min(...candidates);
  let newText = text.slice(0, boundary).trimEnd();

  // Not confident the cut is real if it leaves nothing behind — safer to
  // show the whole message than risk hiding the sender's actual words.
  if (newText.trim().length < 1) {
    return { newText: text, hasQuotedText: false, isForward: false };
  }

  // Trim a trailing "-- \nName\nTitle..." signature block from the kept part.
  const sigMatch = newText.match(SIG_DELIM_RE);
  if (sigMatch && sigMatch.index !== undefined && sigMatch.index > 0) {
    const trimmed = newText.slice(0, sigMatch.index).trimEnd();
    if (trimmed.length > 0) newText = trimmed;
  }

  return { newText, hasQuotedText: newText.length < text.trim().length, isForward: false };
}
