/**
 * Rate card calculation logic.
 *
 * This file is the single source of truth for the premium formula.
 * It is used both client-side (live preview) and server-side (canonical stored values).
 *
 * FORMULA (per tier):
 *   adminSubtotal     = baseAdminFee + cobraFee + simpleFee + networkFee
 *   preBrokerSubtotal = adminSubtotal + expectedClaims
 *
 *   if NONE:          brokerFee = 0 ; premium = preBrokerSubtotal
 *   if FLAT_PEPM:     brokerFee = brokerValue ; premium = preBrokerSubtotal + brokerValue
 *   if FIXED_MONTHLY: brokerFee = brokerValue ; premium = preBrokerSubtotal + brokerValue
 *   if PERCENT:       premium   = round(preBrokerSubtotal / (1 - pct), 2)
 *                     brokerFee = premium - preBrokerSubtotal   (derived, never drifts)
 *
 *   totalAdminFee  = adminSubtotal + brokerFee
 *   monthlyPremium = totalAdminFee + expectedClaims             (always = premium)
 *
 * Worked example — Gainesville City Schools Standard, EE, 8% broker:
 *   base=2.05 cobra=0 simple=2.15 network=0 claims=26.32 pct=0.08
 *   adminSubtotal=4.20  preBroker=30.52
 *   premium = round(30.52/0.92, 2) = 33.17
 *   brokerFee = 33.17 - 30.52 = 2.65
 *   totalAdminFee = 4.20 + 2.65 = 6.85
 *   check: 6.85 + 26.32 = 33.17 ✓
 */

export type BrokerMode = "NONE" | "FLAT_PEPM" | "FIXED_MONTHLY" | "PERCENT_OF_PREMIUM";

export interface RateInputs {
  baseAdminFee: number;
  cobraFee: number;
  simpleFee: number;
  networkFee: number;
  expectedClaims: number;
}

export interface RateOutputs {
  adminSubtotal: number;
  brokerFee: number;
  totalAdminFee: number;
  monthlyPremium: number;
}

/** Round to two decimal places using "round half up" (standard financial rounding). */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the derived fields for one rate card tier.
 *
 * @param inputs      The five editable fee inputs.
 * @param brokerMode  The plan-level broker compensation mode.
 * @param brokerValue For FLAT/FIXED: dollar amount. For PERCENT: decimal fraction (0.08 = 8%).
 */
export function calcRateCard(
  inputs: RateInputs,
  brokerMode: BrokerMode,
  brokerValue: number,
): RateOutputs {
  const { baseAdminFee, cobraFee, simpleFee, networkFee, expectedClaims } = inputs;

  const adminSubtotal = r2(baseAdminFee + cobraFee + simpleFee + networkFee);
  const preBrokerSubtotal = r2(adminSubtotal + expectedClaims);

  let brokerFee = 0;
  let monthlyPremium = preBrokerSubtotal;

  if (brokerMode === "FLAT_PEPM" || brokerMode === "FIXED_MONTHLY") {
    brokerFee = brokerValue;
    monthlyPremium = r2(preBrokerSubtotal + brokerValue);
  } else if (brokerMode === "PERCENT_OF_PREMIUM" && brokerValue > 0 && brokerValue < 1) {
    // Gross-up: round premium first, then derive broker fee from the rounded premium.
    // This guarantees totalAdminFee + claims = premium with no rounding drift.
    monthlyPremium = r2(preBrokerSubtotal / (1 - brokerValue));
    brokerFee = r2(monthlyPremium - preBrokerSubtotal);
  }

  const totalAdminFee = r2(adminSubtotal + brokerFee);
  // Recompute premium from the canonical equation to eliminate any floating-point drift.
  monthlyPremium = r2(totalAdminFee + expectedClaims);

  return { adminSubtotal, brokerFee, totalAdminFee, monthlyPremium };
}

/** Parse a string that may be a percentage (e.g. "8" → 0.08) or a dollar string (e.g. "1.50"). */
export function parsePctInput(raw: string): number {
  const n = parseFloat(raw) || 0;
  // User enters the percentage as a whole number (8 for 8%)
  return n / 100;
}

/** Default base admin fee by plan coverage type. */
export function defaultBaseAdminFee(coverageType: string | null | undefined): string {
  if (coverageType === "VISION_ONLY") return "0.48";
  if (coverageType === "DENTAL_VISION" || coverageType === "DENTAL_VISION_HEARING") return "2.53";
  return "2.05"; // DENTAL_ONLY or unknown
}
