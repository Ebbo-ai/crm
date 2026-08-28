/**
 * Shared state model for the communication triage workflow.
 *
 * Two rules drive everything in this file, and both come straight from how the
 * service desk actually works:
 *
 *  1. A resolution note is mandatory. Without it the app becomes a list of
 *     things that vanished, and nobody can answer "what happened to that?"
 *     six weeks later. The note is the audit trail.
 *
 *  2. Nothing is deletable, only resolvable. Every communication, task and
 *     to-do ends up in a terminal state with a note and a date attached.
 *
 * Both the server and the client import from here so the rules cannot drift
 * apart. The server is the enforcement point; the client uses the same helpers
 * so the UI refuses before the round trip.
 */

/** Hard cap on every resolution note in the system. */
export const RESOLUTION_NOTE_MAX = 500;

/**
 * How long "Read: no task needed" can be taken back.
 *
 * The row fades over about five seconds; the server allows a minute so a slow
 * click or a slow network still lands. Past that the resolution is history and
 * stays on the record.
 */
export const UNDO_WINDOW_MS = 60_000;

// ─── Communications ─────────────────────────────────────────────────────────

export const COMMUNICATION_STATUSES = ["ACTIVE", "RESOLVED"] as const;
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];

/**
 * How a communication left the feed.
 *
 * READ_NO_TASK is the "information only" path. It still writes a note and a
 * date, so even a message Kim waved through leaves a record, but she does not
 * have to type anything for mail that needs no work.
 *
 * RESOLVED is the worked path and always carries Kim's own words.
 */
export const RESOLUTION_TYPES = ["READ_NO_TASK", "RESOLVED"] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

/** The note written automatically when Kim uses "Read: no task needed". */
export const READ_NO_TASK_NOTE = "Read on the dashboard. No task needed.";

// ─── Tasks and to-dos ───────────────────────────────────────────────────────

export const TASK_STATUSES = ["OPEN", "TODO", "RESOLVED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["URGENT", "NORMAL", "CASUAL"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_ORIGINS = ["AI", "MANUAL"] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];

/**
 * Section order on the to-do list. Urgent first, then Normal, then Casual.
 * Within a section the oldest item sits at the top: something that has waited
 * longest is the most overdue.
 */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  URGENT: 0,
  NORMAL: 1,
  CASUAL: 2,
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  URGENT: "Urgent",
  NORMAL: "Normal",
  CASUAL: "Casual",
};

/**
 * Palette for the to-do sections and priority badges. Kept as raw hex to match
 * the rest of the app, which uses literal hex rather than Tailwind theme names.
 */
export const PRIORITY_STYLE: Record<TaskPriority, { text: string; bg: string; border: string }> = {
  URGENT: { text: "#EF4444", bg: "#FEF2F2", border: "#FECACA" },
  NORMAL: { text: "#1A5276", bg: "#F0F4F8", border: "#CBD5E1" },
  CASUAL: { text: "#94A3B8", bg: "#F8FAFC", border: "#E2E8F0" },
};

// ─── Guards ─────────────────────────────────────────────────────────────────

export function isCommunicationStatus(v: unknown): v is CommunicationStatus {
  return typeof v === "string" && (COMMUNICATION_STATUSES as readonly string[]).includes(v);
}

export function isResolutionType(v: unknown): v is ResolutionType {
  return typeof v === "string" && (RESOLUTION_TYPES as readonly string[]).includes(v);
}

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}

export function isTaskPriority(v: unknown): v is TaskPriority {
  return typeof v === "string" && (TASK_PRIORITIES as readonly string[]).includes(v);
}

// ─── Note validation ────────────────────────────────────────────────────────

export interface NoteCheck {
  ok: boolean;
  /** User-facing message. Null when the note is acceptable. */
  error: string | null;
  /** The note trimmed and ready to store. Only meaningful when ok is true. */
  value: string;
}

/**
 * The single definition of a valid resolution note.
 *
 * Whitespace does not count as an explanation, so a note of spaces is rejected
 * the same way an empty one is. This is deliberately strict: the note is the
 * only reason the resolved item is still worth anything later.
 */
export function checkResolutionNote(raw: unknown): NoteCheck {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return { ok: false, error: "Describe what was done. This note is the record of how it was handled.", value: "" };
  }
  if (value.length > RESOLUTION_NOTE_MAX) {
    return {
      ok: false,
      error: `Keep it to ${RESOLUTION_NOTE_MAX} characters or fewer (currently ${value.length}).`,
      value: "",
    };
  }
  return { ok: true, error: null, value };
}

// ─── Sorting ────────────────────────────────────────────────────────────────

export interface SortableTodo {
  priority: string | null;
  sortOrder: number;
  todoAddedAt: Date | string | null;
  createdAt: Date | string;
  id: number;
}

function timeOf(v: Date | string | null): number {
  if (!v) return 0;
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

/**
 * Orders the to-do list: Urgent, then Normal, then Casual; oldest first inside
 * each section; manual drag order wins over age once Kim has dragged something.
 *
 * `sortOrder` defaults to 0 for every task, so an untouched list falls back
 * cleanly to oldest-first. Reordering rewrites `sortOrder` across the section.
 */
export function compareTodos(a: SortableTodo, b: SortableTodo): number {
  const ra = isTaskPriority(a.priority) ? PRIORITY_RANK[a.priority] : PRIORITY_RANK.NORMAL;
  const rb = isTaskPriority(b.priority) ? PRIORITY_RANK[b.priority] : PRIORITY_RANK.NORMAL;
  if (ra !== rb) return ra - rb;

  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;

  const ta = timeOf(a.todoAddedAt) || timeOf(a.createdAt);
  const tb = timeOf(b.todoAddedAt) || timeOf(b.createdAt);
  if (ta !== tb) return ta - tb; // oldest first

  return a.id - b.id;
}
