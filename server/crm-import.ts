/**
 * CRM spreadsheet import.
 *
 * Loads the Clients / Plans / Rate Cards workbook produced from the plan performance
 * reports. Two properties matter more than anything else here:
 *
 * 1. It updates in place. Every record is matched on a business key, never on a
 *    database id, so the same file can be run repeatedly. This is not a convenience:
 *    administrative fee corrections come back from the administrator in batches over
 *    weeks, and each corrected fee touches every tier on a plan. Re-running a revised
 *    file has to be the way those land, otherwise each correction is dozens of manual
 *    edits through the interface.
 *
 *      clients    → client_code
 *      plans      → client_code + plan_name + coverage_type + plan_year
 *      rate cards → the plan above + tier_label
 *
 *    Plan identity includes coverage because a plan name alone does not identify a
 *    plan. One client can carry a dental "Standard" and a vision "Standard" in the
 *    same year, and those are two different plans.
 *
 * 2. It never invents a value. Where the workbook is blank the column is written as
 *    NULL, explicitly, so that column defaults cannot quietly substitute a number
 *    that would then read as fact. Where wording cannot be represented in a
 *    structured column it is preserved verbatim in plan notes rather than dropped or
 *    approximated.
 *
 * Nothing is ever deleted at client or plan level. Records that exist in the database
 * but not in the workbook are reported and left alone, because the workbook is a
 * snapshot of what the reports covered, not a statement that everything else is gone.
 */

import * as XLSX from "xlsx";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { clients, plans, planTiers, rateCards, brokerContacts } from "@shared/schema";

// ─── Result shapes ──────────────────────────────────────────────────────────

export type ImportMode = "validate" | "apply";

export interface ImportIssue {
  severity: "error" | "warning";
  sheet: string;
  row?: number;
  ref?: string;
  message: string;
}

export interface EntityCounts {
  created: number;
  updated: number;
  unchanged: number;
}

export interface ImportResult {
  ok: boolean;
  mode: ImportMode;
  applied: boolean;
  issues: ImportIssue[];
  counts: {
    clients: EntityCounts;
    plans: EntityCounts;
    rateCards: EntityCounts;
    brokerContacts: EntityCounts;
  };
  /** Contacts dropped because the workbook no longer lists them for that client. */
  brokerContactsRemoved: number;
  /** Tier rows removed because the workbook no longer lists that tier for the plan. */
  tiersRemoved: number;
  /** In the database but absent from the workbook. Reported only — never deleted. */
  notInFile: { clients: string[]; plans: string[] };
  /** Rows the workbook itself flags as needing attention. */
  flagged: { ref: string; note: string }[];
}

class Rollback extends Error {}

// ─── Column contracts ───────────────────────────────────────────────────────

const REQUIRED_COLUMNS: Record<string, string[]> = {
  Clients: ["client_code", "client_name"],
  Plans: ["client_code", "plan_name", "plan_year", "coverage_type"],
  // coverage_type is required here for the same reason it is on Plans: without it a
  // rate row cannot be attached to the right plan when a client runs the same plan
  // name on more than one coverage. It must be carried explicitly rather than
  // inferred from the fees, because the fees themselves are subject to correction.
  "Rate Cards": ["client_code", "plan_name", "plan_year", "coverage_type", "tier_label"],
};

// ─── Value coercion ─────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

