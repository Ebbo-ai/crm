export const US_STATES = [
  { value: "AL", label: "Alabama" }, { value: "AK", label: "Alaska" }, { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" }, { value: "CA", label: "California" }, { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" }, { value: "DE", label: "Delaware" }, { value: "DC", label: "District of Columbia" },
  { value: "FL", label: "Florida" }, { value: "GA", label: "Georgia" }, { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" }, { value: "IL", label: "Illinois" }, { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" }, { value: "KS", label: "Kansas" }, { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" }, { value: "ME", label: "Maine" }, { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" }, { value: "MI", label: "Michigan" }, { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" }, { value: "MO", label: "Missouri" }, { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" }, { value: "NV", label: "Nevada" }, { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" }, { value: "NM", label: "New Mexico" }, { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" }, { value: "ND", label: "North Dakota" }, { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" }, { value: "OR", label: "Oregon" }, { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" }, { value: "SC", label: "South Carolina" }, { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" }, { value: "TX", label: "Texas" }, { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" }, { value: "VA", label: "Virginia" }, { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" }, { value: "WI", label: "Wisconsin" }, { value: "WY", label: "Wyoming" },
];

export const PLAN_TYPE_LABELS: Record<string, string> = {
  DENTAL: "Dental",
  VISION: "Vision",
  HEARING: "Hearing",
  DENTAL_VISION: "Dental / Vision",
  HEARING_VISION: "Hearing / Vision",
  DENTAL_HEARING_VISION: "Dental / Hearing / Vision",
};

// Coverage type: how a plan is funded and reported (4 fixed values).
// Combined plans share one rate and one claims stream — never split them into
// separate dental and vision rows.
export const PLAN_COVERAGE_TYPE_LABELS: Record<string, string> = {
  DENTAL_ONLY:           "Dental only",
  VISION_ONLY:           "Vision only",
  DENTAL_VISION:         "Dental + Vision (combined)",
  DENTAL_VISION_HEARING: "Dental + Vision + Hearing (combined)",
};

export const PLAN_COVERAGE_TYPE_OPTIONS = [
  { value: "DENTAL_ONLY",           label: "Dental only" },
  { value: "VISION_ONLY",           label: "Vision only" },
  { value: "DENTAL_VISION",         label: "Dental + Vision (combined)" },
  { value: "DENTAL_VISION_HEARING", label: "Dental + Vision + Hearing (combined)" },
];

export const PLAN_BASIS_LABELS: Record<string, string> = {
  PROCEDURE_BASED: "Procedure Based",
  DOLLAR_BASED: "Dollar Based",
};

/**
 * The house standard for tier labels, used across every client.
 *
 * Consistency is the point. The variation in the older data came from different
 * people typing whatever was quickest, which made plans hard to compare across
 * years. These are offered as a dropdown so picking a standard label is the
 * default path and typing something else takes deliberate effort.
 *
 * EE+1 is not a duplicate of EE+SP. It means employee plus one other person,
 * spouse or child, which some employers price as a single add-on tier without
 * distinguishing which.
 */
export const STANDARD_TIER_LABELS = ["EE", "EE+SP", "EE+CH", "EE+1", "EE+FAM"] as const;

export const STANDARD_TIER_DESCRIPTIONS: Record<string, string> = {
  "EE": "Employee only",
  "EE+SP": "Employee plus spouse",
  "EE+CH": "Employee plus children",
  "EE+1": "Employee plus one, spouse or child",
  "EE+FAM": "Employee plus family",
};

/**
 * Display fallback for rate cards still carrying the retired `tier` enum rather
 * than a plan_tiers row. EE_SPOUSE maps to EE+1 on purpose: the enum name was
 * inaccurate, it covered a spouse or a child.
 */
export const TIER_LABELS: Record<string, string> = {
  EE: "EE",
  EE_CHILD: "EE+CH",
  EE_SPOUSE: "EE+1",
  FAMILY: "EE+FAM",
};

/** Every category in the document_category enum (shared/schema.ts). A category missing here renders as its raw enum value, which is how PLAN_TRANSMITTAL used to show up. */
export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  CLIENT_AGREEMENT: "Client Agreement",
  PROPOSAL: "Proposal",
  EMPLOYER_ACCEPTANCE: "Employer Acceptance",
  BROKER_COMPENSATION: "Broker Compensation",
  BROKER_OF_RECORD: "Broker of Record",
  RENEWAL_PROPOSAL: "Renewal Proposal",
  PPR_REPORT: "Performance Report",
  SPD: "SPD",
  HANDOUT: "Handout",
  NEW_PROPOSAL: "New Proposal",
  RATE_NOTICE: "Rate Notice",
  PLAN_TRANSMITTAL: "Plan Transmittal",
  SUPPLEMENT: "Supplement",
  OTHER: "Other",
};

export const BANKING_TYPE_LABELS: Record<string, string> = {
  CLIENT_BANK: "Client Bank Account",
  NINETY_DEGREE_BANK: "90 Degree Bank Account",
};

export const FUNDING_TYPE_LABELS: Record<string, string> = {
  REQUIRES_APPROVAL: "Client Requires Approval",
  PROCESS_WITHOUT_APPROVAL: "Process Without Approval",
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

/**
 * Parse a date-only value (e.g. "2025-11-01" or a DB timestamp string) as a
 * local calendar date, avoiding the UTC-midnight timezone-shift bug where
 * new Date("2025-11-01") renders as Oct 31 in US timezones.
 */
export function parseLocalDate(value: string | Date | null | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const datePart = (value as string).split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "$0.00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return `$${num.toFixed(2)}`;
}
