/**
 * Client lifecycle state, derived from one date.
 *
 * A termination date does not end the relationship here. Simple keeps providing
 * services and producing PPRs right through the termination date and for a
 * run-out window after it, because run-out claims continue to be paid in that
 * window. What a termination date *does* mean, the moment it is known, is that
 * no renewal is needed.
 *
 * State is derived rather than stored so a status and a date can never
 * contradict each other. The one axis a date cannot express is PROSPECT, which
 * is why `clientStatus` still exists: it carries prospect-versus-client, not
 * active-versus-terminated.
 */

/**
 * Fixed for every client. Deliberately not configurable: with roughly 50 groups
 * and about five departures a year, per-client run-out windows buy nothing and
 * cost a settings screen, a migration and a per-client answer to "why is this
 * one different".
 */
export const RUN_OUT_MONTHS = 3;

export type ClientLifecycleState =
  | "PROSPECT"
  | "ACTIVE"
  | "TERMINATING"
  | "RUN_OUT"
  | "CLOSED";

export interface ClientStateInput {
  clientStatus?: string | null;
  isActive?: boolean | null;
  terminationDate?: Date | string | null;
}

/**
 * Months since year 0, so two dates can be compared at month granularity.
 *
 * Termination dates are always month-end, and the claims file only carries a
 * report month and year, so every comparison in this model is a month
 * comparison. Doing it on whole months also sidesteps the timezone trap: a
 * "2026-09-30" string parsed as a Date lands on UTC midnight and can read back
 * as the 29th in a negative-offset zone, which would silently move a client's
 * state by a month. Strings are therefore read as written and never parsed.
 */
export function toYearMonth(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const iso = /^(\d{4})-(\d{2})/.exec(value);
    if (iso) return Number(iso[1]) * 12 + (Number(iso[2]) - 1);
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.getFullYear() * 12 + parsed.getMonth();
  }
  return isNaN(value.getTime()) ? null : value.getFullYear() * 12 + value.getMonth();
}

/**
 * The last month in which run-out claims are still expected, as a year-month.
 */
export function runOutEndYearMonth(terminationDate: Date | string | null | undefined): number | null {
  const term = toYearMonth(terminationDate);
  return term === null ? null : term + RUN_OUT_MONTHS;
}

/**
 * The calendar date the run-out window closes: the last day of the last
 * run-out month. Returned for display, never used for comparisons.
 */
export function runOutEndDate(terminationDate: Date | string | null | undefined): Date | null {
  const endYm = runOutEndYearMonth(terminationDate);
  if (endYm === null) return null;
  // Day 0 of the following month is the last day of this one.
  return new Date(Math.floor(endYm / 12), (endYm % 12) + 1, 0);
}

export function deriveClientState(
  client: ClientStateInput | null | undefined,
  today: Date = new Date(),
): ClientLifecycleState {
  if (!client) return "CLOSED";

  // Prospects are not on the termination axis at all.
  if (client.clientStatus === "PROSPECT") return "PROSPECT";

  const termYm = toYearMonth(client.terminationDate);

  if (termYm === null) {
    // Legacy shape: clients terminated before this model existed carry no date,
    // only the flag. They all terminated well in the past, so they are CLOSED.
    // Not backfilled with an invented date; give one of them a real termination
    // date later and it starts deriving normally with no special case left.
    if (client.isActive === false || client.clientStatus === "TERMINATED") return "CLOSED";
    return "ACTIVE";
  }

  const todayYm = toYearMonth(today)!;

  // The termination month itself is still TERMINATING: coverage runs to the
  // last day of it.
  if (todayYm <= termYm) return "TERMINATING";
  if (todayYm <= termYm + RUN_OUT_MONTHS) return "RUN_OUT";
  return "CLOSED";
}

/**
 * Renewals stop the moment a departure is known, not when the date arrives.
 * That is the whole point of TERMINATING.
 */
export function suppressesRenewals(state: ClientLifecycleState): boolean {
  return state === "TERMINATING" || state === "RUN_OUT" || state === "CLOSED";
}

/** PPRs keep being produced right through run-out. Closed clients are archive-only. */
export function generatesPpr(state: ClientLifecycleState): boolean {
  return state !== "CLOSED";
}

/** Run-out claims are legitimate and expected. Only a closed client holds rows. */
export function importsClaims(state: ClientLifecycleState): boolean {
  return state !== "CLOSED";
}

/**
 * Whether the client belongs in the day-to-day active views. A terminating or
 * run-out client is still being serviced, so it stays fully visible and Kim
 * keeps working the account normally.
 */
export function countsAsActive(state: ClientLifecycleState): boolean {
  return state === "ACTIVE" || state === "TERMINATING" || state === "RUN_OUT";
}

export function clientStateLabel(state: ClientLifecycleState): string {
  switch (state) {
    case "PROSPECT": return "Prospect";
    case "ACTIVE": return "Active";
    case "TERMINATING": return "Terminating";
    case "RUN_OUT": return "Run-out";
    case "CLOSED": return "Terminated";
  }
}