function bool(v: unknown): boolean | null {
  const s = str(v);
  if (s === null) return null;
  const t = s.toLowerCase();
  if (["yes", "y", "true", "1"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  return null;
}

/** Accepts ISO strings and Excel serial dates. Returns a UTC-midnight Date. */
function date(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Excel serial: days since 1899-12-30.
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Builds the set of columns a sheet actually hands us.
 *
 * The workbook owns a column only when the sheet carries it. A corrections file that
 * lists just the fees is not a statement that every client has lost its broker and its
 * network; omitted columns must be left exactly as they are. So:
 *
 *   - column absent from the sheet  -> never written, on insert or update
 *   - column present, cell has data -> written
 *   - column present, cell blank    -> written as NULL, because within a column the
 *                                      workbook does supply, a blank means "no value"
 *
 * The one exception is a NOT NULL column: a blank there cannot be stored, so the field
 * is omitted instead. New rows then take the database default and existing rows keep
 * what they already had, rather than being reset to a guess.
 */
function owned(
  cols: Set<string>,
  spec: Record<string, readonly [column: string, value: unknown, notNull?: boolean]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, [column, value, notNull]] of Object.entries(spec)) {
    if (!cols.has(column)) continue;
    if (notNull && value === null) continue;
    out[field] = value;
  }
  return out;
}

/**
 * Withholds a coinsurance figure when the design turned out to be larger than the
 * columns that hold it. The wording is still preserved in the plan notes, so nothing
 * is lost; what is avoided is a partial design presented as the whole one.
 */
function coinsValue<T>(coins: { truncated: boolean }, value: T): T | null {
  return coins.truncated ? null : value;
}

/** Decimal columns take strings in Drizzle. Null stays null — never coerced to "0". */
function dec(v: number | null, scale = 2): string | null {
  return v === null ? null : v.toFixed(scale);
}

/**
 * Client codes are not spelled consistently in the stored data: the same client is
 * S-020 in some records and S-20 in others, and both spellings are genuinely in use.
 * Normalising the zero padding lets a workbook row find the record it belongs to
 * instead of creating a second copy of a client already on file.
 *
 * Used for matching only. It never rewrites a code by itself, and a normalised match
 * is only accepted when it resolves to exactly one record.
 */
export function normalizeCode(code: string): string {
  const m = /^([A-Za-z]+)[-\s]*0*(\d+)$/.exec(String(code).trim());
  return m ? `${m[1].toUpperCase()}-${m[2]}` : String(code).trim().toUpperCase();
}

// ─── Enum mapping ───────────────────────────────────────────────────────────

const COVERAGE_MAP: Record<string, string> = {
  DENTAL: "DENTAL_ONLY",
  DENTAL_ONLY: "DENTAL_ONLY",
  VISION: "VISION_ONLY",
  VISION_ONLY: "VISION_ONLY",
  DENTAL_VISION: "DENTAL_VISION",
  DENTAL_HEARING_VISION: "DENTAL_VISION_HEARING",
  DENTAL_VISION_HEARING: "DENTAL_VISION_HEARING",
};

const CLIENT_PLAN_TYPES = [
  "DENTAL",
  "VISION",
  "HEARING",
  "DENTAL_VISION",
  "HEARING_VISION",
  "DENTAL_HEARING_VISION",
];

const FEE_BASES = ["PEPM", "FIXED_MONTHLY"];
const BROKER_MODES = ["NONE", "FLAT_PEPM", "FIXED_MONTHLY", "PERCENT_OF_PREMIUM"];

// ─── Plan design parsing ────────────────────────────────────────────────────
//
// The workbook carries plan design as the wording used in the plan performance
// report. Most of it follows one of two shapes and converts cleanly to structured
// columns. The rest is genuine prose. Anything that does not convert is left NULL in
// the structured columns and kept verbatim in plan notes, which is where a compound
// figure needs to appear on a client-facing document anyway. A half-parsed value in a
// structured column would be indistinguishable from a verified one.

interface CoinsuranceParse {
  /** Null when no coinsurance wording was supplied, so the basis is simply not known. */
  planBasis: "PROCEDURE_BASED" | "DOLLAR_BASED" | null;
  preventivePercent: number | null;
  correctivePercent: number | null;
  restorativePercent: number | null;
  dollarTier1Percent: number | null;
  dollarTier1Limit: number | null;
  dollarTier2Percent: number | null;
  dollarTier2Limit: number | null;
  dollarTier3Percent: number | null;
  /**
   * Null when the final band is open ended ("50% of the remaining"). A bounded final
   * band is a different plan from an unbounded one, so the two must not collapse
   * together: dropping the figure would silently turn a capped band into an unlimited
   * one on every document the plan appears in.
   */
  dollarTier3Limit: number | null;
  /** True when the wording carries meaning the columns above cannot hold. */
  lossy: boolean;
  /**
   * True when the design has more bands or categories than there are columns, so the
   * extracted values describe only part of it. Distinct from `lossy`, which also covers
   * wording that merely adds something alongside values that are themselves correct.
   *
   * A truncated design writes nothing: rendering a four-band plan as three bands is not
   * an incomplete answer, it is a wrong one, and it would read as verified on a client
   * document. An annotated design keeps its values, because they are accurate, and the
   * annotation travels with them in the plan notes.
   */
  truncated: boolean;
}

const EMPTY_COINSURANCE: CoinsuranceParse = {
  planBasis: null,
  preventivePercent: null,
  correctivePercent: null,
  restorativePercent: null,
  dollarTier1Percent: null,
  dollarTier1Limit: null,
  dollarTier2Percent: null,
  dollarTier2Limit: null,
  dollarTier3Percent: null,
  dollarTier3Limit: null,
  lossy: false,
  truncated: false,
};

export function parseCoinsurance(raw: string | null): CoinsuranceParse {
  // No wording at all: the basis is unknown, not dollar based.
  if (!raw) return { ...EMPTY_COINSURANCE };
  const text = raw.trim();

  // Shape one: named service categories (preventive & diagnostic / basic / major).
  if (/P&D|Preventive\s*&\s*Diagnostic|Preventive and Diagnostic|\bP & D\b/i.test(text)) {
    // Orthodontia has a column of its own, so its percentage is not competing for the
    // three service-category slots. Dropping that clause before counting is what lets
    // "100% P&D, 80% Basic, 50% Major, 50% ortho" be read as three categories plus a
    // separately stored ortho figure, rather than as a design too big for the columns.
    const withoutOrtho = text.replace(/[,;/]?\s*[^,;/]*ortho[^,;/]*/gi, "");
    const pct = Array.from(withoutOrtho.matchAll(/(\d{2,3})\s*%/g)).map((m) => Number(m[1]));

    // Wording such as "100% P&D, 80% of the first $200, 50% of the remaining" names a
    // service category and then describes dollar bands. Read as three categories it
    // would label two bands as Basic and Major, which is a different plan from the one
    // written down. The percentages are real but their meaning is not settled, so the
    // figures are withheld and the sentence is carried through intact.
    const hybrid = /\$/.test(withoutOrtho);
    if (hybrid) {
      return { ...EMPTY_COINSURANCE, planBasis: "PROCEDURE_BASED", lossy: true, truncated: true };
    }

    if (pct.length >= 2) {
      return {
        ...EMPTY_COINSURANCE,
        planBasis: "PROCEDURE_BASED",
        preventivePercent: pct[0] ?? null,
        correctivePercent: pct[1] ?? null,
        restorativePercent: pct[2] ?? null,
        lossy: pct.length > 3 || /ortho|does not apply|no restriction/i.test(text),
        // More service categories than columns: what we could extract would describe
        // only part of the design.
        truncated: pct.length > 3,
      };
    }
    return { ...EMPTY_COINSURANCE, planBasis: "PROCEDURE_BASED", lossy: true };
  }

  // Shape two: percentage/dollar bands, e.g. "100% first $250, 50% next $2,500".
  const steps = Array.from(text.matchAll(/(\d{2,3})\s*%[^\d%$]*\$\s*([\d,]+(?:\.\d+)?)/g)).map((m) => ({
    percent: Number(m[1]),
    amount: Number(m[2].replace(/,/g, "")),
  }));
  const trailing = /(\d{2,3})\s*%\s*(?:of\s*)?(?:the\s*)?remaining(?!\s*(?:\$|maximum\s*\$))/i.exec(text);

  if (steps.length > 0) {
    // A trailing "50% of the remaining" is an open-ended final band: it has a
    // percentage but no limit, which is exactly what tier 3 represents.
    const tier3 = trailing ? Number(trailing[1]) : steps[2]?.percent ?? null;
    const capped = /max(?:imum)?\s*pay|cap\b|frames/i.test(text);
    return {
      ...EMPTY_COINSURANCE,
      planBasis: "DOLLAR_BASED",
      dollarTier1Percent: steps[0]?.percent ?? null,
      dollarTier1Limit: steps[0]?.amount ?? null,
      dollarTier2Percent: steps[1]?.percent ?? null,
      dollarTier2Limit: steps[1]?.amount ?? null,
      dollarTier3Percent: tier3,
      // Only a stated third band has a limit; a trailing "of the remaining" is
      // deliberately open ended and must stay null rather than borrow a figure.
      dollarTier3Limit: trailing ? null : steps[2]?.amount ?? null,
      // More bands than the three columns hold, or a sub-limit such as a frame cap
      // that the bands cannot express.
      lossy: steps.length > 3 || capped || (steps.length === 3 && trailing !== null),
      // Only the band count truncates. A frame cap sits alongside bands that are
      // themselves accurate, so those stay and the cap travels in the notes.
      truncated: steps.length > 3 || (steps.length === 3 && trailing !== null),
    };
  }

  // Genuine prose. Structured columns stay NULL so nothing reads as verified, and
  // the wording is carried through to plan notes by the caller.
  return {
    ...EMPTY_COINSURANCE,
    planBasis: /\$/.test(text) ? "DOLLAR_BASED" : "PROCEDURE_BASED",
    lossy: true,
  };
}

interface OrthoParse {
  /**
   * Null when the wording plainly describes an orthodontia benefit but does not say
   * who is eligible. Falling back to NONE there would assert the plan has no
   * orthodontia at all, which is a stronger and more damaging claim than saying
   * nothing — "Included in the $2,000 maximum" describes cover, not the absence of it.
   */
  orthoEligibility: "NONE" | "CHILDREN" | "ALL" | null;
  orthoCoinsurancePercent: number | null;
  orthoLifetimeMax: number | null;
  orthoMaxType: "SHARED_ANNUAL" | "SEPARATE_LIFETIME" | null;
  lossy: boolean;
}

export function parseOrthodontia(raw: string | null): OrthoParse {
  const base: OrthoParse = {
    orthoEligibility: "NONE",
    orthoCoinsurancePercent: null,
    orthoLifetimeMax: null,
    orthoMaxType: null,
    lossy: false,
  };
  if (!raw) return base;
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (/^(no|not covered|not included|none)\b/.test(lower)) {
    return { ...base, orthoEligibility: "NONE", lossy: false };
  }

  let eligibility: OrthoParse["orthoEligibility"] | null = null;
  if (/adults?\s*(?:&|and)\s*children/i.test(text)) eligibility = "ALL";
  else if (/children|child/i.test(text)) eligibility = "CHILDREN";

  const pct = /(\d{2,3})\s*%/.exec(text);
  const lifetime = /lifetime\s*(?:max(?:imum)?)?\s*\$\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  const lifetimeAlt = /lifetime\s*\$\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  const maxMatch = lifetime ?? lifetimeAlt;

  // A lifetime figure only means a *separate* lifetime maximum when the wording does
  // not also tie the benefit to another maximum. "Included in the $2,000 maximum" and
  // "shared with the annual maximum" describe the opposite arrangement, and
  // "Lifetime $1,500 / Annual $2,000" states both without saying which governs. The
  // figure itself is explicit and is kept; how it applies is left unstated.
  const tiedToAnotherMaximum = /included in|shared|same\s+(?:annual\s+)?max|\bannual\b/i.test(text);

  // Anything qualifying *how* the benefit applies — an age cut-off, a waiting
  // period, sharing the plan maximum, a separate benefit — changes what the plan
  // actually pays and cannot be reconstructed from the columns above.
  const qualifier =
    /to age|waiting period|included in|no lifetime max|separate benefit|same benefits|annual/i.test(text);

  return {
    orthoEligibility: eligibility,
    orthoCoinsurancePercent: pct ? Number(pct[1]) : null,
    orthoLifetimeMax: maxMatch ? Number(maxMatch[1].replace(/,/g, "")) : null,
    orthoMaxType: maxMatch && !tiedToAnotherMaximum ? "SEPARATE_LIFETIME" : null,
    lossy: eligibility === null || qualifier,
  };
}

/** A plain dollar amount converts; anything compound stays as wording. */
export function parseDeductible(raw: string | null): { value: number | null; lossy: boolean } {
  if (!raw) return { value: null, lossy: false };
  const text = raw.trim();
  const plain = /^\$?\s*([\d,]+(?:\.\d+)?)\s*$/.exec(text);
  if (plain) return { value: Number(plain[1].replace(/,/g, "")), lossy: false };
  return { value: null, lossy: true };
}

/**
 * Plan notes are rebuilt from the workbook every run, never appended to what is
 * already stored. Re-running the same file therefore produces byte-identical notes
 * instead of stacking duplicate lines each time.
 */
function composeNotes(parts: { sheetNotes: string | null; extras: [string, string | null][] }): string | null {
  const lines: string[] = [];
  if (parts.sheetNotes) lines.push(parts.sheetNotes);
  for (const [label, value] of parts.extras) {
    if (value) lines.push(`${label}: ${value}`);
  }
  return lines.length ? lines.join("\n") : null;
}

// ─── Parsed row shapes ──────────────────────────────────────────────────────

interface ParsedClient {
  row: number;
  clientCode: string;
  values: Record<string, unknown>;
  importNote: string | null;
}

interface ParsedPlan {
  row: number;
  clientCode: string;
  planName: string;
  planYear: number;
  coverageType: string;
  values: Record<string, unknown>;
}

interface ParsedRate {
  row: number;
  clientCode: string;
  planName: string;
  planYear: number;
  coverageType: string;
  tierLabel: string;
  tierOrder: number;
  values: Record<string, unknown>;
  note: string | null;
}

/**
 * One person at the brokerage, as the workbook supplies them.
 *
 * `provided` records which optional columns the source sheet actually carried, so the
 * same ownership rule that governs client columns applies here: a column that is not in
 * the sheet is never written. Without it, a file listing only names and emails would
 * silently wipe every stored phone number and role.
 */
export interface ParsedBrokerContact {
  contactName: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  notes: string | null;
  isPrimary: boolean;
  effectiveDate: Date | null;
  terminationDate: Date | null;
  provided: {
    email: boolean;
    phone: boolean;
    role: boolean;
    notes: boolean;
    effectiveDate: boolean;
    terminationDate: boolean;
  };
}

/**
 * The whole contact set for one client. Contacts are written as a set, not row by
 * row, because that is the only way the file can express someone leaving the account.
 * A set is only ever built when the workbook actually carries contact columns — see
 * `owned()` — so a corrections file listing fees cannot wipe a client's contacts.
 */
export interface ParsedBrokerContactSet {
  row: number;
  sheet: string;
  clientCode: string;
  contacts: ParsedBrokerContact[];
}

export interface ParsedWorkbook {
  clients: ParsedClient[];
  plans: ParsedPlan[];
  rates: ParsedRate[];
  brokerContacts: ParsedBrokerContactSet[];
  issues: ImportIssue[];
  flagged: { ref: string; note: string }[];
}

/**
 * Cross-sheet key. The client code is normalised so that a Clients row written S-020
 * and a Plans row written S-20 join to each other instead of being reported as a plan
 * belonging to an unknown client.
 */
const planKey = (clientCode: string, name: string, coverage: string, year: number) =>
  [normalizeCode(clientCode), name, coverage, year].join("\u0000");

// ─── Parsing ────────────────────────────────────────────────────────────────

export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const issues: ImportIssue[] = [];
  const flagged: { ref: string; note: string }[] = [];
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  for (const sheet of Object.keys(REQUIRED_COLUMNS)) {
    if (!wb.SheetNames.includes(sheet)) {
      issues.push({ severity: "error", sheet, message: `Sheet "${sheet}" is missing from the workbook.` });
    }
  }
  if (issues.length) return { clients: [], plans: [], rates: [], brokerContacts: [], issues, flagged };

  const rowsOf = (name: string) =>
    XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null });
  const headersOf = (name: string) =>
    (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1 })[0] ?? []).map((h) => String(h ?? "").trim());
  const colsOf = (name: string) => new Set(headersOf(name));
  const clientCols = colsOf("Clients");
  const planCols = colsOf("Plans");

  for (const [sheet, required] of Object.entries(REQUIRED_COLUMNS)) {
    const headers = headersOf(sheet);
    const missing = required.filter((c) => !headers.includes(c));
    if (missing.length) {
      issues.push({
        severity: "error",
        sheet,
        message:
          `Sheet "${sheet}" is missing required column(s): ${missing.join(", ")}. ` +
          (missing.includes("coverage_type")
            ? "Every row must state its own coverage so it can be matched to the right plan. " +
              "Coverage cannot be inferred from the fees, because the fees are themselves subject to correction."
            : ""),
      });
    }
  }
  if (issues.some((i) => i.severity === "error")) return { clients: [], plans: [], rates: [], brokerContacts: [], issues, flagged };

  const hasSurplusAsOf = headersOf("Plans").includes("surplus_deficit_as_of");

  // ── Clients ──
  const parsedClients: ParsedClient[] = [];
  const seenClientCodes = new Set<string>();
  const seenNormCodes = new Map<string, string>();
  const seenClientNames = new Map<string, string>();

  rowsOf("Clients").forEach((r, i) => {
    const row = i + 2;
    const clientCode = str(r.client_code);
    const clientName = str(r.client_name);
    if (!clientCode || !clientName) {
      issues.push({ severity: "error", sheet: "Clients", row, message: "client_code and client_name are both required." });
      return;
    }
    if (seenClientCodes.has(clientCode)) {
      issues.push({ severity: "error", sheet: "Clients", row, ref: clientCode, message: `Duplicate client_code "${clientCode}".` });
      return;
    }
    // Two rows differing only in zero padding (S-20 and S-020) would both match the
    // same stored client, so the workbook has to settle on one spelling.
    const normClash = seenNormCodes.get(normalizeCode(clientCode));
    if (normClash) {
      issues.push({
        severity: "error",
        sheet: "Clients",
        row,
        ref: clientCode,
        message: `"${clientCode}" and "${normClash}" are the same client code written two ways. Use one spelling.`,
      });
      return;
    }
    // client_name carries a uniqueness constraint of its own, so a collision here
    // would fail mid-write rather than at validation time.
    const nameClash = seenClientNames.get(clientName.toLowerCase());
    if (nameClash) {
      issues.push({
        severity: "error",
        sheet: "Clients",
        row,
        ref: clientCode,
        message: `client_name "${clientName}" is already used by ${nameClash}. Client names must be unique.`,
      });
      return;
    }
    seenClientCodes.add(clientCode);
    seenNormCodes.set(normalizeCode(clientCode), clientCode);
    seenClientNames.set(clientName.toLowerCase(), clientCode);

    const planType = str(r.plan_type);
    if (planType && !CLIENT_PLAN_TYPES.includes(planType)) {
      issues.push({ severity: "error", sheet: "Clients", row, ref: clientCode, message: `Unknown plan_type "${planType}".` });
    }

    const isActive = bool(r.is_active);
    const importNote = str(r["IMPORT NOTES"]);
    if (importNote) flagged.push({ ref: `${clientCode} (client)`, note: importNote });

    parsedClients.push({
      row,
      clientCode,
      importNote,
      values: {
        clientCode,
        clientName,
        ...owned(clientCols, {
          streetAddress: ["street_address", str(r.street_address)],
          suiteUnit: ["suite_unit", str(r.suite_unit)],
          city: ["city", str(r.city)],
          state: ["state", str(r.state)],
          zipCode: ["zip_code", str(r.zip_code)],
          industryType: ["industry_type", str(r.industry_type)],
          numberOfEmployees: ["number_of_employees", int(r.number_of_employees)],
          isActive: ["is_active", isActive, true],
          terminationDate: ["termination_date", date(r.termination_date)],
          planType: ["plan_type", planType],
          networkActive: ["network_active", bool(r.network_active), true],
          dentalNetworkName: ["dental_network_name", str(r.dental_network_name)],
          decisionMakerName: ["decision_maker_name", str(r.decision_maker_name)],
          decisionMakerTitle: ["decision_maker_title", str(r.decision_maker_title)],
          decisionMakerPhone: ["decision_maker_phone", str(r.decision_maker_phone)],
          decisionMakerEmail: ["decision_maker_email", str(r.decision_maker_email)],
          adminContactName: ["admin_contact_name", str(r.admin_contact_name)],
          adminContactTitle: ["admin_contact_title", str(r.admin_contact_title)],
          adminContactPhone: ["admin_contact_phone", str(r.admin_contact_phone)],
          adminContactEmail: ["admin_contact_email", str(r.admin_contact_email)],
          hasBroker: ["has_broker", bool(r.has_broker), true],
          brokerFirmName: ["broker_firm_name", str(r.broker_firm_name)],
          brokerContactName: ["broker_contact_name", str(r.broker_contact_name)],
          brokerPhone: ["broker_phone", str(r.broker_phone)],
          brokerEmail: ["broker_email", str(r.broker_email)],
          bankingType: ["banking_type", str(r.banking_type)],
          fundingType: ["funding_type", str(r.funding_type)],
          cobraAdministeredBy90d: ["cobra_admin_by_90db", bool(r.cobra_admin_by_90db), true],
          cobraFee: ["cobra_fee", dec(num(r.cobra_fee))],
          accountBalance: ["account_balance", dec(num(r.account_balance))],
          accountBalanceAsOfDate: ["account_balance_as_of", date(r.account_balance_as_of)],
          anniversaryDate: ["anniversary_date", date(r.anniversary_date)],
          renewalLeadMonths: ["renewal_lead_months", int(r.renewal_lead_months), true],
        }),
      },
    });
  });

  // ── Broker contacts ──
  //
  // A brokerage assigns a lead plus a service rep, sometimes a third. Two ways to
  // carry them, both optional:
  //
  //   1. Numbered columns on the Clients sheet — broker_contact_role for the person
  //      already named in broker_contact_name, then broker_contact2_* and
  //      broker_contact3_*. Covers the common lead-plus-service-rep case in the sheet
  //      that is already there.
  //   2. A "Broker Contacts" sheet — one row per person, unlimited. Where both are
  //      supplied this sheet wins for the clients it lists, because it is the more
  //      explicit statement.
  //
  // Neither present means contacts are never touched. This is the same ownership rule
  // as `owned()`: a fee corrections file must not be read as "this client has no
  // broker contacts". Where a source IS present, it owns the whole set for that
  // client, which is what makes removing someone expressible.
  const parsedBrokerContacts: ParsedBrokerContactSet[] = [];
  const contactSetByCode = new Map<string, ParsedBrokerContactSet>();

  const CONTACT_COLS = [
    "broker_contact_role",
    "broker_contact2_name", "broker_contact2_email", "broker_contact2_phone", "broker_contact2_role",
    "broker_contact3_name", "broker_contact3_email", "broker_contact3_phone", "broker_contact3_role",
  ];
  const clientsSheetCarriesContacts = CONTACT_COLS.some((c) => clientCols.has(c));

  if (clientsSheetCarriesContacts) {
    rowsOf("Clients").forEach((r, i) => {
      const row = i + 2;
      const clientCode = str(r.client_code);
      if (!clientCode) return;

      const contacts: ParsedBrokerContact[] = [];
      const push = (
        prefix: { name: string; email: string; phone: string; role: string },
        isPrimary: boolean,
      ) => {
        const name = str(r[prefix.name]);
        const email = str(r[prefix.email]);
        if (!name && !email) return;
        contacts.push({
          contactName: name ?? email!,
          email,
          phone: str(r[prefix.phone]),
          role: str(r[prefix.role]),
          notes: null,
          isPrimary,
          effectiveDate: null,
          terminationDate: null,
          // Dates and notes are never carried by the Clients sheet, so they are never
          // owned here — use the Broker Contacts sheet to write them.
          provided: {
            email: clientCols.has(prefix.email),
            phone: clientCols.has(prefix.phone),
            role: clientCols.has(prefix.role),
            notes: false,
            effectiveDate: false,
            terminationDate: false,
          },
        });
      };
      push({ name: "broker_contact_name", email: "broker_email", phone: "broker_phone", role: "broker_contact_role" }, true);
      push({ name: "broker_contact2_name", email: "broker_contact2_email", phone: "broker_contact2_phone", role: "broker_contact2_role" }, false);
      push({ name: "broker_contact3_name", email: "broker_contact3_email", phone: "broker_contact3_phone", role: "broker_contact3_role" }, false);

      const set: ParsedBrokerContactSet = { row, sheet: "Clients", clientCode, contacts };
      contactSetByCode.set(normalizeCode(clientCode), set);
      parsedBrokerContacts.push(set);
    });
  }

  if (wb.SheetNames.includes("Broker Contacts")) {
    const bcCols = colsOf("Broker Contacts");
    const missing = ["client_code", "contact_name"].filter((c) => !bcCols.has(c));
    if (missing.length) {
      issues.push({
        severity: "error",
        sheet: "Broker Contacts",
        message: `Sheet "Broker Contacts" is missing required column(s): ${missing.join(", ")}.`,
      });
    } else {
      // The sheet replaces anything the Clients columns produced for these clients.
      const fromSheet = new Map<string, ParsedBrokerContactSet>();
      rowsOf("Broker Contacts").forEach((r, i) => {
        const row = i + 2;
        const clientCode = str(r.client_code);
        const contactName = str(r.contact_name);
        if (!clientCode || !contactName) {
          issues.push({
            severity: "error",
            sheet: "Broker Contacts",
            row,
            message: "client_code and contact_name are both required.",
          });
          return;
        }
        const key = normalizeCode(clientCode);
        const set = fromSheet.get(key) ?? { row, sheet: "Broker Contacts", clientCode, contacts: [] };
        set.contacts.push({
          contactName,
          email: str(r.contact_email),
          phone: str(r.contact_phone),
          role: str(r.role),
          notes: str(r.notes),
          isPrimary: bool(r.is_primary) === true,
          effectiveDate: date(r.effective_date),
          terminationDate: date(r.termination_date),
          provided: {
            email: bcCols.has("contact_email"),
            phone: bcCols.has("contact_phone"),
            role: bcCols.has("role"),
            notes: bcCols.has("notes"),
            effectiveDate: bcCols.has("effective_date"),
            terminationDate: bcCols.has("termination_date"),
          },
        });
        fromSheet.set(key, set);
      });

      for (const [key, set] of Array.from(fromSheet.entries())) {
        const superseded = contactSetByCode.get(key);
        if (superseded) {
          const idx = parsedBrokerContacts.indexOf(superseded);
          if (idx >= 0) parsedBrokerContacts.splice(idx, 1);
        }
        contactSetByCode.set(key, set);
        parsedBrokerContacts.push(set);
      }
    }
  }

  // Validated before anything is written, for the same reason the client-name clash
  // is: a constraint violation halfway through an import is the worst way to find out.
  for (const set of parsedBrokerContacts) {
    const seenNames = new Map<string, number>();
    for (const c of set.contacts) {
      const key = c.contactName.trim().toLowerCase();
      seenNames.set(key, (seenNames.get(key) ?? 0) + 1);
      if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
        issues.push({
          severity: "warning",
          sheet: set.sheet,
          row: set.row,
          ref: set.clientCode,
          message: `"${c.email}" for ${c.contactName} is not a valid email address. Stored as given — correct it at source rather than here.`,
        });
      }
    }
    for (const [name, n] of Array.from(seenNames.entries())) {
      if (n > 1) {
        issues.push({
          severity: "error",
          sheet: set.sheet,
          row: set.row,
          ref: set.clientCode,
          message: `"${name}" is listed ${n} times for this client. One row per person.`,
        });
      }
    }
    const serving = set.contacts.filter((c) => !c.terminationDate);
    const primaries = serving.filter((c) => c.isPrimary);
    if (primaries.length > 1) {
      issues.push({
        severity: "error",
        sheet: set.sheet,
        row: set.row,
        ref: set.clientCode,
        message: `${primaries.length} contacts are marked primary (${primaries.map((c) => c.contactName).join(", ")}). Exactly one lead per client.`,
      });
    }
    if (serving.length > 0 && primaries.length === 0) {
      issues.push({
        severity: "warning",
        sheet: set.sheet,
        row: set.row,
        ref: set.clientCode,
        message: "No contact marked primary — the first listed will be used as the lead, and is what the flat broker columns will mirror.",
      });
    }
  }

  // ── Plans ──
  const parsedPlans: ParsedPlan[] = [];
  const seenPlans = new Set<string>();

  rowsOf("Plans").forEach((r, i) => {
    const row = i + 2;
    const clientCode = str(r.client_code);
    const planName = str(r.plan_name);
    const planYear = int(r.plan_year);
    const rawCoverage = str(r.coverage_type);
    if (!clientCode || !planName || planYear === null || !rawCoverage) {
      issues.push({
        severity: "error",
        sheet: "Plans",
        row,
        message: "client_code, plan_name, plan_year and coverage_type are all required.",
      });
      return;
    }
    const coverageType = COVERAGE_MAP[rawCoverage.toUpperCase()];
    if (!coverageType) {
      issues.push({ severity: "error", sheet: "Plans", row, ref: clientCode, message: `Unknown coverage_type "${rawCoverage}".` });
      return;
    }
    const key = planKey(clientCode, planName, coverageType, planYear);
    if (seenPlans.has(key)) {
      issues.push({
        severity: "error",
        sheet: "Plans",
        row,
        ref: clientCode,
        message: `Duplicate plan: ${planName} / ${rawCoverage} / ${planYear}.`,
      });
      return;
    }
    seenPlans.add(key);

    const feeBasis = str(r.fee_basis) ?? "PEPM";
    if (!FEE_BASES.includes(feeBasis)) {
      issues.push({ severity: "error", sheet: "Plans", row, ref: clientCode, message: `Unknown fee_basis "${feeBasis}".` });
    }
    const brokerMode = str(r.broker_mode) ?? "NONE";
    if (!BROKER_MODES.includes(brokerMode)) {
      issues.push({ severity: "error", sheet: "Plans", row, ref: clientCode, message: `Unknown broker_mode "${brokerMode}".` });
    }

    const effectiveDate = date(r.effective_date);
    if (!effectiveDate) {
      issues.push({ severity: "error", sheet: "Plans", row, ref: clientCode, message: "effective_date is required." });
    }

    const coinsuranceText = str(r.coinsurance_summary);
    const deductibleText = str(r.deductible);
    const orthoText = str(r.orthodontia);
    const coins = parseCoinsurance(coinsuranceText);
    const ortho = parseOrthodontia(orthoText);
    const deductible = parseDeductible(deductibleText);

    const surplus = num(r.surplus_deficit);
    if (surplus !== null && !hasSurplusAsOf) {
      // Recorded once, not per row — the caller turns this into a single warning.
    }

    parsedPlans.push({
      row,
      clientCode,
      planName,
      planYear,
      coverageType,
      values: {
        planName,
        planYear,
        coverageType,
        effectiveDate,
        ...owned(planCols, {
          feeBasis: ["fee_basis", feeBasis, true],
          brokerMode: ["broker_mode", brokerMode, true],
          brokerValue: ["broker_value", dec(num(r.broker_value), 4)],
          flatMonthlyFee: ["flat_monthly_fee", dec(num(r.flat_monthly_fee))],
          flat90DBFee: ["flat_90db_fee", dec(num(r.flat_90db_fee))],
          flatSimpleFee: ["flat_simple_fee", dec(num(r.flat_simple_fee))],
          flatNetworkFee: ["flat_network_fee", dec(num(r.flat_network_fee))],
          // Written explicitly, including when blank: annual_limit carries a column
          // default that would otherwise invent a maximum for a plan that has none.
          annualLimit: ["annual_limit", dec(num(r.annual_limit))],
          deductible: ["deductible", dec(deductible.value)],
          // The basis is an observation about the shape of the design and survives
          // truncation; the individual figures do not, because a partial rendering of
          // the bands would read as the whole design.
          planBasis: ["coinsurance_summary", coins.planBasis],
          preventivePercent: ["coinsurance_summary", coinsValue(coins, coins.preventivePercent)],
          correctivePercent: ["coinsurance_summary", coinsValue(coins, coins.correctivePercent)],
          restorativePercent: ["coinsurance_summary", coinsValue(coins, coins.restorativePercent)],
          dollarTier1Percent: ["coinsurance_summary", coinsValue(coins, coins.dollarTier1Percent)],
          dollarTier1Limit: ["coinsurance_summary", coinsValue(coins, dec(coins.dollarTier1Limit))],
          dollarTier2Percent: ["coinsurance_summary", coinsValue(coins, coins.dollarTier2Percent)],
          dollarTier2Limit: ["coinsurance_summary", coinsValue(coins, dec(coins.dollarTier2Limit))],
          dollarTier3Percent: ["coinsurance_summary", coinsValue(coins, coins.dollarTier3Percent)],
          dollarTier3Limit: ["coinsurance_summary", coinsValue(coins, dec(coins.dollarTier3Limit))],
          orthoEligibility: ["orthodontia", ortho.orthoEligibility],
          orthoCoinsurancePercent: ["orthodontia", ortho.orthoCoinsurancePercent],
          orthoLifetimeMax: ["orthodontia", dec(ortho.orthoLifetimeMax)],
          orthoMaxType: ["orthodontia", ortho.orthoMaxType],
          assignmentOfBenefits: ["assignment_of_benefits", bool(r.assignment_of_benefits), true],
          surplusDeficit: ["surplus_deficit", dec(surplus)],
          surplusDeficitAsOfDate: ["surplus_deficit_as_of", hasSurplusAsOf ? date(r.surplus_deficit_as_of) : null],
        }),
        planNotes: composeNotes({
          sheetNotes: str(r.plan_notes),
          extras: [
            ["Deductible", deductible.lossy ? deductibleText : null],
            ["Coinsurance", coins.lossy ? coinsuranceText : null],
            ["Orthodontia", ortho.lossy ? orthoText : null],
          ],
        }),
      },
    });
  });

  if (parsedPlans.some((p) => p.values.surplusDeficit !== null) && !hasSurplusAsOf) {
    issues.push({
      severity: "warning",
      sheet: "Plans",
      message:
        "surplus_deficit is present but there is no surplus_deficit_as_of column, so the figures will be stored " +
        "without an as-of date. A surplus is a point-in-time position taken from one monthly report; without the " +
        "date it cannot be compared against the account balance with any confidence. Add a surplus_deficit_as_of " +
        "column to the Plans sheet and re-run to fill it in.",
    });
  }

  // ── Rate cards ──
  const parsedRates: ParsedRate[] = [];
  const seenRates = new Set<string>();
  const planIndex = new Set(parsedPlans.map((p) => planKey(p.clientCode, p.planName, p.coverageType, p.planYear)));

  rowsOf("Rate Cards").forEach((r, i) => {
    const row = i + 2;
    const clientCode = str(r.client_code);
    const planName = str(r.plan_name);
    const planYear = int(r.plan_year);
    const rawCoverage = str(r.coverage_type);
    const tierLabel = str(r.tier_label);
    if (!clientCode || !planName || planYear === null || !rawCoverage || !tierLabel) {
      issues.push({
        severity: "error",
        sheet: "Rate Cards",
        row,
        message: "client_code, plan_name, plan_year, coverage_type and tier_label are all required.",
      });
      return;
    }
    const coverageType = COVERAGE_MAP[rawCoverage.toUpperCase()];
    if (!coverageType) {
      issues.push({ severity: "error", sheet: "Rate Cards", row, ref: clientCode, message: `Unknown coverage_type "${rawCoverage}".` });
      return;
    }
    const key = planKey(clientCode, planName, coverageType, planYear);
    if (!planIndex.has(key)) {
      issues.push({
        severity: "error",
        sheet: "Rate Cards",
        row,
        ref: clientCode,
        message: `No plan on the Plans sheet matches ${planName} / ${rawCoverage} / ${planYear}.`,
      });
      return;
    }
    const tierKey = `${key}\u0000${tierLabel}`;
    if (seenRates.has(tierKey)) {
      issues.push({
        severity: "error",
        sheet: "Rate Cards",
        row,
        ref: clientCode,
        message: `Duplicate tier "${tierLabel}" for ${planName} / ${rawCoverage} / ${planYear}.`,
      });
      return;
    }
    seenRates.add(tierKey);

    const note = str(r.NOTES);
    if (note) flagged.push({ ref: `${clientCode} ${planName} ${planYear} ${tierLabel}`, note });

    parsedRates.push({
      row,
      clientCode,
      planName,
      planYear,
      coverageType,
      tierLabel,
      tierOrder: int(r.tier_order) ?? 0,
      note,
      values: {
        baseAdminFee: dec(num(r.ninety_degree_base_fee)),
        cobraFee: dec(num(r.cobra_fee)),
        simpleFee: dec(num(r.simple_fee)),
        networkFee: dec(num(r.network_fee)),
        brokerFee: dec(num(r.broker_fee)),
        totalAdminFee: dec(num(r.total_admin_fee)),
        expectedClaims: dec(num(r.expected_claims)),
        monthlyPremium: dec(num(r.monthly_premium)),
      },
    });
  });

  const withRates = new Set(parsedRates.map((r) => planKey(r.clientCode, r.planName, r.coverageType, r.planYear)));
  for (const p of parsedPlans) {
    if (!withRates.has(planKey(p.clientCode, p.planName, p.coverageType, p.planYear))) {
      issues.push({
        severity: "warning",
        sheet: "Plans",
        row: p.row,
        ref: p.clientCode,
        message: `${p.planName} / ${p.planYear} has no rate rows. The plan will be imported with no rate card.`,
      });
    }
  }

  const clientCodes = new Set(parsedClients.map((c) => normalizeCode(c.clientCode)));
  for (const p of parsedPlans) {
    if (!clientCodes.has(normalizeCode(p.clientCode))) {
      issues.push({
        severity: "error",
        sheet: "Plans",
        row: p.row,
        ref: p.clientCode,
        message: `Plan references client "${p.clientCode}", which is not on the Clients sheet.`,
      });
    }
  }

  return { clients: parsedClients, plans: parsedPlans, rates: parsedRates, brokerContacts: parsedBrokerContacts, issues, flagged };
}

