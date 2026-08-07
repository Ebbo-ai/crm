// Tracks which client fields we consider "completeness-relevant".
// Only fields that are genuinely optional post-relaxation and that staff
// would want filled in before going live are listed here.
// client_code, client_name, and plan_type are always required, so they
// are not tracked (a record cannot exist without them).

export const COMPLETENESS_FIELDS = [
  { key: "streetAddress",       label: "Street address" },
  { key: "city",                label: "City" },
  { key: "state",               label: "State" },
  { key: "zipCode",             label: "ZIP code" },
  { key: "industryType",        label: "Industry type" },
  { key: "numberOfEmployees",   label: "Number of employees" },
  { key: "decisionMakerName",   label: "Decision maker — name" },
  { key: "decisionMakerTitle",  label: "Decision maker — title" },
  { key: "decisionMakerPhone",  label: "Decision maker — phone" },
  { key: "decisionMakerEmail",  label: "Decision maker — email" },
  { key: "adminContactName",    label: "Admin contact — name" },
  { key: "adminContactPhone",   label: "Admin contact — phone" },
  { key: "adminContactEmail",   label: "Admin contact — email" },
  { key: "bankingType",         label: "Banking type" },
  { key: "fundingType",         label: "Funding type" },
  { key: "anniversaryDate",     label: "Anniversary date" },
] as const;

export type CompletenessField = (typeof COMPLETENESS_FIELDS)[number]["key"];

export interface CompletenessResult {
  filled: number;
  total: number;
  pct: number;        // 0–100, rounded
  missing: string[];  // human-readable labels of blank fields
  isComplete: boolean;
}

export function getClientCompleteness(client: Record<string, any>): CompletenessResult {
  const missing: string[] = [];
  for (const field of COMPLETENESS_FIELDS) {
    const val = client[field.key];
    const blank =
      val === null ||
      val === undefined ||
      val === "" ||
      (field.key === "numberOfEmployees" && (Number(val) <= 0 || isNaN(Number(val))));
    if (blank) missing.push(field.label);
  }
  const total = COMPLETENESS_FIELDS.length;
  const filled = total - missing.length;
  const pct = Math.round((filled / total) * 100);
  return { filled, total, pct, missing, isComplete: missing.length === 0 };
}
