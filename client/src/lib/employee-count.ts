/**
 * Employee headcount — the single place that decides how a count is displayed.
 *
 * A missing headcount renders blank. Not a zero, not a dash, not a guess. A zero
 * is a claim, and for this field it is currently a false one: no client in the
 * book has a recorded count yet, so anything that coerced null to 0 was stating
 * that every group had no employees, and any total built from those was stating
 * a whole-book headcount of zero.
 *
 * A real recorded zero, should one ever exist, still renders "0" and stays
 * distinguishable from a missing value. That is the reason every check here is
 * an explicit null/undefined test rather than a falsy one.
 *
 * All three reports import from here so they cannot drift into disagreeing
 * about what an unknown headcount looks like.
 *
 * Enrollment is expected to come from uploaded PPRs later. When it does, the
 * source changes but this rendering contract should not.
 */

/** How a missing headcount renders, in every report. */
export const EMPLOYEE_COUNT_BLANK = "";

/** One client's headcount. Blank when unknown; "0" when genuinely zero. */
export function formatEmployeeCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPLOYEE_COUNT_BLANK;
  return value.toLocaleString();
}

export interface EmployeeCountTotal {
  /** Sum of the recorded counts, or null when nothing at all was recorded. */
  total: number | null;
  /** How many clients actually carried a count. */
  reporting: number;
  /** How many clients were in the group being totalled. */
  clientCount: number;
  /** True when the total is real but built from only some of the clients. */
  isPartial: boolean;
}

/**
 * Total a set of headcounts without treating a missing one as zero.
 *
 * Missing values are excluded from the sum rather than added as 0, and the
 * caller is told how many contributed so a partial figure can be labelled as
 * one instead of passing for a full-book number.
 */
export function sumEmployeeCounts(
  values: ReadonlyArray<number | null | undefined>,
): EmployeeCountTotal {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  return {
    total: present.length === 0 ? null : present.reduce((sum, n) => sum + n, 0),
    reporting: present.length,
    clientCount: values.length,
    isPartial: present.length > 0 && present.length < values.length,
  };
}

/** The bare total for a table cell. Blank when nothing was recorded. */
export function formatEmployeeTotal(t: EmployeeCountTotal): string {
  return t.total === null ? EMPLOYEE_COUNT_BLANK : t.total.toLocaleString();
}

/**
 * The headline summary. Says plainly that nothing is on file rather than
 * printing a zero, and marks a partial total as partial.
 */
export function employeeTotalSummary(t: EmployeeCountTotal): string {
  if (t.total === null) return "Employee counts not recorded";
  if (t.isPartial) {
    return `${t.total.toLocaleString()} Total Employees (${t.reporting} of ${t.clientCount} reporting)`;
  }
  return `${t.total.toLocaleString()} Total Employees`;
}

/** The totals-row label, carrying the partial caveat right beside the number. */
export function employeeTotalRowLabel(t: EmployeeCountTotal): string {
  if (t.total === null) return "TOTALS";
  if (t.isPartial) return `TOTALS (${t.reporting} of ${t.clientCount} reporting)`;
  return "TOTALS";
}