// ─── Applying ───────────────────────────────────────────────────────────────

/** Compares only the fields the workbook owns, so unrelated edits are not counted. */
function changedFields(existing: Record<string, any>, next: Record<string, any>): string[] {
  const changed: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    const cur = existing[k];
    if (v === null && (cur === null || cur === undefined)) continue;
    if (v instanceof Date || cur instanceof Date) {
      const a = v instanceof Date ? v.getTime() : v === null ? null : new Date(v as any).getTime();
      const b = cur instanceof Date ? cur.getTime() : cur === null || cur === undefined ? null : new Date(cur).getTime();
      if (a !== b) changed.push(k);
      continue;
    }
    // Decimal columns come back as strings ("2.05" vs "2.0500"); compare numerically.
    const bothNumeric = v !== null && cur !== null && cur !== undefined && !Number.isNaN(Number(v)) && !Number.isNaN(Number(cur));
    if (bothNumeric) {
      if (Number(v) !== Number(cur)) changed.push(k);
      continue;
    }
    if (v !== cur) changed.push(k);
  }
  return changed;
}

export async function runImport(buffer: Buffer, mode: ImportMode): Promise<ImportResult> {
  const parsed = parseWorkbook(buffer);
  const issues = [...parsed.issues];

  const result: ImportResult = {
    ok: false,
    mode,
    applied: false,
    issues,
    counts: {
      clients: { created: 0, updated: 0, unchanged: 0 },
      plans: { created: 0, updated: 0, unchanged: 0 },
      rateCards: { created: 0, updated: 0, unchanged: 0 },
      brokerContacts: { created: 0, updated: 0, unchanged: 0 },
    },
    brokerContactsRemoved: 0,
    tiersRemoved: 0,
    notInFile: { clients: [], plans: [] },
    flagged: parsed.flagged,
  };

  if (issues.some((i) => i.severity === "error")) return result;

  try {
    await db.transaction(async (tx) => {
      // ── Resolve every workbook row to a stored record before writing anything ──
      //
      // Matching on the literal code string is not enough: the stored data spells the
      // same client both S-020 and S-20. A strict match would treat the workbook row
      // as a new client, and the insert would then collide with the unique client name
      // partway through the run. Failing at that point is the worst outcome — it is
      // opaque, and it is discovered only after the import has started.
      //
      // Both checks below therefore run up front, on the whole workbook, and abort
      // before a single row is written.
      const existingClients = await tx
        .select({ id: clients.id, clientCode: clients.clientCode, clientName: clients.clientName })
        .from(clients);
      const byExactCode = new Map(existingClients.map((c) => [c.clientCode, c]));
      const byNormCode = new Map<string, typeof existingClients>();
      for (const c of existingClients) {
        const k = normalizeCode(c.clientCode);
        byNormCode.set(k, [...(byNormCode.get(k) ?? []), c]);
      }

      const preflight: ImportIssue[] = [];
      type ExistingClient = { id: number; clientCode: string; clientName: string };
      const resolved = new Map<string, ExistingClient | null>();

      for (const c of parsed.clients) {
        const exact = byExactCode.get(c.clientCode);
        if (exact) {
          resolved.set(c.clientCode, exact);
          continue;
        }
        const candidates = byNormCode.get(normalizeCode(c.clientCode)) ?? [];
        if (candidates.length > 1) {
          preflight.push({
            severity: "error",
            sheet: "Clients",
            row: c.row,
            ref: c.clientCode,
            message:
              `"${c.clientCode}" matches more than one stored client (${candidates.map((x) => x.clientCode).join(", ")}). ` +
              "Resolve the duplicate before importing — picking one here would be a guess.",
          });
          resolved.set(c.clientCode, null);
          continue;
        }
        if (candidates.length === 1) {
          const hit = candidates[0];
          resolved.set(c.clientCode, hit);
          preflight.push({
            severity: "warning",
            sheet: "Clients",
            row: c.row,
            ref: c.clientCode,
            message:
              `Matched stored client ${hit.clientCode} ("${hit.clientName}") on a differently padded code. ` +
              `The stored code stays ${hit.clientCode}; renaming it here could break the monthly report import, ` +
              "which matches clients on that exact string.",
          });
          continue;
        }
        resolved.set(c.clientCode, null);
      }

      // Client names carry a uniqueness constraint of their own, so a name already
      // held by a different record has to be caught here rather than by the database.
      const byName = new Map(existingClients.map((c) => [c.clientName.trim().toLowerCase(), c]));
      for (const c of parsed.clients) {
        const target = resolved.get(c.clientCode) ?? null;
        const holder = byName.get(String(c.values.clientName).trim().toLowerCase());
        if (holder && holder.id !== target?.id) {
          preflight.push({
            severity: "error",
            sheet: "Clients",
            row: c.row,
            ref: c.clientCode,
            message:
              `The name "${c.values.clientName}" already belongs to stored client ${holder.clientCode}. ` +
              "Client names must be unique, so this row cannot be imported under a different code.",
          });
        }
      }

      result.issues.push(...preflight);
      if (preflight.some((i) => i.severity === "error")) throw new Rollback();

      const clientIdByCode = new Map<string, number>();

      // ── Clients ──
      for (const c of parsed.clients) {
        const match = resolved.get(c.clientCode) ?? null;
        const [existing] = match
          ? await tx.select().from(clients).where(eq(clients.id, match.id)).limit(1)
          : [undefined];
        const values = { ...c.values } as Record<string, any>;

        if (existing) {
          // The stored client code is left exactly as it is. Other parts of the system
          // match clients on that literal string, the monthly report import among them,
          // so quietly renaming S-020 to S-20 could break matching well away from here.
          // The difference is reported instead, as something to decide deliberately.
          if (existing.clientCode !== values.clientCode) delete values.clientCode;

          // clientStatus is never reconciled against the active flag here. It now
          // carries prospect-versus-client only; whether a client is active,
          // terminating, in run-out or closed is derived from the termination date
          // (see shared/client-state.ts). Writing TERMINATED because a workbook
          // said is_active=false is exactly the contradiction that model removes:
          // it would flatten a client with a known future departure into a closed
          // one and cut off their run-out PPRs and claims.

          const changed = changedFields(existing as any, values);
          if (changed.length) {
            await tx.update(clients).set({ ...values, updatedAt: new Date() }).where(eq(clients.id, existing.id));
            result.counts.clients.updated++;
          } else {
            result.counts.clients.unchanged++;
          }
          clientIdByCode.set(normalizeCode(c.clientCode), existing.id);
        } else {
          // clientStatus is deliberately not inferred here either. A new row with
          // is_active=false and no termination date already derives as CLOSED,
          // which is exactly the legacy shape; writing a duplicate lifecycle
          // status alongside the date is what let the two disagree before.
          const [created] = await tx.insert(clients).values(values as any).returning({ id: clients.id });
          result.counts.clients.created++;
          clientIdByCode.set(normalizeCode(c.clientCode), created.id);
        }
      }

      // ── Broker contacts ──
      //
      // Written as a set per client: rows matched to the person already on file by
      // name, anyone the workbook no longer lists removed. That is what lets a
      // corrections file record someone leaving the account, which a row-by-row
      // upsert cannot express.
      for (const set of parsed.brokerContacts) {
        const norm = normalizeCode(set.clientCode);
        let clientId = clientIdByCode.get(norm);
        if (clientId === undefined) {
          // Only reachable from the Broker Contacts sheet, which may name a client the
          // Clients sheet does not repeat.
          const candidates = byNormCode.get(norm) ?? [];
          if (candidates.length !== 1) {
            result.issues.push({
              severity: "error",
              sheet: set.sheet,
              row: set.row,
              ref: set.clientCode,
              message: candidates.length === 0
                ? `No stored client matches "${set.clientCode}".`
                : `"${set.clientCode}" matches more than one stored client. Resolve the duplicate first.`,
            });
            continue;
          }
          clientId = candidates[0].id;
        }

        const existing = await tx.select().from(brokerContacts).where(eq(brokerContacts.clientId, clientId));
        const byName = new Map(existing.map((r) => [r.contactName.trim().toLowerCase(), r]));

        // Cleared first: only one serving primary per client is allowed, so a swap
        // between two people would otherwise collide mid-update.
        await tx.update(brokerContacts).set({ isPrimary: false }).where(eq(brokerContacts.clientId, clientId));

        const keptIds: number[] = [];
        for (const c of set.contacts) {
          const prior = byName.get(c.contactName.trim().toLowerCase());
          // A column the sheet does not carry keeps whatever is already on file, so a
          // names-and-emails file cannot wipe stored phone numbers, roles, or the
          // termination date that says somebody has left.
          const keep = <T>(supplied: boolean, value: T, stored: T | undefined): T =>
            supplied ? value : (stored ?? value);
          const values = {
            contactName: c.contactName.trim(),
            email: keep(c.provided.email, c.email, prior?.email),
            phone: keep(c.provided.phone, c.phone, prior?.phone),
            role: keep(c.provided.role, c.role, prior?.role),
            notes: keep(c.provided.notes, c.notes, prior?.notes),
            effectiveDate: c.provided.effectiveDate
              ? c.effectiveDate
              : (prior?.effectiveDate ?? c.effectiveDate),
            terminationDate: keep(c.provided.terminationDate, c.terminationDate, prior?.terminationDate),
            updatedAt: new Date(),
          };
          if (prior) {
            const changed = changedFields(prior as any, values);
            if (changed.length) {
              await tx.update(brokerContacts).set(values).where(eq(brokerContacts.id, prior.id));
              result.counts.brokerContacts.updated++;
            } else {
              result.counts.brokerContacts.unchanged++;
            }
            keptIds.push(prior.id);
          } else {
            const [created] = await tx.insert(brokerContacts)
              .values({ clientId, ...values, isPrimary: false })
              .returning({ id: brokerContacts.id });
            result.counts.brokerContacts.created++;
            keptIds.push(created.id);
          }
        }

        const removed = existing.filter((r) => !keptIds.includes(r.id));
        if (removed.length) {
          await tx.delete(brokerContacts).where(inArray(brokerContacts.id, removed.map((r) => r.id)));
          result.brokerContactsRemoved += removed.length;
          for (const r of removed) {
            result.issues.push({
              severity: "warning",
              sheet: set.sheet,
              row: set.row,
              ref: set.clientCode,
              message: `Removed broker contact "${r.contactName}" — the workbook no longer lists them for this client.`,
            });
          }
        }

        // Primary last, once every other row is known to be non-primary.
        const servingIdx = set.contacts.findIndex((c) => c.isPrimary && !c.terminationDate);
        const fallbackIdx = set.contacts.findIndex((c) => !c.terminationDate);
        const primaryIdx = servingIdx >= 0 ? servingIdx : fallbackIdx;
        const primaryId = primaryIdx >= 0 ? keptIds[primaryIdx] : undefined;
        if (primaryId !== undefined) {
          await tx.update(brokerContacts).set({ isPrimary: true }).where(eq(brokerContacts.id, primaryId));
        }

        // Mirror the lead onto the flat columns so every reader that predates this
        // table keeps working, and keeps showing the lead rather than whoever was
        // written last. Read back rather than mirroring the workbook row: a column the
        // sheet did not carry was preserved above, and the mirror has to agree with
        // what is actually stored.
        const [primary] = primaryId === undefined
          ? [undefined]
          : await tx.select().from(brokerContacts).where(eq(brokerContacts.id, primaryId));
        await tx.update(clients).set({
          brokerContactName: primary?.contactName ?? null,
          brokerEmail: primary?.email ?? null,
          brokerPhone: primary?.phone ?? null,
          updatedAt: new Date(),
        }).where(eq(clients.id, clientId));
      }

      // ── Plans ──
      const planIdByKey = new Map<string, number>();
      for (const p of parsed.plans) {
        const clientId = clientIdByCode.get(normalizeCode(p.clientCode))!;
        const [existing] = await tx
          .select()
          .from(plans)
          .where(
            and(
              eq(plans.clientId, clientId),
              eq(plans.planName, p.planName),
              eq(plans.planYear, p.planYear),
              eq(plans.coverageType, p.coverageType as any),
            ),
          )
          .limit(1);

        const values = { ...p.values, clientId } as Record<string, any>;
        let planId: number;
        if (existing) {
          const changed = changedFields(existing as any, values);
          if (changed.length) {
            await tx.update(plans).set({ ...values, updatedAt: new Date() }).where(eq(plans.id, existing.id));
            result.counts.plans.updated++;
          } else {
            result.counts.plans.unchanged++;
          }
          planId = existing.id;
        } else {
          const [created] = await tx.insert(plans).values(values as any).returning({ id: plans.id });
          result.counts.plans.created++;
          planId = created.id;
        }
        planIdByKey.set(planKey(p.clientCode, p.planName, p.coverageType, p.planYear), planId);
      }

      // ── Tiers and rate cards ──
      const ratesByPlan = new Map<string, ParsedRate[]>();
      for (const r of parsed.rates) {
        const key = planKey(r.clientCode, r.planName, r.coverageType, r.planYear);
        const list = ratesByPlan.get(key) ?? [];
        list.push(r);
        ratesByPlan.set(key, list);
      }

      for (const [key, rows] of Array.from(ratesByPlan.entries())) {
        const planId = planIdByKey.get(key)!;
        const planRow = parsed.plans.find(
          (p) => planKey(p.clientCode, p.planName, p.coverageType, p.planYear) === key,
        )!;
        const effectiveDate = planRow.values.effectiveDate as Date | null;

        const existingTiers = await tx.select().from(planTiers).where(eq(planTiers.planId, planId));
        const tierByLabel = new Map(existingTiers.map((t) => [t.label, t]));
        const existingCards = await tx.select().from(rateCards).where(eq(rateCards.planId, planId));
        const cardByTierId = new Map(existingCards.filter((c) => c.planTierId !== null).map((c) => [c.planTierId!, c]));

        const keptTierIds = new Set<number>();

        for (const r of rows) {
          let tier = tierByLabel.get(r.tierLabel);
          let tierId: number;
          if (tier) {
            tierId = tier.id;
            if (tier.displayOrder !== r.tierOrder) {
              await tx.update(planTiers).set({ displayOrder: r.tierOrder }).where(eq(planTiers.id, tierId));
            }
          } else {
            const [createdTier] = await tx
              .insert(planTiers)
              .values({ planId, label: r.tierLabel, displayOrder: r.tierOrder })
              .returning({ id: planTiers.id });
            tierId = createdTier.id;
          }
          keptTierIds.add(tierId);

          const values = { ...r.values, planId, planTierId: tierId, effectiveDate } as Record<string, any>;
          const existingCard = cardByTierId.get(tierId);
          if (existingCard) {
            const changed = changedFields(existingCard as any, values);
            if (changed.length) {
              await tx.update(rateCards).set({ ...values, updatedAt: new Date() }).where(eq(rateCards.id, existingCard.id));
              result.counts.rateCards.updated++;
            } else {
              result.counts.rateCards.unchanged++;
            }
          } else {
            await tx.insert(rateCards).values(values as any);
            result.counts.rateCards.created++;
          }
        }

        // Within a plan the workbook is the whole rate card, so a tier it no longer
        // lists has genuinely gone. This is scoped strictly to plans in the file.
        const staleTierIds = existingTiers.filter((t) => !keptTierIds.has(t.id)).map((t) => t.id);
        if (staleTierIds.length) {
          await tx.delete(rateCards).where(inArray(rateCards.planTierId, staleTierIds));
          await tx.delete(planTiers).where(inArray(planTiers.id, staleTierIds));
          result.tiersRemoved += staleTierIds.length;
        }
        // Legacy rows predating per-plan tiers would otherwise duplicate the tiers
        // just written, since they carry the old fixed enum and no plan_tier_id.
        const orphanCards = existingCards.filter((c) => c.planTierId === null).map((c) => c.id);
        if (orphanCards.length) await tx.delete(rateCards).where(inArray(rateCards.id, orphanCards));
      }

      // ── Report what the workbook does not mention. Nothing here is deleted. ──
      const allClients = await tx.select({ id: clients.id, code: clients.clientCode }).from(clients);
      const fileCodes = new Set(parsed.clients.map((c) => c.clientCode));
      result.notInFile.clients = allClients.filter((c) => !fileCodes.has(c.code)).map((c) => c.code).sort();

      const codeById = new Map(allClients.map((c) => [c.id, c.code]));
      const allPlans = await tx
        .select({
          clientId: plans.clientId,
          planName: plans.planName,
          planYear: plans.planYear,
          coverageType: plans.coverageType,
        })
        .from(plans);
      const fileePlanKeys = new Set(
        parsed.plans.map((p) => planKey(p.clientCode, p.planName, p.coverageType, p.planYear)),
      );
      result.notInFile.plans = allPlans
        .filter((p) => {
          const code = codeById.get(p.clientId);
          if (!code) return false;
          return !fileePlanKeys.has(planKey(code, p.planName, p.coverageType ?? "", p.planYear));
        })
        .map((p) => `${codeById.get(p.clientId)} ${p.planName} ${p.coverageType ?? "no coverage"} ${p.planYear}`)
        .sort();

      result.ok = true;
      if (mode === "validate") throw new Rollback();
      result.applied = true;
    });
  } catch (err) {
    if (!(err instanceof Rollback)) {
      result.ok = false;
      result.applied = false;
      result.issues.push({
        severity: "error",
        sheet: "-",
        message: `Import failed and nothing was written: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return result;
}
