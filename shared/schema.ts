import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, pgEnum, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", ["ADMIN", "STANDARD"]);
export const planTypeEnum = pgEnum("plan_type", ["DENTAL", "VISION", "HEARING", "DENTAL_VISION", "HEARING_VISION", "DENTAL_HEARING_VISION"]);
export const planBasisEnum = pgEnum("plan_basis", ["PROCEDURE_BASED", "DOLLAR_BASED"]);
export const tierEnum = pgEnum("tier", ["EE", "EE_CHILD", "EE_SPOUSE", "FAMILY"]);
export const bankingTypeEnum = pgEnum("banking_type", ["CLIENT_BANK", "NINETY_DEGREE_BANK"]);
export const fundingTypeEnum = pgEnum("funding_type", ["REQUIRES_APPROVAL", "PROCESS_WITHOUT_APPROVAL"]);
export const documentCategoryEnum = pgEnum("document_category", ["CLIENT_AGREEMENT", "PROPOSAL", "EMPLOYER_ACCEPTANCE", "BROKER_COMPENSATION", "BROKER_OF_RECORD", "RENEWAL_PROPOSAL", "OTHER"]);
export const issueStatusEnum = pgEnum("issue_status", ["ACTIVE", "RESOLVED"]);

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
  streetAddress: text("street_address").notNull(),
  suiteUnit: text("suite_unit"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zipCode: text("zip_code").notNull(),
  industryType: text("industry_type").notNull(),
  numberOfEmployees: integer("number_of_employees").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  terminationDate: timestamp("termination_date"),
  planType: planTypeEnum("plan_type").notNull(),
  networkActive: boolean("network_active").notNull().default(false),
  dentalNetworkName: text("dental_network_name").default("Dentemax"),
  decisionMakerName: text("decision_maker_name").notNull(),
  decisionMakerTitle: text("decision_maker_title").notNull(),
  decisionMakerPhone: text("decision_maker_phone").notNull(),
  decisionMakerEmail: text("decision_maker_email").notNull(),
  adminContactName: text("admin_contact_name").notNull(),
  adminContactTitle: text("admin_contact_title").notNull().default("Admin Contact"),
  adminContactPhone: text("admin_contact_phone").notNull(),
  adminContactEmail: text("admin_contact_email").notNull(),
  hasBroker: boolean("has_broker").notNull().default(false),
  brokerFirmName: text("broker_firm_name"),
  brokerContactName: text("broker_contact_name"),
  brokerPhone: text("broker_phone"),
  brokerEmail: text("broker_email"),
  bankingType: bankingTypeEnum("banking_type").notNull(),
  fundingType: fundingTypeEnum("funding_type").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  planName: text("plan_name").notNull(),
  effectiveDate: timestamp("effective_date").notNull(),
  planBasis: planBasisEnum("plan_basis").notNull(),
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
  isArchived: boolean("is_archived").notNull().default(false),
  planYear: integer("plan_year").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const rateCards = pgTable("rate_cards", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  tier: tierEnum("tier").notNull(),
  baseAdminFee: decimal("base_admin_fee", { precision: 10, scale: 2 }).notNull(),
  spreadAdminFee: decimal("spread_admin_fee", { precision: 10, scale: 2 }).notNull(),
  networkFee: decimal("network_fee", { precision: 10, scale: 2 }).default("0.00"),
  brokerFee: decimal("broker_fee", { precision: 10, scale: 2 }).default("0.00"),
  totalAdminFee: decimal("total_admin_fee", { precision: 10, scale: 2 }).notNull(),
  totalFee: decimal("total_fee", { precision: 10, scale: 2 }).notNull(),
  expectedClaims: decimal("expected_claims", { precision: 10, scale: 2 }).notNull(),
  monthlyPremium: decimal("monthly_premium", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  documentName: text("document_name").notNull(),
  category: documentCategoryEnum("category").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  notes: text("notes"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  uploadedBy: text("uploaded_by").notNull(),
});

export const issues = pgTable("issues", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
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

export const insertCommunicationSchema = createInsertSchema(communications).omit({ id: true, receivedAt: true });
export const insertCommunicationClientSchema = createInsertSchema(communicationClients).omit({ id: true });
export const insertCommunicationAttachmentSchema = createInsertSchema(communicationAttachments).omit({ id: true, uploadedAt: true });
export const insertCommunicationTaskSchema = createInsertSchema(communicationTasks).omit({ id: true, createdAt: true, completedAt: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
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
