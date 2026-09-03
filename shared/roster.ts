/**
 * Client roster report — shared shape and the single place plan type is derived.
 *
 * Plan type mirrors the PPR coverage scheme in `rating_engine/ppr_coverage.py`,
 * which treats coverage as a funding-and-reporting fact rather than a clinical
 * one: separate dental and vision rates are TWO plans, while one rate and one
 * claims stream covering several lines is ONE bundled plan. That distinction is
 * the whole reason "Both" and "Combined" are different answers, so the roster
 * derives from `plans.coverage_type` and never from the legacy `clients.plan_type`
 * field, which is free-form legacy data and disagrees with the plans in places.
 */

/** A single plan whose one rate bundles more than one line of coverage. */
export const BUNDLED_COVERAGE_TYPES = ["DENTAL_VISION", "DENTAL_VISION_HEARING"] as const;
export const DENTAL_ONLY_COVERAGE = "DENTAL_ONLY";
export const VISION_ONLY_COVERAGE = "VISION_ONLY";

export type RosterPlanType = "Dental" | "Vision" | "Both" | "Combined";

/** Every plan type the roster can report, in the order the summary lists them. */
export const ROSTER_PLAN_TYPES: RosterPlanType[] = ["Dental", "Vision", "Both", "Combined"];

/**
 * Derive one client's plan type from the coverage types of the plans they carry.
 *
 * Returns null rather than a default when nothing can be derived. A client with
 * no plans is a real state and must show blank, because guessing "Dental" here
 * would silently misreport whichever client had lost its plans.
 */
export function derivePlanType(
  coverageTypes: ReadonlyArray<string | null | undefined>,
): RosterPlanType | null {
  const present = coverageTypes.filter((c): c is string => !!c);
  if (present.length === 0) return null;

  // A bundled plan is the defining fact: one rate covering several lines. It
  // outranks any separately-rated plan sitting alongside it, because the
  // combined rate is what makes the client's billing shape "Combined".
  if (present.some(c => (BUNDLED_COVERAGE_TYPES as readonly string[]).includes(c))) {
    return "Combined";
  }

  const hasDental = present.includes(DENTAL_ONLY_COVERAGE);
  const hasVision = present.includes(VISION_ONLY_COVERAGE);
  if (hasDental && hasVision) return "Both";
  if (hasDental) return "Dental";
  if (hasVision) return "Vision";
  return null;
}

/** One row of the roster. Every optional field is blank-when-unknown, never zeroed. */
export interface RosterRow {
  clientId: number;
  clientName: string;
  /** The group number, spelled exactly as stored. Padding is never rewritten. */
  groupNumber: string | null;
  city: string | null;
  state: string | null;
  numberOfEmployees: number | null;
  planType: RosterPlanType | null;
  /** Full date; the roster displays month and day, as the year is incidental. */
  anniversaryDate: string | null;
  brokerFirmName: string | null;
  brokerName: string | null;
  brokerEmail: string | null;
  brokerPhone: string | null;
  /** ACTIVE, TERMINATING or RUN_OUT. Anything else is excluded, not listed. */
  clientState: string;
}

/** A client left off the roster, always with the reason it was left off. */
export interface RosterExclusion {
  clientId: number;
  groupNumber: string | null;
  clientName: string;
  reason: string;
}

export interface RosterSummary {
  totalRows: number;
  blankCity: number;
  blankState: number;
  noBrokerOnFile: number;
  brokerMissingEmail: number;
  brokerMissingPhone: number;
  missingEmployeeCount: number;
  planTypeCounts: Record<string, number>;
  /** Group numbers of in-scope clients whose plan type could not be derived. */
  planTypeUnresolved: string[];
}

export interface ClientRosterResponse {
  generatedAt: string;
  rows: RosterRow[];
  excluded: RosterExclusion[];
  summary: RosterSummary;
}
