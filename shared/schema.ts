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
export const documentCategoryEnum = pgEnum("document_category", ["CLIENT_AGREEMENT", "PROPOSAL", "EMPLOYER_ACCEPTANCE", "BROKER_COMPENSATION", "BROKER_OF_RECORD", "RENEWAL_PROPOSAL", "PPR_REPORT", "OTHER"]);
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
});

export const communicationTasks = pgTable("communication_tasks", {
  id: serial("id").primaryKey(),
  communicationId: integer("communication_id").notNull(),
  clientId: integer("client_id"),
  description: text("description").notNull(),
  dueDate: timestamp("due_date"),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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

export const insertCommunicationSchema = createInsertSchema(communications).omit({ id: true, receivedAt: true });
export const insertCommunicationClientSchema = createInsertSchema(communicationClients).omit({ id: true });
export const insertCommunicationAttachmentSchema = createInsertSchema(communicationAttachments).omit({ id: true, uploadedAt: true });
export const insertCommunicationTaskSchema = createInsertSchema(communicationTasks).omit({ id: true, createdAt: true, completedAt: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPlanTierSchema = createInsertSchema(planTiers).omit({ id: true, createdAt: true });
export const insertPlanSchema = createInsertSchema(plans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRateCardSchema = createInsertSchema(rateCards).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, uploadedAt: true });
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
export type CommunicationTask = typeof communicationTasks.$inferSelect;
export type InsertCommunicationTask = z.infer<typeof insertCommunicationTaskSchema>;

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
