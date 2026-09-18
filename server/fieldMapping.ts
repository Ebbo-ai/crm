/**
 * Maps a Claude-proposed field (fieldKey from documentFieldProposals) onto an
 * actual column on the client or plan record. Only fields listed here can ever
 * be written automatically — anything else stays UNMAPPED in the review queue
 * rather than being guessed at or dropped, because Claude's fieldKey naming is
 * freeform per document and most of it (per-tier rate cells, PPR facts like
 * loss ratio or claims totals, one-off notes) has no safe home on the record.
 *
 * isPlanDesign marks fields that describe the plan's actual benefit design
 * (deductible, coinsurance percents, annual max, ortho rules, plan basis). A
 * plan-design field proposed from a PPR_REPORT document is downgraded to
 * "low" confidence and excluded from bulk confirm, because the PPR's plan
 * design block is frequently stale — the plan document or a signed renewal is
 * the reliable source for what the plan actually is.
 */

export type MappingTarget = "clients" | "plans";

export interface FieldMappingEntry {
  table: MappingTarget;
  column: string;
  isPlanDesign: boolean;
  /** Validates + normalizes the raw proposed/edited text into a value safe to store. Returns null if invalid. */
  coerce: (raw: string) => string | number | boolean | null;
}

function asIs(raw: string): string | null {
  const v = raw.trim();
  return v.length > 0 ? v : null;
}

