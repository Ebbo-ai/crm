import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, pgEnum, serial, uniqueIndex, unique, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", ["ADMIN", "STANDARD"]);
export const planTypeEnum = pgEnum("plan_type", ["DENTAL", "VISION", "HEARING", "DENTAL_VISION", "HEARING_VISION", "DENTAL_HEARING_VISION"]);
// Coverage type describes how a plan is *funded and reported*, not its clinical scope.
// A combined plan (one rate, one claims stream) is ONE plan with DENTAL_VISION or
// DENTAL_VISION_HEARING — never split into separate dental and vision rows.
export const planCoverageTypeEnum = pgEnum("plan_coverage_type", [
  "DENTAL_ONLY",
  "VISION_ONLY",
  "DENTAL_VISION",
  "DENTAL_VISION_HEARING",
]);
export const planBasisEnum = pgEnum("plan_basis", ["PROCEDURE_BASED", "DOLLAR_BASED"]);
export const tierEnum = pgEnum("tier", ["EE", "EE_CHILD", "EE_SPOUSE", "FAMILY"]); // legacy — replaced by plan_tiers table
export const bankingTypeEnum = pgEnum("banking_type", ["CLIENT_BANK", "NINETY_DEGREE_BANK"]);
export const fundingTypeEnum = pgEnum("funding_type", ["REQUIRES_APPROVAL", "PROCESS_WITHOUT_APPROVAL"]);
export const documentCategoryEnum = pgEnum("document_category", [
  "CLIENT_AGREEMENT", "PROPOSAL", "EMPLOYER_ACCEPTANCE", "BROKER_COMPENSATION", "BROKER_OF_RECORD",
  "RENEWAL_PROPOSAL", "PPR_REPORT", "OTHER",
  // Per-client variable document types (Requirement 2 groundwork — see replit.md "Document model").
  "SPD", "HANDOUT", "RENEWAL_ACCEPTANCE", "NEW_PROPOSAL", "RATE_NOTICE",
  // Internal-only: admin fee breakdown. Never attach to a client/broker-facing send —
  // enforced server-side in server/documentGuards.ts, not just a UI warning.
  "PLAN_TRANSMITTAL",
]);
export const heldRowStatusEnum = pgEnum("held_row_status", ["PENDING", "ACCEPTED", "DISCARDED"]);
export const issueStatusEnum = pgEnum("issue_status", ["ACTIVE", "RESOLVED"]);
export const clientStatusEnum = pgEnum("client_status", ["PROSPECT", "ACTIVE", "TERMINATED"]);
export const orthoEligibilityEnum = pgEnum("ortho_eligibility", ["NONE", "CHILDREN", "ALL"]);
export const orthoMaxTypeEnum = pgEnum("ortho_max_type", ["SHARED_ANNUAL", "SEPARATE_LIFETIME"]);

// Reason codes for held or revised PPR months (drives client-facing report wording)
export const pprReasonCodeEnum = pgEnum("ppr_reason_code", [
  "CLERICAL_CORRECTION",
  "CLAIMS_HELD_FUNDING",       // claims held because client funding was not received
  "CLAIMS_HELD_PROCESSING",    // claims held during administrator processing
  "ENROLLMENT_RESTATEMENT",
  "OTHER",                     // requires a non-empty reason_note (enforced by DB CHECK)
]);

