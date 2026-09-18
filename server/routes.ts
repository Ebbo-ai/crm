import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, StaleOrderError, type BrokerContactInput } from "./storage";
import { db } from "./db";
import { renewals, renewalPlanOptions, clients, plans, brokerContacts } from "@shared/schema";
import {
  RUN_OUT_MONTHS,
  countsAsActive,
  deriveClientState,
  generatesPpr,
  runOutEndYearMonth,
  suppressesRenewals,
  toYearMonth,
} from "@shared/client-state";
import {
  ROSTER_PLAN_TYPES,
  derivePlanType,
  type ClientRosterResponse,
  type RosterExclusion,
  type RosterRow,
} from "@shared/roster";
import {
  checkResolutionNote, isResolutionType, isTaskPriority, READ_NO_TASK_NOTE,
} from "@shared/communication-state";
import { and, eq, desc, ne, or, isNull, inArray } from "drizzle-orm";
import { setupAuth, requireAuth, requireAdmin } from "./auth";
import { runImport } from "./crm-import";
import {
  buildCommunicationLinkExport,
  buildResetPreview,
  runDataReset,
  reattachCommunicationLinks,
  ResetNotConfirmedError,
} from "./data-reset";
import { matchEmailToClients, matchTextToClients, processEmail, queryClientCommunications, findDuplicateTask } from "./claude";
import { buildClientRefs } from "./client-context";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { computeRenewalBuckets, getAnniversaryForPlanYear } from "./renewal-buckets";
import { callRatingEngine, sendRatingEngineError } from "./rating-engine";

const uploadDir = path.join(process.cwd(), "uploads");

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subDir = (req as any).uploadSubDir || "documents";
    const clientId = req.params.id || req.params.clientId || "general";
    const dir = path.join(uploadDir, subDir, String(clientId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${timestamp}-${safeName}`);
  },
});

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "text/plain",
];

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted types: PDF, DOC, DOCX, XLS, XLSX, CSV, PNG, JPEG, GIF, TXT`));
    }
  },
});

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Seven-step pipeline order. Index used for urgency sorting and completion checks.
const PIPELINE_STEPS = ["REQUESTED","PROCESSED","SENT","REVISED","ACCEPTED","SIGNED_FORM_ATTACHED","EMAILED_TO_90D"];
const FINAL_STEP = "EMAILED_TO_90D";

/**
 * A renewal is open until it reaches the final step.
 *
 * Must be NULL-safe: a brand new renewal has pipeline_step = NULL, and in SQL
 * `NULL <> 'EMAILED_TO_90D'` evaluates to NULL rather than TRUE, so a plain
 * inequality silently drops every not-yet-started renewal — which is the most
 * common state there is.
 */
const openRenewalPredicate = () =>
  or(isNull(renewals.pipelineStep), ne(renewals.pipelineStep, FINAL_STEP));

/**
 * The anniversary date stores an original effective date (e.g. 2019-04-01), so
 * the year is historical. This projects it onto the next occurrence from today.
 * Used to decide WHICH plan year to open a renewal for.
 */
/**
 * Read a broker contact set off a request body.
 *
 * Returns `contacts: undefined` when the key is absent — the caller is not speaking
 * about contacts, so the stored set is left alone. An empty array is a real statement
 * that the client has none. Any request that names contacts is rejected outright rather
 * than partly applied, because the write replaces the whole set.
 */
function parseBrokerContacts(body: any): { contacts?: BrokerContactInput[]; error?: string } {
  if (body?.brokerContacts === undefined || body?.brokerContacts === null) return {};
  if (!Array.isArray(body.brokerContacts)) return { error: "brokerContacts must be a list." };

  const contacts: BrokerContactInput[] = [];
  for (const c of body.brokerContacts) {
    const contactName = String(c?.contactName ?? "").trim();
    if (!contactName) continue;
    // An absent key and an explicit null mean different things, and the difference
    // matters: the contact editor does not carry the dates at all, so treating its
    // silence as "clear them" would wipe the termination date that records somebody
    // having left the account every time an unrelated field is saved. Absent leaves
    // the stored value alone; null clears it.
    const parseDate = (present: boolean, v: any, field: string): Date | null | string | undefined => {
      if (!present) return undefined;
      if (v === undefined || v === null || v === "") return null;
      const d = new Date(v);
      return isNaN(d.getTime()) ? `"${v}" is not a valid ${field} for ${contactName}.` : d;
    };
    const effectiveDate = parseDate(c != null && "effectiveDate" in c, c?.effectiveDate, "effective date");
    if (typeof effectiveDate === "string") return { error: effectiveDate };
    const terminationDate = parseDate(c != null && "terminationDate" in c, c?.terminationDate, "termination date");
    if (typeof terminationDate === "string") return { error: terminationDate };

    contacts.push({
      contactName,
      email: c?.email ? String(c.email).trim() : null,
      phone: c?.phone ? String(c.phone).trim() : null,
      role: c?.role ? String(c.role).trim() : null,
      notes: c?.notes ? String(c.notes).trim() : null,
      isPrimary: Boolean(c?.isPrimary),
      effectiveDate,
      terminationDate,
    });
  }

  // The business key is (client, name), so a duplicate would silently collapse two
  // people into one row rather than failing.
  const seen = new Set<string>();
  for (const c of contacts) {
    const key = c.contactName.toLowerCase();
    if (seen.has(key)) return { error: `"${c.contactName}" is listed twice. One row per person.` };
    seen.add(key);
  }

  const primaries = contacts.filter(c => c.isPrimary && !c.terminationDate);
  if (primaries.length > 1) return { error: "Only one serving contact can be the primary." };

  return { contacts };
}

function getUpcomingAnniversary(anniversaryDate: Date, today: Date): Date {
  const upcoming = new Date(anniversaryDate);
  upcoming.setFullYear(today.getFullYear());
  if (upcoming < today) upcoming.setFullYear(today.getFullYear() + 1);
  return upcoming;
}

/**
 * The anniversary that a specific renewal cycle is measured against.
 *
 * Timing warnings must use this, not the upcoming anniversary: the upcoming one
 * is always in the future by construction, so comparing today against it can
 * never produce OVERDUE. A renewal for plan year 2025 left unfinished into 2026
 * is overdue against its own 2025 anniversary.
 */
/* ── Renewal report ──────────────────────────────────────────────────────────
 * The document sent to 90 Degree Benefits once a client accepts their renewal.
 * It tells them exactly what to change in their claims system for the new year.
 *
 * IMPORTANT: this is the ONE document that breaks broker compensation out as its
 * own line. Everywhere else it is folded into a single combined administrative
 * fee, because those documents are client facing. 90 Degree Benefits sets up the
 * billing, so they need every component separately. Do not "fix" this file by
 * applying the client facing suppression rule used elsewhere.
 *
 * Current vs new comes from the year-specific plan rows. Plans are unique on
 * (client_id, plan_name, plan_year), so the row for the renewal's plan year is
 * the "new" side and the most recent earlier year is the "current" side.
 */

const ORTHO_ELIGIBILITY_LABELS: Record<string, string> = {
  NONE: "None", CHILDREN: "Children only", ALL: "All members",
};
const ORTHO_MAX_TYPE_LABELS: Record<string, string> = {
  SHARED_ANNUAL: "Shared with annual maximum", SEPARATE_LIFETIME: "Separate lifetime maximum",
};
const PLAN_BASIS_LABELS: Record<string, string> = {
  PROCEDURE_BASED: "Procedure based", DOLLAR_BASED: "Dollar based",
};
const PLAN_COVERAGE_TYPE_LABELS: Record<string, string> = {
  DENTAL_ONLY: "dental",
  VISION_ONLY: "vision",
  DENTAL_VISION: "dental and vision",
  DENTAL_VISION_HEARING: "dental, vision and hearing",
};

/**
 * A plan is identified by its coverage *and* its name, never by name alone.
 * Coverage is the benefit provided; the name is the benefit level within it. One
 * client can carry Standard on dental and Standard on vision, and pairing those
 * two against each other across plan years would compare unrelated plans.
 *
 * Coverage is nullable and still being filled in, so unset is its own bucket
 * rather than a wildcard. The NUL separator keeps a name containing the
 * separator from colliding with a different coverage.
 */
function planKey(p: any): string {
  return `${p?.coverageType ?? ""}\u0000${p?.planName ?? ""}`;
}

/** How a plan is named to a human reader. Disambiguates a name shared across coverages. */
function planLabel(p: any): string {
  const cov = p?.coverageType ? PLAN_COVERAGE_TYPE_LABELS[p.coverageType] ?? String(p.coverageType) : null;
  return cov ? `${p.planName} (${cov})` : String(p?.planName ?? "");
}