function asInt(raw: string): number | null {
  const m = raw.replace(/[,$]/g, "").match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

function asDecimalString(raw: string): string | null {
  const m = raw.replace(/[,$%]/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n.toFixed(4) : null;
}

function asDateISO(raw: string): string | null {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (["yes", "true", "y", "assigned", "provider paid"].includes(v)) return true;
  if (["no", "false", "n", "not assigned", "member pays"].includes(v)) return false;
  return null;
}

function enumMatcher(values: string[]) {
  return (raw: string): string | null => {
    const v = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
    return values.includes(v) ? v : null;
  };
}

export const FIELD_MAPPINGS: Record<string, FieldMappingEntry> = {
  // ── Client-level, administrative — never PPR-stale-sensitive ──────────────
  groupNumber: { table: "clients", column: "groupNumber", isPlanDesign: false, coerce: asIs },
  numberOfEmployees: { table: "clients", column: "numberOfEmployees", isPlanDesign: false, coerce: asInt },
  coveredEmployees: { table: "clients", column: "coveredEmployees", isPlanDesign: false, coerce: asInt },
  coveredLives: { table: "clients", column: "coveredEmployees", isPlanDesign: false, coerce: asInt },
  totalContracts: { table: "clients", column: "coveredEmployees", isPlanDesign: false, coerce: asInt },
  enrollmentTotalContracts: { table: "clients", column: "coveredEmployees", isPlanDesign: false, coerce: asInt },
  fundingBasis: {
    table: "clients", column: "fundingBasis", isPlanDesign: false,
    coerce: enumMatcher(["CLAIMS_ONLY", "CLAIMS_PLUS_ADMIN"]),
  },
  planType: {
    table: "clients", column: "planType", isPlanDesign: false,
    coerce: enumMatcher(["DENTAL", "VISION", "HEARING", "DENTAL_VISION", "HEARING_VISION", "DENTAL_HEARING_VISION"]),
  },
  accountBalance: { table: "clients", column: "accountBalance", isPlanDesign: false, coerce: asDecimalString },
  anniversaryDate: { table: "clients", column: "anniversaryDate", isPlanDesign: false, coerce: asDateISO },

  // ── Plan-level, administrative/financial (not "design") ────────────────────
  renewalEffectiveDate: { table: "plans", column: "effectiveDate", isPlanDesign: false, coerce: asDateISO },
  planYear: { table: "plans", column: "planYear", isPlanDesign: false, coerce: asInt },
  currentPlanYear: { table: "plans", column: "planYear", isPlanDesign: false, coerce: asInt },
  planYearStartDate: { table: "plans", column: "effectiveDate", isPlanDesign: false, coerce: asDateISO },
  planYearStart: { table: "plans", column: "effectiveDate", isPlanDesign: false, coerce: asDateISO },
  planName: { table: "plans", column: "planName", isPlanDesign: false, coerce: asIs },
  assignmentOfBenefits: { table: "plans", column: "assignmentOfBenefits", isPlanDesign: false, coerce: asBool },
  adminFeeRenewal: { table: "plans", column: "flatMonthlyFee", isPlanDesign: false, coerce: asDecimalString },

  // ── Plan-level design fields — low-confidence when sourced from a PPR ──────
  annualMaximum: { table: "plans", column: "annualLimit", isPlanDesign: true, coerce: asDecimalString },
  annualMaximumPerPerson: { table: "plans", column: "annualLimit", isPlanDesign: true, coerce: asDecimalString },
  deductible: { table: "plans", column: "deductible", isPlanDesign: true, coerce: asDecimalString },
  orthoLifetimeMax: { table: "plans", column: "orthoLifetimeMax", isPlanDesign: true, coerce: asDecimalString },
  orthoCoinsurancePercent: { table: "plans", column: "orthoCoinsurancePercent", isPlanDesign: true, coerce: asInt },
  preventivePercent: { table: "plans", column: "preventivePercent", isPlanDesign: true, coerce: asInt },
  correctivePercent: { table: "plans", column: "correctivePercent", isPlanDesign: true, coerce: asInt },
  restorativePercent: { table: "plans", column: "restorativePercent", isPlanDesign: true, coerce: asInt },
  orthoEligibility: {
    table: "plans", column: "orthoEligibility", isPlanDesign: true,
    coerce: enumMatcher(["NONE", "CHILDREN", "ALL"]),
  },
  coverageType: {
    table: "plans", column: "coverageType", isPlanDesign: true,
    coerce: enumMatcher(["DENTAL_ONLY", "VISION_ONLY", "DENTAL_VISION", "DENTAL_VISION_HEARING"]),
  },
};

export interface ResolvedMapping {
  mappingStatus: "MAPPED" | "UNMAPPED";
  confidence: "normal" | "low";
  isPlanDesignField: boolean;
  targetTable: string;
  targetId: number | null;
  targetField: string;
  /** The coerced value that would actually be written, or null if the raw text failed validation for this column type. */
  coercedValue: string | number | boolean | null;
}

/**
 * Resolves a proposal's fieldKey to a concrete column. Needs the document's
 * clientId and (when the field is plan-level) planId — a plan-level field on a
 * document with no planId cannot be safely pointed at one of several plans, so
 * it stays UNMAPPED even though the fieldKey itself is known.
 */
export function resolveFieldMapping(
  fieldKey: string,
  proposedValue: string,
  documentCategory: string,
  clientId: number,
  planId: number | null,
): ResolvedMapping {
  const entry = FIELD_MAPPINGS[fieldKey];
  if (!entry) {
    return {
      mappingStatus: "UNMAPPED", confidence: "normal", isPlanDesignField: false,
      targetTable: "review_only", targetId: null, targetField: fieldKey, coercedValue: null,
    };
  }

  const targetId = entry.table === "clients" ? clientId : planId;
  if (targetId == null) {
    return {
      mappingStatus: "UNMAPPED", confidence: "normal", isPlanDesignField: entry.isPlanDesign,
      targetTable: "review_only", targetId: null, targetField: fieldKey, coercedValue: null,
    };
  }

  const coercedValue = entry.coerce(proposedValue);
  const confidence: "normal" | "low" = entry.isPlanDesign && documentCategory === "PPR_REPORT" ? "low" : "normal";

  return {
    mappingStatus: coercedValue !== null ? "MAPPED" : "UNMAPPED",
    confidence,
    isPlanDesignField: entry.isPlanDesign,
    targetTable: coercedValue !== null ? entry.table : "review_only",
    targetId: coercedValue !== null ? targetId : null,
    targetField: entry.column,
    coercedValue,
  };
}