// How the employer funds the account each month
export const fundingBasisEnum = pgEnum("funding_basis", [
  "CLAIMS_ONLY",        // employer funds projected claims amount only
  "CLAIMS_PLUS_ADMIN",  // employer funds projected claims plus the administrative fee
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  fullName: text("full_name").notNull(),
  role: roleEnum("role").notNull().default("STANDARD"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientCode: text("client_code").notNull().unique(),
  clientName: text("client_name").notNull().unique(),
  // Address — all optional; partial records are valid during import
  streetAddress: text("street_address"),
  suiteUnit: text("suite_unit"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  industryType: text("industry_type"),
  numberOfEmployees: integer("number_of_employees"),
  // Carrier/administrator-assigned group number — distinct from clientCode,
  // which is 90 Degree's own internal identifier (e.g. S-20).
  groupNumber: text("group_number"),
  // Employees actually enrolled in the plan, as distinct from the employer's
  // total headcount tracked in numberOfEmployees.
  coveredEmployees: integer("covered_employees"),
  isActive: boolean("is_active").notNull().default(true),
  terminationDate: timestamp("termination_date"),
  clientStatus: clientStatusEnum("client_status").notNull().default("ACTIVE"),
  // Optional: a client whose current coverage is still being confirmed with the
  // administrator is a real client we need on file. Recording no plan type is
  // honest; guessing one would be read as fact everywhere it renders.
  planType: planTypeEnum("plan_type"),
  networkActive: boolean("network_active").notNull().default(false),
  dentalNetworkName: text("dental_network_name").default("Dentemax"),
  // Contacts — all optional; save whatever we have and fill the rest later
  decisionMakerName: text("decision_maker_name"),
  decisionMakerTitle: text("decision_maker_title"),
  decisionMakerPhone: text("decision_maker_phone"),
  decisionMakerEmail: text("decision_maker_email"),
  adminContactName: text("admin_contact_name"),
  adminContactTitle: text("admin_contact_title").default("Admin Contact"),
  adminContactPhone: text("admin_contact_phone"),
  adminContactEmail: text("admin_contact_email"),
  hasBroker: boolean("has_broker").notNull().default(false),
  brokerFirmName: text("broker_firm_name"),
  brokerContactName: text("broker_contact_name"),
  brokerPhone: text("broker_phone"),
  brokerEmail: text("broker_email"),
  // Banking & funding — optional; clients may be unknown at import time
  bankingType: bankingTypeEnum("banking_type"),
  fundingType: fundingTypeEnum("funding_type"),
  // How the employer funds the account. Default: CLAIMS_PLUS_ADMIN (administrator draws all fees
  // from the plan account, so admin is always funded in together with claims).
  fundingBasis: fundingBasisEnum("funding_basis").notNull().default("CLAIMS_PLUS_ADMIN"),
  // Set to true when a month closes with enrollment but zero paid claims and no reason code on file
  zeroPayFlag: boolean("zero_paid_flag").notNull().default(false),
  // Set to true when actual account_balance is on file and is materially below the billed position
  underfundingFlag: boolean("underfunding_flag").notNull().default(false),

  // ── Renewal tracking ────────────────────────────────────────────────────
  // Plan anniversary date — drives renewal timing
  anniversaryDate: timestamp("anniversary_date"),
  // How many months before the anniversary date the renewal proposal is due.
  // Default 3; override to 4–7 for clients that need more lead time.
  renewalLeadMonths: integer("renewal_lead_months").notNull().default(3),
  // Renewal lifecycle data lives on the `renewals` table (one record per client
  // per plan year). Anniversary date and lead months describe the client itself
  // and stay here; pipeline step, proposal dates, and accepted options belong
  // to a particular year's renewal record.

  // COBRA administration by 90 Degree Benefits
  cobraAdministeredBy90d: boolean("cobra_administered_by_90d").notNull().default(false),
  // COBRA admin fee ($/member/month). Historically $1.00; editable per client.
  cobraFee: decimal("cobra_fee", { precision: 10, scale: 2 }).default("1.00"),

  // Account balance — only relevant when bankingType = NINETY_DEGREE_BANK.
  // NOTE: this is the actual bank account balance, not the plan surplus/deficit.
  // The two numbers legitimately differ: the account holds more than claims funds,
  // and admin fees are drawn out of it, so do not calculate one from the other.
  accountBalance: decimal("account_balance", { precision: 14, scale: 2 }),
  accountBalanceAsOfDate: timestamp("account_balance_as_of_date"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Per-plan tier definitions. Each plan has 1–4 tiers with free-text labels.
// Replaces the fixed `tierEnum`; rate cards reference plan_tiers.id instead.
export const planTiers = pgTable("plan_tiers", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  label: text("label").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  planName: text("plan_name").notNull(),
  effectiveDate: timestamp("effective_date").notNull(),
  // Nullable: the basis is read from the coinsurance wording, and a plan whose
  // coinsurance has not been supplied has no known basis. Defaulting it to dollar
  // based would put an invented design on a client-facing document.
  planBasis: planBasisEnum("plan_basis"),
  preventivePercent: integer("preventive_percent").default(100),
  correctivePercent: integer("corrective_percent").default(80),
  restorativePercent: integer("restorative_percent").default(50),
  annualLimit: decimal("annual_limit", { precision: 10, scale: 2 }).default("1000.00"),
  deductible: decimal("deductible", { precision: 10, scale: 2 }),
  dollarTier1Percent: integer("dollar_tier1_percent"),
  dollarTier1Limit: decimal("dollar_tier1_limit", { precision: 10, scale: 2 }),
  dollarTier2Percent: integer("dollar_tier2_percent"),
  dollarTier2Limit: decimal("dollar_tier2_limit", { precision: 10, scale: 2 }),
  dollarTier3Percent: integer("dollar_tier3_percent"),
  // Null when the final band is open ended ("50% of the remaining"). A bounded final
  // band is a materially different plan from an unbounded one, so the figure needs a
  // column of its own rather than being dropped on the way in.
  dollarTier3Limit: decimal("dollar_tier3_limit", { precision: 10, scale: 2 }),
  isArchived: boolean("is_archived").notNull().default(false),
  // Nullable, empty by default. No date means the plan is active; a date means the
  // plan is terminated as of that date. Deliberately a single date rather than a
  // separate boolean, so a status and a date can never disagree with each other.
  // Distinct from isArchived, which means "superseded by a newer plan year" — a
  // plan can be terminated mid-year while still being this year's current record.
  // Terminating a plan never touches the client record; a client can be fully
  // active with one terminated plan and one active plan.
  terminationDate: timestamp("termination_date"),
  planYear: integer("plan_year").notNull(),
  // Nullable: wording such as "Included in the $2,000 maximum" describes an
  // orthodontia benefit without saying who is eligible. Storing NONE there would
  // assert the plan has no orthodontia, which is a stronger claim than the source
  // supports, so the field is left empty and the wording is kept in plan notes.
  orthoEligibility: orthoEligibilityEnum("ortho_eligibility"),
  orthoCoinsurancePercent: integer("ortho_coinsurance_percent"),
  orthoMaxType: orthoMaxTypeEnum("ortho_max_type").default("SHARED_ANNUAL"),
  orthoLifetimeMax: decimal("ortho_lifetime_max", { precision: 10, scale: 2 }),
  // What lines of coverage this plan funds and reports on (closed list — see planCoverageTypeEnum).
  // Combined plans (dental+vision on one rate/claims stream) are stored as DENTAL_VISION or
  // DENTAL_VISION_HEARING; they are never split into separate dental and vision plan rows.
  coverageType: planCoverageTypeEnum("coverage_type"),
  renewalDueMonthsBefore: integer("renewal_due_months_before").notNull().default(3),
  renewalRecipient: text("renewal_recipient").notNull().default("CLIENT"),
  isRenewalComplete: boolean("is_renewal_complete").notNull().default(false),
  renewalCompletedDate: timestamp("renewal_completed_date"),
  renewalCompletedBy: text("renewal_completed_by"),
  // Broker compensation — set per plan (brokers request what they want per plan)
  // mode: NONE | FLAT_PEPM | FIXED_MONTHLY | PERCENT_OF_PREMIUM
  brokerMode: text("broker_mode").notNull().default("NONE"),
  // For FLAT_PEPM / FIXED_MONTHLY: dollar amount. For PERCENT_OF_PREMIUM: rate (0.08 = 8%).
  brokerValue: decimal("broker_value", { precision: 10, scale: 4 }).default("0.0000"),
  // PEPM = per employee per month (default). FIXED_MONTHLY = single flat amount for the whole group.
  feeBasis: text("fee_basis").notNull().default("PEPM"),
  // For FIXED_MONTHLY plans only: the flat admin fee charged for the whole group per month.
  // PEPM plans leave this null — their admin fee is calculated per-tier × headcount.
  // This is the admin-only total (excludes broker). PPR uses this + brokerValue for the full charge.
  flatMonthlyFee: decimal("flat_monthly_fee", { precision: 10, scale: 2 }),
  // Fee component breakdown for FIXED_MONTHLY plans — mirrors the per-tier breakdown on PEPM plans.
  // All three are optional: when unknown, only flatMonthlyFee (the total) is stored.
  // When present, flatMonthlyFee = flat90DBFee + flatSimpleFee + flatNetworkFee (auto-computed on save).
  flat90DBFee:   decimal("flat_90db_fee",    { precision: 10, scale: 2 }),
  flatSimpleFee: decimal("flat_simple_fee",  { precision: 10, scale: 2 }),
  flatNetworkFee: decimal("flat_network_fee", { precision: 10, scale: 2 }),
  // Whether claims are assigned directly to providers (true = provider is paid; false = member pays and seeks reimbursement).
  // Defaults true — the majority of plans assign benefits. Varies per plan even within a single client.
  assignmentOfBenefits: boolean("assignment_of_benefits").notNull().default(true),
  // Free-text notes for plan design details that don't fit structured fields.
  // Renders on all client-facing documents (PPR, employee handout). Not internal-only.
  planNotes: text("plan_notes"),
  // Plan surplus or deficit — the plan's financial position, negative when in deficit.
  //
  // Deliberately NOT the same figure as clients.accountBalance, and neither is derivable
  // from the other. The account balance is what the bank account actually holds; the
  // surplus or deficit is where the plan stands. They diverge because employers fund at
  // their own discretion (paying ahead, paying short, or skipping a month when the plan
  // is in surplus) and because administrative fees are drawn from that same account.
  // Storing this separately is what makes the two comparable.
  //
  // Point in time: taken from one particular monthly report, so it carries its own
  // as-of date rather than borrowing the client's account balance date.
  surplusDeficit: decimal("surplus_deficit", { precision: 14, scale: 2 }),
  surplusDeficitAsOfDate: timestamp("surplus_deficit_as_of_date"),
  // Accepted renewal option and accepted rates now live on `renewal_plan_options`
  // (one row per plan per renewal year). They change every year while the plan
  // itself persists, so they are properties of a renewal, not of the plan.
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // A plan is identified by client + coverage + name + year, not by name alone.
  //
  // Coverage is the benefit being provided (dental, vision, dental and vision
  // together), in the same way an employer might offer medical, life or
  // disability. The plan name is the benefit level *within* that coverage:
  // Standard, Premium, Gold, Low/High, Union/Non Union. Because those are two
  // different things, one client can legitimately carry the same name twice:
  // a combined dental and vision "Standard" alongside a vision only "Standard",
  // or Standard and Premium on dental and Standard and Premium again on vision.
  // Those are not duplicates, so the name alone cannot be the key.
  //
  // nullsNotDistinct is load bearing. Postgres treats NULLs as distinct by
  // default, so adding a nullable column to a unique key silently stops it
  // enforcing anything on rows where that column is unset. Coverage is still
  // being filled in, so without this the constraint would weaken rather than
  // tighten. With it, two plans that share a client, name and year and have no
  // coverage recorded still collide exactly as they did before.
  clientCoverageNameYearUnique: unique("plans_client_coverage_name_year_unique")
    .on(table.clientId, table.coverageType, table.planName, table.planYear)
    .nullsNotDistinct(),
}));

export const rateCards = pgTable("rate_cards", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  // planTierId references plan_tiers.id — the per-plan free-text tier definition.
  // Nullable for backward compat; all new inserts set this. Old rows also have tier set.
  planTierId: integer("plan_tier_id"),
  // tier is the legacy fixed enum; retained so old rows still decode. New rows leave it null.
  tier: tierEnum("tier"),
  // effectiveDate lets prior months be valued at the rates actually in force
  // rather than being retroactively restated when a group renews
  effectiveDate: timestamp("effective_date"),
  // Every figure below is nullable on purpose. A tier can be known to exist while its
  // rate has not been published yet — the administrator names the tier in the plan
  // performance report but leaves the rate blank. Storing the tier with no figures
  // records exactly that, and a later import fills the numbers in. Substituting zero
  // would be indistinguishable from a genuinely free tier and would quietly feed a
  // wrong number into every fee total and client-facing document.
  baseAdminFee: decimal("base_admin_fee", { precision: 10, scale: 2 }),
  // COBRA admin fee for this tier (from client.cobraFee when COBRA is active, else 0).
  cobraFee: decimal("cobra_fee", { precision: 10, scale: 2 }).default("0.00"),
  // Simple's marketing and program fee. Previously named "spread admin fee".
  simpleFee: decimal("simple_fee", { precision: 10, scale: 2 }),
  networkFee: decimal("network_fee", { precision: 10, scale: 2 }).default("0.00"),
  // Calculated from plan.brokerMode + plan.brokerValue; never entered per-tier.
  brokerFee: decimal("broker_fee", { precision: 10, scale: 2 }).default("0.00"),
  // totalAdminFee = adminSubtotal + brokerFee (adminSubtotal = base+cobra+simple+network)
  totalAdminFee: decimal("total_admin_fee", { precision: 10, scale: 2 }),
  // totalFee: dropped — column removed in Phase 5 migration. Do not re-add.
  expectedClaims: decimal("expected_claims", { precision: 10, scale: 2 }),
  // monthlyPremium = totalAdminFee + expectedClaims (always matches)
  monthlyPremium: decimal("monthly_premium", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  planId: integer("plan_id"),
  // Optional link to a specific renewal year. Proposals, signed acceptance
  // forms, and the 90 Degree notification all belong to one year's renewal.
  renewalId: integer("renewal_id"),
  documentName: text("document_name").notNull(),
  category: documentCategoryEnum("category").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  version: text("version"),
  notes: text("notes"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  uploadedBy: text("uploaded_by").notNull(),
  /**
   * Raw text pulled from the file at filing time (PDF/Word/Excel text layer,
   * or Claude's OCR transcription for image-only pages). Kept so Claude
   * field-extraction can be re-run — after a prompt change, or to retry a
   * failed run — without re-fetching the file from Gmail or re-running OCR.
   */
  extractedText: text("extracted_text"),
  /** True when extractedText came from Claude vision OCR rather than a native text layer. */
  ocrUsed: boolean("ocr_used").notNull().default(false),
  /** Set only when this document was filed from a Gmail-sourced attachment. */
  sourceGmailMessageId: text("source_gmail_message_id"),
  /** SHA-256 of the raw file bytes. Lets Gmail ingestion recognize a file Kim already uploaded by hand and skip filing a duplicate. */
  contentHash: text("content_hash"),
  /**
   * The plan year / report period this document's content actually describes,
   * as best derived from a date field Claude already extracted from it (or,
   * failing that, a year guessed from the filename). Distinct from uploadedAt,
   * which only says when Gmail happened to deliver it — renewal season email
   * often arrives out of order relative to which document supersedes which.
   * Null when neither source yields a usable date.
   */
  effectiveDate: timestamp("effective_date"),
  /**
   * True for the current version of this client+category document; false once
   * superseded. Superseded documents are never deleted — a prior year's Rate
   * Notice or Renewal Proposal stays on file, just no longer the one shown by
   * default. Set by storage.createDocument, which flips any older row in the
   * same clientId+category to false when a new one is filed.
   */
  isCurrent: boolean("is_current").notNull().default(true),
});

/**
 * Fixed marketing/reference documents that are the same for every client
 * (e.g. "Simple vs Traditional Plans", "Simple Plan Options") — a data-driven
 * list, not per-client copies and not a hardcoded set in code. `category` is
 * free text here (not the documentCategoryEnum, which describes per-client
 * variable documents) so a new global document type never requires a schema
 * change. `isCurrent` carries forward the same superseded-but-retained model
 * as `documents.isCurrent`.
 */
export const globalDocuments = pgTable("global_documents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  uploadedBy: text("uploaded_by").notNull(),
});

/**
 * The 90 Degree Benefits people every client shares — one Client Service
 * Manager, one Accounting Manager, and so on, the same six names for every
 * group. Deliberately one shared list, not a copy per client: these are
 * vendor routing contacts, not anything client-specific.
 */
export const vendorContacts = pgTable("vendor_contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  email: text("email"),
  phone: text("phone"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const issues = pgTable("issues", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  issueType: text("issue_type"),
  status: issueStatusEnum("status").notNull().default("ACTIVE"),
  resolutionNotes: text("resolution_notes"),
  createdBy: text("created_by").notNull(),
  resolvedAt: timestamp("resolved_at"),
  followUpAt: timestamp("follow_up_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const pprUploads = pgTable("ppr_uploads", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  reportMonth: integer("report_month").notNull(),
  reportYear: integer("report_year").notNull(),
  fileType: text("file_type"),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  notes: text("notes"),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const pprMetrics = pgTable("ppr_metrics", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  reportMonth: integer("report_month").notNull(),
  reportYear: integer("report_year").notNull(),
  planName: text("plan_name"),
  monthlyLossRatio: decimal("monthly_loss_ratio", { precision: 10, scale: 4 }),
  ytdLossRatio: decimal("ytd_loss_ratio", { precision: 10, scale: 4 }),
  ytdSurplusDeficit: decimal("ytd_surplus_deficit", { precision: 12, scale: 2 }),
  sourceFile: text("source_file"),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  importedBy: text("imported_by").notNull(),
});

export const communications = pgTable("communications", {
  id: serial("id").primaryKey(),
  subject: text("subject"),
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name"),
  senderDomain: text("sender_domain"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  claudeSummary: text("claude_summary"),
  claudeActionItems: text("claude_action_items"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  isInternal: boolean("is_internal").notNull().default(false),
  isUnmatched: boolean("is_unmatched").notNull().default(false),
  source: text("source").notNull().default("email"),
  rawPayload: text("raw_payload"),
  /**
   * ACTIVE | RESOLVED. A communication stays ACTIVE — and therefore stays in
   * Kim's dashboard feed — until it is explicitly resolved. It never ages out.
   */
  status: text("status").notNull().default("ACTIVE"),
  /** READ_NO_TASK (information only) | RESOLVED (worked, note required). */
  resolutionType: text("resolution_type"),
  resolutionNote: text("resolution_note"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  /**
   * The sender is chasing something Simple already dropped. Judged by the AI
   * per message, not by keyword matching.
   */
  isFollowUp: boolean("is_follow_up").notNull().default(false),
  followUpReason: text("follow_up_reason"),
  /**
   * INBOUND (default, back-compat with every row imported before sending
   * existed) | OUTBOUND for a message a staff member sent from the CRM.
   * senderEmail/senderName hold the sending identity (From address) for both
   * directions, so the list renders uniformly either way.
   */
  direction: text("direction").notNull().default("INBOUND"),
  /** Outbound only: who the message was sent to. */
  recipientEmails: jsonb("recipient_emails").notNull().default([]),
  /** Outbound only: set when the logged-in user is not the identity's own owner, so replies land on the shared mailbox instead of only the person being covered for. */
  replyToEmail: text("reply_to_email"),
  /**
   * Outbound only: the user actually logged in and clicking Send — distinct
   * from senderEmail, which is the identity chosen (possibly someone else's,
   * e.g. Steve covering for Kim). Both userId and a mirrored name are kept:
   * the name survives a deactivated account, matching the pattern used for
   * task/resolution attribution elsewhere in this app.
   */
  sentByUserId: integer("sent_by_user_id"),
  sentByUserName: text("sent_by_user_name"),
  /**
   * Set when a message doesn't resolve to a specific client but the
   * counterparty is 90 Degree Benefits (the TPA) — general/global TPA
   * discussion files here instead of sitting unassigned. A message that DOES
   * resolve to a client always files there even when the sender is 90DB, per
   * the rule that a group-specific message belongs to that group.
   */
  filesToVendor: boolean("files_to_vendor").notNull().default(false),
  /**
   * The RFC822 Message-ID header, the same for every mailbox's copy of one
   * email. Gmail's own per-mailbox message id differs for the same email
   * seen in two connected mailboxes (e.g. Steve CCs clientservice@ on a
   * message he sends), so cross-mailbox dedupe keys on this instead.
   */
  messageIdHeader: text("message_id_header"),
  /**
   * Set once this legacy row is confirmed to be the same physical email as
   * a row already ingested by the Gmail-native pipeline (gmail_messages).
   * Legacy rows predate Message-ID header capture, so this is matched by
   * sender + subject + a tight send-time window rather than an exact key —
   * see server/mailDedup.ts. Never deleted, just marked: a superseded row
   * keeps its resolution note/audit trail but is excluded from the
   * Gmail-native triage view (which reads gmail_messages directly) so the
   * same email never shows up twice across the two stores.
   */
  supersededByGmailMessageId: integer("superseded_by_gmail_message_id"),
});

/**
 * A mailbox a staff member can send as from the CRM (kim.anderson@simple.us,
 * clientservice@simple.us, ...). Data, not an enum or hardcoded conditional,
 * so a new address or a new user never requires a code change — see
 * userSendingIdentities for who may use each one.
 */
export const sendingIdentities = pgTable("sending_identities", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  /** Editable per identity — Kim's signature on kim.anderson@ is hers alone, independent of who else is permitted to send as that address. */
  signature: text("signature"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Which users may send as which identities. The permission check lives here, not in code. */
export const userSendingIdentities = pgTable("user_sending_identities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sendingIdentityId: integer("sending_identity_id").notNull(),
});

export const communicationClients = pgTable("communication_clients", {
  id: serial("id").primaryKey(),
  communicationId: integer("communication_id").notNull(),
  clientId: integer("client_id").notNull(),
  matchConfidence: text("match_confidence").notNull().default("high"),
});

export const communicationAttachments = pgTable("communication_attachments", {
  id: serial("id").primaryKey(),
  communicationId: integer("communication_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  storagePath: text("storage_path").notNull(),
  claudeAnalysis: text("claude_analysis"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  /** Set once this attachment has been auto-filed onto the client's documents tab, so it is never filed twice. */
  filedAsDocumentId: integer("filed_as_document_id"),
  /**
   * Where storagePath actually lives. Attachments filed before the Object
   * Storage migration stayed on local disk under storagePath; everything
   * pulled from Gmail (and anything new) goes to Object Storage instead, and
   * storagePath there is the bucket key, not a filesystem path.
   */
  storageBackend: text("storage_backend").notNull().default("local"),
  /** Set only for attachments pulled directly from Gmail, never for inbound webhook mail. */
  gmailMessageId: text("gmail_message_id"),
  gmailAttachmentId: text("gmail_attachment_id"),
  /** Which mailbox this came from (kim@..., etc), so re-imports can tell whose history they're walking. */
  gmailMailbox: text("gmail_mailbox"),
});

/**
 * One row per Anthropic API call made anywhere in the app, so live-sync spend
 * is visible and can be capped instead of discovered after the fact. Written
 * right after the call returns, from actual token usage on the response —
 * never estimated in advance, since that would drift from what's really billed.
 */
export const llmUsageLog = pgTable("llm_usage_log", {
  id: serial("id").primaryKey(),
  /** Which mailbox's sync triggered this call, or "manual" for on-demand calls (e.g. a to-do note match) not tied to any mailbox. */
  mailbox: text("mailbox").notNull(),
  /** matchEmailToClients | matchTextToClients | processEmail | classifyMailRelevance | generateThreadSummary | findDuplicateTask | ocrPageImage | extractDocumentFields | queryClientCommunications */
  callType: text("call_type").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  estimatedCostUsd: decimal("estimated_cost_usd", { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Tracks Gmail backfill/import progress per mailbox so a re-run picks up
 * where it left off instead of re-downloading and re-billing Claude for
 * attachments already ingested. One row per connected mailbox.
 */
export const gmailImportState = pgTable("gmail_import_state", {
  id: serial("id").primaryKey(),
  mailbox: text("mailbox").notNull().unique(),
  /** The oldest date this mailbox's backfill is allowed to reach — bounds cost, not a technical limit. */
  backfillStartDate: timestamp("backfill_start_date"),
  /** Internal date (ms since epoch, as Gmail returns it) of the newest message already processed. */
  lastProcessedInternalDate: text("last_processed_internal_date"),
  lastRunAt: timestamp("last_run_at"),
  lastRunSummary: text("last_run_summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * A single field Claude proposed after reading a filed document (PPR, renewal
 * letter, rate sheet). Never written to the target table automatically —
 * Kim or Steve reviews each one against currentValue and the cited
 * sourceLocation before it takes effect. Rejecting a proposal leaves the
 * target record untouched.
 */
export const documentFieldProposals = pgTable("document_field_proposals", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  clientId: integer("client_id").notNull(),
  /** Logical field name, e.g. "adminFee", "renewalEffectiveDate", "lossRatio". */
  fieldKey: text("field_key").notNull(),
  /** Human-readable label for the review screen, e.g. "Admin fee (all-in)". */
  fieldLabel: text("field_label").notNull(),
  proposedValue: text("proposed_value").notNull(),
  /** Where in the source document this came from, e.g. "Page 2, Renewal Summary table" or "Sheet1!B12". */
  sourceLocation: text("source_location"),
  /** What this would update if accepted. Nullable targetId means Claude could not confidently match a row (e.g. a new plan). */
  targetTable: text("target_table").notNull(),
  targetId: integer("target_id"),
  targetField: text("target_field").notNull(),
  /** Snapshot of the value in place when this was proposed, so the reviewer sees exactly what would change. */
  currentValue: text("current_value"),
  status: text("status").notNull().default("PENDING"), // PENDING | ACCEPTED | REJECTED
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /**
   * MAPPED | UNMAPPED. Set once, when the proposal is created (or backfilled), by
   * running fieldKey through the fieldMapping table. UNMAPPED means Claude found a
   * value but there is no known client/plan column for it — it stays in the queue
   * forever rather than being silently dropped, since a person may still want to
   * act on it by hand.
   */
  mappingStatus: text("mapping_status").notNull().default("UNMAPPED"),
  /**
   * normal | low. Low confidence means this is a plan-design field (deductible,
   * coinsurance percents, ortho rules, annual max, etc.) proposed from a PPR
   * report rather than a plan document or signed renewal. PPR's plan-design block
   * is often stale, so these render with a warning and are excluded from bulk
   * confirm — they still need a one-by-one look.
   */
  confidence: text("confidence").notNull().default("normal"),
  /** True when fieldKey maps to a plan-design column (as opposed to admin/contact/financial fields). */
  isPlanDesignField: boolean("is_plan_design_field").notNull().default(false),
});

/**
 * Permanent audit trail of every value a field-proposal confirmation actually
 * wrote to a client/plan record. One row per field per confirmation — a bulk
 * confirm across several fields on the same document produces one row each,
 * never a single combined row, so each field can be individually undone.
 */
export const fieldChangeHistory = pgTable("field_change_history", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id").notNull(),
  clientId: integer("client_id").notNull(),
  targetTable: text("target_table").notNull(),
  targetId: integer("target_id").notNull(),
  targetField: text("target_field").notNull(),
  fieldLabel: text("field_label").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  sourceDocumentId: integer("source_document_id"),
  sourceDocumentName: text("source_document_name"),
  confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: timestamp("confirmed_at").notNull().defaultNow(),
  /** Set only once this change is reverted. The proposal itself stays ACCEPTED — this row is the undo record. */
  undoneBy: text("undone_by"),
  undoneAt: timestamp("undone_at"),
});
export type FieldChangeHistory = typeof fieldChangeHistory.$inferSelect;

export const communicationTasks = pgTable("communication_tasks", {
  id: serial("id").primaryKey(),
  /**
   * The email this task came out of, or null when Kim typed it herself.
   *
   * Nullable because real service work happens on the phone and in the
   * corridor, not only in the mailbox. A task with no communication is a
   * manually captured to-do and has no conversation to resolve alongside it.
   */
  communicationId: integer("communication_id"),
  /**
   * The Gmail-native message this task came from, for tasks created off the
   * gmail_messages/gmail_threads pipeline instead of the legacy communications
   * webhook path. Exactly one of communicationId/gmailMessageId is set for an
   * AI-origin task; both are null for a manually typed to-do.
   */
  gmailMessageId: integer("gmail_message_id"),
  /**
   * Mirror of the first attached client, kept so older callers that expect a
   * single client keep working. `task_clients` is the truth: a task can be
   * about more than one account, and about none at all.
   */
  clientId: integer("client_id"),
  description: text("description").notNull(),
  dueDate: timestamp("due_date"),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /**
   * OPEN | TODO | RESOLVED. OPEN is a fresh suggestion, TODO has been pushed
   * onto the to-do list with a priority, RESOLVED carries a mandatory note.
   * `isCompleted` is kept in lockstep with RESOLVED for older callers.
   */
  status: text("status").notNull().default("OPEN"),
  /** URGENT | NORMAL | CASUAL. Set only once the task is on the to-do list. */
  priority: text("priority"),
  todoAddedAt: timestamp("todo_added_at"),
  resolutionNote: text("resolution_note"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  /** AI (extracted from the message) | MANUAL (Kim typed it). */
  origin: text("origin").notNull().default("AI"),
  /** Manual drag ordering within a priority section. Lower sorts first. */
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * Full name of the person this task belongs to (Kim Anderson | Steve Schultz).
   * Everything defaults to Kim, the service rep; she reassigns to Steve when needed.
   * Text, not a user FK, to match the existing resolvedBy convention.
   */
  owner: text("owner").notNull().default("Kim Anderson"),
  /**
   * Groups this task with others that are the same underlying job (same
   * client, same ask) extracted more than once, whether from repeat mentions
   * in one thread or from several different threads. Null means the task
   * stands alone. All tasks sharing a groupId render as one item with the
   * others listed underneath instead of as separate rows.
   */
  groupId: text("group_id"),
  /**
   * HIGH | MEDIUM | LOW, set only on AI-origin tasks (gmailMessageId is set)
   * from the same extraction call that produced the description. Null for
   * manual to-dos. Drives the per-owner triage dashboard's inclusion
   * threshold (app_settings key TRIAGE_MIN_PRIORITY) — a tunable setting
   * compared at query time, not a filter baked into the extraction prompt,
   * so raising or lowering the bar surfaces or hides already-extracted items
   * without re-running AI extraction.
   */
  aiPriority: text("ai_priority"),
});

/**
 * Small set of admin-tunable knobs that used to be constants in code. One
 * row per key, so a new setting is a data row, not a migration.
 */
export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

/**
 * Which clients a task is about. Many-to-many on purpose.
 *
 * "Call Annette to discuss the Ware and Thomas renewals" is one job, one phone
 * call and one resolution, but it touches two accounts and must appear on both
 * records. Duplicating the task per client would make Kim resolve the same call
 * twice and write the same note twice.
 *
 * No rows at all is a legitimate state: the to-do belongs to the business
 * rather than to any account, and shows up as General.
 */
export const taskClients = pgTable("task_clients", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  clientId: integer("client_id").notNull(),
  /** high | medium | low from the AI, or "manual" when a person attached it. */
  matchConfidence: text("match_confidence").notNull().default("manual"),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const brokerHistory = pgTable("broker_history", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  brokerFirmName: text("broker_firm_name"),
  brokerContactName: text("broker_contact_name"),
  brokerPhone: text("broker_phone"),
  brokerEmail: text("broker_email"),
  effectiveDate: timestamp("effective_date").notNull(),
  terminationDate: timestamp("termination_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One row per Gmail thread read from the connected mailbox. Full mail, not
 * just the has:attachment subset gmailImportState/communications cover — this
 * is the "Gmail inside the CRM" view, so a thread is the unit of navigation,
 * classification, privacy, and AI summary the same way it is in Gmail itself.
 */
export const gmailThreadBusinessEnum = pgEnum("gmail_thread_business", ["MATCHED", "UNASSIGNED", "NOT_BUSINESS"]);

export const gmailThreads = pgTable("gmail_threads", {
  id: serial("id").primaryKey(),
  gmailThreadId: text("gmail_thread_id").notNull().unique(),
  mailbox: text("mailbox").notNull(),
  subject: text("subject"),
  /** Denormalized for fast list sorting; kept in step with the newest message's date. */
  latestMessageAt: timestamp("latest_message_at").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  /** MATCHED (has a client), UNASSIGNED (business but no client match), NOT_BUSINESS (newsletter/marketing/receipt/personal). */
  businessStatus: gmailThreadBusinessEnum("business_status").notNull().default("UNASSIGNED"),
  /** AI-written structured summary: who wants what, questions, dates, amounts, action needed. Null for short threads. */
  summary: text("summary"),
  /** One line for the list view, derived from the same summary pass. */
  summaryOneLine: text("summary_one_line"),
  summaryGeneratedAt: timestamp("summary_generated_at"),
  /** messageCount at the time the summary was generated, so a new message on the thread is detected and triggers a regenerate. */
  summaryForMessageCount: integer("summary_for_message_count"),
  /**
   * Admin-only visibility. Excluded from search, counts, and summaries for
   * everyone else. Nothing sets this yet — it exists so the flag is ready
   * before any workflow depends on it.
   */
  isPrivate: boolean("is_private").notNull().default(false),
  /** Same meaning as communications.filesToVendor: general 90 Degree Benefits correspondence that never resolved to a specific client. */
  filesToVendor: boolean("files_to_vendor").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gmailThreadClients = pgTable("gmail_thread_clients", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull(),
  clientId: integer("client_id").notNull(),
  matchConfidence: text("match_confidence").notNull().default("medium"),
});

export const gmailMessageDirectionEnum = pgEnum("gmail_message_direction", ["SENT", "RECEIVED"]);

export const gmailMessages = pgTable("gmail_messages", {
  id: serial("id").primaryKey(),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  threadId: integer("thread_id").notNull(),
  mailbox: text("mailbox").notNull(),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  /** Every To/Cc address as a plain lowercase email, for participant search. */
  toEmails: jsonb("to_emails").notNull().default([]),
  ccEmails: jsonb("cc_emails").notNull().default([]),
  subject: text("subject"),
  /** Full original body exactly as received — quoted history is never discarded here. */
  bodyText: text("body_text"),
  /** Sanitized for display: scripts/iframes/forms stripped, event handlers removed, remote images and tracking pixels blocked. */
  bodyHtmlSafe: text("body_html_safe"),
  /**
   * The sender's own new text only — quoted history, "On ... wrote:" / Outlook
   * From:/Sent:/To: reply headers, and a trailing "-- " signature block
   * stripped. Equal to bodyText when the message is a forward (forwarded
   * content is the point, so it's kept) or when trimming wasn't confident
   * (falls back to the full body rather than risk hiding real content).
   * This is what AI summaries and default search run against.
   */
  bodyTextNew: text("body_text_new"),
  /** True when bodyTextNew is a strict subset of bodyText — drives the "show quoted text" toggle. */
  hasQuotedText: boolean("has_quoted_text").notNull().default(false),
  /** True when this message is itself a forward — quoted/forwarded content is deliberately not trimmed. */
  isForward: boolean("is_forward").notNull().default(false),
  snippet: text("snippet"),
  sentAt: timestamp("sent_at").notNull(),
  direction: gmailMessageDirectionEnum("direction").notNull(),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  /** RFC822 Message-ID header — see communications.messageIdHeader for why this, not Gmail's per-mailbox id, is the cross-mailbox dedupe key. */
  messageIdHeader: text("message_id_header"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gmailAttachments = pgTable("gmail_attachments", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  gmailAttachmentId: text("gmail_attachment_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  /**
   * True for small inline images (signature logos, tracking icons) — never
   * downloaded or filed as a document, only listed for completeness.
   */
  isEmbeddedImage: boolean("is_embedded_image").notNull().default(false),
  storagePath: text("storage_path"),
  /** Set once this attachment is filed onto the client's Documents tab. */
  filedAsDocumentId: integer("filed_as_document_id"),
});

export const insertGmailThreadSchema = createInsertSchema(gmailThreads).omit({ id: true, createdAt: true });
export const insertGmailThreadClientSchema = createInsertSchema(gmailThreadClients).omit({ id: true });
export const insertGmailMessageSchema = createInsertSchema(gmailMessages).omit({ id: true, createdAt: true });
export const insertGmailAttachmentSchema = createInsertSchema(gmailAttachments).omit({ id: true });

export type GmailThread = typeof gmailThreads.$inferSelect;
export type InsertGmailThread = z.infer<typeof insertGmailThreadSchema>;
export type GmailThreadClient = typeof gmailThreadClients.$inferSelect;
export type InsertGmailThreadClient = z.infer<typeof insertGmailThreadClientSchema>;
export type GmailMessage = typeof gmailMessages.$inferSelect;
export type InsertGmailMessage = z.infer<typeof insertGmailMessageSchema>;
export type GmailAttachment = typeof gmailAttachments.$inferSelect;
export type InsertGmailAttachment = z.infer<typeof insertGmailAttachmentSchema>;

export const insertCommunicationSchema = createInsertSchema(communications).omit({ id: true, receivedAt: true });
export const insertCommunicationClientSchema = createInsertSchema(communicationClients).omit({ id: true });
export const insertCommunicationAttachmentSchema = createInsertSchema(communicationAttachments).omit({ id: true, uploadedAt: true });
export const insertCommunicationTaskSchema = createInsertSchema(communicationTasks).omit({
  id: true, createdAt: true, completedAt: true, resolvedAt: true, resolvedBy: true, todoAddedAt: true,
});
export const insertTaskClientSchema = createInsertSchema(taskClients).omit({ id: true });
export const insertSendingIdentitySchema = createInsertSchema(sendingIdentities).omit({ id: true, createdAt: true });
export const insertUserSendingIdentitySchema = createInsertSchema(userSendingIdentities).omit({ id: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPlanTierSchema = createInsertSchema(planTiers).omit({ id: true, createdAt: true });
export const insertPlanSchema = createInsertSchema(plans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRateCardSchema = createInsertSchema(rateCards).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, uploadedAt: true });
export const insertGlobalDocumentSchema = createInsertSchema(globalDocuments).omit({ id: true, uploadedAt: true });
export const insertVendorContactSchema = createInsertSchema(vendorContacts).omit({ id: true });
/**
 * One row per unique sender domain found while censusing a label for
 * historical backfill (e.g. "90 Degree Benefits" on steve.schultz@) — never
 * per-thread, since the whole point is one classification call per domain
 * whose verdict then applies to every thread from it. PENDING until
 * classifyDomain() runs; BUSINESS/CONSUMER after. Own domains (simple.us,
 * simple.dental) and free-mail providers never get a row here — they're
 * handled by gmailBackfillThreads directly.
 */
export const gmailBackfillDomains = pgTable("gmail_backfill_domains", {
  id: serial("id").primaryKey(),
  mailbox: text("mailbox").notNull(),
  label: text("label").notNull(),
  domain: text("domain").notNull(),
  threadCount: integer("thread_count").notNull().default(0),
  verdict: text("verdict").notNull().default("PENDING"), // PENDING | BUSINESS | CONSUMER
  classifiedAt: timestamp("classified_at"),
  model: text("model"),
  /** One subject line captured while sampling for classification — carried forward so the consumer-domain human review list never needs a second Gmail round trip. */
  sampleSubject: text("sample_subject"),
  /** Earliest/latest sent date seen among the sampled messages for this domain — an approximation (from the sample, not a full scan) good enough for a reviewer to judge "is this really just noise". */
  earliestSampleAt: timestamp("earliest_sample_at"),
  latestSampleAt: timestamp("latest_sample_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One row per thread under the censused label, recording which
 * counterparty domain (if any) it resolved to and whether it's been
 * imported yet — the resumable unit for both the census pass (populated
 * once, cheap) and the import pass (importedAt set once its messages are
 * actually stored). category mirrors gmailBackfillDomains.verdict but adds
 * the buckets a domain verdict alone can't capture: OWN_ONLY (every
 * participant on simple.us/simple.dental — nothing external to file
 * against), FREE_PROVIDER (gmail.com etc. — resolved by exact address, not
 * domain), and NO_EXTERNAL_DOMAIN (no parseable non-own sender found).
 *
 * permanentlyExcluded is set at census time for OWN_ONLY and
 * NO_EXTERNAL_DOMAIN threads — internal/no-counterparty mail that must never
 * reach the import phase, in any future run, not just the run that first
 * saw it. The resumable "already seen" check already skips a re-classify,
 * but this flag makes the exclusion an explicit, auditable fact about the
 * row rather than an emergent property of category filtering.
 */
export const gmailBackfillThreads = pgTable("gmail_backfill_threads", {
  id: serial("id").primaryKey(),
  mailbox: text("mailbox").notNull(),
  label: text("label").notNull(),
  gmailThreadId: text("gmail_thread_id").notNull(),
  domain: text("domain"),
  category: text("category").notNull(), // DOMAIN_PENDING | BUSINESS | CONSUMER | OWN_ONLY | FREE_PROVIDER_RESOLVED | FREE_PROVIDER_UNRESOLVED | FREE_PROVIDER_BUSINESS | FREE_PROVIDER_CONSUMER | NO_EXTERNAL_DOMAIN
  resolvedContactEmail: text("resolved_contact_email"),
  /** For FREE_PROVIDER_UNRESOLVED threads: the free-mail counterparty address and one subject line, captured once at census time so the later per-thread classification pass needs zero extra Gmail calls. */
  counterpartyEmail: text("counterparty_email"),
  sampleSubject: text("sample_subject"),
  permanentlyExcluded: boolean("permanently_excluded").notNull().default(false),
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertGmailBackfillDomainSchema = createInsertSchema(gmailBackfillDomains).omit({ id: true, createdAt: true });
export const insertGmailBackfillThreadSchema = createInsertSchema(gmailBackfillThreads).omit({ id: true, createdAt: true });
export type GmailBackfillDomain = typeof gmailBackfillDomains.$inferSelect;
export type InsertGmailBackfillDomain = z.infer<typeof insertGmailBackfillDomainSchema>;
export type GmailBackfillThread = typeof gmailBackfillThreads.$inferSelect;
export type InsertGmailBackfillThread = z.infer<typeof insertGmailBackfillThreadSchema>;

export const insertGmailImportStateSchema = createInsertSchema(gmailImportState).omit({ id: true, createdAt: true });
export const insertLlmUsageLogSchema = createInsertSchema(llmUsageLog).omit({ id: true, createdAt: true });
export const insertAppSettingSchema = createInsertSchema(appSettings).omit({ id: true, updatedAt: true });
export const insertDocumentFieldProposalSchema = createInsertSchema(documentFieldProposals).omit({ id: true, createdAt: true, reviewedAt: true, reviewedBy: true });
export const insertIssueSchema = createInsertSchema(issues).omit({ id: true, createdAt: true, updatedAt: true, resolvedAt: true });
export const insertPprUploadSchema = createInsertSchema(pprUploads).omit({ id: true, uploadedAt: true });
export const insertPprMetricsSchema = createInsertSchema(pprMetrics).omit({ id: true, importedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type PlanTier = typeof planTiers.$inferSelect;
export type InsertPlanTier = z.infer<typeof insertPlanTierSchema>;
export type Plan = typeof plans.$inferSelect;
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type RateCard = typeof rateCards.$inferSelect;
export type InsertRateCard = z.infer<typeof insertRateCardSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type GlobalDocument = typeof globalDocuments.$inferSelect;
export type InsertGlobalDocument = z.infer<typeof insertGlobalDocumentSchema>;
export type VendorContact = typeof vendorContacts.$inferSelect;
export type InsertVendorContact = z.infer<typeof insertVendorContactSchema>;
export type GmailImportState = typeof gmailImportState.$inferSelect;
export type LlmUsageLog = typeof llmUsageLog.$inferSelect;
export type InsertLlmUsageLog = z.infer<typeof insertLlmUsageLogSchema>;
export type InsertGmailImportState = z.infer<typeof insertGmailImportStateSchema>;
export type DocumentFieldProposal = typeof documentFieldProposals.$inferSelect;
export type InsertDocumentFieldProposal = z.infer<typeof insertDocumentFieldProposalSchema>;
export type Issue = typeof issues.$inferSelect;
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type PprUpload = typeof pprUploads.$inferSelect;
export type InsertPprUpload = z.infer<typeof insertPprUploadSchema>;
export interface PprMonthGroup {
  reportYear: number;
  reportMonth: number;
  pdf: PprUpload | null;
  excel: PprUpload | null;
  notes: string | null;
  uploadedAt: Date;
}
export type PprMetrics = typeof pprMetrics.$inferSelect;
export type InsertPprMetrics = z.infer<typeof insertPprMetricsSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type Communication = typeof communications.$inferSelect;
export type InsertCommunication = z.infer<typeof insertCommunicationSchema>;
export type CommunicationClient = typeof communicationClients.$inferSelect;
export type InsertCommunicationClient = z.infer<typeof insertCommunicationClientSchema>;
export type CommunicationAttachment = typeof communicationAttachments.$inferSelect;
export type InsertCommunicationAttachment = z.infer<typeof insertCommunicationAttachmentSchema>;
export type SendingIdentity = typeof sendingIdentities.$inferSelect;
export type InsertSendingIdentity = z.infer<typeof insertSendingIdentitySchema>;
export type UserSendingIdentity = typeof userSendingIdentities.$inferSelect;
export type InsertUserSendingIdentity = z.infer<typeof insertUserSendingIdentitySchema>;
export type CommunicationTask = typeof communicationTasks.$inferSelect;
export type InsertCommunicationTask = z.infer<typeof insertCommunicationTaskSchema>;
export type TaskClient = typeof taskClients.$inferSelect;
export type InsertTaskClient = z.infer<typeof insertTaskClientSchema>;
export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

/** Priority ranking, low to high — used to compare an AI-tagged item's priority against the tunable TRIAGE_MIN_PRIORITY setting. */
export const PRIORITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
export const TRIAGE_MIN_PRIORITY_KEY = "TRIAGE_MIN_PRIORITY";
export const TRIAGE_MIN_PRIORITY_DEFAULT = "LOW";

export const insertBrokerHistorySchema = createInsertSchema(brokerHistory).omit({ id: true, createdAt: true });
export type BrokerHistory = typeof brokerHistory.$inferSelect;
export type InsertBrokerHistory = z.infer<typeof insertBrokerHistorySchema>;

/**
 * The people a brokerage assigns to one client. A brokerage typically names a lead
 * (Account Advisor, Account Executive, Implementation Manager) plus a service
 * representative, and occasionally a third.
 *
 * Keyed to the client, not to a firm. The same firm serves different clients through
 * different people — HUB International covers six clients through three separate
 * contacts — so the contact belongs to the client-broker relationship. The firm name
 * stays on the client record, where there is exactly one per client.
 *
 * `clients.broker_contact_name / broker_phone / broker_email` remain populated from
 * whichever row is primary, so every existing reader keeps working unchanged.
 */
export const brokerContacts = pgTable("broker_contacts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  contactName: text("contact_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  /** Free text — the titles brokerages use vary and are not worth constraining. */
  role: text("role"),
  /**
   * Free text for anything the structured fields cannot hold — "from the 2024
   * workbook, may no longer be on the account", "prefers phone", a second address
   * the person also uses. Deliberately unstructured: the alternative is inventing a
   * column every time a one-off fact turns up.
   */
  notes: text("notes"),
  isPrimary: boolean("is_primary").notNull().default(false),
  /** Same dating pattern as broker_history: null termination means currently serving. */
  effectiveDate: timestamp("effective_date"),
  terminationDate: timestamp("termination_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBrokerContactSchema = createInsertSchema(brokerContacts).omit({ id: true, createdAt: true, updatedAt: true });

/**
 * One row per mailbox the CRM's own Gmail OAuth app can act as
 * (kim.anderson@, clientservice@, steve.schultz@). Replaces the Replit Gmail
 * connector for these three, since that connector holds one account at a
 * time and these three mailboxes must be authorized concurrently, each with
 * its own scopes. Refresh tokens are sensitive — never returned from any API
 * route, only read server-side to mint a short-lived access token.
 */
export const gmailAccounts = pgTable("gmail_accounts", {
  id: serial("id").primaryKey(),
  mailbox: text("mailbox").notNull().unique(),
  displayName: text("display_name").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  /** Scopes actually granted at the last successful (re)authorization. */
  scopes: jsonb("scopes").notNull().default([]),
  /** CONNECTED | NEEDS_REAUTH — flips to NEEDS_REAUTH the moment a refresh attempt fails (revoked/expired), surfaced in the Mail Accounts admin page rather than failing silently mid-sync. */
  status: text("status").notNull().default("CONNECTED"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncSummary: text("last_sync_summary"),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  connectedBy: text("connected_by"),
});

export const insertGmailAccountSchema = createInsertSchema(gmailAccounts).omit({ id: true, connectedAt: true });
export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type InsertGmailAccount = typeof gmailAccounts.$inferInsert;

/**
 * Domains eligible for Steve's mailbox allow-list, generated from client and
 * broker records rather than hand-maintained. `approved` starts null
 * (pending review) — the allow-list backfill and ongoing sync both refuse to
 * treat a domain as eligible until an admin has explicitly reviewed it, per
 * the requirement that the first pass never runs against an unreviewed list.
 * Free mail providers (gmail.com etc.) are never generated as candidates —
 * filtered out before insertion — since a domain rule there would sweep in
 * personal mail; contacts on those providers rely on the exact-address list
 * instead.
 */
export const mailAllowlistDomains = pgTable("mail_allowlist_domains", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  /** CLIENT | BROKER | VENDOR — where this domain was generated from, shown to the reviewer for context. */
  source: text("source").notNull(),
  /** e.g. the client or firm name, for the review screen — not used in matching. */
  sourceLabel: text("source_label"),
  /** null = pending review, true = approved for matching, false = explicitly rejected. */
  approved: boolean("approved"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMailAllowlistDomainSchema = createInsertSchema(mailAllowlistDomains).omit({ id: true, createdAt: true });
export type MailAllowlistDomain = typeof mailAllowlistDomains.$inferSelect;
export type InsertMailAllowlistDomain = typeof mailAllowlistDomains.$inferInsert;
export type BrokerContact = typeof brokerContacts.$inferSelect;
export type InsertBrokerContact = z.infer<typeof insertBrokerContactSchema>;

// ── Renewal records (one per client per plan year) ────────────────────────────
// A renewal opens automatically 30 days before the proposal due date
// (anniversary − lead months − 30 days), giving staff time to produce the
// analysis and contact the client before the proposal itself is due.
//
// A new renewal opens on schedule regardless of whether the prior year's
// renewal reached its final step — an incomplete renewal must never block the
// next one. When that happens, incompletePriorFlag is set so it is surfaced
// rather than hidden.
//
// DB-level constraint (in migration SQL): UNIQUE (client_id, plan_year).
// Auto-creation fires on GET requests, so concurrent page loads would otherwise
// race to insert the same record.
export const renewals = pgTable("renewals", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  // Calendar year of the anniversary this renewal cycle covers
  planYear: integer("plan_year").notNull(),
  // Seven-step pipeline — set manually by staff; never derived from dates
  pipelineStep: text("pipeline_step"),
  proposalSentDate: timestamp("proposal_sent_date"),
  proposalVersion: text("proposal_version"),
  acceptanceReceivedDate: timestamp("acceptance_received_date"),
  // True when a prior year's renewal was still open as this one auto-created
  incompletePriorFlag: boolean("incomplete_prior_flag").notNull().default(false),
  // Set when the pipeline first reaches EMAILED_TO_90D.
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  clientPlanYearUnique: uniqueIndex("renewals_client_plan_year_unique").on(table.clientId, table.planYear),
}));
export type Renewal = typeof renewals.$inferSelect;
export const insertRenewalSchema = createInsertSchema(renewals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRenewal = z.infer<typeof insertRenewalSchema>;

// ── Renewal plan options (one per plan per renewal) ───────────────────────────
// Which proposal option the client accepted, plus the rate snapshot, recorded
// per plan within a renewal — a multi-plan client can accept a different option
// on each plan (e.g. Recommended on dental, Value on vision).
export const renewalPlanOptions = pgTable("renewal_plan_options", {
  id: serial("id").primaryKey(),
  renewalId: integer("renewal_id").notNull(),
  planId: integer("plan_id").notNull(),
  acceptedOption: text("accepted_option"),  // 'VALUE' | 'RECOMMENDED' | 'PROTECTIVE' | null
  acceptedRates: jsonb("accepted_rates"),   // rate snapshot produced by the rating engine
  // Version of the rating program that produced the accepted rates (e.g. "7.3.1").
  // Lets staff tell whether a regenerated document would match what was signed.
  ratingEngineVersion: text("rating_engine_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  renewalPlanUnique: uniqueIndex("renewal_plan_options_renewal_plan_unique").on(table.renewalId, table.planId),
}));
export type RenewalPlanOption = typeof renewalPlanOptions.$inferSelect;
export const insertRenewalPlanOptionSchema = createInsertSchema(renewalPlanOptions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRenewalPlanOption = z.infer<typeof insertRenewalPlanOptionSchema>;

// ── Renewal pipeline progress (one record per plan) ──────────────────────────
export const renewalProgress = pgTable("renewal_progress", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().unique(),
  clientId: integer("client_id").notNull(),
  step1Date: timestamp("step1_date"),                                   // Renewal Requested
  step2Date: timestamp("step2_date"),                                   // Renewal Processed
  step3Date: timestamp("step3_date"),                                   // Renewal Sent
  step4Revisions: jsonb("step4_revisions").$type<string[]>().default([]), // Renewal Revised (optional, multiple)
  step5Date: timestamp("step5_date"),                                   // Renewal Accepted
  step6Date: timestamp("step6_date"),                                   // Signed Form Attached
  step6DocumentId: integer("step6_document_id"),                        // FK → documents (optional)
  step7Date: timestamp("step7_date"),                                   // Form Emailed to 90 Degree
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type RenewalProgress = typeof renewalProgress.$inferSelect;

// ── Prospect pipeline progress (one record per client) ───────────────────────
export const prospectProgress = pgTable("prospect_progress", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique(),
  step1Date: timestamp("step1_date"),   // New Proposal Requested
  step2Date: timestamp("step2_date"),   // Proposal Received
  step3Date: timestamp("step3_date"),   // Proposal Sent
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ProspectProgress = typeof prospectProgress.$inferSelect;

// ── Monthly plan performance facts ───────────────────────────────────────────
// Append-only versioned table: one row per client/plan/calendar month per
// revision.  The current (latest) version for each client/plan/month is the
// row where superseded_at IS NULL.  When figures are revised a new row is
// inserted and the prior row's superseded_at is stamped — never overwrite.
//
// DB-level constraints (enforced in migration SQL, not re-expressed here):
//   • UNIQUE (client_id, plan_id, report_month, report_year) WHERE superseded_at IS NULL
//   • CHECK  reason_code <> 'OTHER' OR (reason_note IS NOT NULL AND trim(reason_note) <> '')
//   • CHECK  report_month BETWEEN 1 AND 12
//   • CHECK  release_month BETWEEN 1 AND 12 (when not null)
export const planPerformanceFacts = pgTable("plan_performance_facts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  planId: integer("plan_id").notNull(),
  reportMonth: integer("report_month").notNull(),    // 1–12
  reportYear: integer("report_year").notNull(),
  version: integer("version").notNull().default(1), // increments with each revision

  // Enrollment by tier — mirrors the four tiers in rate_cards
  eeCount: integer("ee_count"),
  eeSpouseCount: integer("ee_spouse_count"),
  eeChildCount: integer("ee_child_count"),
  familyCount: integer("family_count"),

  // Claims figures
  submittedCharges: decimal("submitted_charges", { precision: 14, scale: 2 }),
  paidClaims: decimal("paid_claims", { precision: 14, scale: 2 }),
  claimCount: integer("claim_count"),

  // Why a month was held or figures were changed; drives client-facing report wording
  reasonCode: pprReasonCodeEnum("reason_code"),
  reasonNote: text("reason_note"),  // required when reasonCode = 'OTHER'

  // For held months: the later month in which those claims were eventually released
  releaseMonth: integer("release_month"),
  releaseYear: integer("release_year"),

  // Optional actual account balance at month end (supplied by the administrator for some groups).
  // When present, the report shows billed plan position alongside the actual balance and the gap.
  // When absent, the comparison is simply omitted — many groups will not have this figure.
  accountBalance: decimal("account_balance", { precision: 14, scale: 2 }),

  // Provenance
  receivedDate: timestamp("received_date"),
  loadedBy: text("loaded_by").notNull(),

  // Versioning: NULL = this is the current row; non-NULL = superseded on that timestamp
  supersededAt: timestamp("superseded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPlanPerformanceFactsSchema = createInsertSchema(planPerformanceFacts).omit({
  id: true, createdAt: true,
});
export type PlanPerformanceFacts = typeof planPerformanceFacts.$inferSelect;
export type InsertPlanPerformanceFacts = z.infer<typeof insertPlanPerformanceFactsSchema>;

// ── Monthly import batches ────────────────────────────────────────────────────
// One record per combined file received from 90 Degree Benefits.
export const pprImportBatches = pgTable("ppr_import_batches", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsUnchanged: integer("rows_unchanged").notNull().default(0),
  rowsRestated: integer("rows_restated").notNull().default(0),
  rowsHeld: integer("rows_held").notNull().default(0),
  notes: text("notes"),
});

// ── Held (failed-validation) rows from a monthly import ──────────────────────
// Rows that failed import validation are stored here rather than silently
// dropped.  After the administrator clarifies, a user can accept or discard
// each held row.  Accepting a row writes it to plan_performance_facts.
export const pprHeldRows = pgTable("ppr_held_rows", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  clientCode: text("client_code"),
  planName: text("plan_name"),
  reportMonth: integer("report_month"),
  reportYear: integer("report_year"),
  // All values from the original file row — used when the row is later accepted
  rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
  holdReasons: jsonb("hold_reasons").$type<string[]>().notNull().default([]),
  status: heldRowStatusEnum("status").notNull().default("PENDING"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  // If the user overrides the client/plan on acceptance these are populated
  resolvedClientId: integer("resolved_client_id"),
  resolvedPlanId: integer("resolved_plan_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPprImportBatchSchema = createInsertSchema(pprImportBatches).omit({ id: true, uploadedAt: true });
export const insertPprHeldRowSchema = createInsertSchema(pprHeldRows).omit({ id: true, createdAt: true });
export type PprImportBatch = typeof pprImportBatches.$inferSelect;
export type InsertPprImportBatch = z.infer<typeof insertPprImportBatchSchema>;
export type PprHeldRow = typeof pprHeldRows.$inferSelect;
export type InsertPprHeldRow = z.infer<typeof insertPprHeldRowSchema>;