/** Decimal columns come back as strings. Empty and null both mean "not recorded". */
function dec(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function labelOf(map: Record<string, string>, v: any): string | null {
  if (v == null) return null;
  return map[String(v)] ?? String(v);
}

type TierEntry = { label: string; card: any };

/**
 * Tiers in display order, each with its rate card. Tiers are matched between
 * plan years by position rather than by label, so that a relabelled tier still
 * lines up with its predecessor instead of reading as one added and one removed.
 */
async function loadTierEntries(plan: any | null): Promise<TierEntry[]> {
  if (!plan) return [];
  const [tiers, cards] = await Promise.all([
    storage.getPlanTiers(plan.id),
    storage.getRateCards(plan.id),
  ]);
  if (tiers.length) {
    return [...tiers]
      .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((t: any) => ({
        label: t.label,
        card: cards.find((c: any) => c.planTierId === t.id) ?? null,
      }));
  }
  // Legacy plans predate plan_tiers and carry the fixed tier enum on the card.
  return cards.map((c: any, i: number) => ({ label: c.tier ?? `Tier ${i + 1}`, card: c }));
}

/** Every fee component, broken out. See the note at the top of this section. */
function feeComponents(card: any | null) {
  if (!card) return null;
  return {
    base_admin_fee: dec(card.baseAdminFee),
    cobra_fee: dec(card.cobraFee),
    simple_fee: dec(card.simpleFee),
    network_fee: dec(card.networkFee),
    broker_fee: dec(card.brokerFee),
    total_admin_fee: dec(card.totalAdminFee),
    expected_claims: dec(card.expectedClaims),
    monthly_premium: dec(card.monthlyPremium),
  };
}

/**
 * Charges billed as one flat monthly amount for the whole group rather than per
 * employee. Two distinct cases land here:
 *   - feeBasis FIXED_MONTHLY: the whole administrative fee is a group charge.
 *   - brokerMode FIXED_MONTHLY on a PEPM plan: only broker compensation is.
 * The second case is easy to miss and matters a lot. upsertTiersAndRates
 * deliberately writes $0 broker onto every tier row for that mode and keeps the
 * real amount on the plan record, so without this block the report would tell
 * 90 Degree Benefits the broker is paid nothing.
 */
function groupCharges(plan: any | null) {
  if (!plan) return null;
  const flatFee = plan.feeBasis === "FIXED_MONTHLY";
  const flatBroker = plan.brokerMode === "FIXED_MONTHLY";
  if (!flatFee && !flatBroker) return null;

  const broker = flatBroker ? dec(plan.brokerValue) : null;
  if (!flatFee) {
    // Per employee plan: the tier rates stand, only the broker is a group charge.
    return {
      base_admin_fee: null, simple_fee: null, network_fee: null,
      broker_fee: broker, total_admin_fee: null,
    };
  }
  const adminOnly = dec(plan.flatMonthlyFee);
  return {
    base_admin_fee: dec(plan.flat90DBFee),
    simple_fee: dec(plan.flatSimpleFee),
    network_fee: dec(plan.flatNetworkFee),
    broker_fee: broker ?? 0,
    // flatMonthlyFee is admin only and excludes broker, so add it back here.
    total_admin_fee: adminOnly == null && broker == null ? null : (adminOnly ?? 0) + (broker ?? 0),
  };
}

/** How broker compensation is calculated. brokerValue holds 0.08 to mean 8%. */
function brokerInfo(plan: any | null) {
  if (!plan) return null;
  const mode = plan.brokerMode ?? "NONE";
  const raw = dec(plan.brokerValue);
  return {
    mode,
    percent: mode === "PERCENT_OF_PREMIUM" && raw != null ? Math.round(raw * 1000000) / 10000 : null,
    amount: mode === "FLAT_PEPM" || mode === "FIXED_MONTHLY" ? raw : null,
  };
}

/** Plan design fields, raw. The renderer decides what counts as "no change". */
function designRows(cur: any | null, nw: any | null) {
  const f = (p: any | null, get: (p: any) => any) => (p ? get(p) : null);
  return [
    { label: "Annual maximum", kind: "money", current: f(cur, p => dec(p.annualLimit)), new: f(nw, p => dec(p.annualLimit)) },
    { label: "Deductible", kind: "money", current: f(cur, p => dec(p.deductible)), new: f(nw, p => dec(p.deductible)) },
    { label: "Preventive coinsurance", kind: "percent", current: f(cur, p => p.preventivePercent), new: f(nw, p => p.preventivePercent) },
    { label: "Corrective coinsurance", kind: "percent", current: f(cur, p => p.correctivePercent), new: f(nw, p => p.correctivePercent) },
    { label: "Restorative coinsurance", kind: "percent", current: f(cur, p => p.restorativePercent), new: f(nw, p => p.restorativePercent) },
    { label: "Orthodontia eligibility", kind: "text", current: f(cur, p => labelOf(ORTHO_ELIGIBILITY_LABELS, p.orthoEligibility)), new: f(nw, p => labelOf(ORTHO_ELIGIBILITY_LABELS, p.orthoEligibility)) },
    { label: "Orthodontia coinsurance", kind: "percent", current: f(cur, p => p.orthoCoinsurancePercent), new: f(nw, p => p.orthoCoinsurancePercent) },
    { label: "Orthodontia maximum type", kind: "text", current: f(cur, p => labelOf(ORTHO_MAX_TYPE_LABELS, p.orthoMaxType)), new: f(nw, p => labelOf(ORTHO_MAX_TYPE_LABELS, p.orthoMaxType)) },
    { label: "Orthodontia lifetime maximum", kind: "money", current: f(cur, p => dec(p.orthoLifetimeMax)), new: f(nw, p => dec(p.orthoLifetimeMax)) },
    { label: "Assignment of benefits", kind: "bool", current: f(cur, p => p.assignmentOfBenefits), new: f(nw, p => p.assignmentOfBenefits) },
    { label: "Plan design notes", kind: "text", current: f(cur, p => p.planNotes), new: f(nw, p => p.planNotes) },
  ];
}

/** Join names for prose: `"A"`, `"A" or "B"`, `"A", "B" or "C"`. */
function orList(names: string[]) {
  const q = names.map(n => `"${n}"`);
  if (q.length <= 1) return q[0] ?? "";
  return `${q.slice(0, -1).join(", ")} or ${q[q.length - 1]}`;
}

/**
 * Coverage was added to plan records after many plans were first entered, so
 * during the backfill a plan can carry its coverage this year and have none
 * recorded in an earlier year. Strict matching would call that a brand new plan
 * and report a discontinuation beside it, both false alarms caused by a records
 * gap rather than by anything the client did.
 *
 * Pairing the two is only safe when it involves no guessing, so a name is
 * eligible only when exactly one plan can possibly be the continuation:
 *
 *   eligible   one, and only one, plan this year carries the name and is
 *              otherwise unmatched. Safe to pair to the earlier uncovered plan.
 *   ambiguous  more than one does. This is the case the coverage change exists
 *              to support, a single plan splitting into separate dental and
 *              vision plans, and nothing in the data says which one continues
 *              the original. Never guessed at, reported instead.
 *
 * A name is skipped entirely when some plan this year still has no coverage
 * recorded, because that plan already pairs to the earlier uncovered plan on the
 * key itself and there is nothing left over to reconnect.
 *
 * Returned as one shared result so the pairing and the drift notices cannot
 * disagree about which plans were reconnected.
 */
function coverageBackfill(priorYearPlans: any[], newYearPlans: any[]) {
  const eligible = new Set<string>();
  const ambiguous = new Set<string>();

  // Judged strictly against the immediately preceding plan year, the same
  // horizon `dropped` uses. Looking further back gets both halves wrong: a plan
  // whose match lives two years ago would still leave last year's uncovered
  // record looking discontinued, and an older match would wrongly certify some
  // other coverage as the safe owner of that record.
  const priorKeys = new Set(priorYearPlans.map(planKey));
  // At most one per name: uniqueness treats NULLs as not distinct, so a client
  // cannot hold two uncovered plans of the same name in one year.
  const priorUncoveredNames = new Set(priorYearPlans.filter(p => !p.coverageType).map(p => p.planName));

  const byName = new Map<string, any[]>();
  for (const p of newYearPlans) {
    const list = byName.get(p.planName);
    if (list) list.push(p); else byName.set(p.planName, [p]);
  }

  for (const [name, plans] of Array.from(byName.entries())) {
    if (!priorUncoveredNames.has(name)) continue;
    if (plans.some(p => !p.coverageType)) continue;
    // Plans that already pair into the prior year on the key are settled and
    // cannot also lay claim to the uncovered record.
    const candidates = plans.filter(p => !priorKeys.has(planKey(p)));
    if (candidates.length === 1) eligible.add(name);
    else if (candidates.length > 1) ambiguous.add(name);
  }
  return { eligible, ambiguous };
}

/**
 * Work out which plans gained or lost a counterpart between the prior plan year
 * and the renewal year.
 *
 * Plans are paired across years by coverage *and* name, because rate_cards is
 * the only source of the fee component split. Matching on name alone would pair
 * a client's Standard dental plan against their Standard vision plan and present
 * two entirely different plans as a like for like renewal.
 *
 * The pairing still cannot tell a renamed plan apart from a genuinely new one:
 * both simply fail to match. Only one of them is correct to render as all new,
 * so neither is guessed at. Both sides are surfaced and a person decides before
 * the report goes out.
 *
 * The two sides are deliberately asymmetric:
 *   dropped  plans carried in the immediately preceding plan year on record and
 *            absent from the renewal year. Scoped to that one year so a plan
 *            discontinued three years ago is not raised again every renewal.
 *   added    plans in the renewal year with no counterpart in ANY earlier year.
 *            Matches how the prior plan is looked up, so a plan that skipped a
 *            year is not misreported as new.
 *
 * Both are returned as reader-facing labels, so a name shared across two
 * coverages is distinguishable in the notice text.
 */
function planNameDrift(allPlans: any[], renewalYear: number) {
  const earlier = allPlans.filter(p => p.planYear < renewalYear);
  const priorYear = earlier.length ? Math.max(...earlier.map(p => p.planYear)) : null;
  const priorYearPlans = priorYear === null ? [] : allPlans.filter(p => p.planYear === priorYear);
  const newYearPlans = allPlans.filter(p => p.planYear === renewalYear && !p.isArchived);

  const newKeys = new Set(newYearPlans.map(planKey));
  const everEarlierKeys = new Set(earlier.map(planKey));

  // Plans reconnected across a coverage records gap are not drift, and both
  // sides have to be excluded or one gap produces two false alarms: a
  // discontinuation that never happened, and a new plan that is really last
  // year's plan with its coverage now filled in. It would also offer each as the
  // other's rename candidate, which is the exact wrong answer.
  //
  // Ambiguous names are excluded from `dropped` too. The earlier plan really
  // does lack a counterpart there, but calling it a possible discontinuation
  // would be misleading when the likelier story is that it split in two, and
  // that case gets its own notice which says something more useful.
  const backfill = coverageBackfill(priorYearPlans, newYearPlans);

  return {
    priorYear,
    newYearPlans,
    backfill,
    dropped: Array.from(new Map(
      priorYearPlans
        .filter(p => !newKeys.has(planKey(p)))
        .filter(p => !(!p.coverageType
          && (backfill.eligible.has(p.planName) || backfill.ambiguous.has(p.planName))))
        .map(p => [planKey(p), planLabel(p)]),
    ).values()),
    added: Array.from(new Map(
      newYearPlans
        .filter(p => !everEarlierKeys.has(planKey(p)))
        .filter(p => !backfill.eligible.has(p.planName))
        .map(p => [planKey(p), planLabel(p)]),
    ).values()),
  };
}

/**
 * Build the report payload for one renewal. Throws with a `status` property so
 * the route can map it to the right HTTP code.
 */
async function buildRenewalReportPayload(renewalId: number) {
  const [renewal] = await db.select().from(renewals).where(eq(renewals.id, renewalId)).limit(1);
  if (!renewal) throw Object.assign(new Error("Renewal not found"), { status: 404 });

  const client = await storage.getClient(renewal.clientId);
  if (!client) throw Object.assign(new Error("Client not found"), { status: 404 });

  const options = await db.select().from(renewalPlanOptions)
    .where(eq(renewalPlanOptions.renewalId, renewalId));
  const accepted = options.filter(o => o.acceptedOption);
  if (!accepted.length) {
    throw Object.assign(
      new Error("No plan on this renewal has an accepted option recorded, so there is nothing to report."),
      { status: 400 },
    );
  }

  // Archived plans are kept in scope on purpose. A prior plan year is routinely
  // archived once it is superseded, and excluding it would erase the "current"
  // side of the comparison. Only the new year's plan is required to be active.
  const allPlans = await storage.getPlans(client.id);
  const notices: string[] = [];
  const planPayloads: any[] = [];

  const drift = planNameDrift(allPlans, renewal.planYear);
  const firstYearOnRecord = drift.priorYear === null;
  if (firstYearOnRecord) {
    notices.push(
      `This is the first plan year on record for ${client.clientName}, so there is nothing ` +
      `to compare against. Every value in this report is new.`,
    );
  }
  const reportedKeys = new Set<string>();

  for (const opt of accepted) {
    const optPlan = allPlans.find(p => p.id === opt.planId) ?? await storage.getPlan(opt.planId);
    if (!optPlan) {
      notices.push(`An accepted option references plan ${opt.planId}, which no longer exists.`);
      continue;
    }

    // Pair the plan across years by coverage and name. Unique on
    // (client, coverage, name, year), so this identifies at most one per year.
    const key = planKey(optPlan);
    const family = allPlans.filter(p => planKey(p) === key);
    const newPlan = family.find(p => p.planYear === renewal.planYear && !p.isArchived) ?? null;
    let priorPlan = family
      .filter(p => p.planYear < renewal.planYear)
      .sort((a, b) => b.planYear - a.planYear)[0] ?? null;

    // Reconnect a plan to its earlier self across a coverage records gap, but
    // only where coverageBackfill judged the pairing unambiguous. Where a name
    // now covers two plans, pairing both to the one earlier record would compare
    // the same old plan twice and quietly invent a history for whichever plan is
    // not its continuation.
    let coverageBackfillPair: any = null;
    if (optPlan.coverageType && drift.priorYear !== null
        && drift.backfill.eligible.has(optPlan.planName)) {
      const uncovered = allPlans.find(
        p => p.planYear === drift.priorYear && p.planName === optPlan.planName && !p.coverageType,
      ) ?? null;
      // Prefer it over an older exact match. Where a plan carried coverage two
      // years ago, lost it from the records last year, and carries it again now,
      // last year's record is still the real predecessor and comparing against
      // the older one would skip a year of changes. A plan that already pairs
      // into the prior year has the later year and keeps it, which is what stops
      // a settled plan from stealing the uncovered record.
      if (uncovered && (!priorPlan || priorPlan.planYear < uncovered.planYear)) {
        coverageBackfillPair = uncovered;
        priorPlan = uncovered;
      }
    }

    const name = planLabel(optPlan);
    reportedKeys.add(key);
    if (coverageBackfillPair) {
      notices.push(
        `${name}: no coverage was recorded on this plan in ${coverageBackfillPair.planYear}, so it was ` +
        `paired to the ${coverageBackfillPair.planYear} plan of the same name. Confirm that is the ` +
        `same plan, and set the coverage on the earlier record so future reports pair it directly.`,
      );
    }
    if (!newPlan) {
      notices.push(
        `${name}: there is no plan record for plan year ${renewal.planYear}. ` +
        `Set it up so the new rates and design can be reported.`,
      );
    }
    // This plan shares its name with another plan this year and with one earlier
    // plan that has no coverage recorded, so it is one side of a suspected split.
    // It gets its own explanation rather than the generic rename warning, which
    // would point at unrelated dropped plans while ignoring the same-named plan
    // sitting in the prior year.
    const coverageSplit = !priorPlan && !firstYearOnRecord
      && drift.backfill.ambiguous.has(optPlan.planName);

    // A plan with no earlier namesake is rendered as all new. That is right for
    // a genuinely new plan and wrong for a renamed one, and the pairing cannot
    // tell them apart, so say so instead of letting it pass silently.
    // When this is the client's first plan year, the absence of a comparison is
    // already stated once at the top. Repeating it per plan is noise, and the
    // plan section carries its own note anyway.
    const unmatchedNew = !priorPlan && !firstYearOnRecord && !coverageSplit;
    if (unmatchedNew) {
      notices.push(
        `${name}: no plan of this name exists in any earlier plan year, so it is reported as ` +
        `entirely new. ` +
        (drift.dropped.length
          ? `${orList(drift.dropped)} was carried in ${drift.priorYear} and has no counterpart ` +
            `this year. If this plan is that plan renamed, the report treats a rename as a new ` +
            `plan and none of its values are a like for like comparison. Confirm which it is ` +
            `before sending.`
          : `Confirm it is a new plan and not a rename before sending.`),
      );
    }

    const [priorTiers, newTiers] = await Promise.all([
      loadTierEntries(priorPlan),
      loadTierEntries(newPlan),
    ]);

    const tierRows: any[] = [];
    const len = Math.max(priorTiers.length, newTiers.length);
    for (let i = 0; i < len; i++) {
      const c = priorTiers[i] ?? null;
      const n = newTiers[i] ?? null;
      tierRows.push({
        current_label: c?.label ?? null,
        new_label: n?.label ?? null,
        current: feeComponents(c?.card ?? null),
        new: feeComponents(n?.card ?? null),
      });
      // Tier changes are the main thing 90 Degree needs flagged.
      if (priorPlan && newPlan) {
        if (c && n && c.label !== n.label) {
          notices.push(`${name}: tier "${c.label}" was relabelled to "${n.label}".`);
        } else if (!c && n) {
          notices.push(`${name}: tier "${n.label}" was added.`);
        } else if (c && !n) {
          notices.push(`${name}: tier "${c.label}" was removed.`);
        }
      }
    }

    if (priorPlan && newPlan && priorPlan.planBasis !== newPlan.planBasis) {
      notices.push(
        `${name}: plan basis changed from ${labelOf(PLAN_BASIS_LABELS, priorPlan.planBasis)} ` +
        `to ${labelOf(PLAN_BASIS_LABELS, newPlan.planBasis)}.`,
      );
    }
    if (priorPlan && newPlan && priorPlan.feeBasis !== newPlan.feeBasis) {
      notices.push(
        `${name}: billing basis changed from ${priorPlan.feeBasis} to ${newPlan.feeBasis}.`,
      );
    }

    const subject = newPlan ?? optPlan;
    planPayloads.push({
      plan_name: subject.planName,
      // Coverage is the benefit; plan_name is the benefit level within it. Sent
      // separately so the report can tell one client's Standard dental plan from
      // their Standard vision plan instead of printing the same heading twice.
      coverage: labelOf(PLAN_COVERAGE_TYPE_LABELS, subject.coverageType),
      accepted_option: opt.acceptedOption,
      fee_basis: subject.feeBasis ?? "PEPM",
      has_prior: !!priorPlan,
      has_new: !!newPlan,
      unmatched_new: unmatchedNew,
      rename_candidates: unmatchedNew ? drift.dropped : [],
      // One side of a suspected coverage split: same name as another plan this
      // year and as one earlier plan that has no coverage recorded.
      coverage_split: coverageSplit,
      coverage_split_prior_year: coverageSplit ? drift.priorYear : null,
      // Paired across a coverage records gap on the name alone. Being the only
      // candidate is not proof of identity, so the section says so.
      coverage_backfilled: !!coverageBackfillPair,
      coverage_backfilled_year: coverageBackfillPair ? coverageBackfillPair.planYear : null,
      prior_plan_year: priorPlan?.planYear ?? null,
      new_plan_year: newPlan?.planYear ?? null,
      design: designRows(priorPlan, newPlan),
      broker: { current: brokerInfo(priorPlan), new: brokerInfo(newPlan) },
      tiers: tierRows,
      group_charges: { current: groupCharges(priorPlan), new: groupCharges(newPlan) },
    });
  }

  // The loop above only visits plans with an accepted option, so a plan that
  // existed last year and lost its name match would otherwise never be reached
  // and would drop out of the report without a word. 90 Degree Benefits has to
  // be told whether it is going away or just called something else now.
  for (const gone of drift.dropped) {
    notices.push(
      `${gone}: carried in plan year ${drift.priorYear} and there is no plan of that name in ` +
      `${renewal.planYear}. ` +
      (drift.added.length
        ? `Either it was renamed to ${orList(drift.added)}, or it is being discontinued. ` +
          `Tell 90 Degree Benefits which, because the two need opposite handling.`
        : `Confirm whether it is being discontinued and tell 90 Degree Benefits if so.`),
    );
  }

  // One earlier plan with no coverage recorded, and several plans of that name
  // this year. Almost always a single plan that split into separate dental and
  // vision plans. Which one continues the original decides where the prior
  // year's history belongs, and nothing in the data says, so it is asked rather
  // than guessed. Without this the reader would only see each plan reported as
  // new, with no hint that a records gap caused it.
  for (const name of Array.from(drift.backfill.ambiguous)) {
    const split = drift.newYearPlans.filter(p => p.planName === name).map(planLabel);
    notices.push(
      `${name}: no coverage was recorded on the ${drift.priorYear} plan of this name, and ` +
      `${renewal.planYear} has more than one plan called ${name} (${orList(split)}). It cannot be ` +
      `told which one continues it, so each is reported as new. Set the coverage on the ` +
      `${drift.priorYear} record to pair them up.`,
    );
  }

  // A rename candidate the reader cannot find a section for is worse than no
  // candidate at all, so account for new year plans this report does not cover.
  for (const p of drift.newYearPlans) {
    if (reportedKeys.has(planKey(p))) continue;
    notices.push(
      `${planLabel(p)}: on record for plan year ${renewal.planYear} but no option has been ` +
      `accepted for it, so this report does not cover it.`,
    );
  }

  const anniversary = client.anniversaryDate
    ? getAnniversaryForPlanYear(new Date(client.anniversaryDate), renewal.planYear)
    : null;

  return {
    client: {
      client_name: client.clientName,
      group_number: client.clientCode ?? null,
      plan_year: renewal.planYear,
      anniversary_date: anniversary ? anniversary.toISOString().split("T")[0] : null,
    },
    plans: planPayloads,
    notices,
    generated_at: new Date().toISOString(),
    _meta: { client, renewal },
  };
}

/** Render the payload through the rating engine service. */
async function renderRenewalReport(payload: any, format: "html" | "pdf") {
  return await callRatingEngine<any>(
    "/generate-renewal-report",
    { payload, output_format: format },
    { failureMessage: "Renewal report generation failed" },
  );
}

/**
 * Opens the renewal record for a client's upcoming plan year once it is due to
 * start, and returns the currently open renewal (or null if none is open yet).
 *
 * A renewal opens 30 days before the proposal due date, giving staff lead time
 * to prepare the analysis before the proposal itself is owed to the client.
 *
 * Called from GET handlers so records appear without anyone having to trigger
 * them manually. Two concurrent requests can therefore both pass the existence
 * check below; the UNIQUE (client_id, plan_year) index plus onConflictDoNothing
 * make the duplicate impossible rather than merely unlikely.
 */
/**
 * Checks a freshly-created task against the client's other open tasks and
 * groups it with an existing one when Claude judges it the same underlying
 * job — whether that's the same thread producing a near-duplicate, or a
 * different thread raising the same ask. Never blocks or fails task creation:
 * a dedup miss just leaves two rows instead of one.
 */
/**
 * Files a matched communication's attachments onto the client's documents
 * tab automatically. Every attachment is marked filed the moment it is
 * promoted, so reprocessing the same communication (or a retrying webhook)
 * never creates a second document row for the same file.
 */
async function autoFileAttachments(communicationId: number, clientId: number, uploadedBy: string) {
  try {
    const unfiled = await storage.getUnfiledAttachments(communicationId);
    for (const att of unfiled) {
      const doc = await storage.createDocument({
        clientId,
        renewalId: null,
        planId: null,
        documentName: att.filename,
        category: "OTHER",
        filePath: att.storagePath,
        fileName: att.filename,
        notes: "Auto-filed from an email attachment.",
        uploadedBy,
      });
      await storage.markAttachmentFiled(att.id, doc.id);
    }
  } catch (err: any) {
    console.error("[auto-file] attachment filing failed:", err?.message || err);
  }
}

async function dedupAgainstOpenTasks(taskId: number, clientId: number | null | undefined, description: string) {
  if (!clientId) return;
  try {
    const candidates = await storage.getOpenTasksForClientExcept(clientId, taskId);
    if (!candidates.length) return;
    const matchId = await findDuplicateTask(description, candidates);
    if (matchId) await storage.groupTaskWith(taskId, matchId);
  } catch (err: any) {
    console.error("[dedup] task grouping check failed:", err?.message || err);
  }
}

async function ensureOpenRenewal(client: any, today = new Date()) {
  if (!client?.anniversaryDate) return null;

  // A known departure ends the renewal immediately, not on the termination date.
  // Steve learns one to four months ahead, and the renewal should stop the moment
  // he does — so this keys off the derived state (TERMINATING counts) rather than
  // waiting for the date to pass or for a status field to be flipped by hand.
  if (suppressesRenewals(deriveClientState(client, today))) return null;

  // A client with every plan terminated has nothing to renew. Skip opening a
  // renewal for them, but the client itself is never touched — it stays fully
  // active and visible, exactly like a client with no plans configured yet.
  const clientPlans = await storage.getPlans(client.id);
  if (clientPlans.length > 0 && clientPlans.every(p => p.terminationDate)) return null;

  const anniversary = getUpcomingAnniversary(new Date(client.anniversaryDate), today);
  const leadMonths = (client.renewalLeadMonths ?? 3) as number;
  const proposalDue = new Date(anniversary);
  proposalDue.setMonth(proposalDue.getMonth() - leadMonths);

  const opensAt = new Date(proposalDue);
  opensAt.setDate(opensAt.getDate() - 30);

  const planYear = anniversary.getFullYear();

  const existing = await db.select().from(renewals)
    .where(and(eq(renewals.clientId, client.id), eq(renewals.planYear, planYear)))
    .limit(1);
  if (existing.length > 0) {
    return existing[0].pipelineStep === FINAL_STEP ? null : existing[0];
  }

  // Not yet time to open this year's renewal. Any earlier year's renewal that is
  // still unfinished remains the open one so it stays visible until completed.
  if (today < opensAt) {
    const stragglers = await db.select().from(renewals)
      .where(and(eq(renewals.clientId, client.id), openRenewalPredicate()))
      .orderBy(desc(renewals.planYear))
      .limit(1);
    return stragglers[0] ?? null;
  }

  // A prior year still open means last cycle never finished. The new renewal
  // opens regardless — an unfinished year must never block the next one — but
  // the flag records it so it is surfaced rather than silently buried.
  const priorOpen = await db.select().from(renewals)
    .where(and(eq(renewals.clientId, client.id), openRenewalPredicate()))
    .limit(1);

  await db.insert(renewals).values({
    clientId: client.id,
    planYear,
    pipelineStep: null,
    incompletePriorFlag: priorOpen.length > 0,
  }).onConflictDoNothing();

  // Re-read rather than using the insert's return value: onConflictDoNothing
  // returns nothing when a concurrent request won the race, and that request's
  // row is the correct one to use.
  const [created] = await db.select().from(renewals)
    .where(and(eq(renewals.clientId, client.id), eq(renewals.planYear, planYear)))
    .limit(1);
  return created ?? null;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  app.get("/api/clients", requireAuth, async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      const clientList = await storage.getClients(search, status);

      // Attach each client's open renewal so the list can show pipeline badges.
      // Read-only here — the list view shouldn't create records as a side effect
      // of a search; auto-creation happens on the detail and alerts endpoints.
      const ids = clientList.map(c => c.id);
      const openRows = ids.length
        ? await db.select().from(renewals)
            .where(and(inArray(renewals.clientId, ids), openRenewalPredicate()))
            .orderBy(desc(renewals.planYear))
        : [];
      const byClient = new Map<number, any>();
      for (const r of openRows) if (!byClient.has(r.clientId)) byClient.set(r.clientId, r);

      res.json(clientList.map(c => ({ ...c, openRenewal: byClient.get(c.id) ?? null })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/search", requireAuth, async (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q || q.length < 2) return res.json([]);
      const clientList = await storage.getClients(q);
      res.json(clientList.slice(0, 10));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/check-code/:code", requireAuth, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const existing = await storage.getClientByCode(code);
      res.json({ exists: !!existing, clientId: existing?.id || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * A termination date is always the last day of a calendar month. The whole
   * lifecycle model compares whole months, and that is how the business records
   * a departure, so a mid-month date is malformed rather than merely unusual.
   * Checked here as well as in the form, because the form is not the only way a
   * date reaches this column.
   *
   * Deliberately reads the raw request value rather than a parsed Date: a
   * "2026-09-30" string becomes UTC midnight, which is the 29th in a
   * negative-offset zone, and a local-time check would reject a perfectly good
   * month-end date.
   */
  function terminationDateError(raw: unknown): string | null {
    if (raw === null || raw === undefined || raw === "") return null;
    let y: number, m: number, d: number;
    const iso = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null;
    if (iso) {
      [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    } else if (raw instanceof Date && !isNaN(raw.getTime())) {
      [y, m, d] = [raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()];
    } else {
      return null; // not a shape we can judge; the column conversion will complain
    }
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d === lastDay ? null : "Termination date must be the last day of a calendar month";
  }

  /** Every timestamp column a caller is allowed to write on a client. */
  const CLIENT_DATE_FIELDS = ["anniversaryDate", "terminationDate", "accountBalanceAsOfDate"] as const;

  /**
   * Coerce the client date fields from whatever JSON carried them into real Dates.
   *
   * A date input hands back "YYYY-MM-DD", and JSON has no date type, so every date
   * on the wire arrives as a string. The timestamp columns call .toISOString() on
   * whatever they are handed, so a string that reaches the column throws
   * "value.toISOString is not a function" from deep inside the write, with nothing
   * in the message naming the field. Converting per field at the call site is what
   * failed before: two of the three were converted and the third was forgotten,
   * which silently broke saving any client carrying an anniversary date. Doing it
   * once here means a new date field cannot be half-wired.
   *
   * Returns an error string for a value that is not a date at all, so a typo is a
   * 400 naming the field rather than a 500 naming a missing method.
   */
  function coerceClientDates(body: any): string | undefined {
    for (const field of CLIENT_DATE_FIELDS) {
      const value = body[field];
      if (value === undefined) continue;
      if (value === null || value === "") { body[field] = null; continue; }
      if (value instanceof Date) {
        if (isNaN(value.getTime())) return `"${field}" is not a valid date.`;
        continue;
      }
      if (typeof value !== "string" && typeof value !== "number") {
        return `"${field}" is not a valid date.`;
      }
      // A bare "YYYY-MM-DD" is a calendar day, not an instant. Pinning it to UTC
      // midnight stores exactly that day whatever timezone the server runs in, and
      // round-trips cleanly: every stored date comes back as "...T00:00:00.000Z" and
      // the form reads the day straight off the front of that string. Local midnight
      // would shift the stored hour with the server's zone and, west of Greenwich,
      // could land the whole thing on the previous day.
      const text = String(value);
      const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      const parsed = dateOnly
        ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
        : new Date(text);
      if (isNaN(parsed.getTime())) return `"${text}" is not a valid ${field}.`;
      body[field] = parsed;
    }
    // Identity and audit stamps are the row's own business, never the caller's.
    delete body.id;
    delete body.createdAt;
    delete body.updatedAt;
    return undefined;
  }

  app.post("/api/clients", requireAuth, async (req, res) => {
    try {
      const body = { ...req.body };
      const termError = terminationDateError(req.body.terminationDate);
      if (termError) return res.status(400).json({ message: termError });
      const dateError = coerceClientDates(body);
      if (dateError) return res.status(400).json({ message: dateError });
      // Contacts travel with the client so both land in one transaction — see
      // parseBrokerContacts for why an absent key differs from an empty list.
      const { contacts, error } = parseBrokerContacts(body);
      if (error) return res.status(400).json({ message: error });
      delete body.brokerContacts;
      const client = await storage.createClient(body, contacts);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "created",
        entity: "client",
        entityId: client.id,
        details: `Created client "${client.clientName}"`,
      });
      res.status(201).json(client);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        const detail = err.detail || "";
        if (detail.includes("client_code")) {
          return res.status(400).json({ message: "This Client ID is already in use" });
        }
        return res.status(400).json({ message: "A client with this name already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id", requireAuth, async (req, res) => {
    try {
      const client = await storage.getClient(parseInt(req.params.id));
      if (!client) return res.status(404).json({ message: "Client not found" });
      const activeIssueCount = await storage.getActiveIssueCount(client.id);
      const openRenewal = await ensureOpenRenewal(client);
      res.json({ ...client, activeIssueCount, openRenewal });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/renewal-alerts", requireAuth, async (req, res) => {
    try {
      const today = new Date();
      const allClients = await storage.getClients();
      const alerts: any[] = [];

      const stepIdx = (s: string | null) => s ? PIPELINE_STEPS.indexOf(s) : -1;

      // Iterate every active client and open its renewal if due, rather than
      // querying renewals that already exist. Querying first would mean a client
      // whose renewal has never been created can't appear here, so the helper
      // would never fire for them, so the record would never be created — the
      // client would surface only if someone happened to open their detail page.
      for (const client of allClients) {
        if (!client.anniversaryDate) continue;
        // Also drops any renewal opened before the departure was known: the row
        // stays as history, it just stops being chased.
        if (suppressesRenewals(deriveClientState(client, today))) continue;

        const renewal = await ensureOpenRenewal(client, today);
        if (!renewal) continue; // No open renewal — either not due yet, or finished.

        // Measure against the renewal's OWN plan year, not the upcoming
        // anniversary. The upcoming anniversary is always in the future, so
        // `today > anniversary` could never fire and OVERDUE was unreachable.
        const anniversary = getAnniversaryForPlanYear(new Date(client.anniversaryDate), renewal.planYear);
        const leadMonths = (client.renewalLeadMonths ?? 3) as number;
        const proposalDue = new Date(anniversary);
        proposalDue.setMonth(proposalDue.getMonth() - leadMonths);

        const step = renewal.pipelineStep ?? null;
        let timingWarning: string | null = null;

        if (today > anniversary) {
          timingWarning = "OVERDUE";
        } else if (today >= proposalDue && [null,"REQUESTED","PROCESSED"].includes(step)) {
          timingWarning = "PROPOSAL_DUE";
        } else if (renewal.proposalSentDate && [null,"REQUESTED","PROCESSED","SENT","REVISED"].includes(step)) {
          const sent = new Date(renewal.proposalSentDate);
          const days = (today.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24);
          if (days > 14) timingWarning = "LATE_RESPONSE";
        }

        // An unfinished prior year is worth surfacing even with no timing warning.
        if (!timingWarning && !renewal.incompletePriorFlag) continue;

        alerts.push({
          client,
          renewal,
          timingWarning,
          proposalDueDate: proposalDue.toISOString(),
        });
      }

      // Sort: OVERDUE first, then PROPOSAL_DUE, then LATE_RESPONSE, then
      // flag-only entries. Within each group, earlier pipeline step = more
      // urgent because less has been done.
      const warnOrder: Record<string, number> = { OVERDUE: 0, PROPOSAL_DUE: 1, LATE_RESPONSE: 2 };
      alerts.sort((a, b) => {
        const wDiff = (warnOrder[a.timingWarning] ?? 9) - (warnOrder[b.timingWarning] ?? 9);
        if (wDiff !== 0) return wDiff;
        return stepIdx(a.renewal.pipelineStep) - stepIdx(b.renewal.pipelineStep);
      });

      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Full renewal history for a client, newest plan year first, each with its
  // per-plan accepted options. This is what makes prior years readable instead
  // of being overwritten by the current cycle.
  app.get("/api/clients/:id/renewals", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      await ensureOpenRenewal(client);

      const rows = await db.select().from(renewals)
        .where(eq(renewals.clientId, clientId))
        .orderBy(desc(renewals.planYear));

      const ids = rows.map(r => r.id);
      const options = ids.length
        ? await db.select().from(renewalPlanOptions).where(inArray(renewalPlanOptions.renewalId, ids))
        : [];

      res.json(rows.map(r => ({
        ...r,
        planOptions: options.filter(o => o.renewalId === r.id),
      })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/renewals/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const body = { ...req.body };
      const [existingRenewal] = await db.select().from(renewals)
        .where(eq(renewals.id, id))
        .limit(1);
      if (!existingRenewal) return res.status(404).json({ message: "Renewal not found" });

      const patch: any = { updatedAt: new Date() };
      if ("pipelineStep" in body) {
        const step = body.pipelineStep || null;
        if (step !== null && !PIPELINE_STEPS.includes(step)) {
          return res.status(400).json({ message: `Unknown pipeline step "${step}"` });
        }
        patch.pipelineStep = step;
        patch.completedAt = step === FINAL_STEP
          ? existingRenewal.completedAt ?? new Date()
          : null;
      }
      if ("proposalVersion" in body) patch.proposalVersion = body.proposalVersion || null;
      if ("incompletePriorFlag" in body) patch.incompletePriorFlag = !!body.incompletePriorFlag;
      for (const field of ["proposalSentDate", "acceptanceReceivedDate"] as const) {
        if (field in body) patch[field] = body[field] ? new Date(body[field]) : null;
      }

      const [updated] = await db.update(renewals).set(patch).where(eq(renewals.id, id)).returning();
      if (!updated) return res.status(404).json({ message: "Renewal not found" });

      const client = await storage.getClient(updated.clientId);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "updated",
        entity: "renewal",
        entityId: updated.id,
        details: `Updated ${updated.planYear} renewal for "${client?.clientName ?? `client ${updated.clientId}`}"`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Accepted option is recorded per plan, since a multi-plan client can accept a
  // different tier on each plan. Upsert keyed on (renewal, plan).
  app.put("/api/renewals/:id/plan-options/:planId", requireAuth, async (req, res) => {
    try {
      const renewalId = parseInt(req.params.id);
      const planId = parseInt(req.params.planId);
      const { acceptedOption, acceptedRates, ratingEngineVersion } = req.body ?? {};

      if (acceptedOption && !["VALUE","RECOMMENDED","PROTECTIVE"].includes(acceptedOption)) {
        return res.status(400).json({ message: `Unknown renewal option "${acceptedOption}"` });
      }

      const [renewal] = await db.select().from(renewals).where(eq(renewals.id, renewalId)).limit(1);
      if (!renewal) return res.status(404).json({ message: "Renewal not found" });

      // The plan must belong to the same client as the renewal. Without this,
      // any plan id could be attached to any renewal, creating cross-client
      // option records.
      const plan = await storage.getPlan(planId);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      if (plan.clientId !== renewal.clientId) {
        return res.status(400).json({ message: "Plan does not belong to this renewal's client" });
      }

      const values = {
        renewalId,
        planId,
        acceptedOption: acceptedOption || null,
        acceptedRates: acceptedRates ?? null,
        ratingEngineVersion: ratingEngineVersion || null,
      };

      const [saved] = await db.insert(renewalPlanOptions).values(values)
        .onConflictDoUpdate({
          target: [renewalPlanOptions.renewalId, renewalPlanOptions.planId],
          set: {
            acceptedOption: values.acceptedOption,
            acceptedRates: values.acceptedRates,
            ratingEngineVersion: values.ratingEngineVersion,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/renewals/:id/report?format=html|pdf — preview or download
  app.get("/api/renewals/:id/report", requireAuth, async (req, res) => {
    try {
      const renewalId = parseInt(String(req.params.id));
      const format = String(req.query.format) === "pdf" ? "pdf" : "html";

      const { _meta, ...payload } = await buildRenewalReportPayload(renewalId);
      const { client, renewal } = _meta as any;
      const result = await renderRenewalReport(payload, format);

      if (format === "html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        return res.send(result.html);
      }
      const pdfBytes = Buffer.from(result.pdf_b64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition",
        `attachment; filename="${client.clientCode || client.id}-renewal-report-${renewal.planYear}.pdf"`);
      return res.send(pdfBytes);
    } catch (err: any) {
      if (sendRatingEngineError(res, err)) return;
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // POST /api/renewals/:id/report/save — generate the PDF and file it against
  // the renewal it came from, the same way proposals and signed forms are.
  app.post("/api/renewals/:id/report/save", requireAuth, async (req, res) => {
    try {
      const renewalId = parseInt(String(req.params.id));
      const uploadedBy = (req.user as any).fullName;

      const { _meta, ...payload } = await buildRenewalReportPayload(renewalId);
      const { client, renewal } = _meta as any;
      const result = await renderRenewalReport(payload, "pdf");

      const pdfBytes = Buffer.from(result.pdf_b64, "base64");
      const generatorVersion: string = result.generator_version || "unknown";

      const dir = path.join(uploadDir, "renewal-reports", String(client.id));
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `${client.clientCode || client.id}-renewal-report-${renewal.planYear}-${Date.now()}.pdf`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, pdfBytes);

      const doc = await storage.createDocument({
        clientId: client.id,
        planId: null,
        renewalId,
        documentName: `Renewal Report, Plan Year ${renewal.planYear}`,
        category: "RENEWAL_PROPOSAL",
        filePath,
        fileName,
        version: generatorVersion,
        notes: "For 90 Degree Benefits. Lists every fee component separately, including broker compensation. Not for the client or broker.",
        uploadedBy,
      });

      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: uploadedBy,
        action: "GENERATE_RENEWAL_REPORT",
        entity: "document",
        entityId: doc.id,
        details: `Generated renewal report for ${client.clientName} plan year ${renewal.planYear} (v${generatorVersion})`,
      });

      res.json({ document: doc, generatorVersion });
    } catch (err: any) {
      if (sendRatingEngineError(res, err)) return;
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.put("/api/clients/:id", requireAuth, async (req, res) => {
    try {
      const body = { ...req.body };
      const termError = terminationDateError(req.body.terminationDate);
      if (termError) return res.status(400).json({ message: termError });
      const dateError = coerceClientDates(body);
      if (dateError) return res.status(400).json({ message: dateError });
      const { contacts, error } = parseBrokerContacts(body);
      if (error) return res.status(400).json({ message: error });
      delete body.brokerContacts;

      // The brokerage firm is not editable from this endpoint. Changing it here would
      // move the client to a new broker with no effective date and no history row,
      // which reads afterwards as if the client had always been with the new firm.
      // The only way to change a firm is the broker-change endpoint, which records the
      // succession. This is a backstop: the form renders the field read-only.
      const clientId = parseInt(req.params.id);
      const existingClient = await storage.getClient(clientId);
      if (!existingClient) return res.status(404).json({ message: "Client not found" });
      if ("brokerFirmName" in body) {
        const norm = (v: unknown) => (v == null ? "" : String(v).trim());
        const current = norm(existingClient.brokerFirmName);
        const incoming = norm(body.brokerFirmName);
        if (current === incoming) {
          // Nothing to write. Dropping the field also stops a stale form body from
          // reverting a broker change that committed between the read above and the
          // write below, which would leave the flat column and the history disagreeing.
          delete body.brokerFirmName;
        } else {
          // Naming a broker for the first time is not a succession: there is nothing to
          // supersede and no effective date to lose. Everything else is, including
          // clearing the firm, so it has to go through the path that records history.
          const priorHistory = current === "" ? await storage.getBrokerHistory(clientId) : [];
          if (current !== "" || priorHistory.length > 0) {
            return res.status(400).json({
              message: current
                ? `The brokerage firm cannot be changed from here. ${existingClient.brokerFirmName} is recorded as this client's broker, and moving to another firm has to go through Change Broker so the effective date and the history are kept.`
                : "This client has a broker history, so naming a firm here would leave a gap. Use Change Broker so the effective date is recorded.",
            });
          }
        }
      }

      // Renewal lifecycle fields are no longer on the client record — they are
      // edited through PUT /api/renewals/:id against a specific plan year.
      const updated = await storage.updateClient(clientId, body, contacts);
      if (!updated) return res.status(404).json({ message: "Client not found" });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "updated",
        entity: "client",
        entityId: updated.id,
        details: `Updated client "${updated.clientName}"`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/broker-contacts", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getBrokerContacts(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Replaces the whole set for the client. The form edits contacts as a list, so a
  // partial update would leave no way to remove someone.
  app.put("/api/clients/:id/broker-contacts", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      if (isNaN(clientId)) return res.status(400).json({ message: "Invalid client id." });

      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      const { contacts, error } = parseBrokerContacts({ brokerContacts: req.body?.contacts ?? [] });
      if (error) return res.status(400).json({ message: error });

      const saved = await storage.replaceBrokerContacts(clientId, contacts ?? []);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "updated",
        entity: "client",
        entityId: clientId,
        details: `Updated broker contacts (${saved.length} on file)`,
      });
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // The brokerage firms already in use, for the firm picker. Not client-scoped:
  // firm identity is shared, which is the whole point of picking from a list.
  app.get("/api/broker-firms", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getBrokerFirms());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/broker-history", requireAuth, async (req, res) => {
    try {
      const history = await storage.getBrokerHistory(parseInt(req.params.id));
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/broker-change", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const { brokerFirmName, brokerContactName, brokerPhone, brokerEmail, effectiveYear, effectiveMonth } = req.body;
      if (!effectiveYear || !effectiveMonth) {
        return res.status(400).json({ message: "Effective date is required" });
      }

      // Change Broker records a move to a DIFFERENT firm. Run it against the firm the
      // client is already on and it retires that firm and reinstates it in the same
      // breath, leaving a succession from a firm to itself. Nothing downstream can tell
      // that apart from a real move, so refuse it here rather than record it.
      const existingClient = await storage.getClient(clientId);
      if (!existingClient) return res.status(404).json({ message: "Client not found" });
      const sameFirm = (a?: string | null, b?: string | null) =>
        (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
      if (existingClient.brokerFirmName && sameFirm(existingClient.brokerFirmName, brokerFirmName)) {
        return res.status(400).json({
          message: `This client is already with ${existingClient.brokerFirmName}. Change Broker is for moving to a different brokerage firm. To correct the rep, email or phone at the same firm, use Edit Client.`,
        });
      }

      const effectiveDate = new Date(parseInt(effectiveYear), parseInt(effectiveMonth) - 1, 1);
      await storage.addBrokerChange(clientId, {
        brokerFirmName: brokerFirmName || null,
        brokerContactName: brokerContactName || null,
        brokerPhone: brokerPhone || null,
        brokerEmail: brokerEmail || null,
        effectiveDate,
      });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "broker_change",
        entity: "client",
        entityId: clientId,
        details: `Broker changed to "${brokerFirmName}" effective ${effectiveDate.toLocaleDateString()}`,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/plans", requireAuth, async (req, res) => {
    try {
      const planList = await storage.getPlans(parseInt(req.params.id));
      const plansWithRates = await Promise.all(
        planList.map(async (plan) => {
          const rates = await storage.getRateCards(plan.id);
          return { ...plan, rateCards: rates };
        })
      );
      res.json(plansWithRates);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/plans", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const activeCount = await storage.getActivePlanCount(clientId);
      if (activeCount >= 6) {
        return res.status(400).json({ message: "Maximum of 6 active plans reached" });
      }
      const body = { ...req.body, clientId };
      if (body.effectiveDate && typeof body.effectiveDate === "string") {
        body.effectiveDate = new Date(body.effectiveDate);
      }
      if (body.terminationDate && typeof body.terminationDate === "string") {
        body.terminationDate = new Date(body.terminationDate);
      }
      const plan = await storage.createPlan(body);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "created",
        entity: "plan",
        entityId: plan.id,
        details: `Created plan "${plan.planName}" for client #${clientId}`,
      });
      res.status(201).json(plan);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/plans/:planId", requireAuth, async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.effectiveDate && typeof body.effectiveDate === "string") {
        body.effectiveDate = new Date(body.effectiveDate);
      }
      if (body.terminationDate && typeof body.terminationDate === "string") {
        body.terminationDate = new Date(body.terminationDate);
      }
      const updated = await storage.updatePlan(parseInt(req.params.planId), body);
      if (!updated) return res.status(404).json({ message: "Plan not found" });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "updated",
        entity: "plan",
        entityId: updated.id,
        details: `Updated plan "${updated.planName}"`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/plans/:planId/rates", requireAuth, async (req, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const body = req.body;

      // New format: { tiers, rates, brokerMode, brokerValue, feeBasis, flatMonthlyFee?, flat90DBFee?, flatSimpleFee?, flatNetworkFee? }
      if (body && Array.isArray(body.tiers)) {
        const result = await storage.upsertTiersAndRates(
          planId,
          body.tiers,
          body.rates,
          {
            brokerMode: body.brokerMode ?? "NONE",
            brokerValue: body.brokerValue ?? "0.0000",
            feeBasis: body.feeBasis ?? "PEPM",
            flatMonthlyFee: body.flatMonthlyFee ?? null,
            flat90DBFee: body.flat90DBFee ?? null,
            flatSimpleFee: body.flatSimpleFee ?? null,
            flatNetworkFee: body.flatNetworkFee ?? null,
          },
        );
        await storage.createAuditLog({
          userId: (req.user as any).id,
          userName: (req.user as any).fullName,
          action: "updated",
          entity: "rate_cards",
          entityId: planId,
          details: `Updated ${result.tiers.length} tiers / ${result.rates.length} rate cards for plan #${planId}`,
        });
        return res.json(result);
      }

      // Legacy array format (backward compat with old seed data)
      const cards = (Array.isArray(body) ? body : []).map((card: any) => ({ ...card, planId }));
      const result = await storage.upsertRateCards(planId, cards);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "updated",
        entity: "rate_cards",
        entityId: planId,
        details: `Updated rate cards for plan #${planId}`,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/plans/:planId/archive", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updatePlan(parseInt(req.params.planId), { isArchived: true });
      if (!updated) return res.status(404).json({ message: "Plan not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/plans/:planId/renew", requireAuth, async (req, res) => {
    try {
      const plan = await storage.getPlan(parseInt(req.params.planId));
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      const newEffective = new Date(plan.effectiveDate);
      newEffective.setFullYear(newEffective.getFullYear() + 1);
      const newPlan = await storage.createPlan({
        clientId: plan.clientId,
        planName: plan.planName,
        effectiveDate: newEffective,
        planBasis: plan.planBasis,
        preventivePercent: plan.preventivePercent,
        correctivePercent: plan.correctivePercent,
        restorativePercent: plan.restorativePercent,
        annualLimit: plan.annualLimit,
        deductible: plan.deductible,
        isArchived: false,
        planYear: plan.planYear + 1,
        coverageType: plan.coverageType ?? null,
      });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "renewed",
        entity: "plan",
        entityId: newPlan.id,
        details: `Renewed plan "${plan.planName}" to year ${newPlan.planYear}`,
      });
      res.status(201).json(newPlan);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/plans/:planId/renewal", requireAuth, async (req, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const body: any = { ...req.body };
      if (body.renewalCompletedDate && typeof body.renewalCompletedDate === "string") {
        body.renewalCompletedDate = new Date(body.renewalCompletedDate);
      }
      const updated = await storage.updatePlan(planId, body);
      if (!updated) return res.status(404).json({ message: "Plan not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/plans/:planId/documents", requireAuth, async (req, res) => {
    try {
      const docs = await storage.getPlanDocuments(parseInt(req.params.planId));
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Shared 90 Degree Benefits vendor contacts ──────────────────────────────
  app.get("/api/vendor-contacts", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getVendorContacts());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/vendor-contacts/:id", requireAuth, async (req, res) => {
    try {
      const { email, phone } = req.body;
      const updated = await storage.updateVendorContact(parseInt(req.params.id), {
        email: email ?? null,
        phone: phone ?? null,
      });
      if (!updated) return res.status(404).json({ message: "Vendor contact not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/plans/:planId/documents", requireAuth, (req, res, next) => {
    (req as any).uploadSubDir = "documents";
    next();
  }, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "File is required" });
      const plan = await storage.getPlan(parseInt(req.params.planId));
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      const doc = await storage.createDocument({
        clientId: plan.clientId,
        planId: plan.id,
        // Optional — ties the proposal to a specific renewal year
        renewalId: req.body.renewalId ? parseInt(req.body.renewalId) : null,
        documentName: req.body.documentName,
        category: "RENEWAL_PROPOSAL",
        filePath: req.file.path,
        fileName: req.file.originalname,
        version: req.body.version || null,
        notes: req.body.notes || null,
        uploadedBy: (req.user as any).fullName,
      });
      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/documents", requireAuth, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const docs = await storage.getDocuments(parseInt(req.params.id), category);
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * Bulk-friendly: accepts one file or many in the same request (field name
   * "files"), all filed under the same client/category/notes. Lets Kim drop a
   * folder's worth of existing renewal/proposal documents on a client at once
   * instead of one request per file.
   */
  app.post("/api/clients/:id/documents", requireAuth, (req, res, next) => {
    (req as any).uploadSubDir = "documents";
    next();
  }, upload.array("file", 25), async (req, res) => {
    try {
      // Same field name ("file") as the existing single-upload form; appending
      // it more than once in the FormData is what makes this a bulk upload.
      const files = (req.files as Express.Multer.File[]) || [];
      if (!files.length) return res.status(400).json({ message: "At least one file is required" });

      const created = [];
      for (const file of files) {
        const doc = await storage.createDocument({
          clientId: parseInt(req.params.id),
          // Optional — signed acceptance forms and 90 Degree notifications belong
          // to a particular renewal year
          renewalId: req.body.renewalId ? parseInt(req.body.renewalId) : null,
          documentName: files.length > 1 ? file.originalname : (req.body.documentName || file.originalname),
          category: req.body.category,
          filePath: file.path,
          fileName: file.originalname,
          notes: req.body.notes || null,
          uploadedBy: (req.user as any).fullName,
        });
        created.push(doc);
      }
      if (created.length > 1) {
        return res.status(201).json({ documents: created });
      }
      const doc = created[0];
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "uploaded",
        entity: "document",
        entityId: doc.id,
        details: `Uploaded document "${doc.documentName}" for client #${req.params.id}`,
      });
      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Renewal draft generator ────────────────────────────────────────────
  // Calls the internal Python rating engine, saves the returned PDF as a
  // RENEWAL_PROPOSAL document attached to the client, and returns the doc
  // record plus the computed funding scenarios.
  // DRAFT ONLY: does not write rate cards or mark any renewal complete.
  app.post("/api/clients/:id/generate-renewal-draft", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      // Call internal Python service with the client's identity so the PDF
      // cover page shows the real group name, not "Westside School District".
      const { pdf_b64, scenarios, total_pages, advisories } = await callRatingEngine<any>(
        "/generate-renewal-sample",
        {
          group_name:        client.clientName,
          group_id:          client.clientCode || String(client.id),
          prepared_for:      client.clientName,
        },
        { failureMessage: "Rating engine error" },
      );

      // Decode and persist the PDF
      const pdfBuffer = Buffer.from(pdf_b64, "base64");
      const dir = path.join(uploadDir, "documents", String(clientId));
      fs.mkdirSync(dir, { recursive: true });
      const timestamp = Date.now();
      const fileName = `${timestamp}-renewal-draft.pdf`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, pdfBuffer);

      const label = new Date().toLocaleDateString("en-US",
        { month: "long", day: "numeric", year: "numeric" });
      const notes = [
        `Draft generated from sample data (${total_pages} pages).`,
        advisories?.length
          ? `Advisories: ${advisories.join("; ")}`
          : "No advisories.",
      ].join(" ");

      const doc = await storage.createDocument({
        clientId,
        documentName: `Renewal Proposal Draft — ${label}`,
        category: "RENEWAL_PROPOSAL",
        filePath,
        fileName,
        notes,
        uploadedBy: (req.user as any).fullName,
      });

      await storage.createAuditLog({
        userId:   (req.user as any).id,
        userName: (req.user as any).fullName,
        action:   "generated",
        entity:   "document",
        entityId: doc.id,
        details:  `Generated renewal draft for client #${clientId}`,
      });

      res.status(201).json({ document: doc, scenarios, total_pages });
    } catch (err: any) {
      if (sendRatingEngineError(res, err)) return;
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/documents/:docId/download", requireAuth, async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.docId));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      // Gmail-sourced documents live in Object Storage under filePath as the bucket
      // key, not a local filesystem path — everything filed before that migration,
      // and everything uploaded by hand, stays on local disk.
      if (doc.sourceGmailMessageId) {
        const { downloadAttachmentBytes } = await import("./objectStorage");
        const bytes = await downloadAttachmentBytes(doc.filePath);
        res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName}"`);
        return res.send(bytes);
      }
      res.download(doc.filePath, doc.fileName);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/documents/:docId", requireAuth, async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.docId));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (doc.sourceGmailMessageId) {
        const { deleteAttachmentBytes } = await import("./objectStorage");
        try { await deleteAttachmentBytes(doc.filePath); } catch {}
      } else {
        try { fs.unlinkSync(doc.filePath); } catch {}
      }
      await storage.deleteDocument(doc.id);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "deleted",
        entity: "document",
        entityId: doc.id,
        details: `Deleted document "${doc.documentName}"`,
      });
      res.json({ message: "Document deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Gmail attachment ingestion ─────────────────────────────────────────────
  app.get("/api/gmail-import/estimate", requireAdmin, async (req, res) => {
    try {
      const { estimateGmailIngestionVolume } = await import("./gmailIngestion");
      const estimate = await estimateGmailIngestionVolume();
      res.json(estimate);
    } catch (err: any) {
      console.error("[gmail-import] estimate failed:", err?.message || err);
      res.status(502).json({ message: err.message || "Failed to reach Gmail" });
    }
  });

  app.get("/api/gmail-import/status", requireAdmin, async (req, res) => {
    try {
      const { getGmailProfile } = await import("./gmail");
      const profile = await getGmailProfile();
      const state = await storage.getGmailImportState(profile.emailAddress);
      res.json({ mailbox: profile.emailAddress, state: state || null });
    } catch (err: any) {
      console.error("[gmail-import] status failed:", err?.message || err);
      res.status(502).json({ message: err.message || "Failed to reach Gmail" });
    }
  });

  app.post("/api/gmail-import/run", requireAdmin, async (req, res) => {
    try {
      const { runGmailIngestion } = await import("./gmailIngestion");
      const summary = await runGmailIngestion();
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "ran",
        entity: "gmail_import",
        entityId: 0,
        details: `Gmail ingestion for ${summary.mailbox}: ${summary.documentsFiled} document(s) filed, ${summary.attachmentsSkippedDuplicate} duplicate(s) skipped, ${summary.fieldProposalsCreated} field proposal(s) created.`,
      });
      res.json(summary);
    } catch (err: any) {
      console.error("[gmail-import] run failed:", err?.message || err);
      res.status(502).json({ message: err.message || "Gmail ingestion failed" });
    }
  });

  // ─── Gmail inbox (full mail, read/search/summarize only — no send/reply) ───
  app.post("/api/gmail-inbox/sync", requireAdmin, async (req, res) => {
    try {
      const { runGmailFullSync } = await import("./gmailFullSync");
      const summary = await runGmailFullSync();
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "ran",
        entity: "gmail_inbox_sync",
        entityId: 0,
        details: `Gmail full sync for ${summary.mailbox}: ${summary.messagesNew} new message(s), ${summary.threadsTouched} thread(s) touched, ${summary.attachmentsFiled} document(s) filed.`,
      });
      res.json(summary);
    } catch (err: any) {
      console.error("[gmail-inbox] sync failed:", err?.message || err);
      res.status(502).json({ message: err.message || "Gmail sync failed" });
    }
  });

  app.get("/api/gmail-inbox/counts", requireAuth, async (req, res) => {
    try {
      const isAdmin = (req.user as any).role === "ADMIN";
      const counts = await storage.getGmailInboxCounts(isAdmin);
      res.json(counts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/gmail-inbox/domains", requireAuth, async (req, res) => {
    try {
      const domains = await storage.getDistinctGmailDomains();
      res.json(domains);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/gmail-inbox/threads", requireAuth, async (req, res) => {
    try {
      const isAdmin = (req.user as any).role === "ADMIN";
      const q = req.query;
      const { threads, total } = await storage.searchGmailThreads({
        viewerIsAdmin: isAdmin,
        view: (q.view as any) || undefined,
        clientId: q.clientId ? parseInt(q.clientId as string) : undefined,
        personEmail: (q.personEmail as string) || undefined,
        domain: (q.domain as string) || undefined,
        text: (q.text as string) || undefined,
        includeQuoted: q.includeQuoted === "true" ? true : undefined,
        dateFrom: q.dateFrom ? new Date(q.dateFrom as string) : undefined,
        dateTo: q.dateTo ? new Date(q.dateTo as string) : undefined,
        direction: (q.direction as any) || undefined,
        hasAttachment: q.hasAttachment === "true" ? true : undefined,
        limit: q.limit ? parseInt(q.limit as string) : 50,
        offset: q.offset ? parseInt(q.offset as string) : 0,
      });
      const threadIds = threads.map((t) => t.id);
      const clientLinks = threadIds.length > 0
        ? await Promise.all(threadIds.map(async (id) => ({ id, clientIds: await storage.getGmailThreadClientIds(id) })))
        : [];
      const linkMap = new Map(clientLinks.map((c) => [c.id, c.clientIds]));
      res.json({
        total,
        threads: threads.map((t) => ({ ...t, clientIds: linkMap.get(t.id) || [] })),
      });
    } catch (err: any) {
      console.error("[gmail-inbox] search failed:", err?.message || err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/gmail-inbox/threads/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const thread = await storage.getGmailThread(id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const isAdmin = (req.user as any).role === "ADMIN";
      if (thread.isPrivate && !isAdmin) return res.status(403).json({ message: "Private thread" });

      const messages = await storage.getGmailMessagesForThread(id);
      const attachments = await storage.getGmailAttachmentsForMessages(messages.map((m) => m.id));
      const clientIds = await storage.getGmailThreadClientIds(id);
      const clientsList = clientIds.length > 0 ? await storage.getClientsByIds(clientIds) : [];
      res.json({
        thread,
        clients: clientsList,
        messages: messages.map((m) => ({
          ...m,
          attachments: attachments.filter((a) => a.messageId === m.id && !a.isEmbeddedImage),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmail-inbox/threads/:id/assign", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { clientId } = req.body;
      if (!clientId) return res.status(400).json({ message: "clientId required" });
      await storage.assignGmailThreadToClient(id, parseInt(clientId), (req.user as any).fullName);
      res.json({ message: "Assigned" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmail-inbox/threads/:id/private", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isPrivate } = req.body;
      await storage.setGmailThreadPrivate(id, !!isPrivate);
      res.json({ message: "Updated" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Document field proposal review queue ──────────────────────────────────
  app.get("/api/field-proposals", requireAuth, async (req, res) => {
    try {
      const proposals = await storage.getPendingFieldProposals();
      res.json(proposals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // One row per (client, plan/client field) instead of one per document —
  // collapses repeat proposals from prior-year and re-sent documents into a
  // single item, flags disagreeing recent documents as a conflict, and drops
  // items whose newest value already matches the record out of the count.
  app.get("/api/field-proposals/grouped", requireAuth, async (req, res) => {
    try {
      const result = await storage.getGroupedFieldProposals();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/field-proposals", requireAuth, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const proposals = await storage.getFieldProposalsForClient(parseInt(req.params.id), status);
      res.json(proposals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/field-proposals/:id/accept", requireAuth, async (req, res) => {
    try {
      const proposal = await storage.getFieldProposal(parseInt(req.params.id));
      if (!proposal) return res.status(404).json({ message: "Proposal not found" });
      if (proposal.status !== "PENDING") return res.status(400).json({ message: "Proposal already reviewed" });
      if (proposal.mappingStatus !== "MAPPED") {
        return res.status(400).json({ message: "This field has no matching place on the record. It stays in the queue as unmapped." });
      }

      const finalValue: string = typeof req.body?.value === "string" && req.body.value.trim() ? req.body.value : proposal.proposedValue;
      const force = !!req.body?.force;

      const { resolveFieldMapping } = await import("./fieldMapping");
      const doc = await storage.getDocument(proposal.documentId);
      const mapping = resolveFieldMapping(proposal.fieldKey, finalValue, doc?.category || "OTHER", proposal.clientId, proposal.targetTable === "plans" ? proposal.targetId : null);
      if (mapping.coercedValue === null) {
        return res.status(400).json({ message: `"${finalValue}" is not a valid value for ${proposal.fieldLabel}.` });
      }

      const result = await storage.confirmFieldProposal(proposal.id, {
        value: finalValue,
        coercedValue: mapping.coercedValue,
        confirmedBy: (req.user as any).fullName,
        force,
      });

      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "accepted",
        entity: "document_field_proposal",
        entityId: proposal.id,
        details: `Confirmed "${proposal.fieldLabel}" = "${finalValue}" onto ${proposal.targetTable}#${proposal.targetId}.${proposal.targetField} from ${proposal.sourceLocation || "document"}.`,
      });
      res.json(result.proposal);
    } catch (err: any) {
      if (err.code === "OVERWRITE_CONFIRMATION_REQUIRED") {
        return res.status(409).json({ message: "This would overwrite an existing value.", currentValue: err.currentValue });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/field-proposals/bulk-accept", requireAuth, async (req, res) => {
    try {
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const results: { id: number; ok: boolean; message?: string }[] = [];
      for (const id of ids) {
        const proposal = await storage.getFieldProposal(id);
        if (!proposal || proposal.status !== "PENDING") {
          results.push({ id, ok: false, message: "Not pending" });
          continue;
        }
        if (proposal.mappingStatus !== "MAPPED") {
          results.push({ id, ok: false, message: "Unmapped" });
          continue;
        }
        if (proposal.confidence === "low") {
          results.push({ id, ok: false, message: "Low confidence (PPR plan-design field) — confirm individually" });
          continue;
        }
        try {
          const { resolveFieldMapping } = await import("./fieldMapping");
          const doc = await storage.getDocument(proposal.documentId);
          const mapping = resolveFieldMapping(proposal.fieldKey, proposal.proposedValue, doc?.category || "OTHER", proposal.clientId, proposal.targetTable === "plans" ? proposal.targetId : null);
          if (mapping.coercedValue === null) {
            results.push({ id, ok: false, message: "Invalid value" });
            continue;
          }
          await storage.confirmFieldProposal(proposal.id, {
            value: proposal.proposedValue,
            coercedValue: mapping.coercedValue,
            confirmedBy: (req.user as any).fullName,
            force: false,
          });
          await storage.createAuditLog({
            userId: (req.user as any).id,
            userName: (req.user as any).fullName,
            action: "accepted",
            entity: "document_field_proposal",
            entityId: proposal.id,
            details: `Bulk-confirmed "${proposal.fieldLabel}" = "${proposal.proposedValue}" onto ${proposal.targetTable}#${proposal.targetId}.${proposal.targetField}.`,
          });
          results.push({ id, ok: true });
        } catch (err: any) {
          results.push({ id, ok: false, message: err.code === "OVERWRITE_CONFIRMATION_REQUIRED" ? "Would overwrite an existing value — confirm individually" : err.message });
        }
      }
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/field-proposals/history", requireAuth, async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
      const history = await storage.getFieldChangeHistory(clientId);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/field-proposals/history/:id/undo", requireAuth, async (req, res) => {
    try {
      const updated = await storage.undoFieldChange(parseInt(req.params.id), (req.user as any).fullName);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "undone",
        entity: "field_change_history",
        entityId: updated.id,
        details: `Reverted "${updated.fieldLabel}" back to "${updated.oldValue ?? "(blank)"}" on ${updated.targetTable}#${updated.targetId}.`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/field-proposals/:id/reject", requireAuth, async (req, res) => {
    try {
      const proposal = await storage.getFieldProposal(parseInt(req.params.id));
      if (!proposal) return res.status(404).json({ message: "Proposal not found" });
      if (proposal.status !== "PENDING") return res.status(400).json({ message: "Proposal already reviewed" });
      const updated = await storage.reviewFieldProposal(proposal.id, "REJECTED", (req.user as any).fullName);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/issues", requireAuth, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const issueList = await storage.getAllIssues(status);
      res.json(issueList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/issues/followups-due-count", requireAuth, async (req, res) => {
    try {
      const cnt = await storage.getOverdueFollowUpCount();
      res.json({ count: cnt });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/issues/:issueId/resolve", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updateIssue(parseInt(req.params.issueId), {
        status: "RESOLVED",
        resolutionNotes: req.body.resolutionNotes || null,
        resolvedAt: new Date(),
        followUpAt: null,
      });
      if (!updated) return res.status(404).json({ message: "Issue not found" });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "resolved",
        entity: "issue",
        entityId: updated.id,
        details: `Resolved issue "${updated.title}"`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/issues/:issueId/followup", requireAuth, async (req, res) => {
    try {
      const followUpAt = req.body.followUpAt ? new Date(req.body.followUpAt) : null;
      const updated = await storage.updateIssue(parseInt(req.params.issueId), { followUpAt });
      if (!updated) return res.status(404).json({ message: "Issue not found" });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "scheduled follow-up",
        entity: "issue",
        entityId: updated.id,
        details: `Set follow-up for issue "${updated.title}" to ${followUpAt?.toISOString()}`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/issues", requireAuth, async (req, res) => {
    try {
      const issueList = await storage.getIssues(parseInt(req.params.id));
      res.json(issueList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/issues", requireAuth, async (req, res) => {
    try {
      const issue = await storage.createIssue({
        clientId: parseInt(req.params.id),
        title: req.body.title,
        description: req.body.description,
        issueType: req.body.issueType || null,
        status: "ACTIVE",
        createdBy: (req.user as any).fullName,
      });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "created",
        entity: "issue",
        entityId: issue.id,
        details: `Created issue "${issue.title}" for client #${req.params.id}`,
      });
      res.status(201).json(issue);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/issues/:issueId", requireAuth, async (req, res) => {
    try {
      const data: any = { ...req.body };
      if (data.status === "RESOLVED") {
        data.resolvedAt = new Date();
      }
      const updated = await storage.updateIssue(parseInt(req.params.issueId), data);
      if (!updated) return res.status(404).json({ message: "Issue not found" });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: data.status === "RESOLVED" ? "resolved" : "updated",
        entity: "issue",
        entityId: updated.id,
        details: `${data.status === "RESOLVED" ? "Resolved" : "Updated"} issue "${updated.title}"`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/issues/count", requireAuth, async (req, res) => {
    try {
      const cnt = await storage.getActiveIssueCount(parseInt(req.params.id));
      res.json({ count: cnt });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PPR helpers ──────────────────────────────────────────────────────────
  const MON_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function abbrevClientName(name: string): string {
    const stop = new Set(["a","an","the","of","and","or","in","at","for","city","county","school","schools"]);
    const words = (name || "").replace(/[^a-zA-Z0-9\s]/g,"").split(/\s+/).filter(Boolean);
    const word = words.find(w => !stop.has(w.toLowerCase())) || words[0] || "Client";
    return word.slice(0, 10);
  }
  function pprFileType(filename: string): "PDF" | "EXCEL" {
    return /\.pdf$/i.test(filename) ? "PDF" : "EXCEL";
  }
  function pprFileExt(ft: "PDF" | "EXCEL"): string {
    return ft === "PDF" ? ".pdf" : ".xlsx";
  }
  function autoFileName(clientCode: string, clientName: string, reportMonth: number, reportYear: number, ft: "PDF"|"EXCEL"): string {
    const code = (clientCode || "").replace(/[^a-zA-Z0-9]/g,"");
    const abbr = abbrevClientName(clientName);
    const mon = MON_ABBR[(reportMonth - 1)] || "Unk";
    return `${code}_${abbr}_${mon}${reportYear}${pprFileExt(ft)}`;
  }
  // Parse new-convention name: S29_Gainesville_Jun2026.pdf
  function parseNewConvention(filename: string): { reportMonth: number; reportYear: number } | null {
    const m = filename.match(/_([A-Za-z]{3})(\d{4})\.[^.]+$/);
    if (!m) return null;
    const monthIdx = MON_ABBR.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
    if (monthIdx < 0) return null;
    return { reportMonth: monthIdx + 1, reportYear: parseInt(m[2]) };
  }
  // Parse client code from filename: s29gainesvilleppr2026.xlsx → S-29
  function parseClientCode(filename: string): string | null {
    const m = filename.match(/^s(\d+)/i);
    return m ? `S-${m[1]}` : null;
  }
  // Upsert PPR (replace old file on disk + update DB, or insert new)
  async function upsertPprFile(
    clientId: number, reportMonth: number, reportYear: number,
    fileType: "PDF"|"EXCEL", newFilePath: string, fileName: string,
    notes: string|null, uploadedBy: string
  ) {
    const existing = await storage.findPprUploadByType(clientId, reportMonth, reportYear, fileType);
    if (existing) {
      // Only delete the old file if it's at a different path than the new file
      // (renameSync/writeFileSync already overwrites when paths are equal)
      if (existing.filePath !== newFilePath) {
        try { fs.unlinkSync(existing.filePath); } catch {}
      }
      return await storage.updatePprUpload(existing.id, { filePath: newFilePath, fileName, notes: notes ?? existing.notes, uploadedBy, uploadedAt: new Date() } as any);
    }
    return await storage.createPprUpload({ clientId, reportMonth, reportYear, fileType, filePath: newFilePath, fileName, notes, uploadedBy });
  }

  app.get("/api/clients/:id/ppr", requireAuth, async (req, res) => {
    try {
      const groups = await storage.getPprGroupedUploads(parseInt(req.params.id));
      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Single-client upload: POST /api/clients/:id/ppr
  // Accepts fields: reportMonth, reportYear, fileType (PDF|EXCEL), notes
  // Files: "pdf" and/or "excel"
  app.post("/api/clients/:id/ppr", requireAuth, (req, res, next) => {
    (req as any).uploadSubDir = "ppr";
    next();
  }, upload.fields([{ name: "pdf", maxCount: 1 }, { name: "excel", maxCount: 1 }, { name: "file", maxCount: 1 }]), async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const reportMonth = parseInt(req.body.reportMonth);
      const reportYear = parseInt(req.body.reportYear);
      const notes = req.body.notes || null;
      const uploadedBy = (req.user as any).fullName;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      const filesMap = req.files as Record<string, Express.Multer.File[]>;
      const saved: any[] = [];

      const processFile = async (f: Express.Multer.File, ft: "PDF"|"EXCEL") => {
        const newName = autoFileName(client.clientCode || "", client.clientName || "", reportMonth, reportYear, ft);
        const newPath = path.join(path.dirname(f.path), newName);
        fs.renameSync(f.path, newPath);
        const ppr = await upsertPprFile(clientId, reportMonth, reportYear, ft, newPath, newName, notes, uploadedBy);
        saved.push(ppr);
      };

      if (filesMap?.pdf?.[0]) await processFile(filesMap.pdf[0], "PDF");
      if (filesMap?.excel?.[0]) await processFile(filesMap.excel[0], "EXCEL");
      // Legacy single "file" field
      if (!saved.length && filesMap?.file?.[0]) {
        const f = filesMap.file[0];
        const ft = pprFileType(f.originalname);
        await processFile(f, ft);
      }

      if (!saved.length) return res.status(400).json({ message: "No files provided" });

      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: uploadedBy,
        action: "uploaded",
        entity: "ppr",
        entityId: saved[0].id,
        details: `Uploaded PPR for ${reportMonth}/${reportYear} (${saved.map((s: any) => s.fileType).join(", ")})`,
      });
      res.status(201).json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ppr/:pprId/download", requireAuth, async (req, res) => {
    try {
      const ppr = await storage.getPprUpload(parseInt(req.params.pprId));
      if (!ppr) return res.status(404).json({ message: "PPR not found" });
      res.download(ppr.filePath, ppr.fileName);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Serve file inline so the browser renders it rather than downloading
  app.get("/api/ppr/:pprId/inline", requireAuth, async (req, res) => {
    try {
      const ppr = await storage.getPprUpload(parseInt(req.params.pprId));
      if (!ppr) return res.status(404).json({ message: "PPR not found" });
      const ext = path.extname(ppr.fileName).toLowerCase();
      const mime = ext === ".pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `inline; filename="${ppr.fileName}"`);
      res.sendFile(path.resolve(ppr.filePath));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Parse Excel and return sheet data as JSON for in-app viewer
  app.get("/api/ppr/:pprId/sheet-data", requireAuth, async (req, res) => {
    try {
      const ppr = await storage.getPprUpload(parseInt(req.params.pprId));
      if (!ppr) return res.status(404).json({ message: "PPR not found" });
      const ext = path.extname(ppr.fileName).toLowerCase();
      if (ext === ".pdf") return res.status(400).json({ message: "Use /inline for PDF files" });
      const XLSX = (await import("xlsx")).default;
      const workbook = XLSX.readFile(ppr.filePath);
      const sheets = workbook.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json<(string | number | null)[]>(
          workbook.Sheets[name], { header: 1, defval: "" }
        ),
      }));
      res.json({ fileName: ppr.fileName, sheets });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/ppr/:pprId", requireAuth, async (req, res) => {
    try {
      const ppr = await storage.getPprUpload(parseInt(req.params.pprId));
      if (!ppr) return res.status(404).json({ message: "PPR not found" });
      try { fs.unlinkSync(ppr.filePath); } catch {}
      await storage.deletePprUpload(ppr.id);
      res.json({ message: "PPR deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Cross-client monthly batch upload ─────────────────────────────────────
  // POST /api/ppr/batch-monthly
  // fields: reportMonth, reportYear (used when filename has no embedded month)
  // files: "files[]" (multiple) OR "zipFile" (single ZIP)
  app.post("/api/ppr/batch-monthly", requireAuth, memUpload.fields([
    { name: "files", maxCount: 200 },
    { name: "zipFile", maxCount: 1 },
  ]), async (req, res) => {
    try {
      const fallbackMonth = req.body.reportMonth ? parseInt(req.body.reportMonth) : null;
      const fallbackYear  = req.body.reportYear  ? parseInt(req.body.reportYear)  : null;
      const uploadedBy = (req.user as any).fullName;
      const AdmZip = (await import("adm-zip")).default;

      // Collect raw file entries: { name, buffer }
      const entries: { name: string; buffer: Buffer }[] = [];
      const filesMap = req.files as Record<string, Express.Multer.File[]>;

      if (filesMap?.zipFile?.[0]) {
        const zip = new AdmZip(filesMap.zipFile[0].buffer);
        for (const e of zip.getEntries()) {
          if (e.isDirectory) continue;
          const name = path.basename(e.entryName);
          if (/\.(pdf|xlsx|xls)$/i.test(name)) entries.push({ name, buffer: e.getData() });
        }
      }
      if (filesMap?.files?.length) {
        for (const f of filesMap.files) {
          entries.push({ name: f.originalname, buffer: f.buffer });
        }
      }

      if (!entries.length) return res.status(400).json({ message: "No valid files found" });

      type BatchRow = { file: string; status: "imported"|"skipped"|"error"; clientName?: string; clientCode?: string; fileType?: string; reportMonth?: number; reportYear?: number; pprId?: number; error?: string };
      const results: BatchRow[] = [];
      const unrecognized: { file: string; reason: string }[] = [];
      // byClient: map clientCode → { clientCode, clientName, files[] }
      const byClientMap = new Map<string, { clientCode: string; clientName: string; files: { file: string; fileType: string; reportMonth: number; reportYear: number }[] }>();

      for (const { name, buffer } of entries) {
        try {
          // Determine client code
          const rawCode = parseClientCode(name);
          if (!rawCode) {
            const reason = "Cannot parse client code from filename";
            results.push({ file: name, status: "skipped", error: reason });
            unrecognized.push({ file: name, reason });
            continue;
          }
          const client = await storage.getClientByCode(rawCode);
          if (!client) {
            const reason = `Client ${rawCode} not found`;
            results.push({ file: name, status: "skipped", clientCode: rawCode, error: reason });
            unrecognized.push({ file: name, reason });
            continue;
          }

          // Determine month/year from new naming convention or use fallback
          const fromName = parseNewConvention(name);
          const reportMonth = fromName?.reportMonth ?? fallbackMonth;
          const reportYear  = fromName?.reportYear  ?? fallbackYear;
          if (!reportMonth || !reportYear) {
            const reason = "Cannot determine report month/year";
            results.push({ file: name, status: "skipped", clientCode: rawCode, clientName: client.clientName, error: reason });
            unrecognized.push({ file: name, reason });
            continue;
          }

          // Determine file type
          const ft = pprFileType(name);
          const newName = autoFileName(client.clientCode || "", client.clientName || "", reportMonth, reportYear, ft);

          // Save buffer to disk
          const dir = path.join(uploadDir, "ppr", String(client.id));
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, newName);
          fs.writeFileSync(filePath, buffer);

          const saved = await upsertPprFile(client.id, reportMonth, reportYear, ft, filePath, newName, null, uploadedBy);
          results.push({ file: name, status: "imported", clientCode: rawCode, clientName: client.clientName, fileType: ft, reportMonth, reportYear, pprId: saved.id });

          // Accumulate byClient
          if (!byClientMap.has(rawCode)) byClientMap.set(rawCode, { clientCode: rawCode, clientName: client.clientName, files: [] });
          byClientMap.get(rawCode)!.files.push({ file: newName, fileType: ft, reportMonth, reportYear });
        } catch (e: any) {
          results.push({ file: name, status: "error", error: e.message });
          unrecognized.push({ file: name, reason: e.message });
        }
      }

      const imported = results.filter(r => r.status === "imported").length;
      const skipped  = results.filter(r => r.status === "skipped").length;
      const errors   = results.filter(r => r.status === "error").length;
      const byClient = Array.from(byClientMap.values());

      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: uploadedBy,
        action: "imported",
        entity: "ppr",
        details: `Batch PPR upload: ${imported} imported, ${skipped} skipped, ${errors} errors`,
      });
      res.json({ imported, skipped, errors, byClient, unrecognized, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PPR Metrics — batch import via ZIP
  app.post("/api/ppr/batch-import", requireAuth, memUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "ZIP file is required" });
      const AdmZip = (await import("adm-zip")).default;
      const XLSX = (await import("xlsx")).default;
      const zip = new AdmZip(req.file.buffer);
      const entries = zip.getEntries().filter(e => /\.(xlsx|xls)$/i.test(e.entryName));

      const results: { file: string; status: string; clientCode?: string; error?: string }[] = [];

      for (const entry of entries) {
        const filename = entry.entryName;
        try {
          const buf = entry.getData();
          const wb = XLSX.read(buf, { type: "buffer" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

          // Helper: last non-null value in a row (rows are padded with trailing nulls)
          const lastNonNull = (row: any[]) => {
            for (let j = row.length - 1; j >= 0; j--) {
              if (row[j] !== null && row[j] !== "" && row[j] !== undefined) return row[j];
            }
            return null;
          };
          // Helper: first match for S-code pattern anywhere in a row
          const findSCode = (row: any[]) => {
            for (const cell of row) {
              if (!cell) continue;
              const m = String(cell).trim().match(/^S-?(\d+)$/i);
              if (m) return `S-${m[1]}`;
            }
            return null;
          };

          // Extract client code from Row 4 (Group ID row) or filename fallback
          let clientCode: string | null = findSCode(data[4] ?? []);
          if (!clientCode) {
            const m = filename.match(/^s(\d+)/i);
            if (m) clientCode = `S-${m[1]}`;
          }
          if (!clientCode) { results.push({ file: filename, status: "skipped", error: "Could not determine client code" }); continue; }

          const client = await storage.getClientByCode(clientCode);
          if (!client) { results.push({ file: filename, clientCode, status: "skipped", error: `Client ${clientCode} not found in database` }); continue; }

          // Plan name from Row 5 — find first non-label string value (skip "Coverage:", "Plan ID:", etc.)
          const planName = (() => {
            const row = data[5] ?? [];
            for (const cell of row) {
              if (!cell || typeof cell !== "string") continue;
              const s = cell.trim();
              if (s && !s.endsWith(":") && !s.startsWith("S")) return s;
            }
            return null;
          })();

          // Averages row is always at index 24
          const avgRow: any[] = data[24] ?? [];
          const avgVals = avgRow.filter(v => v !== null && v !== "" && v !== "Averages" && typeof v === "number");

          const rawYtdLR = avgVals.length > 0 ? avgVals[avgVals.length - 1] : null;
          const rawSurplus = avgVals.length > 1 ? avgVals[avgVals.length - 2] : null;
          // Normalize: if ratio ≤ 5 it's a decimal (e.g. 0.83 = 83%), else already a percentage (e.g. 51 = 51%)
          const ytdLossRatio = rawYtdLR != null ? (rawYtdLR <= 5 ? rawYtdLR * 100 : rawYtdLR) : null;
          const ytdSurplusDeficit = rawSurplus ?? null;

          // Find latest monthly data row (rows 11–22) — scan backward for last row with a loss ratio
          let monthlyLossRatio: number | null = null;
          let reportMonth: number | null = null;
          let reportYear: number | null = null;
          for (let i = 22; i >= 11; i--) {
            const row: any[] = data[i] ?? [];
            const nonNulls = row.filter(v => v !== null && v !== "" && v !== 0);
            if (nonNulls.length < 3) continue;
            // Loss ratio is the last non-null numeric value in the row
            const lrVal = lastNonNull(row);
            if (lrVal === null || lrVal === 0) continue;
            const lr = Number(lrVal);
            if (isNaN(lr) || lr === 0) continue;
            monthlyLossRatio = lr <= 5 ? lr * 100 : lr;
            // Report period comes from the Excel date serial in the first column
            const dateSerial = Number(row[0]);
            if (dateSerial > 40000) {
              const d = new Date((dateSerial - 25569) * 86400000);
              reportMonth = d.getUTCMonth() + 1;
              reportYear = d.getUTCFullYear();
            }
            break;
          }

          if (!reportMonth || !reportYear) {
            // Fall back to current month
            const now = new Date();
            reportMonth = now.getMonth() + 1;
            reportYear = now.getFullYear();
          }

          await storage.upsertPprMetrics({
            clientId: client.id,
            reportMonth,
            reportYear,
            planName,
            monthlyLossRatio: monthlyLossRatio != null ? String(monthlyLossRatio.toFixed(4)) : null,
            ytdLossRatio: ytdLossRatio != null ? String(ytdLossRatio.toFixed(4)) : null,
            ytdSurplusDeficit: ytdSurplusDeficit != null ? String(ytdSurplusDeficit.toFixed(2)) : null,
            sourceFile: filename,
            importedBy: (req.user as any).fullName,
          });

          results.push({ file: filename, status: "imported", clientCode });
        } catch (e: any) {
          results.push({ file: filename, status: "error", error: e.message });
        }
      }

      const imported = results.filter(r => r.status === "imported").length;
      const skipped  = results.filter(r => r.status === "skipped").length;
      const errors   = results.filter(r => r.status === "error").length;
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "imported",
        entity: "ppr_metrics",
        details: `Batch PPR import: ${imported} imported, ${skipped} skipped, ${errors} errors`,
      });
      res.json({ imported, skipped, errors, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/ppr-metrics", requireAuth, async (req, res) => {
    try {
      const metrics = await storage.getPprMetrics(parseInt(req.params.id));
      res.json(metrics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ppr-metrics/summary", requireAuth, async (req, res) => {
    try {
      const summary = await storage.getPprMetricsSummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard/issues", requireAuth, async (req, res) => {
    try {
      const dashIssues = await storage.getDashboardIssues();
      res.json(dashIssues);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard/expiring-plans", requireAuth, async (req, res) => {
    try {
      const expiringPlans = await storage.getExpiringPlans();
      res.json(expiringPlans);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard/activity", requireAuth, async (req, res) => {
    try {
      const logs = await storage.getRecentAuditLogs(15);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard/renewals", requireAuth, async (req, res) => {
    try {
      const renewals = await storage.getDashboardRenewals();
      res.json(renewals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard/renewal-buckets", requireAuth, async (_req, res) => {
    try {
      const today = new Date();
      const allClients = await storage.getClients();
      const eligibleClients = allClients.filter(client =>
        client.anniversaryDate
        && !suppressesRenewals(deriveClientState(client, today)));

      // Trigger the same cycle-opening behavior used by renewal alerts before
      // reading the records that the shared selector will classify.
      for (const client of eligibleClients) {
        await ensureOpenRenewal(client, today);
      }

      const renewalRows = await db.select().from(renewals).orderBy(desc(renewals.planYear));
      const latestByClient = new Map<number, typeof renewalRows[number]>();
      for (const renewal of renewalRows) {
        if (!latestByClient.has(renewal.clientId)) latestByClient.set(renewal.clientId, renewal);
      }

      const sources = eligibleClients.flatMap(client => {
        const renewal = latestByClient.get(client.id);
        return renewal ? [{ client, renewal }] : [];
      });
      res.json(computeRenewalBuckets(sources, today));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/broker", requireAuth, async (req, res) => {
    try {
      const firm = (req.query.firm as string || "").trim();
      if (firm.length < 2) return res.json([]);
      const results = await storage.getClientsByBrokerFirm(firm);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * Client roster: one row per in-scope client.
   *
   * Scope is derived, never stored — `countsAsActive` keeps ACTIVE, TERMINATING
   * and RUN_OUT clients on the report so a departing group stays visible while
   * it is still being serviced. Anyone left off appears in `excluded` with the
   * reason, so a client can never quietly vanish from the roster.
   *
   * Every value is passed through as stored. Missing data stays null and is
   * rendered blank by the client; nothing is defaulted, zeroed or guessed.
   */
  app.get("/api/reports/client-roster", requireAuth, async (_req, res) => {
    try {
      const [allClients, allPlans, allContacts] = await Promise.all([
        db.select().from(clients),
        db.select().from(plans),
        db.select().from(brokerContacts),
      ]);

      // Archived plans are historical and say nothing about current coverage.
      // A terminated-but-not-archived plan is deliberately kept: under the
      // run-out model a termination date is not an off switch, and the client
      // still carries that coverage through the run-out window.
      const plansByClient = new Map<number, typeof allPlans>();
      for (const p of allPlans) {
        if (p.isArchived) continue;
        const list = plansByClient.get(p.clientId) ?? [];
        list.push(p);
        plansByClient.set(p.clientId, list);
      }

      // One contact per client: the serving primary. Roles are free text and
      // inconsistently spelled, so `isPrimary` is the only dependable key.
      const primaryByClient = new Map<number, typeof allContacts[number]>();
      for (const c of allContacts) {
        if (!c.isPrimary || c.terminationDate) continue;
        if (!primaryByClient.has(c.clientId)) primaryByClient.set(c.clientId, c);
      }

      const rows: RosterRow[] = [];
      const excluded: RosterExclusion[] = [];

      for (const c of allClients) {
        const state = deriveClientState(c);
        if (!countsAsActive(state)) {
          excluded.push({
            clientId: c.id,
            groupNumber: c.clientCode ?? null,
            clientName: c.clientName,
            reason: state === "PROSPECT" ? "Prospect, not yet an active client" : "Closed client",
          });
          continue;
        }

        // Fall back to the flat mirror columns only when there is no contact
        // row at all. They mirror the serving primary, so this adds no new
        // information — it just avoids blanking a client whose contact was
        // recorded before broker_contacts existed.
        const contact = primaryByClient.get(c.id);
        const brokerName = contact?.contactName ?? c.brokerContactName ?? null;
        const brokerEmail = contact?.email ?? c.brokerEmail ?? null;
        const brokerPhone = contact?.phone ?? c.brokerPhone ?? null;

        rows.push({
          clientId: c.id,
          clientName: c.clientName,
          groupNumber: c.clientCode ?? null,
          city: c.city ?? null,
          state: c.state ?? null,
          numberOfEmployees: c.numberOfEmployees ?? null,
          planType: derivePlanType((plansByClient.get(c.id) ?? []).map(p => p.coverageType)),
          anniversaryDate: c.anniversaryDate ? c.anniversaryDate.toISOString() : null,
          brokerFirmName: c.brokerFirmName || null,
          brokerName: brokerName || null,
          brokerEmail: brokerEmail || null,
          brokerPhone: brokerPhone || null,
          clientState: state,
        });
      }

      rows.sort((a, b) => a.clientName.localeCompare(b.clientName));

      const hasBroker = (r: RosterRow) => !!(r.brokerFirmName || r.brokerName);
      const planTypeCounts: Record<string, number> = {};
      for (const t of ROSTER_PLAN_TYPES) planTypeCounts[t] = 0;
      for (const r of rows) if (r.planType) planTypeCounts[r.planType]++;

      const payload: ClientRosterResponse = {
        generatedAt: new Date().toISOString(),
        rows,
        excluded,
        summary: {
          totalRows: rows.length,
          blankCity: rows.filter(r => !r.city).length,
          blankState: rows.filter(r => !r.state).length,
          noBrokerOnFile: rows.filter(r => !hasBroker(r)).length,
          brokerMissingEmail: rows.filter(r => hasBroker(r) && !r.brokerEmail).length,
          brokerMissingPhone: rows.filter(r => hasBroker(r) && !r.brokerPhone).length,
          missingEmployeeCount: rows.filter(r => r.numberOfEmployees == null).length,
          planTypeCounts,
          planTypeUnresolved: rows
            .filter(r => !r.planType)
            .map(r => r.groupNumber ?? `client ${r.clientId}`),
        },
      };

      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/search", requireAuth, async (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q || q.trim().length < 2) return res.json([]);
      const results = await storage.globalSearch(q.trim());
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/users", requireAdmin, async (req, res) => {
    try {
      const userList = await storage.getAllUsers();
      const safeUsers = userList.map(({ password, ...u }) => u);
      res.json(safeUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const hashed = await bcrypt.hash(req.body.password, 10);
      const user = await storage.createUser({ ...req.body, password: hashed });
      const { password, ...safeUser } = user;
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "created",
        entity: "user",
        entityId: user.id,
        details: `Created user "${user.fullName}"`,
      });
      res.status(201).json(safeUser);
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(400).json({ message: "A user with this email already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.password) {
        data.password = await bcrypt.hash(data.password, 10);
      }
      const updated = await storage.updateUser(parseInt(req.params.id), data);
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { password, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── CRM spreadsheet import (admin only) ────────────────────────────────────
  // Two modes over one code path. "validate" runs the entire import inside a
  // transaction and rolls it back, so the preview is produced by the same logic that
  // does the writing rather than by a separate estimate that could disagree with it.
  app.post("/api/admin/crm-import", requireAdmin, memUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file was uploaded." });
      const mode = req.body?.mode === "apply" ? "apply" : "validate";
      const result = await runImport(req.file.buffer, mode);
      // A rejected workbook is a client-side problem (wrong columns, unknown values),
      // so it reports as 422 with the issues attached rather than as a server error.
      res.status(result.ok ? 200 : 422).json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Communication link export / data reset / re-attach (admin only) ────────
  //
  // These three bracket the client re-import. The export is taken immediately before
  // the reset, because the mailbox keeps receiving and any older snapshot is stale.

  app.get("/api/admin/communication-links/export", requireAdmin, async (req, res) => {
    try {
      const payload = await buildCommunicationLinkExport();
      const stamp = payload.exportedAt.replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="communication-links-${stamp}.json"`,
      );
      res.send(JSON.stringify(payload, null, 2));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Counts only, for the screen to show what is about to be exported.
  app.get("/api/admin/communication-links/preview", requireAdmin, async (req, res) => {
    try {
      const payload = await buildCommunicationLinkExport();
      res.json(payload.counts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // What the reset would destroy right now, plus the phrase that unlocks it.
  app.get("/api/admin/data-reset/preview", requireAdmin, async (req, res) => {
    try {
      res.json(await buildResetPreview());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/data-reset", requireAdmin, async (req, res) => {
    try {
      const report = await runDataReset(req.body?.confirm);
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "reset",
        entity: "database",
        details: (() => {
          const removed = report.deleted
            .filter((d) => d.rows > 0)
            .map((d) => `${d.table} ${d.rows}`)
            .join(", ");
          return removed
            ? `Client data reset. Deleted: ${removed}.`
            : "Client data reset. Nothing to delete.";
        })(),
      });
      res.json(report);
    } catch (err: any) {
      if (err instanceof ResetNotConfirmedError) {
        return res.status(400).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.post(
    "/api/admin/communication-links/reattach",
    requireAdmin,
    memUpload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ message: "No file was uploaded." });
        const report = await reattachCommunicationLinks(req.file.buffer.toString("utf8"));
        await storage.createAuditLog({
          userId: (req.user as any).id,
          userName: (req.user as any).fullName,
          action: "reattached",
          entity: "communication_links",
          details:
            `Restored ${report.links.restored} email links and ${report.tasks.restored} task links. ` +
            `${report.unmatched.length} code(s) no longer match a client.`,
        });
        res.json(report);
      } catch (err: any) {
        res.status(400).json({ message: err.message });
      }
    },
  );

  // ─── Email attachment upload (for email webhook + manual) ───────────────────
  const emailAttachDir = path.join(uploadDir, "email-attachments");
  fs.mkdirSync(emailAttachDir, { recursive: true });

  const emailAttachStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(emailAttachDir, String(Date.now()));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, safeName);
    },
  });
  const emailUpload = multer({ storage: emailAttachStorage, limits: { fileSize: 25 * 1024 * 1024 } });

  // Helper: extract text from attachment buffer by mime type
  async function extractAttachmentText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    try {
      if (mimeType === "application/pdf" || filename.endsWith(".pdf")) {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buffer });
        const parsed = await parser.getText();
        await parser.destroy();
        return parsed.text.slice(0, 8000);
      }
      if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || filename.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        return result.value.slice(0, 8000);
      }
      if (mimeType?.startsWith("text/")) {
        return buffer.toString("utf8").slice(0, 8000);
      }
    } catch {}
    return "";
  }

  // ─── Mailgun inbound email webhook ─────────────────────────────────────────
  app.post("/api/email/inbound", emailUpload.any(), async (req, res) => {
    // Verify Mailgun webhook signature if key is configured
    const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (signingKey) {
      const { timestamp, token, signature } = req.body;
      // A request missing any of the three signing fields is not a validly signed
      // Mailgun call — it must be rejected, not silently waved through. Previously
      // this branch only checked the signature when all three fields happened to be
      // present, which let an attacker skip verification entirely by omitting them.
      if (!timestamp || !token || !signature) {
        console.error("[email-inbound] Missing Mailgun signature fields — rejecting");
        return res.status(403).json({ message: "Missing Mailgun signature fields" });
      }
      const hmac = crypto.createHmac("sha256", signingKey);
      hmac.update(timestamp + token);
      const computed = hmac.digest("hex");
      const computedBuf = Buffer.from(computed, "hex");
      const signatureBuf = Buffer.from(String(signature), "hex");
      const valid =
        computedBuf.length === signatureBuf.length &&
        crypto.timingSafeEqual(computedBuf, signatureBuf);
      if (!valid) {
        console.error("[email-inbound] Invalid Mailgun signature — rejecting");
        return res.status(403).json({ message: "Invalid Mailgun signature" });
      }
    } else {
      console.warn("[email-inbound] MAILGUN_WEBHOOK_SIGNING_KEY not configured — accepting unverified inbound mail");
    }

    const body = req.body;
    const files = (req.files as Express.Multer.File[]) || [];

    try {
      const sender: string = body.sender || body.from || "";
      const subject: string = body.subject || "(no subject)";
      const bodyText: string = body["body-plain"] || body["stripped-text"] || body.text || "";
      const bodyHtml: string = body["body-html"] || body["stripped-html"] || "";

      // Parse sender name and email
      const senderMatch = sender.match(/^"?([^"<]+)"?\s*<([^>]+)>$/) || [null, null, sender];
      const senderName = senderMatch[1]?.trim() || null;
      const senderEmail = (senderMatch[2] || sender).trim().toLowerCase();
      const senderDomain = senderEmail.split("@")[1] || null;
      const internalDomain = (process.env.INTERNAL_EMAIL_DOMAIN || "90degreebenefits.com").toLowerCase();
      const isInternal = senderDomain === internalDomain;

      console.log(`[email-inbound] Received from ${senderEmail || "(unknown)"}, subject: "${subject}"`);

      // ── STEP 1: Save the raw email immediately so it's never lost ──────────
      const comm = await storage.createCommunication({
        subject,
        senderEmail: senderEmail || "unknown@unknown.com",
        senderName,
        senderDomain,
        bodyText: bodyText.slice(0, 50000),
        bodyHtml: bodyHtml.slice(0, 50000),
        claudeSummary: "Processing…",
        claudeActionItems: "[]",
        isInternal,
        isUnmatched: true,
        source: "email",
        rawPayload: JSON.stringify(body).slice(0, 10000),
      });
      console.log(`[email-inbound] Saved communication #${comm.id} — enriching with AI…`);

      // ── STEP 2: Extract attachment text ────────────────────────────────────
      const attachmentTexts: string[] = [];
      const attachmentMeta: { filename: string; mimeType: string; sizeBytes: number; storagePath: string; extractedText: string }[] = [];
      for (const file of files) {
        try {
          const text = await extractAttachmentText(fs.readFileSync(file.path), file.mimetype, file.originalname);
          attachmentTexts.push(text);
          attachmentMeta.push({ filename: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storagePath: file.path, extractedText: text });
        } catch { /* skip unreadable attachments */ }
      }
      for (const att of attachmentMeta) {
        await storage.createCommunicationAttachment({
          communicationId: comm.id, filename: att.filename, mimeType: att.mimeType,
          sizeBytes: att.sizeBytes, storagePath: att.storagePath, claudeAnalysis: att.extractedText || null,
        });
      }

      // ── STEP 3: Claude enrichment (parallel) ───────────────────────────────
      const fullText = `From: ${senderName ? `${senderName} <${senderEmail}>` : senderEmail}\nSubject: ${subject}\n\n${bodyText}`;
      // Only live clients are candidates. The closed ones still carry broker firms
      // and contact emails, so leaving them in the list lets a closed account win a
      // domain or firm match against the active client the email is actually about.
      // Terminating and run-out clients stay in: that is precisely when the
      // correspondence about winding the account down arrives.
      const clientRefs = await buildClientRefs();

      const [matches, processed] = await Promise.all([
        matchEmailToClients(fullText, clientRefs),
        processEmail(fullText, attachmentTexts),
      ]);

      const matchSummary = matches.length === 0
        ? "unmatched (no client found)"
        : matches.map(m => `client #${m.clientId} (${m.confidence})`).join(", ");
      console.log(`[email-inbound] #${comm.id} match result: ${matchSummary}`);

      // ── STEP 4: Update record with Claude results ──────────────────────────
      await storage.updateCommunication(comm.id, {
        claudeSummary: processed.summary,
        claudeActionItems: JSON.stringify(processed.actionItems),
        isUnmatched: matches.length === 0,
        isFollowUp: processed.isFollowUp,
        followUpReason: processed.followUpReason,
      });
      if (processed.isFollowUp) {
        console.log(`[email-inbound] #${comm.id} flagged as a follow-up: ${processed.followUpReason ?? "no reason given"}`);
      }

      // ── STEP 5: Assign to clients and create tasks ─────────────────────────
      if (matches.length > 0) {
        await storage.assignCommunicationToClients(comm.id, matches);
        // Most incoming documents arrive as email attachments, so file them
        // onto the client's record automatically instead of waiting for
        // someone to notice and re-upload them by hand.
        await autoFileAttachments(comm.id, matches[0].clientId, "System (auto-filed)");
        // One action item is one task, however many clients it touches. It used
        // to be written once per matched client, which meant the same job had
        // to be resolved twice and the same note typed twice.
        for (const item of processed.actionItems) {
          const dueDate = item.dueDate ? new Date(item.dueDate) : null;
          const created = await storage.createTaskWithClients({
            communicationId: comm.id, clientId: matches[0].clientId,
            description: item.description,
            dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
          }, matches);
          await dedupAgainstOpenTasks(created.id, matches[0].clientId, item.description);
        }
      } else {
        for (const item of processed.actionItems) {
          const dueDate = item.dueDate ? new Date(item.dueDate) : null;
          await storage.createCommunicationTask({
            communicationId: comm.id, clientId: null,
            description: item.description,
            dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
          });
        }
      }

      console.log(`[email-inbound] Completed #${comm.id} — ${matchSummary}, ${processed.actionItems.length} action item(s)`);
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error("[email-inbound] Fatal error processing webhook:", err?.message || err);
      // Return 5xx so Mailgun's automatic retry fires instead of treating this as delivered
      return res.status(500).json({ message: "Internal error processing email" });
    }
  });

  // ─── Manual communication (paste/type) ─────────────────────────────────────
  app.post("/api/communications/manual", requireAuth, emailUpload.array("attachments", 10), async (req, res) => {
    try {
      const { subject, senderEmail, senderName, bodyText, clientIds } = req.body;
      if (!senderEmail || !bodyText) return res.status(400).json({ message: "senderEmail and bodyText are required" });

      const domain = senderEmail.split("@")[1]?.toLowerCase() || null;
      const internalDomain = (process.env.INTERNAL_EMAIL_DOMAIN || "90degreebenefits.com").toLowerCase();
      const isInternal = domain === internalDomain;

      const files = (req.files as Express.Multer.File[]) || [];
      const attachmentTexts: string[] = [];
      const attachmentMeta: { filename: string; mimeType: string; sizeBytes: number; storagePath: string }[] = [];
      for (const file of files) {
        const text = await extractAttachmentText(fs.readFileSync(file.path), file.mimetype, file.originalname);
        attachmentTexts.push(text);
        attachmentMeta.push({ filename: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storagePath: file.path });
      }

      const fullText = `From: ${senderName ? `${senderName} <${senderEmail}>` : senderEmail}\nSubject: ${subject || "(manual entry)"}\n\n${bodyText}`;
      const processed = await processEmail(fullText, attachmentTexts);

      const parsedClientIds: number[] = clientIds
        ? (Array.isArray(clientIds) ? clientIds : [clientIds]).map(Number).filter(Boolean)
        : [];

      const comm = await storage.createCommunication({
        subject: subject || "(manual entry)", senderEmail: senderEmail.toLowerCase(),
        senderName: senderName || null, senderDomain: domain,
        bodyText: bodyText.slice(0, 50000), bodyHtml: null,
        claudeSummary: processed.summary, claudeActionItems: JSON.stringify(processed.actionItems),
        isInternal, isUnmatched: parsedClientIds.length === 0, source: "manual",
        isFollowUp: processed.isFollowUp, followUpReason: processed.followUpReason,
      });

      for (const att of attachmentMeta) {
        await storage.createCommunicationAttachment({
          communicationId: comm.id, filename: att.filename, mimeType: att.mimeType,
          sizeBytes: att.sizeBytes, storagePath: att.storagePath, claudeAnalysis: null,
        });
      }

      if (parsedClientIds.length > 0) {
        await storage.assignCommunicationToClients(comm.id, parsedClientIds.map(id => ({ clientId: id, confidence: "manual" })));
        // As with inbound mail: one action item is one task, attached to every
        // client it concerns, resolved once.
        for (const item of processed.actionItems) {
          const dueDate = item.dueDate ? new Date(item.dueDate) : null;
          const created = await storage.createTaskWithClients({
            communicationId: comm.id, clientId: parsedClientIds[0], description: item.description,
            dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
          }, parsedClientIds.map(clientId => ({ clientId, confidence: "manual" })));
          await dedupAgainstOpenTasks(created.id, parsedClientIds[0], item.description);
        }
      }

      res.status(201).json({ ...comm, actionItems: processed.actionItems });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── List communications (inbox) ────────────────────────────────────────────
  app.get("/api/communications", requireAuth, async (req, res) => {
    try {
      const { senderDomain, senderName, clientId, unmatched, isInternal } = req.query;
      const comms = await storage.getAllCommunications({
        senderDomain: senderDomain as string | undefined,
        senderName: senderName as string | undefined,
        clientId: clientId ? parseInt(clientId as string) : undefined,
        unmatched: unmatched === "true",
        isInternal: isInternal === "true" ? true : isInternal === "false" ? false : undefined,
      });
      res.json(comms);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/communications/senders", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getDistinctSenders());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/communications/unread-count", requireAuth, async (req, res) => {
    try {
      res.json({ count: await storage.getUnreadCommunicationsCount() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * The dashboard triage feed. Declared ahead of "/:id" so the literal path is
   * not swallowed by the parameterised one.
   */
  app.get("/api/communications/feed", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getCommunicationFeed());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * Resolve a communication. Two paths, and both leave a note behind:
   *  - READ_NO_TASK writes a standard note for information-only mail.
   *  - RESOLVED demands Kim's own words, capped at 500 characters.
   */
  app.post("/api/communications/:id/resolve", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const comm = await storage.getCommunication(id);
      if (!comm) return res.status(404).json({ message: "Not found" });
      if (comm.status === "RESOLVED") {
        return res.status(409).json({ message: "This communication is already resolved." });
      }

      const resolutionType = req.body?.resolutionType;
      if (!isResolutionType(resolutionType)) {
        return res.status(400).json({ message: "resolutionType must be READ_NO_TASK or RESOLVED" });
      }

      let note: string;
      if (resolutionType === "READ_NO_TASK") {
        note = READ_NO_TASK_NOTE;
      } else {
        const check = checkResolutionNote(req.body?.note);
        if (!check.ok) return res.status(400).json({ message: check.error });
        note = check.value;
      }

      const user = (req.user as any)?.fullName ?? "Unknown";
      const resolvedAt = await storage.resolveCommunication(id, { resolutionType, note, user });
      // Null means someone else resolved it between the check above and the
      // write. Their note stands; we do not overwrite it.
      if (!resolvedAt) return res.status(409).json({ message: "This communication was just resolved by someone else." });
      res.json({ ok: true, resolvedAt, resolutionNote: note });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Undo for a mis-click, before the row finishes fading out of the feed. */
  app.post("/api/communications/:id/unresolve", requireAuth, async (req, res) => {
    try {
      const outcome = await storage.unresolveCommunication(parseInt(req.params.id));
      if (outcome === "not_resolved") {
        return res.status(409).json({ message: "Nothing to undo — this communication is not resolved." });
      }
      // A typed resolution note is the audit trail, so undo is limited to the
      // "read, no task needed" click and only for as long as the row is fading.
      if (outcome === "has_note") {
        return res.status(409).json({ message: "This was resolved with a note, which stays on the record." });
      }
      if (outcome === "expired") {
        return res.status(409).json({ message: "The undo window has passed. This is now on the record." });
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/communications/:id", requireAuth, async (req, res) => {
    try {
      const comm = await storage.getCommunication(parseInt(req.params.id));
      if (!comm) return res.status(404).json({ message: "Not found" });
      res.json(comm);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/communications/:id/assign", requireAuth, async (req, res) => {
    try {
      const { clientId } = req.body;
      if (!clientId) return res.status(400).json({ message: "clientId required" });
      await storage.updateClientAssignment(parseInt(req.params.id), parseInt(clientId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Client communications ──────────────────────────────────────────────────
  app.get("/api/clients/:id/communications", requireAuth, async (req, res) => {
    try {
      const comms = await storage.getClientCommunications(parseInt(req.params.id));
      res.json(comms);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/communications/ask", requireAuth, async (req, res) => {
    try {
      const { question } = req.body;
      if (!question) return res.status(400).json({ message: "question required" });
      const comms = await storage.getClientCommunications(parseInt(req.params.id));
      const answer = await queryClientCommunications(question, comms);
      res.json({ answer });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Global AI query across all communications ──────────────────────────────
  app.post("/api/communications/ask", requireAuth, async (req, res) => {
    try {
      const { question, senderDomain, senderName, clientId } = req.body;
      if (!question) return res.status(400).json({ message: "question required" });
      const comms = await storage.getAllCommunications({ senderDomain, senderName, clientId });
      const answer = await queryClientCommunications(question, comms);
      res.json({ answer });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Tasks ──────────────────────────────────────────────────────────────────
  app.get("/api/communication-tasks", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getOpenTasks());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clients/:id/communication-tasks", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getClientTasks(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * Free-form task Kim typed herself. The AI misses things, and she needs to be
   * able to record what she sees without waiting for it to notice.
   */
  app.post("/api/communication-tasks", requireAuth, async (req, res) => {
    try {
      const communicationId = parseInt(req.body?.communicationId);
      if (!Number.isFinite(communicationId)) {
        return res.status(400).json({ message: "communicationId is required" });
      }
      const comm = await storage.getCommunication(communicationId);
      if (!comm) return res.status(404).json({ message: "Communication not found" });
      // New work cannot be hung off a message that already reads as finished,
      // or the communication would sit resolved with an open task under it.
      if (comm.status === "RESOLVED") {
        return res.status(409).json({ message: "This communication is resolved. Reopen the conversation before adding work to it." });
      }

      const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
      if (!description) return res.status(400).json({ message: "Describe the task." });
      if (description.length > 500) {
        return res.status(400).json({ message: "Keep the task to 500 characters or fewer." });
      }

      const clientId = req.body?.clientId != null ? parseInt(req.body.clientId) : null;
      const dueDate = req.body?.dueDate ? new Date(req.body.dueDate) : null;
      if (dueDate && Number.isNaN(dueDate.getTime())) {
        return res.status(400).json({ message: "Due date is not a valid date." });
      }

      const created = await storage.createCommunicationTask({
        communicationId,
        clientId: Number.isFinite(clientId as number) ? clientId : null,
        description,
        dueDate,
        isCompleted: false,
        status: "OPEN",
        origin: "MANUAL",
        priority: null,
        resolutionNote: null,
        sortOrder: 0,
      } as any);
      res.json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Resolve a task. The note is mandatory and is the audit trail. */
  app.post("/api/communication-tasks/:id/resolve", requireAuth, async (req, res) => {
    try {
      const check = checkResolutionNote(req.body?.note);
      if (!check.ok) return res.status(400).json({ message: check.error });

      const user = (req.user as any)?.fullName ?? "Unknown";
      const result = await storage.resolveCommunicationTask(parseInt(req.params.id), check.value, user);
      if (!result.task) {
        return res.status(409).json({ message: "That task is missing or was already resolved, so its note stands." });
      }
      res.json({ ok: true, communicationResolved: result.communicationResolved });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Push a task onto the to-do list under a priority. */
  app.post("/api/communication-tasks/:id/todo", requireAuth, async (req, res) => {
    try {
      const priority = req.body?.priority;
      if (!isTaskPriority(priority)) {
        return res.status(400).json({ message: "priority must be URGENT, NORMAL or CASUAL" });
      }
      const updated = await storage.moveTaskToTodo(parseInt(req.params.id), priority);
      if (!updated) {
        return res.status(409).json({ message: "That task is missing or already resolved, so it cannot be added to the list." });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/todos", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getTodos());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** The logged-in user's own to-do list — filters the shared list to their owner name. */
  app.get("/api/todos/mine", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getTodosForOwner((req.user as Express.User).fullName));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const TASK_OWNERS = ["Kim Anderson", "Steve Schultz"] as const;

  /** Hands a task to the other person. Either owner can reassign. */
  app.patch("/api/tasks/:id/owner", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const owner = req.body?.owner;
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid task id" });
      if (!TASK_OWNERS.includes(owner)) {
        return res.status(400).json({ message: `owner must be one of: ${TASK_OWNERS.join(", ")}` });
      }
      const updated = await storage.setTaskOwner(id, owner);
      if (!updated) return res.status(404).json({ message: "Task not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Persists drag ordering for one priority section. */
  app.post("/api/todos/reorder", requireAuth, async (req, res) => {
    try {
      const priority = req.body?.priority;
      if (!isTaskPriority(priority)) {
        return res.status(400).json({ message: "priority must be URGENT, NORMAL or CASUAL" });
      }
      const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map((v: any) => parseInt(v)) : [];
      if (ids.some((v: number) => !Number.isFinite(v))) {
        return res.status(400).json({ message: "orderedIds must be task ids" });
      }
      const written = await storage.reorderTodos(priority, ids);
      res.json({ ok: true, reordered: written });
    } catch (err: any) {
      if (err instanceof StaleOrderError) return res.status(409).json({ message: err.message });
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * Reads a sentence Kim typed and works out which clients it is about.
   *
   * Nothing is written here. The answer goes back to her for confirmation
   * first, because the AI attaching the wrong account silently is worse than it
   * attaching nothing.
   */
  app.post("/api/todos/match", requireAuth, async (req, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) return res.status(400).json({ message: "Type what needs doing." });
      if (text.length > 500) {
        return res.status(400).json({ message: "Keep the to-do to 500 characters or fewer." });
      }

      const clientRefs = await buildClientRefs();
      const matches = await matchTextToClients(text, clientRefs);
      const byId = new Map(clientRefs.map(c => [c.id, c]));

      res.json({
        matches: matches.map(m => ({
          clientId: m.clientId,
          confidence: m.confidence,
          clientName: byId.get(m.clientId)?.clientName ?? "Unknown",
          clientCode: byId.get(m.clientId)?.clientCode ?? "",
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * A to-do with no email behind it: a phone call, a hallway conversation, a
   * thing Kim was carrying in her head. It goes straight onto the list under
   * the priority she picked, since she has already decided it needs doing.
   *
   * An empty client list is a general to-do and is a legitimate outcome.
   */
  app.post("/api/todos/manual", requireAuth, async (req, res) => {
    try {
      const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
      if (!description) return res.status(400).json({ message: "Type what needs doing." });
      if (description.length > 500) {
        return res.status(400).json({ message: "Keep the to-do to 500 characters or fewer." });
      }

      const priority = req.body?.priority;
      if (!isTaskPriority(priority)) {
        return res.status(400).json({ message: "priority must be URGENT, NORMAL or CASUAL" });
      }

      const rawClients = Array.isArray(req.body?.clients) ? req.body.clients : [];
      const parsed = rawClients.map((c: any) => ({
        clientId: parseInt(typeof c === "object" && c !== null ? c.clientId : c),
        confidence: typeof c?.confidence === "string" ? c.confidence : "manual",
      }));
      if (parsed.some((c: { clientId: number }) => !Number.isFinite(c.clientId))) {
        return res.status(400).json({ message: "clients must be client ids" });
      }

      // A to-do pointed at a client that does not exist would vanish from every
      // list it should appear on, so it is refused rather than half-written.
      if (parsed.length) {
        const ids = parsed.map((c: { clientId: number }) => c.clientId);
        const found = await storage.getClientsByIds(ids);
        if (found.length !== new Set(ids).size) {
          return res.status(400).json({ message: "One of those clients no longer exists." });
        }
      }

      const created = await storage.createManualTodo({ description, priority, clients: parsed });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Corrects the AI's guess: swap the clients on an unresolved to-do, or clear them. */
  app.patch("/api/todos/:id/clients", requireAuth, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.clientIds) ? req.body.clientIds.map((v: any) => parseInt(v)) : [];
      if (ids.some((v: number) => !Number.isFinite(v))) {
        return res.status(400).json({ message: "clientIds must be client ids" });
      }
      if (ids.length) {
        const found = await storage.getClientsByIds(ids);
        if (found.length !== new Set(ids).size) {
          return res.status(400).json({ message: "One of those clients no longer exists." });
        }
      }
      const updated = await storage.setTodoClients(parseInt(req.params.id), ids);
      if (!updated) {
        return res.status(409).json({ message: "That to-do is missing or already resolved, so its clients stand." });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * The general list: work that belongs to the business rather than to any one
   * account. Open items and the resolved history, same shape as a client record.
   */
  app.get("/api/general/todos", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getGeneralTodos({ resolved: req.query.resolved === "true" }));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Manually captured to-dos on a client record: no email, so nothing to nest under. */
  app.get("/api/clients/:id/manual-todos", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getClientManualTodos(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Attachment download ─────────────────────────────────────────────────────
  app.get("/api/communication-attachments/:id/download", requireAuth, async (req, res) => {
    try {
      const att = await storage.getCommunicationAttachment(parseInt(req.params.id));
      if (!att) return res.status(404).json({ message: "Attachment not found" });
      if (!fs.existsSync(att.storagePath)) return res.status(404).json({ message: "File not found on disk" });
      res.download(att.storagePath, att.filename);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Renewal pipeline ────────────────────────────────────────────────────────

  app.get("/api/plans/:planId/renewal-progress", requireAuth, async (req, res) => {
    try {
      const prog = await storage.getRenewalProgress(parseInt(req.params.planId));
      res.json(prog ?? {});
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/plans/:planId/renewal-progress", requireAuth, async (req, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const plan = await storage.getPlan(planId);
      if (!plan) return res.status(404).json({ message: "Plan not found" });

      const allowed = ["step1Date","step2Date","step3Date","step4Revisions","step5Date","step6Date","step6DocumentId","step7Date"];
      const data: Record<string, any> = {};
      for (const key of allowed) {
        if (key in req.body) {
          const val = req.body[key];
          if (val === null || val === undefined) {
            data[key] = null;
          } else if (key === "step4Revisions") {
            data[key] = Array.isArray(val) ? val : [];
          } else if (key === "step6DocumentId") {
            data[key] = Number(val);
          } else {
            data[key] = new Date(val);
          }
        }
      }

      const prog = await storage.upsertRenewalProgress(planId, plan.clientId, data);
      res.json(prog);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/plans/:planId/renewal-progress/step6-upload", requireAuth,
    (req: any, _res: any, next: any) => { req.uploadSubDir = "signed-forms"; next(); },
    upload.single("file"),
    async (req, res) => {
      try {
        const planId = parseInt(req.params.planId);
        const plan = await storage.getPlan(planId);
        if (!plan) return res.status(404).json({ message: "Plan not found" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const user = (req as any).user;
        const doc = await storage.createDocument({
          clientId: plan.clientId,
          planId,
          documentName: req.file.originalname,
          category: "EMPLOYER_ACCEPTANCE",
          filePath: req.file.path,
          fileName: req.file.filename,
          uploadedBy: user?.fullName ?? "System",
        });

        const prog = await storage.upsertRenewalProgress(planId, plan.clientId, { step6DocumentId: doc.id });
        res.json({ document: doc, progress: prog });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ─── Prospect pipeline ───────────────────────────────────────────────────────

  app.get("/api/clients/:id/prospect-progress", requireAuth, async (req, res) => {
    try {
      const prog = await storage.getProspectProgress(parseInt(req.params.id));
      res.json(prog ?? {});
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/clients/:id/prospect-progress", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const allowed = ["step1Date","step2Date","step3Date"];
      const data: Record<string, any> = {};
      for (const key of allowed) {
        if (key in req.body) {
          const val = req.body[key];
          data[key] = val === null || val === undefined ? null : new Date(val);
        }
      }
      const prog = await storage.upsertProspectProgress(clientId, data);
      res.json(prog);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Stalled pipeline dashboard ──────────────────────────────────────────────

  app.get("/api/dashboard/stalled", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getStalledPipelines());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Monthly PPR import + report
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/ppr/monthly-import
  // Upload combined monthly admin file (CSV or Excel), distribute rows to the
  // right clients/plans, and return a detailed import summary.
  app.post("/api/ppr/monthly-import", requireAuth, memUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const uploadedBy = (req.user as any).fullName;
      const fileExt = path.extname(req.file.originalname).replace(".", "").toLowerCase() || "csv";
      const fileB64 = req.file.buffer.toString("base64");

      // Build lookup context for the parser
      const [allClients, allPlans, allFacts] = await Promise.all([
        storage.getClients(),
        storage.getAllActivePlans(),
        storage.getAllCurrentFacts(),
      ]);

      const context = {
        // `claims_cutoff_ym` is the last year-month whose claims may still import,
        // computed here rather than in the parser so the run-out length is defined
        // in exactly one place and the two sides cannot drift apart.
        clients: allClients.map(c => ({
          id: c.id, client_code: c.clientCode, client_name: c.clientName,
          termination_date: c.terminationDate ?? null,
          claims_cutoff_ym: runOutEndYearMonth(c.terminationDate),
        })),
        plans: allPlans.map(p => ({
          id: p.id, client_id: p.clientId, plan_name: p.planName,
          effective_date: p.effectiveDate, plan_year: p.planYear,
          coverage_type: p.coverageType ?? null,
          termination_date: p.terminationDate ?? null,
          claims_cutoff_ym: runOutEndYearMonth(p.terminationDate),
        })),
        current_facts: allFacts.map(f => ({
          id: f.id, client_id: f.clientId, plan_id: f.planId,
          report_month: f.reportMonth, report_year: f.reportYear,
          version: f.version, paid_claims: f.paidClaims, submitted_charges: f.submittedCharges,
        })),
      };

      const parsed = await callRatingEngine<any>(
        "/parse-ppr-import",
        { file_b64: fileB64, file_ext: fileExt, context },
        { timeoutMs: 120_000, failureMessage: "Parser failed" },
      );

      const accepted: any[] = parsed.accepted || [];
      const unchanged: any[] = parsed.unchanged || [];
      const held: any[] = parsed.held || [];

      // Create batch record (totals updated at the end)
      const batch = await storage.createPprImportBatch({
        fileName: req.file.originalname,
        uploadedBy,
        rowsTotal: accepted.length + unchanged.length + held.length,
        rowsAccepted: 0, rowsUnchanged: 0, rowsRestated: 0, rowsHeld: 0,
      });

      let rowsAccepted = 0;
      let rowsRestated = 0;
      const restatedDetails: any[] = [];

      for (const row of accepted) {
        if (row.is_restatement) {
          // Supersede the existing current row before inserting the new version
          const existing = await storage.getCurrentFactByKey(
            row.client_id, row.plan_id, row.report_month, row.report_year
          );
          if (existing) {
            await storage.supersedePlanPerformanceFact(existing.id);
            restatedDetails.push({
              clientId: row.client_id, planId: row.plan_id,
              reportMonth: row.report_month, reportYear: row.report_year,
              priorPaidClaims: row.prior_paid_claims,
              newPaidClaims: row.paid_claims,
              priorSubmittedCharges: row.prior_submitted_charges,
              newSubmittedCharges: row.submitted_charges,
              reasonCode: row.reason_code,
            });
          }
          rowsRestated++;
        } else {
          rowsAccepted++;
        }

        await storage.insertPlanPerformanceFact({
          clientId: row.client_id,
          planId: row.plan_id,
          reportMonth: row.report_month,
          reportYear: row.report_year,
          version: row.version ?? 1,
          eeCount: row.ee_count ?? null,
          eeSpouseCount: row.ee_spouse_count ?? null,
          eeChildCount: row.ee_child_count ?? null,
          familyCount: row.family_count ?? null,
          submittedCharges: row.submitted_charges != null ? String(row.submitted_charges) : null,
          paidClaims: row.paid_claims != null ? String(row.paid_claims) : null,
          claimCount: row.claim_count ?? null,
          reasonCode: row.reason_code ?? null,
          reasonNote: row.reason_note ?? null,
          releaseMonth: row.release_month ?? null,
          releaseYear: row.release_year ?? null,
          // Optional actual account balance at month end — null when not in the source file
          accountBalance: row.account_balance != null ? String(row.account_balance) : null,
          receivedDate: row.received_date ? new Date(row.received_date) : new Date(),
          loadedBy: uploadedBy,
          supersededAt: null,
        });

        // Set zero_paid_flag when enrollment present but no claims and no reason
        const totalEnroll = (row.ee_count || 0) + (row.ee_spouse_count || 0) +
                            (row.ee_child_count || 0) + (row.family_count || 0);
        if (totalEnroll > 0 && !row.paid_claims && !row.reason_code) {
          await storage.updateClient(row.client_id, { zeroPayFlag: true });
        }

        // Set underfunding_flag when actual account_balance is on file and is negative.
        // A negative account balance means more was drawn from the account than the
        // employer deposited — a clear collections signal parallel to zero_paid_flag.
        // The report generator shows the full billed-position vs actual-balance
        // comparison; the flag here surfaces the alert on the client record quickly.
        if (row.account_balance != null && Number(row.account_balance) < 0) {
          await storage.updateClient(row.client_id, { underfundingFlag: true });
        }
      }

      // Store held rows for later review
      for (const heldRow of held) {
        await storage.createPprHeldRow({
          batchId: batch.id,
          clientCode: heldRow.client_code || null,
          planName: heldRow.plan_name || null,
          reportMonth: heldRow.report_month ?? null,
          reportYear: heldRow.report_year ?? null,
          rawData: heldRow.raw_data ?? {},
          holdReasons: heldRow.hold_reasons ?? [],
        });
      }

      // Finalise batch totals
      await storage.updatePprImportBatch(batch.id, {
        rowsTotal: rowsAccepted + rowsRestated + unchanged.length + held.length,
        rowsAccepted,
        rowsUnchanged: unchanged.length,
        rowsRestated,
        rowsHeld: held.length,
      });

      await storage.createAuditLog({
        userId: (req.user as any).id, userName: uploadedBy,
        action: "MONTHLY_IMPORT", entity: "ppr_import",
        entityId: batch.id,
        details: `Imported ${req.file.originalname}: ${rowsAccepted} new, ${unchanged.length} unchanged, ${rowsRestated} restated, ${held.length} held`,
      });

      res.json({
        batchId: batch.id,
        fileName: req.file.originalname,
        rowsAccepted,
        rowsUnchanged: unchanged.length,
        rowsRestated,
        rowsHeld: held.length,
        restated: restatedDetails,
        held,
      });
    } catch (err: any) {
      if (sendRatingEngineError(res, err)) return;
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/ppr/import-batches
  app.get("/api/ppr/import-batches", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getPprImportBatches());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/ppr/held-rows
  app.get("/api/ppr/held-rows", requireAuth, async (req, res) => {
    try {
      const batchId = req.query.batchId ? parseInt(req.query.batchId as string) : undefined;
      res.json(await storage.getPprHeldRows(batchId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/ppr/held-rows/:id — accept or discard a held row
  app.patch("/api/ppr/held-rows/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, resolvedClientId, resolvedPlanId, reviewNote } = req.body;
      const reviewedBy = (req.user as any).fullName;

      if (!["ACCEPTED", "DISCARDED"].includes(status)) {
        return res.status(400).json({ message: "status must be ACCEPTED or DISCARDED" });
      }

      const held = await storage.updatePprHeldRow(id, {
        status,
        reviewedAt: new Date(),
        reviewedBy,
        reviewNote: reviewNote || null,
        resolvedClientId: resolvedClientId ?? null,
        resolvedPlanId: resolvedPlanId ?? null,
      });

      if (!held) return res.status(404).json({ message: "Held row not found" });

      // When accepting, write the row to plan_performance_facts
      if (status === "ACCEPTED") {
        const raw = held.rawData as any || {};
        const clientId = resolvedClientId ?? null;
        const planId   = resolvedPlanId ?? null;

        if (!clientId || !planId) {
          return res.status(400).json({
            message: "resolvedClientId and resolvedPlanId are required to accept a held row"
          });
        }

        // Supersede any existing current row for this month
        const existing = await storage.getCurrentFactByKey(
          clientId, planId, held.reportMonth!, held.reportYear!
        );
        if (existing) await storage.supersedePlanPerformanceFact(existing.id);

        await storage.insertPlanPerformanceFact({
          clientId,
          planId,
          reportMonth: held.reportMonth!,
          reportYear: held.reportYear!,
          version: existing ? (existing.version + 1) : 1,
          eeCount: raw.ee_count != null ? parseInt(raw.ee_count) : null,
          eeSpouseCount: raw.ee_spouse_count != null ? parseInt(raw.ee_spouse_count) : null,
          eeChildCount: raw.ee_child_count != null ? parseInt(raw.ee_child_count) : null,
          familyCount: raw.family_count != null ? parseInt(raw.family_count) : null,
          submittedCharges: raw.submitted_charges != null ? String(raw.submitted_charges) : null,
          paidClaims: raw.paid_claims != null ? String(raw.paid_claims) : null,
          claimCount: raw.claim_count != null ? parseInt(raw.claim_count) : null,
          reasonCode: raw.reason_code || null,
          reasonNote: raw.reason_note || null,
          releaseMonth: raw.release_month != null ? parseInt(raw.release_month) : null,
          releaseYear: raw.release_year != null ? parseInt(raw.release_year) : null,
          receivedDate: new Date(),
          loadedBy: reviewedBy,
          supersededAt: null,
        });
      }

      res.json(held);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PPR Report generation
  // ─────────────────────────────────────────────────────────────────────────────

  // Helper: build the report payload for a client + plan year
  async function buildPprReportPayload(clientId: number, planYear?: number) {
    const client = await storage.getClient(clientId);
    if (!client) throw Object.assign(new Error("Client not found"), { status: 404 });

    // Terminating and run-out clients keep producing PPRs; that is the service
    // continuing through the departure. Only once run-out has closed does the
    // client go archive-only, where previously saved reports stay readable but
    // no new one is generated.
    if (!generatesPpr(deriveClientState(client))) {
      throw Object.assign(
        new Error("This client's run-out window has closed, so new PPRs are no longer generated. Previously saved reports remain available under Documents."),
        { status: 409 },
      );
    }

    const clientPlans = (await storage.getPlans(clientId)).filter(p => !p.isArchived);
    if (!clientPlans.length) throw Object.assign(new Error("No active plans for this client"), { status: 404 });

    const allFacts = await storage.getCurrentFactsForClient(clientId);

    // Determine the plan year to show
    let reportPlanYear = planYear;
    if (!reportPlanYear) {
      if (allFacts.length > 0) {
        reportPlanYear = Math.max(...allFacts.map(f => f.reportYear));
      } else {
        reportPlanYear = clientPlans[0].planYear;
      }
    }

    const planPayloads: any[] = [];
    for (const plan of clientPlans) {
      const effDate = new Date(plan.effectiveDate);
      const startMonth = effDate.getMonth() + 1; // 1-12
      let planMonths: { month: number; year: number }[] = [];
      for (let i = 0; i < 12; i++) {
        let m = startMonth + i;
        let y = reportPlanYear!;
        if (m > 12) { m -= 12; y++; }
        planMonths.push({ month: m, year: y });
      }

      // A terminated plan renders through its termination month AND through the
      // run-out window after it. Those trailing months are the point: claims paid
      // in October, November and December for a plan that ended September 30 are
      // real, and a PPR that stopped at September would simply not show them.
      // The plan still never appears in a plan year that begins after run-out has
      // closed, otherwise a plan gone for years keeps resurfacing on every PPR.
      if (plan.terminationDate) {
        const lastYm = runOutEndYearMonth(plan.terminationDate)!;
        const windowStartYm = planMonths[0].year * 12 + (planMonths[0].month - 1);
        if (lastYm < windowStartYm) continue;
        planMonths = planMonths.filter(({ month, year }) => year * 12 + (month - 1) <= lastYm);
      }

      const planFacts = allFacts.filter(f => f.planId === plan.id);
      const cards = await storage.getRateCards(plan.id);

      const monthsPayload = planMonths.map(({ month, year }) => {
        const fact = planFacts.find(f => f.reportMonth === month && f.reportYear === year);

        // Admin fee total — two paths depending on the plan's fee basis:
        //
        // FIXED_MONTHLY: a single flat charge for the whole group each month.
        //   = plan.flatMonthlyFee + plan.brokerValue (if brokerMode is FIXED_MONTHLY)
        //   Headcount is irrelevant here; the amount does not vary by enrollment.
        //
        // PEPM: multiply each tier's totalAdminFee by that tier's headcount and sum.
        let adminFeeTotal: number | null = null;
        if (fact) {
          if (plan.feeBasis === "FIXED_MONTHLY") {
            const flatAdmin  = parseFloat(String(plan.flatMonthlyFee ?? "0")) || 0;
            const flatBroker = plan.brokerMode === "FIXED_MONTHLY"
              ? (parseFloat(String(plan.brokerValue ?? "0")) || 0)
              : 0;
            const total = flatAdmin + flatBroker;
            if (total > 0) adminFeeTotal = Math.round(total * 100) / 100;
          } else {
            // PEPM path — multiply per-tier totalAdminFee by headcount.
            const monthDate = new Date(year, month - 1, 1);

            // Build a map from planTierId → totalAdminFee (most recent effective date wins)
            const byTierId: Record<number, number> = {};
            const byLegacyTier: Record<string, number> = {};
            for (const rc of cards) {
              if (rc.effectiveDate && new Date(rc.effectiveDate) > monthDate) continue;
              const fee = parseFloat(rc.totalAdminFee ?? "0") || 0;
              if (rc.planTierId != null) {
                if (!(rc.planTierId in byTierId)) byTierId[rc.planTierId] = fee;
              } else if (rc.tier) {
                byLegacyTier[rc.tier] = fee;
              }
            }

            // Sort cards by displayOrder so tier index matches headcount bucket order.
            const sortedCards = [...cards].sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
            const tieredFees = sortedCards.map((rc: any) =>
              rc.planTierId != null ? (byTierId[rc.planTierId] ?? 0) : (byLegacyTier[rc.tier] ?? 0)
            );

            // Headcount buckets match displayOrder: [EE-only, EE+Child, EE+One/Spouse, Family]
            const headcounts = [fact.eeCount ?? 0, fact.eeChildCount ?? 0, fact.eeSpouseCount ?? 0, fact.familyCount ?? 0];
            let total = 0;
            tieredFees.forEach((fee: number, i: number) => { total += fee * (headcounts[i] ?? 0); });
            if (total > 0) adminFeeTotal = Math.round(total * 100) / 100;
          }
        }

        return {
          report_month: month, report_year: year,
          ee_count: fact?.eeCount ?? null,
          ee_spouse_count: fact?.eeSpouseCount ?? null,
          ee_child_count: fact?.eeChildCount ?? null,
          family_count: fact?.familyCount ?? null,
          submitted_charges: fact?.submittedCharges != null ? parseFloat(fact.submittedCharges) : null,
          paid_claims: fact?.paidClaims != null ? parseFloat(fact.paidClaims) : null,
          claim_count: fact?.claimCount ?? null,
          reason_code: fact?.reasonCode ?? null,
          reason_note: fact?.reasonNote ?? null,
          release_month: fact?.releaseMonth ?? null,
          release_year: fact?.releaseYear ?? null,
          admin_fee_total: adminFeeTotal,
        };
      });

      planPayloads.push({
        plan_id: plan.id, plan_name: plan.planName, plan_year: reportPlanYear,
        effective_date: effDate.toISOString().split("T")[0],
        deductible: plan.deductible != null ? parseFloat(String(plan.deductible)) : null,
        preventive_percent: plan.preventivePercent ?? null,
        corrective_percent: plan.correctivePercent ?? null,
        restorative_percent: plan.restorativePercent ?? null,
        annual_limit: plan.annualLimit != null ? parseFloat(String(plan.annualLimit)) : null,
        months: monthsPayload,
      });
    }

    const factsWithData = allFacts.filter(f => f.paidClaims != null);
    let dataCurrentAsOf = "";
    if (factsWithData.length > 0) {
      const latest = [...factsWithData].sort(
        (a, b) => (b.reportYear * 12 + b.reportMonth) - (a.reportYear * 12 + a.reportMonth)
      )[0];
      dataCurrentAsOf = `${latest.reportYear}-${String(latest.reportMonth).padStart(2, "0")}`;
    }

    return {
      client: { client_code: client.clientCode, client_name: client.clientName, funding_basis: client.fundingBasis },
      plans: planPayloads,
      generated_at: new Date().toISOString(),
      data_current_as_of: dataCurrentAsOf,
      _meta: { reportPlanYear, client },
    };
  }

  // GET /api/clients/:id/ppr-report/plan-years — available plan years for the selector
  app.get("/api/clients/:id/ppr-report/plan-years", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const [clientPlans, allFacts] = await Promise.all([
        storage.getPlans(clientId),
        storage.getCurrentFactsForClient(clientId),
      ]);
      const activePlans = clientPlans.filter(p => !p.isArchived);
      const fromPlans = new Set(activePlans.map(p => p.planYear));
      const fromFacts = new Set(allFacts.map(f => f.reportYear));
      const years = [...new Set([...fromPlans, ...fromFacts])].sort((a, b) => b - a);
      const defaultYear = years[0] ?? (activePlans[0]?.planYear ?? new Date().getFullYear());
      res.json({ planYears: years, defaultPlanYear: defaultYear });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/clients/:id/ppr-report?format=html|pdf[&planYear=YYYY]
  app.get("/api/clients/:id/ppr-report", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const format    = (req.query.format as string) === "pdf" ? "pdf" : "html";
      const planYear  = req.query.planYear ? parseInt(req.query.planYear as string) : undefined;

      const { _meta, ...payload } = await buildPprReportPayload(clientId, planYear);
      const { client } = _meta as any;

      const result: any = await callRatingEngine<any>(
        "/generate-ppr-report",
        { payload, output_format: format },
        { failureMessage: "Report generation failed" },
      );

      if (format === "html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        // Allow iframes from the same origin
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        return res.send(result.html);
      } else {
        const pdfBytes = Buffer.from(result.pdf_b64, "base64");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition",
          `attachment; filename="${client.clientCode}-ppr-${(_meta as any).reportPlanYear}.pdf"`);
        return res.send(pdfBytes);
      }
    } catch (err: any) {
      if (sendRatingEngineError(res, err)) return;
      // Honour whatever status the thrown error carries, not just 404. The
      // archive-only refusal for a client past run-out is a 409, and reporting it
      // as a 500 would read as a broken server rather than a deliberate rule.
      if ((err as any).status) return res.status((err as any).status).json({ message: err.message });
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/clients/:id/ppr-report/save
  // Generate the PDF and archive it to the documents table
  app.post("/api/clients/:id/ppr-report/save", requireAuth, async (req, res) => {
    try {
      const clientId  = parseInt(req.params.id);
      const planYear  = req.body.planYear ? parseInt(req.body.planYear) : undefined;
      const uploadedBy = (req.user as any).fullName;

      const { _meta, ...payload } = await buildPprReportPayload(clientId, planYear);
      const { reportPlanYear, client } = _meta as any;

      const result: any = await callRatingEngine<any>(
        "/generate-ppr-report",
        { payload, output_format: "pdf" },
        { failureMessage: "Report generation failed" },
      );

      const pdfBytes = Buffer.from(result.pdf_b64, "base64");
      const generatorVersion: string = result.generator_version || "unknown";
      const timestamp = Date.now();

      // Save PDF to disk under uploads/ppr-reports/<clientId>/
      const dir = path.join(uploadDir, "ppr-reports", String(clientId));
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `${client.clientCode}-ppr-${reportPlanYear}-${timestamp}.pdf`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, pdfBytes);

      // Archive as a document record
      const doc = await storage.createDocument({
        clientId,
        planId: null,
        documentName: `Performance Report — Plan Year ${reportPlanYear}`,
        category: "PPR_REPORT",
        filePath,
        fileName,
        version: generatorVersion,
        notes: `Data current as of: ${payload.data_current_as_of || "N/A"}`,
        uploadedBy,
      });

      await storage.createAuditLog({
        userId: (req.user as any).id, userName: uploadedBy,
        action: "GENERATE_PPR_REPORT", entity: "document",
        entityId: doc.id,
        details: `Saved PPR report for ${client.clientName} plan year ${reportPlanYear} (v${generatorVersion})`,
      });

      res.json({ document: doc, generatorVersion, reportPlanYear });
    } catch (err: any) {
      if (sendRatingEngineError(res, err)) return;
      // Honour whatever status the thrown error carries, not just 404. The
      // archive-only refusal for a client past run-out is a 409, and reporting it
      // as a 500 would read as a broken server rather than a deliberate rule.
      if ((err as any).status) return res.status((err as any).status).json({ message: err.message });
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
