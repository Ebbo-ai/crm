import { SYNC_MAILBOX } from "./mailboxSyncPolicy";
import { maintainableDocument } from "./mailboxMaintenancePolicy";
import { db } from "./db";
import { eq, and, ilike, sql, desc, asc, count, inArray, isNull, or, gte, lte, ne } from "drizzle-orm";
import {
  users, clients, plans, rateCards, planTiers, documents, issues, pprUploads, pprMetrics, auditLogs, vendorContacts,
  communications, communicationClients, communicationAttachments, communicationTasks, taskClients, brokerHistory, brokerContacts,
  renewalProgress, prospectProgress, planPerformanceFacts, pprImportBatches, pprHeldRows,
  gmailImportState, documentFieldProposals, fieldChangeHistory,
  gmailThreads, gmailThreadClients, gmailMessages, gmailAttachments, gmailSkippedMessages,
  gmailBackfillDomains, gmailBackfillThreads,
  sendingIdentities, userSendingIdentities, gmailAccounts, mailAllowlistDomains, appSettings,
  documentSends, unfiledAttachments, globalDocuments,
  type DocumentSend, type InsertDocumentSend,
  type UnfiledAttachment, type InsertUnfiledAttachment,
  type SendingIdentity, type InsertSendingIdentity,
  type UserSendingIdentity,
  type GmailImportState, type InsertGmailImportState,
  type GmailAccount, type InsertGmailAccount,
  type MailAllowlistDomain, type InsertMailAllowlistDomain,
  type GmailBackfillDomain, type GmailBackfillThread,
  type DocumentFieldProposal, type InsertDocumentFieldProposal,
  type FieldChangeHistory,
  type GmailThread, type InsertGmailThread,
  type GmailThreadClient, type InsertGmailThreadClient,
  type GmailMessage, type InsertGmailMessage,
  type GmailAttachment, type InsertGmailAttachment,
  type RenewalProgress,
  type User, type InsertUser,
  type Client, type InsertClient,
  type Plan, type InsertPlan,
  type PlanTier,
  type RateCard, type InsertRateCard,
  type Document, type InsertDocument,
  type GlobalDocument, type InsertGlobalDocument,
  type Issue, type InsertIssue,
  type PprUpload, type InsertPprUpload,
  type PprMonthGroup,
  type PprMetrics, type InsertPprMetrics,
  type AuditLog, type InsertAuditLog,
  type Communication, type InsertCommunication,
  type CommunicationAttachment, type InsertCommunicationAttachment,
  type CommunicationTask, type InsertCommunicationTask,
  type BrokerHistory,
  type BrokerContact,
  type PlanPerformanceFacts, type InsertPlanPerformanceFacts,
  type PprImportBatch, type InsertPprImportBatch,
  type PprHeldRow, type InsertPprHeldRow,
  type AppSetting,
  PRIORITY_RANK, TRIAGE_MIN_PRIORITY_KEY, TRIAGE_MIN_PRIORITY_DEFAULT,
} from "@shared/schema";
import { countsAsActive, deriveClientState } from "@shared/client-state";

/**
 * How long a mailbox sync claim can go without a heartbeat before another run
 * may take it over. Generous on purpose: a genuinely slow run (a big Gmail
 * page, a rate-limit backoff) must never lose its claim to the next poll tick,
 * and the only cost of waiting is a delayed retry after a hard crash.
 */
const SYNC_CLAIM_STALE_MINUTES = 15;

/** Raised when a message insert loses to the cross-mailbox Message-ID unique index — a duplicate, not a failure. */
export class DuplicateMessageHeaderError extends Error {
  constructor(gmailMessageId: string) {
    super(`Gmail message ${gmailMessageId} is a cross-mailbox duplicate of a message already stored`);
    this.name = "DuplicateMessageHeaderError";
  }
}
import { compareTodos, UNDO_WINDOW_MS } from "@shared/communication-state";

/**
 * A task as the UI needs it: the clients it touches, and the message it came
 * from when there was one.
 *
 * `clients` may hold none, one or several. None means the work belongs to the
 * business rather than to an account. The flat clientName/clientCode mirror the
 * first entry for callers that only ever handled a single client.
 */
export type DecoratedTask = CommunicationTask & {
  clients: { id: number; clientName: string; clientCode: string }[];
  clientName: string | null;
  clientCode: string | null;
  communicationSubject: string | null;
  communicationSender: string | null;
};

/** One person at the brokerage, as supplied by the form or the workbook import. */
export interface BrokerContactInput {
  contactName: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
  effectiveDate?: Date | null;
  terminationDate?: Date | null;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  getClients(search?: string, status?: string): Promise<(Client & { activeIssueCount: number })[]>;
  getClient(id: number): Promise<Client | undefined>;
  getClientsByIds(ids: number[]): Promise<Client[]>;
  getClientByCode(code: string): Promise<Client | undefined>;
  createClient(client: InsertClient, contacts?: BrokerContactInput[]): Promise<Client>;
  updateClient(id: number, data: Partial<InsertClient>, contacts?: BrokerContactInput[]): Promise<Client | undefined>;

  getPlans(clientId: number): Promise<Plan[]>;
  getPlan(id: number): Promise<Plan | undefined>;
  createPlan(plan: InsertPlan): Promise<Plan>;
  updatePlan(id: number, data: Partial<InsertPlan>): Promise<Plan | undefined>;
  getActivePlanCount(clientId: number): Promise<number>;

  getPlanTiers(planId: number): Promise<PlanTier[]>;
  getRateCards(planId: number): Promise<any[]>;
  upsertTiersAndRates(planId: number, tierDefs: {label: string; displayOrder: number}[], rateInputs: any[], planUpdates: {brokerMode: string; brokerValue: string; feeBasis: string}): Promise<{tiers: any[]; rates: any[]}>;
  upsertRateCards(planId: number, cards: InsertRateCard[]): Promise<RateCard[]>;

  getDocuments(clientId: number, category?: string): Promise<Document[]>;
  getPlanDocuments(planId: number): Promise<Document[]>;
  getDocument(id: number): Promise<Document | undefined>;
  createDocument(doc: InsertDocument): Promise<Document>;
  deleteDocument(id: number): Promise<void>;

  getIssues(clientId: number): Promise<Issue[]>;
  getAllIssues(status?: string): Promise<(Issue & { clientName: string; clientCode: string })[]>;
  getIssue(id: number): Promise<Issue | undefined>;
  createIssue(issue: InsertIssue): Promise<Issue>;
  updateIssue(id: number, data: Partial<InsertIssue & { resolvedAt: Date; followUpAt: Date | null }>): Promise<Issue | undefined>;
  getActiveIssueCount(clientId: number): Promise<number>;
  getTotalActiveIssueCount(): Promise<number>;
  getOverdueFollowUpCount(): Promise<number>;

  getPprUploads(clientId: number): Promise<PprUpload[]>;
  getPprGroupedUploads(clientId: number): Promise<PprMonthGroup[]>;
  getPprUpload(id: number): Promise<PprUpload | undefined>;
  findPprUploadByType(clientId: number, reportMonth: number, reportYear: number, fileType: string): Promise<PprUpload | undefined>;
  createPprUpload(ppr: InsertPprUpload): Promise<PprUpload>;
  updatePprUpload(id: number, data: Partial<InsertPprUpload>): Promise<PprUpload | undefined>;
  deletePprUpload(id: number): Promise<void>;

  getPprMetrics(clientId: number): Promise<PprMetrics[]>;
  upsertPprMetrics(metrics: InsertPprMetrics): Promise<PprMetrics>;
  getPprMetricsSummary(): Promise<any[]>;

  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getRecentAuditLogs(limit: number): Promise<AuditLog[]>;

  getDashboardStats(): Promise<{
    totalClients: number;
    activeClients: number;
    terminatedClients: number;
    activeIssues: number;
    expiringPlans: number;
  }>;
  getClientsWithActiveIssues(): Promise<any[]>;
  getDashboardIssues(): Promise<any[]>;
  getExpiringPlans(): Promise<any[]>;
  getDashboardRenewals(): Promise<any[]>;
  globalSearch(q: string): Promise<any[]>;

  createCommunication(comm: InsertCommunication): Promise<Communication>;
  updateCommunication(id: number, data: Partial<Communication>): Promise<Communication | undefined>;
  getCommunication(id: number): Promise<Communication | undefined>;
  getClientCommunications(clientId: number): Promise<(Communication & { attachments: CommunicationAttachment[]; tasks: CommunicationTask[] })[]>;
  getAllCommunications(filters?: { senderDomain?: string; senderName?: string; clientId?: number; unmatched?: boolean; isInternal?: boolean }): Promise<(Communication & { clientNames: string[]; attachments: CommunicationAttachment[]; tasks: CommunicationTask[] })[]>;
  /** Everything still unresolved, newest first. Nothing ages out of this list. */
  getCommunicationFeed(): Promise<(Communication & { clientNames: string[]; attachments: CommunicationAttachment[]; tasks: CommunicationTask[] })[]>;
  /** Returns null when the message was already resolved by someone else. */
  resolveCommunication(id: number, opts: { resolutionType: string; note: string; user: string }): Promise<Date | null>;
  /** Undo is limited to an unexpired "read, no task needed"; notes are permanent. */
  unresolveCommunication(id: number): Promise<"ok" | "not_resolved" | "has_note" | "expired">;
  assignCommunicationToClients(commId: number, assignments: { clientId: number; confidence: string }[]): Promise<void>;
  updateClientAssignment(commId: number, clientId: number): Promise<void>;
  getDistinctSenders(): Promise<{ senderEmail: string; senderName: string | null; senderDomain: string | null }[]>;

  createCommunicationAttachment(att: InsertCommunicationAttachment): Promise<CommunicationAttachment>;
  getCommunicationAttachment(id: number): Promise<CommunicationAttachment | undefined>;

  createCommunicationTask(task: InsertCommunicationTask): Promise<CommunicationTask>;
  /** One task covering several clients: one job, one note, one resolution. */
  createTaskWithClients(task: InsertCommunicationTask, matches: { clientId: number; confidence: string }[]): Promise<CommunicationTask>;
  getOpenTasks(): Promise<DecoratedTask[]>;
  /**
   * Triage. There is deliberately no delete and no bare "complete" here: a task
   * either resolves with a note or moves onto the to-do list under a priority.
   */
  getTodos(): Promise<DecoratedTask[]>;
  /** A to-do Kim typed herself, with no email behind it. */
  createManualTodo(input: { description: string; priority: string; clients: { clientId: number; confidence: string }[] }): Promise<CommunicationTask>;
  /** Re-points an unresolved to-do at a different set of clients, or at none. */
  setTodoClients(taskId: number, clientIds: number[]): Promise<CommunicationTask | undefined>;
  /** To-dos with no client attached: they belong to the business, not an account. */
  getGeneralTodos(opts: { resolved: boolean }): Promise<DecoratedTask[]>;
  getClientManualTodos(clientId: number): Promise<DecoratedTask[]>;
  moveTaskToTodo(id: number, priority: string, openOwner?: string): Promise<CommunicationTask | undefined>;
  resolveCommunicationTask(id: number, note: string, user: string, openOwner?: string): Promise<{ task: CommunicationTask | undefined; communicationResolved: boolean }>;
  reorderTodos(priority: string, orderedIds: number[]): Promise<number>;
  getClientTasks(clientId: number): Promise<DecoratedTask[]>;
  getUnreadCommunicationsCount(): Promise<number>;

  getBrokerFirms(): Promise<{ name: string; clientCount: number }[]>;
  getBrokerHistory(clientId: number): Promise<BrokerHistory[]>;
  addBrokerChange(clientId: number, newBroker: { brokerFirmName: string | null; brokerContactName: string | null; brokerPhone: string | null; brokerEmail: string | null; effectiveDate: Date }): Promise<void>;

  getBrokerContacts(clientId: number): Promise<BrokerContact[]>;
  replaceBrokerContacts(clientId: number, contacts: BrokerContactInput[]): Promise<BrokerContact[]>;
  getBrokerEmailsByClient(): Promise<Map<number, string[]>>;
  getBrokerNamesByClient(): Promise<Map<number, string[]>>;

  getClientsByBrokerFirm(firm: string): Promise<(Client & { plans: Plan[] })[]>;

  getRenewalProgress(planId: number): Promise<RenewalProgress | null>;
  upsertRenewalProgress(planId: number, clientId: number, data: Record<string, any>): Promise<RenewalProgress>;
  getProspectProgress(clientId: number): Promise<any | null>;
  upsertProspectProgress(clientId: number, data: Record<string, any>): Promise<any>;
  getStalledPipelines(): Promise<any[]>;

  // ── Plan performance facts ──────────────────────────────────────────────────
  insertPlanPerformanceFact(data: InsertPlanPerformanceFacts): Promise<PlanPerformanceFacts>;
  supersedePlanPerformanceFact(id: number): Promise<void>;
  getCurrentFactsForClient(clientId: number): Promise<PlanPerformanceFacts[]>;
  getCurrentFactsForPlan(planId: number): Promise<PlanPerformanceFacts[]>;
  getAllCurrentFacts(): Promise<PlanPerformanceFacts[]>;

  getAllActivePlans(): Promise<Plan[]>;

  // ── PPR import batches ──────────────────────────────────────────────────────
  createPprImportBatch(data: InsertPprImportBatch): Promise<PprImportBatch>;
  updatePprImportBatch(id: number, data: Partial<InsertPprImportBatch>): Promise<PprImportBatch | undefined>;
  getPprImportBatches(): Promise<PprImportBatch[]>;
  getPprImportBatch(id: number): Promise<PprImportBatch | undefined>;

  // ── PPR held rows ───────────────────────────────────────────────────────────
  createPprHeldRow(data: InsertPprHeldRow): Promise<PprHeldRow>;
  getPprHeldRows(batchId?: number): Promise<PprHeldRow[]>;
  updatePprHeldRow(id: number, data: Partial<PprHeldRow>): Promise<PprHeldRow | undefined>;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Thrown when a drag-reorder payload no longer matches the section on the
 * server, which means the browser was working from a list that has since
 * changed. The caller should refetch rather than write a half-correct order.
 */
export class StaleOrderError extends Error {
  constructor() {
    super("This list changed while you were dragging. It has been refreshed.");
    this.name = "StaleOrderError";
  }
}

/**
 * Write a client's broker contacts as a set and re-mirror the flat columns.
 *
 * Takes a transaction rather than opening one, because the mirror on `clients` and the
 * rows in `broker_contacts` must never be separately committable — a half-applied save
 * leaves the client showing a broker contact who is no longer on the account.
 *
 * Replace-set semantics: rows are matched to the people already on file by name,
 * and anyone the caller no longer lists is removed. That is what makes "this person
 * has left the account" expressible; a row-by-row upsert can only ever add.
 */
async function applyBrokerContacts(
  tx: Tx,
  clientId: number,
  contacts: BrokerContactInput[],
): Promise<BrokerContact[]> {
  const clean = contacts
    .map(c => ({ ...c, contactName: (c.contactName ?? "").trim() }))
    .filter(c => c.contactName.length > 0);

  const existing = await tx.select().from(brokerContacts).where(eq(brokerContacts.clientId, clientId));
  const byName = new Map(existing.map(r => [r.contactName.trim().toLowerCase(), r]));

  // Cleared first: only one serving primary is allowed per client, so swapping the
  // lead between two people would otherwise collide part-way through the update.
  await tx.update(brokerContacts).set({ isPrimary: false })
    .where(eq(brokerContacts.clientId, clientId));

  const keptIds: number[] = [];
  for (const c of clean) {
    const prior = byName.get(c.contactName.toLowerCase());
    const values = {
      contactName: c.contactName,
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
      role: c.role?.trim() || null,
      notes: c.notes?.trim() || null,
      effectiveDate: c.effectiveDate ?? prior?.effectiveDate ?? null,
      // Only cleared when the caller actually said null. An omitted termination date
      // is a caller that does not edit dates, not an assertion that the person is
      // back on the account — and re-serving them would also make them eligible to
      // become the primary again, which the flat mirror then publishes.
      terminationDate: c.terminationDate !== undefined ? c.terminationDate : (prior?.terminationDate ?? null),
      updatedAt: new Date(),
    };
    if (prior) {
      await tx.update(brokerContacts).set(values).where(eq(brokerContacts.id, prior.id));
      keptIds.push(prior.id);
    } else {
      const [created] = await tx.insert(brokerContacts)
        .values({ clientId, ...values, isPrimary: false })
        .returning({ id: brokerContacts.id });
      keptIds.push(created.id);
    }
  }

  const removed = existing.filter(r => !keptIds.includes(r.id));
  if (removed.length) {
    await tx.delete(brokerContacts).where(inArray(brokerContacts.id, removed.map(r => r.id)));
  }

  // Primary is set last, once every other row is known to be non-primary, and is only
  // ever chosen from the people still serving. A terminated contact must not become the
  // lead: the flat columns mirror the primary, so that would publish a former contact
  // as the client's broker while somebody current is sitting right there.
  const servingIdx = clean.findIndex(c => c.isPrimary && !c.terminationDate);
  const primaryIdx = servingIdx >= 0 ? servingIdx : clean.findIndex(c => !c.terminationDate);
  const primaryId = primaryIdx >= 0 ? keptIds[primaryIdx] : undefined;
  if (primaryId !== undefined) {
    await tx.update(brokerContacts).set({ isPrimary: true }).where(eq(brokerContacts.id, primaryId));
  }

  const rows = await tx.select().from(brokerContacts).where(eq(brokerContacts.clientId, clientId));
  const primary = rows.find(r => r.isPrimary) ?? null;

  // Mirror onto the flat columns. Everything that read a single broker contact before
  // this table existed still reads one, and it is the lead person. No serving contact
  // means the mirror is cleared rather than left pointing at somebody who has gone.
  await tx.update(clients).set({
    brokerContactName: primary?.contactName ?? null,
    brokerEmail: primary?.email ?? null,
    brokerPhone: primary?.phone ?? null,
    updatedAt: new Date(),
  }).where(eq(clients.id, clientId));

  return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.contactName.localeCompare(b.contactName));
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return updated;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.fullName));
  }

  async getClients(search?: string, status?: string): Promise<(Client & { activeIssueCount: number })[]> {
    const conditions = [];
    if (search) {
      conditions.push(ilike(clients.clientName, `%${search}%`));
    }
    const matched = conditions.length > 0
      ? await db.select().from(clients).where(and(...conditions)).orderBy(asc(clients.clientName))
      : await db.select().from(clients).orderBy(asc(clients.clientName));

    // Status is derived from the termination date, not filtered in SQL. The
    // run-out boundary is month arithmetic against today, which SQL would have to
    // re-spell and could then quietly disagree with the rest of the app. A
    // terminating or run-out client is still being serviced, so it belongs in the
    // Active tab, not hidden away under Terminated.
    const clientList = status
      ? matched.filter((c) => {
          const state = deriveClientState(c);
          if (status === "active") return state !== "PROSPECT" && countsAsActive(state);
          if (status === "terminated") return state === "CLOSED";
          if (status === "prospect") return state === "PROSPECT";
          return true;
        })
      : matched;

    const result = await Promise.all(
      clientList.map(async (client) => {
        const activeCount = await this.getActiveIssueCount(client.id);
        return { ...client, activeIssueCount: activeCount };
      })
    );
    return result;
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  /** Existence check for a set of ids, used before attaching work to clients. */
  async getClientsByIds(ids: number[]): Promise<Client[]> {
    const unique = Array.from(new Set(ids));
    if (!unique.length) return [];
    return db.select().from(clients).where(inArray(clients.id, unique));
  }

  async getClientByCode(code: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.clientCode, code));
    return client;
  }

  /**
   * `brokerContacts` undefined means the caller is not speaking about contacts and they
   * are left alone; an array (including an empty one) replaces the set. Both writes share
   * one transaction so a client can never be saved with its contact set half-applied.
   */
  async createClient(client: InsertClient, contacts?: BrokerContactInput[]): Promise<Client> {
    const { requireBrokerChoice } = await import("../shared/broker-status");
    requireBrokerChoice(client.brokerStatus);
    delete client.hasBroker;
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(clients).values(client).returning();
      if (contacts !== undefined) {
        await applyBrokerContacts(tx, created.id, contacts);
        const [refreshed] = await tx.select().from(clients).where(eq(clients.id, created.id));
        return refreshed;
      }
      return created;
    });
  }

  /** See `createClient` for what an undefined vs. empty `contacts` means. */
  async updateClient(id: number, data: Partial<InsertClient>, contacts?: BrokerContactInput[]): Promise<Client | undefined> {
    delete data.hasBroker;
    if (data.brokerStatus !== undefined && !["DIRECT", "BROKER", "NOT_SET"].includes(data.brokerStatus ?? "")) {
      throw Object.assign(new Error("Invalid broker status"), { status: 400 });
    }
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(clients).set({ ...data, updatedAt: new Date() }).where(eq(clients.id, id)).returning();
      if (!updated) return undefined;
      if (contacts !== undefined) {
        // Runs after the client write so the mirror it produces is what survives, rather
        // than any flat broker field the same request happened to carry.
        await applyBrokerContacts(tx, id, contacts);
        const [refreshed] = await tx.select().from(clients).where(eq(clients.id, id));
        return refreshed;
      }
      return updated;
    });
  }

  async getPlans(clientId: number): Promise<Plan[]> {
    return db.select().from(plans).where(eq(plans.clientId, clientId)).orderBy(desc(plans.effectiveDate));
  }

  async getPlan(id: number): Promise<Plan | undefined> {
    const [plan] = await db.select().from(plans).where(eq(plans.id, id));
    return plan;
  }

  async createPlan(plan: InsertPlan): Promise<Plan> {
    await this.validateBrokerPlan(plan.clientId, plan);
    const [created] = await db.insert(plans).values(plan).returning();
    return created;
  }

  async updatePlan(id: number, data: Partial<InsertPlan>): Promise<Plan | undefined> {
    const current = await this.getPlan(id);
    if (current) await this.validateBrokerPlan(current.clientId, { ...current, ...data });
    const [updated] = await db.update(plans).set({ ...data, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
    return updated;
  }

  private async validateBrokerPlan(clientId: number, plan: Partial<InsertPlan>): Promise<void> {
    const client = await this.getClient(clientId);
    const needsBroker = plan.renewalRecipient === "BROKER" || plan.renewalRecipient === "BOTH" || (plan.brokerMode && plan.brokerMode !== "NONE");
    if (needsBroker && client?.brokerStatus !== "BROKER") {
      throw Object.assign(new Error(client?.brokerStatus === "DIRECT" ? "This client is Direct. Broker recipients or compensation require Broker status." : "Broker status is not set. Choose Direct or Broker before configuring renewal recipients or broker fees."), { status: 400 });
    }
  }

  async getActivePlanCount(clientId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(plans).where(and(eq(plans.clientId, clientId), eq(plans.isArchived, false)));
    return result?.count ?? 0;
  }

  async getPlanTiers(planId: number): Promise<PlanTier[]> {
    return db.select().from(planTiers)
      .where(eq(planTiers.planId, planId))
      .orderBy(asc(planTiers.displayOrder));
  }

  async getRateCards(planId: number): Promise<any[]> {
    const [cards, tiers] = await Promise.all([
      db.select().from(rateCards).where(eq(rateCards.planId, planId)),
      db.select().from(planTiers).where(eq(planTiers.planId, planId)).orderBy(asc(planTiers.displayOrder)),
    ]);
    const tierMap = new Map(tiers.map(t => [t.id, t]));
    return cards
      .map(c => ({
        ...c,
        tierLabel: c.planTierId != null ? (tierMap.get(c.planTierId)?.label ?? null) : null,
        displayOrder: c.planTierId != null ? (tierMap.get(c.planTierId)?.displayOrder ?? 99) : 99,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  /**
   * Atomic replacement of a plan's tiers + rate cards + broker settings.
   * Calculation (brokerFee, totalAdminFee, monthlyPremium) is performed server-side
   * so the DB is always the source of truth for derived values.
   */
  async upsertTiersAndRates(
    planId: number,
    tierDefs: { label: string; displayOrder: number }[],
    rateInputs: Array<{ tierIndex: number; baseAdminFee: string; cobraFee: string; simpleFee: string; networkFee: string; expectedClaims: string }>,
    planUpdates: { brokerMode: string; brokerValue: string; feeBasis: string; flatMonthlyFee?: string | null; flat90DBFee?: string | null; flatSimpleFee?: string | null; flatNetworkFee?: string | null },
  ): Promise<{ tiers: PlanTier[]; rates: any[] }> {
    // 1. Delete rate cards first (they reference plan_tiers via plan_tier_id)
    await db.delete(rateCards).where(eq(rateCards.planId, planId));
    // 2. Delete old plan tiers
    await db.delete(planTiers).where(eq(planTiers.planId, planId));
    // 3. Insert new tiers
    const newTiers = tierDefs.length > 0
      ? await db.insert(planTiers).values(tierDefs.map(t => ({ ...t, planId }))).returning()
      : [];

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const isFixedMonthly = planUpdates.feeBasis === "FIXED_MONTHLY";

    // 4. Calculate and insert rate cards
    // FIXED_MONTHLY: admin fee lives on the plan record (flatMonthlyFee), not per tier.
    //   Tier rows carry only expectedClaims for enrollment reporting.
    //   totalAdminFee and brokerFee are zeroed on each row — do not distribute them per tier.
    // PEPM: normal per-tier calculation as before.
    const bv = parseFloat(planUpdates.brokerValue || "0") || 0;
    const mode = planUpdates.brokerMode;

    const cardValues = rateInputs.map(r => {
      const tier = newTiers[r.tierIndex];
      if (!tier) return null;
      const claims = parseFloat(r.expectedClaims || "0") || 0;

      if (isFixedMonthly) {
        // Admin is a fixed group charge — store zeros on the tier rows.
        // monthlyPremium per tier = claims only (for reference; actual billing uses flatMonthlyFee).
        return {
          planId,
          planTierId: tier.id,
          baseAdminFee: "0.00",
          cobraFee: "0.00",
          simpleFee: "0.00",
          networkFee: "0.00",
          brokerFee: "0.00",
          totalAdminFee: "0.00",
          expectedClaims: r.expectedClaims,
          monthlyPremium: claims.toFixed(2),
        };
      }

      // PEPM path
      const base   = parseFloat(r.baseAdminFee || "0") || 0;
      const cobra  = parseFloat(r.cobraFee || "0") || 0;
      const simple = parseFloat(r.simpleFee || "0") || 0;
      const network = parseFloat(r.networkFee || "0") || 0;

      const adminSubtotal     = r2(base + cobra + simple + network);
      const preBrokerSubtotal = r2(adminSubtotal + claims);

      let brokerFee = 0;
      if (mode === "FLAT_PEPM") {
        brokerFee = bv;
      } else if (mode === "FIXED_MONTHLY") {
        // FIXED_MONTHLY broker mode on a PEPM fee-basis plan: broker is a flat group charge.
        // Store it on the plan record only; zero on tier rows (same principle as flatMonthlyFee).
        brokerFee = 0;
      } else if (mode === "PERCENT_OF_PREMIUM" && bv > 0 && bv < 1) {
        const premium = r2(preBrokerSubtotal / (1 - bv));
        brokerFee = r2(premium - preBrokerSubtotal);
      }

      const totalAdminFee  = r2(adminSubtotal + brokerFee);
      const monthlyPremium = r2(totalAdminFee + claims);

      return {
        planId,
        planTierId: tier.id,
        baseAdminFee:  r.baseAdminFee,
        cobraFee:      r.cobraFee,
        simpleFee:     r.simpleFee,
        networkFee:    r.networkFee || "0.00",
        brokerFee:     brokerFee.toFixed(2),
        totalAdminFee: totalAdminFee.toFixed(2),
        expectedClaims: r.expectedClaims,
        monthlyPremium: monthlyPremium.toFixed(2),
      };
    }).filter(Boolean) as any[];

    const newCards = cardValues.length > 0
      ? await db.insert(rateCards).values(cardValues).returning()
      : [];

    // 5. Update plan settings
    const planSet: Record<string, any> = {
      brokerMode:  mode,
      brokerValue: planUpdates.brokerValue,
      feeBasis:    planUpdates.feeBasis,
      updatedAt:   new Date(),
    };
    if (isFixedMonthly) {
      // Store the three optional components.
      const db90    = parseFloat(planUpdates.flat90DBFee    ?? "0") || 0;
      const simple  = parseFloat(planUpdates.flatSimpleFee  ?? "0") || 0;
      const network = parseFloat(planUpdates.flatNetworkFee ?? "0") || 0;
      const hasComponents = db90 > 0 || simple > 0 || network > 0;

      // If the breakdown is provided, auto-compute the admin total from components so it stays
      // consistent. If components are all empty (partial data entry), fall back to the manual total.
      planSet.flat90DBFee    = hasComponents ? db90.toFixed(2)    : (planUpdates.flat90DBFee    ?? null);
      planSet.flatSimpleFee  = hasComponents ? simple.toFixed(2)  : (planUpdates.flatSimpleFee  ?? null);
      planSet.flatNetworkFee = hasComponents ? network.toFixed(2) : (planUpdates.flatNetworkFee ?? null);
      planSet.flatMonthlyFee = hasComponents
        ? r2(db90 + simple + network).toFixed(2)
        : (planUpdates.flatMonthlyFee ?? null);
    } else {
      // Clear all fixed-monthly fields when switching back to PEPM
      planSet.flatMonthlyFee  = null;
      planSet.flat90DBFee     = null;
      planSet.flatSimpleFee   = null;
      planSet.flatNetworkFee  = null;
    }
    await db.update(plans).set(planSet).where(eq(plans.id, planId));

    return { tiers: newTiers, rates: newCards };
  }

  /** Legacy method kept for seed.ts compat. New code uses upsertTiersAndRates. */
  async upsertRateCards(planId: number, cards: InsertRateCard[]): Promise<RateCard[]> {
    await db.delete(rateCards).where(eq(rateCards.planId, planId));
    if (cards.length === 0) return [];
    const created = await db.insert(rateCards).values(cards).returning();
    return created;
  }

  async getDocuments(clientId: number, category?: string): Promise<Document[]> {
    const conditions = [eq(documents.clientId, clientId)];
    if (category && category !== "ALL") {
      conditions.push(eq(documents.category, category as any));
    }
    return db.select().from(documents).where(and(...conditions)).orderBy(desc(documents.uploadedAt));
  }

  async getPlanDocuments(planId: number): Promise<Document[]> {
    return db.select().from(documents)
      .where(eq(documents.planId, planId))
      .orderBy(desc(documents.uploadedAt));
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc;
  }

  /** The shared 90 Degree Benefits contact list, same rows on every client. */
  async getVendorContacts() {
    return db.select().from(vendorContacts).orderBy(asc(vendorContacts.sortOrder));
  }

  /** Only email/phone are ever edited here — name and role are the fixed roster. */
  async updateVendorContact(id: number, fields: { email?: string | null; phone?: string | null }) {
    const [updated] = await db.update(vendorContacts).set(fields).where(eq(vendorContacts.id, id)).returning();
    return updated;
  }

  // ── CRM-owned Gmail OAuth accounts (kim.anderson@, clientservice@, steve.schultz@) ──

  async getGmailAccounts(): Promise<GmailAccount[]> {
    return db.select().from(gmailAccounts).orderBy(asc(gmailAccounts.mailbox));
  }

  async getGmailAccountByMailbox(mailbox: string): Promise<GmailAccount | undefined> {
    const [row] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.mailbox, mailbox.toLowerCase()));
    return row;
  }

  /** Called once per mailbox after the OAuth consent flow completes, and again on every re-authorization. */
  async upsertGmailAccount(data: InsertGmailAccount): Promise<GmailAccount> {
    const mailbox = data.mailbox.toLowerCase();
    const existing = await this.getGmailAccountByMailbox(mailbox);
    if (existing) {
      const [row] = await db.update(gmailAccounts).set({ ...data, mailbox, status: "CONNECTED" }).where(eq(gmailAccounts.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(gmailAccounts).values({ ...data, mailbox }).returning();
    return row;
  }

  /** Just the access token / expiry / status fields, written on every token refresh — never touches refreshToken unless Google issues a new one. */
  async updateGmailAccountToken(mailbox: string, fields: { accessToken?: string | null; accessTokenExpiresAt?: Date | null; status?: string; refreshToken?: string }): Promise<void> {
    await db.update(gmailAccounts).set(fields).where(eq(gmailAccounts.mailbox, mailbox.toLowerCase()));
  }

  async markGmailAccountNeedsReauth(mailbox: string): Promise<void> {
    await db.update(gmailAccounts).set({ status: "NEEDS_REAUTH" }).where(eq(gmailAccounts.mailbox, mailbox.toLowerCase()));
  }

  async recordGmailAccountSync(mailbox: string, summary: string): Promise<void> {
    await db.update(gmailAccounts).set({ lastSyncAt: new Date(), lastSyncSummary: summary }).where(eq(gmailAccounts.mailbox, mailbox.toLowerCase()));
  }

  // ── Steve's mailbox allow-list domains (client/broker-derived, admin-reviewed) ──

  async getMailAllowlistDomains(): Promise<MailAllowlistDomain[]> {
    return db.select().from(mailAllowlistDomains).orderBy(asc(mailAllowlistDomains.domain));
  }

  async getApprovedMailAllowlistDomains(): Promise<Set<string>> {
    const rows = await db.select({ domain: mailAllowlistDomains.domain }).from(mailAllowlistDomains).where(eq(mailAllowlistDomains.approved, true));
    return new Set(rows.map(r => r.domain));
  }

  /** Adds any domain not already on file, as pending (approved = null). Never overwrites a reviewed decision. */
  async addCandidateMailAllowlistDomains(candidates: { domain: string; source: string; sourceLabel: string | null }[]): Promise<number> {
    if (candidates.length === 0) return 0;
    let added = 0;
    for (const c of candidates) {
      const [existing] = await db.select({ id: mailAllowlistDomains.id }).from(mailAllowlistDomains).where(eq(mailAllowlistDomains.domain, c.domain));
      if (existing) continue;
      await db.insert(mailAllowlistDomains).values({ domain: c.domain, source: c.source, sourceLabel: c.sourceLabel, approved: null });
      added++;
    }
    return added;
  }

  async reviewMailAllowlistDomain(id: number, approved: boolean, reviewedBy: string): Promise<MailAllowlistDomain | undefined> {
    const [row] = await db.update(mailAllowlistDomains).set({ approved, reviewedAt: new Date(), reviewedBy }).where(eq(mailAllowlistDomains.id, id)).returning();
    return row;
  }

  // ─── Label backfill: domain census + per-thread resolution (see gmailLabelBackfill.ts) ───

  /** +1 to a domain's thread count, creating the PENDING row on first sight. Idempotent per thread — callers only call this once per (mailbox, label, thread). */
  async incrementBackfillDomainCount(mailbox: string, label: string, domain: string): Promise<void> {
    const [existing] = await db.select().from(gmailBackfillDomains)
      .where(and(eq(gmailBackfillDomains.mailbox, mailbox), eq(gmailBackfillDomains.label, label), eq(gmailBackfillDomains.domain, domain)));
    if (existing) {
      await db.update(gmailBackfillDomains).set({ threadCount: existing.threadCount + 1 }).where(eq(gmailBackfillDomains.id, existing.id));
    } else {
      await db.insert(gmailBackfillDomains).values({ mailbox, label, domain, threadCount: 1, verdict: "PENDING" });
    }
  }

  async getBackfillDomains(mailbox: string, label: string): Promise<GmailBackfillDomain[]> {
    return db.select().from(gmailBackfillDomains)
      .where(and(eq(gmailBackfillDomains.mailbox, mailbox), eq(gmailBackfillDomains.label, label)))
      .orderBy(desc(gmailBackfillDomains.threadCount));
  }

  async getPendingBackfillDomains(mailbox: string, label: string): Promise<GmailBackfillDomain[]> {
    return db.select().from(gmailBackfillDomains)
      .where(and(eq(gmailBackfillDomains.mailbox, mailbox), eq(gmailBackfillDomains.label, label), eq(gmailBackfillDomains.verdict, "PENDING")));
  }

  async setBackfillDomainVerdict(
    id: number,
    verdict: "BUSINESS" | "CONSUMER",
    model: string,
    sample?: { sampleSubject?: string | null; earliestSampleAt?: Date | null; latestSampleAt?: Date | null },
  ): Promise<void> {
    await db.update(gmailBackfillDomains).set({
      verdict,
      classifiedAt: new Date(),
      model,
      sampleSubject: sample?.sampleSubject ?? null,
      earliestSampleAt: sample?.earliestSampleAt ?? null,
      latestSampleAt: sample?.latestSampleAt ?? null,
    }).where(eq(gmailBackfillDomains.id, id));
  }

  /** Domains classified CONSUMER with more than `minThreadCount` threads — the human review list before import, per Steve's decision that a wrongly-classified consumer domain silently discards history. */
  async getConsumerDomainsForReview(mailbox: string, label: string, minThreadCount: number): Promise<GmailBackfillDomain[]> {
    return db.select().from(gmailBackfillDomains)
      .where(and(
        eq(gmailBackfillDomains.mailbox, mailbox),
        eq(gmailBackfillDomains.label, label),
        eq(gmailBackfillDomains.verdict, "CONSUMER"),
        sql`${gmailBackfillDomains.threadCount} > ${minThreadCount}`,
      ))
      .orderBy(desc(gmailBackfillDomains.threadCount));
  }

  /** Null when this thread hasn't been censused yet — lets the census pass skip threads it already recorded on a prior (interrupted) run. */
  async getBackfillThread(mailbox: string, label: string, gmailThreadId: string): Promise<GmailBackfillThread | undefined> {
    const [row] = await db.select().from(gmailBackfillThreads)
      .where(and(eq(gmailBackfillThreads.mailbox, mailbox), eq(gmailBackfillThreads.label, label), eq(gmailBackfillThreads.gmailThreadId, gmailThreadId)));
    return row;
  }

  async createBackfillThread(row: {
    mailbox: string; label: string; gmailThreadId: string; domain: string | null; category: string;
    resolvedContactEmail?: string | null; counterpartyEmail?: string | null; sampleSubject?: string | null;
  }): Promise<GmailBackfillThread> {
    // OWN_ONLY / NO_EXTERNAL_DOMAIN are terminal on arrival — internal or counterpartyless mail
    // is flagged permanently excluded here, not deferred to the import phase, so no later pass
    // (this run or any future one) can ever pick them back up.
    const permanentlyExcluded = row.category === "OWN_ONLY" || row.category === "NO_EXTERNAL_DOMAIN";
    const [created] = await db.insert(gmailBackfillThreads).values({ ...row, permanentlyExcluded }).returning();
    return created;
  }

  async updateBackfillThreadCategory(id: number, category: string): Promise<void> {
    await db.update(gmailBackfillThreads).set({ category }).where(eq(gmailBackfillThreads.id, id));
  }

  /** Threads still awaiting the free-provider per-thread classification pass (classifyFreeProviderThreadsBatch). */
  async getFreeProviderUnresolvedThreads(mailbox: string, label: string, limit: number): Promise<GmailBackfillThread[]> {
    return db.select().from(gmailBackfillThreads)
      .where(and(eq(gmailBackfillThreads.mailbox, mailbox), eq(gmailBackfillThreads.label, label), eq(gmailBackfillThreads.category, "FREE_PROVIDER_UNRESOLVED")))
      .limit(limit);
  }

  async getBackfillThreadsByCategories(mailbox: string, label: string, categories: string[], onlyUnimported: boolean): Promise<GmailBackfillThread[]> {
    const conditions = [eq(gmailBackfillThreads.mailbox, mailbox), eq(gmailBackfillThreads.label, label), inArray(gmailBackfillThreads.category, categories)];
    if (onlyUnimported) conditions.push(isNull(gmailBackfillThreads.importedAt));
    return db.select().from(gmailBackfillThreads).where(and(...conditions));
  }

  async countBackfillThreadsByCategory(mailbox: string, label: string): Promise<{ category: string; count: number }[]> {
    const rows = await db.select({ category: gmailBackfillThreads.category, count: sql<string>`COUNT(*)` })
      .from(gmailBackfillThreads)
      .where(and(eq(gmailBackfillThreads.mailbox, mailbox), eq(gmailBackfillThreads.label, label)))
      .groupBy(gmailBackfillThreads.category);
    return rows.map(r => ({ category: r.category, count: Number(r.count) }));
  }


  /** Attachments on this communication that have not yet been filed onto a client's documents tab. */
  async getUnfiledAttachments(communicationId: number) {
    return db.select().from(communicationAttachments)
      .where(and(eq(communicationAttachments.communicationId, communicationId), isNull(communicationAttachments.filedAsDocumentId)));
  }

  async markAttachmentFiled(attachmentId: number, documentId: number) {
    await db.update(communicationAttachments).set({ filedAsDocumentId: documentId }).where(eq(communicationAttachments.id, attachmentId));
  }

  /**
   * Categories that carry a "current version" concept purely by category —
   * filing a new one supersedes the client's prior document of the same
   * category, regardless of filename. Categories outside this set
   * (CLIENT_AGREEMENT, PROPOSAL, BROKER_*, OTHER, ...) have no such notion —
   * a client can hold several at once — so they are left untouched.
   *
   * RENEWAL_PROPOSAL, EMPLOYER_ACCEPTANCE, HANDOUT and SUPPLEMENT are
   * deliberately NOT in this set: they use the finer-grained
   * client+category+normalizedFileName grouping in VERSIONED_DOCUMENT_CATEGORIES
   * below instead, so filing a 2027 Renewal Proposal does not mark a 2026
   * Renewal Proposal (a different document, not a reissue) as superseded.
   */
  private static readonly SUPERSEDING_DOCUMENT_CATEGORIES = new Set([
    "SPD", "PPR_REPORT", "NEW_PROPOSAL", "RATE_NOTICE", "PLAN_TRANSMITTAL",
  ]);

  /**
   * Categories versioned by client + category + normalizedFileName (see
   * documents.normalizedFileName). A resend of the same document under a
   * slightly different filename (" (1)", "_v2", "_REVISED") is a new version
   * of the same document, ordered by sentAt (falling back to uploadedAt);
   * a document with a different normalized filename in the same category
   * (e.g. a different plan year) is an unrelated document, not a version.
   */
  static readonly VERSIONED_DOCUMENT_CATEGORIES = new Set([
    "RENEWAL_PROPOSAL", "EMPLOYER_ACCEPTANCE", "HANDOUT", "SUPPLEMENT",
  ]);

  async createDocument(doc: InsertDocument): Promise<Document> {
    return db.transaction(async tx => {
      if (DatabaseStorage.SUPERSEDING_DOCUMENT_CATEGORIES.has(doc.category as string)) {
        await tx.update(documents).set({ isCurrent: false })
          .where(and(eq(documents.clientId, doc.clientId), eq(documents.category, doc.category as any), eq(documents.isCurrent, true)));
      }
      let version = doc.version ?? null;
      let isCurrent = doc.isCurrent ?? true;
      if (DatabaseStorage.VERSIONED_DOCUMENT_CATEGORIES.has(doc.category as string) && doc.normalizedFileName) {
        const siblings = await tx.select().from(documents)
          .where(and(
            eq(documents.clientId, doc.clientId),
            eq(documents.category, doc.category as any),
            eq(documents.normalizedFileName, doc.normalizedFileName),
          ));
        version = siblings.length + 1;
        isCurrent = true;
        if (siblings.length > 0) {
          await tx.update(documents).set({ isCurrent: false })
            .where(inArray(documents.id, siblings.map(s => s.id)));
        }
      }
      const [created] = await tx.insert(documents).values({ ...doc, version, isCurrent }).returning();
      return created;
    });
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  /** Finds a document already filed for this client with the exact same bytes, so Gmail ingestion never re-files what Kim already uploaded by hand. */
  async findDocumentByContentHash(clientId: number, contentHash: string): Promise<Document | undefined> {
    const [existing] = await db.select().from(documents)
      .where(and(eq(documents.clientId, clientId), eq(documents.contentHash, contentHash)));
    return existing;
  }

  /** Every recorded send date for a document — the original filing plus any identical-bytes resends. */
  async getDocumentSends(documentId: number): Promise<DocumentSend[]> {
    return db.select().from(documentSends).where(eq(documentSends.documentId, documentId)).orderBy(desc(documentSends.sentAt));
  }

  async createDocumentSend(send: InsertDocumentSend): Promise<DocumentSend> {
    const [created] = await db.insert(documentSends).values(send).returning();
    return created;
  }

  async createUnfiledAttachment(row: InsertUnfiledAttachment): Promise<UnfiledAttachment> {
    const [created] = await db.insert(unfiledAttachments).values(row).returning();
    return created;
  }

  async getUnfiledAttachmentsQueue(status: string = "PENDING"): Promise<UnfiledAttachment[]> {
    return db.select().from(unfiledAttachments).where(eq(unfiledAttachments.status, status as any)).orderBy(desc(unfiledAttachments.createdAt));
  }

  async assignUnfiledAttachment(id: number, clientId: number, documentId: number, assignedBy: string): Promise<UnfiledAttachment | undefined> {
    const [updated] = await db.update(unfiledAttachments)
      .set({ status: "ASSIGNED", assignedClientId: clientId, assignedDocumentId: documentId, assignedAt: new Date(), assignedBy })
      .where(eq(unfiledAttachments.id, id)).returning();
    return updated;
  }

  async dismissUnfiledAttachment(id: number, assignedBy: string): Promise<UnfiledAttachment | undefined> {
    const [updated] = await db.update(unfiledAttachments)
      .set({ status: "DISMISSED", assignedAt: new Date(), assignedBy })
      .where(eq(unfiledAttachments.id, id)).returning();
    return updated;
  }

  /** Recognizes an attachment already pulled from this exact Gmail message, so a re-run of ingestion never re-downloads or re-bills Claude for it. */
  async findAttachmentByGmailIds(gmailMessageId: string, gmailAttachmentId: string): Promise<CommunicationAttachment | undefined> {
    const [existing] = await db.select().from(communicationAttachments)
      .where(and(
        eq(communicationAttachments.gmailMessageId, gmailMessageId),
        eq(communicationAttachments.gmailAttachmentId, gmailAttachmentId),
      ));
    return existing;
  }

  async getGmailImportState(mailbox: string): Promise<GmailImportState | undefined> {
    const [state] = await db.select().from(gmailImportState).where(eq(gmailImportState.mailbox, mailbox));
    return state;
  }

  /**
   * Claims the single-flight lock for one mailbox's sync, returning false when
   * a run is already in flight.
   *
   * The claim is a conditional UPDATE on the state row rather than an
   * in-process flag, because autoscale can run several web instances and each
   * carries its own poll timer — a boolean would only have guarded one of
   * them. A claim whose heartbeat has gone quiet for longer than
   * SYNC_CLAIM_STALE_MINUTES is treated as abandoned (the instance holding it
   * was killed mid-run) and can be taken over, so a crash can never wedge a
   * mailbox permanently.
   */
  async claimGmailSyncRun(stateKey: string, owner: string, trigger: string): Promise<boolean> {
    await db.insert(gmailImportState).values({ mailbox: stateKey } as any).onConflictDoNothing();
    const result: any = await db.execute(sql`
      UPDATE gmail_import_state
      SET run_state = 'RUNNING',
          run_owner = ${owner},
          run_trigger = ${trigger},
          run_started_at = now(),
          run_heartbeat_at = now(),
          run_progress = '{}'::jsonb
      WHERE mailbox = ${stateKey}
        AND (run_state <> 'RUNNING'
             OR run_heartbeat_at IS NULL
             OR run_heartbeat_at < now() - make_interval(mins => ${SYNC_CLAIM_STALE_MINUTES}))
      RETURNING id
    `);
    return (result?.rowCount ?? result?.rows?.length ?? 0) > 0;
  }

  /**
   * Refreshes the claim and publishes live counters for the sync button.
   * Returns false when this run no longer holds the claim — it was taken over
   * as stale, or cleared at boot. The caller must stop when that happens:
   * two runs walking the same mailbox is the exact failure this guards.
   */
  async heartbeatGmailSyncRun(stateKey: string, owner: string, progress: Record<string, unknown>): Promise<boolean> {
    const result: any = await db.execute(sql`
      UPDATE gmail_import_state
      SET run_heartbeat_at = now(), run_progress = ${JSON.stringify(progress)}::jsonb
      WHERE mailbox = ${stateKey} AND run_owner = ${owner} AND run_state = 'RUNNING'
      RETURNING id
    `);
    return (result?.rowCount ?? result?.rows?.length ?? 0) > 0;
  }

  /**
   * Cursor and run-summary writes, refused unless this run still holds the
   * claim. Without the owner check a displaced run could overwrite the cursor
   * of the run that replaced it, sending the new run back over pages that were
   * already ingested.
   */
  async updateGmailSyncStateIfOwner(
    stateKey: string,
    owner: string,
    fields: { lastProcessedInternalDate?: string | null; lastRunAt?: Date; lastRunSummary?: string; backfillStartDate?: Date; floorPolicy?: string; caughtUpAt?: Date | null; walkStartedAt?: Date | null; walkFailures?: number },
  ): Promise<boolean> {
    const sets = [
      fields.lastProcessedInternalDate !== undefined ? sql`last_processed_internal_date = ${fields.lastProcessedInternalDate}` : null,
      fields.lastRunAt !== undefined ? sql`last_run_at = ${fields.lastRunAt}` : null,
      fields.lastRunSummary !== undefined ? sql`last_run_summary = ${fields.lastRunSummary}` : null,
      fields.backfillStartDate !== undefined ? sql`backfill_start_date = ${fields.backfillStartDate}` : null,
      fields.floorPolicy !== undefined ? sql`floor_policy = ${fields.floorPolicy}` : null,
      fields.caughtUpAt !== undefined ? sql`caught_up_at = ${fields.caughtUpAt}` : null,
      fields.walkStartedAt !== undefined ? sql`walk_started_at = ${fields.walkStartedAt}` : null,
      fields.walkFailures !== undefined ? sql`walk_failures = ${fields.walkFailures}` : null,
    ].filter(Boolean) as any[];
    if (sets.length === 0) return true;
    const result: any = await db.execute(sql`
      UPDATE gmail_import_state SET ${sql.join(sets, sql`, `)}
      WHERE mailbox = ${stateKey} AND run_owner = ${owner}
      RETURNING id
    `);
    return (result?.rowCount ?? result?.rows?.length ?? 0) > 0;
  }

  /** Releases the claim. Scoped to the owner so a run that was already taken over as stale cannot clear someone else's claim. */
  async releaseGmailSyncRun(stateKey: string, owner: string): Promise<void> {
    await db.execute(sql`
      UPDATE gmail_import_state
      SET run_state = 'IDLE', run_owner = NULL, run_trigger = NULL
      WHERE mailbox = ${stateKey} AND run_owner = ${owner}
    `);
  }

  /** Every mailbox's sync state, in-flight or not — what the manual sync button polls. */
  async getGmailSyncRunStates(): Promise<GmailImportState[]> {
    return db.select().from(gmailImportState).orderBy(asc(gmailImportState.mailbox));
  }

  async upsertGmailImportState(mailbox: string, fields: Partial<InsertGmailImportState>): Promise<GmailImportState> {
    const existing = await this.getGmailImportState(mailbox);
    if (existing) {
      const [updated] = await db.update(gmailImportState).set(fields).where(eq(gmailImportState.mailbox, mailbox)).returning();
      return updated;
    }
    const [created] = await db.insert(gmailImportState).values({ mailbox, ...fields }).returning();
    return created;
  }

  async createDocumentFieldProposals(proposals: InsertDocumentFieldProposal[]): Promise<DocumentFieldProposal[]> {
    if (proposals.length === 0) return [];
    return db.insert(documentFieldProposals).values(proposals).returning();
  }

  async getFieldProposalsForClient(clientId: number, status?: string): Promise<DocumentFieldProposal[]> {
    const conditions = [eq(documentFieldProposals.clientId, clientId)];
    if (status) conditions.push(eq(documentFieldProposals.status, status));
    return db.select().from(documentFieldProposals).where(and(...conditions)).orderBy(desc(documentFieldProposals.createdAt));
  }

  async getPendingFieldProposals(): Promise<(DocumentFieldProposal & { clientName: string; clientCode: string; documentName: string })[]> {
    const rows = await db.select({
      proposal: documentFieldProposals,
      clientName: clients.clientName,
      clientCode: clients.clientCode,
      documentName: documents.documentName,
    })
      .from(documentFieldProposals)
      .innerJoin(clients, eq(documentFieldProposals.clientId, clients.id))
      .innerJoin(documents, eq(documentFieldProposals.documentId, documents.id))
      .where(eq(documentFieldProposals.status, "PENDING"))
      .orderBy(desc(documentFieldProposals.createdAt));
    return rows.map((r) => ({ ...r.proposal, clientName: r.clientName, clientCode: r.clientCode, documentName: r.documentName }));
  }

  async getFieldProposal(id: number): Promise<DocumentFieldProposal | undefined> {
    const [proposal] = await db.select().from(documentFieldProposals).where(eq(documentFieldProposals.id, id));
    return proposal;
  }

  async reviewFieldProposal(id: number, status: "ACCEPTED" | "REJECTED", reviewedBy: string): Promise<DocumentFieldProposal> {
    const [updated] = await db.update(documentFieldProposals)
      .set({ status, reviewedBy, reviewedAt: new Date() })
      .where(eq(documentFieldProposals.id, id))
      .returning();
    return updated;
  }

  /** Re-reads whatever the live column actually holds right now, not the stale snapshot on the proposal. */
  async getLiveFieldValue(targetTable: string, targetId: number, targetField: string): Promise<string | null> {
    if (targetTable === "clients") {
      const [row] = await db.select().from(clients).where(eq(clients.id, targetId));
      return row ? ((row as any)[targetField] ?? null)?.toString() ?? null : null;
    }
    if (targetTable === "plans") {
      const [row] = await db.select().from(plans).where(eq(plans.id, targetId));
      return row ? ((row as any)[targetField] ?? null)?.toString() ?? null : null;
    }
    throw new Error(`Unknown target table: ${targetTable}`);
  }

  /**
   * Writes a proposal's confirmed value onto the real client/plan record, inside
   * one transaction with the audit-trail row and the proposal's own status flip.
   * Throws "OVERWRITE_CONFIRMATION_REQUIRED" when the live value is non-blank
   * and differs from what's about to be written and the caller hasn't set
   * force — the route layer turns that into a 409 with both values so the UI
   * can show a warning before resubmitting with force=true.
   */
  async confirmFieldProposal(
    proposalId: number,
    opts: { value: string; coercedValue: string | number | boolean; confirmedBy: string; force?: boolean },
  ): Promise<{ proposal: DocumentFieldProposal; history: FieldChangeHistory }> {
    return db.transaction(async (tx) => {
      const [proposal] = await tx.select().from(documentFieldProposals).where(eq(documentFieldProposals.id, proposalId));
      if (!proposal) throw new Error("Proposal not found");
      if (proposal.status !== "PENDING") throw new Error("Proposal already reviewed");
      if (proposal.mappingStatus !== "MAPPED" || !proposal.targetId) throw new Error("This field has no matching place on the record and cannot be confirmed onto it");

      const table = proposal.targetTable === "clients" ? clients : plans;
      const [liveRow] = await tx.select().from(table as any).where(eq((table as any).id, proposal.targetId));
      if (!liveRow) throw new Error(`${proposal.targetTable} record not found`);
      const liveValue = (liveRow as any)[proposal.targetField];
      const liveValueStr = liveValue === null || liveValue === undefined ? null : String(liveValue);

      const newValueStr = String(opts.coercedValue);
      if (liveValueStr && liveValueStr !== newValueStr && !opts.force) {
        const err: any = new Error("OVERWRITE_CONFIRMATION_REQUIRED");
        err.code = "OVERWRITE_CONFIRMATION_REQUIRED";
        err.currentValue = liveValueStr;
        throw err;
      }

      await tx.update(table as any)
        .set({ [proposal.targetField]: opts.coercedValue, updatedAt: new Date() } as any)
        .where(eq((table as any).id, proposal.targetId));

      const [doc] = await tx.select().from(documents).where(eq(documents.id, proposal.documentId));

      const [history] = await tx.insert(fieldChangeHistory).values({
        proposalId: proposal.id,
        clientId: proposal.clientId,
        targetTable: proposal.targetTable,
        targetId: proposal.targetId,
        targetField: proposal.targetField,
        fieldLabel: proposal.fieldLabel,
        oldValue: liveValueStr,
        newValue: newValueStr,
        sourceDocumentId: proposal.documentId,
        sourceDocumentName: doc?.documentName || null,
        confirmedBy: opts.confirmedBy,
      }).returning();

      const [updatedProposal] = await tx.update(documentFieldProposals)
        .set({ status: "ACCEPTED", reviewedBy: opts.confirmedBy, reviewedAt: new Date(), currentValue: newValueStr, proposedValue: opts.value })
        .where(eq(documentFieldProposals.id, proposalId))
        .returning();

      return { proposal: updatedProposal, history };
    });
  }

  async getFieldChangeHistory(clientId?: number): Promise<(FieldChangeHistory & { clientName: string; clientCode: string })[]> {
    const base = db.select({
      history: fieldChangeHistory,
      clientName: clients.clientName,
      clientCode: clients.clientCode,
    })
      .from(fieldChangeHistory)
      .innerJoin(clients, eq(fieldChangeHistory.clientId, clients.id));
    const query = clientId ? base.where(eq(fieldChangeHistory.clientId, clientId)) : base;
    const rows = await query.orderBy(desc(fieldChangeHistory.confirmedAt)).limit(200);
    return rows.map((r) => ({ ...r.history, clientName: r.clientName, clientCode: r.clientCode }));
  }

  /**
   * Re-resolves every PENDING proposal still sitting at the placeholder
   * "review_only" target through the current field-mapping table. Safe to run
   * on every boot: already-mapped or already-reviewed rows are left alone, and
   * a fieldKey with no mapping entry resolves to the same UNMAPPED state it
   * started in. Returns how many became mapped vs. stayed unmapped, for the
   * one-time report on the existing proposal backlog.
   */
  async backfillFieldProposalMappings(): Promise<{ mapped: number; unmapped: number; total: number }> {
    const { backfillCursor, saveBackfillCursor } = await import("./backfillProgress");
    const cursor = await backfillCursor("field-proposal-mapping-backfill");
    const rows = await db.select({
      proposal: documentFieldProposals,
      documentCategory: documents.category,
      documentPlanId: documents.planId,
    })
      .from(documentFieldProposals)
      .innerJoin(documents, eq(documentFieldProposals.documentId, documents.id))
      .where(and(maintainableDocument, sql`${documentFieldProposals.id} > ${cursor}`, eq(documentFieldProposals.status, "PENDING"), eq(documentFieldProposals.targetTable, "review_only")))
      .orderBy(asc(documentFieldProposals.id));

    let mapped = 0;
    let unmapped = 0;
    for (const row of rows) {
      const { resolveFieldMapping } = await import("./fieldMapping");
      const m = resolveFieldMapping(
        row.proposal.fieldKey,
        row.proposal.proposedValue,
        row.documentCategory,
        row.proposal.clientId,
        row.documentPlanId,
      );
      if (m.mappingStatus === "MAPPED") mapped++; else unmapped++;
      await db.update(documentFieldProposals)
        .set({
          targetTable: m.targetTable,
          targetId: m.targetId,
          targetField: m.targetField,
          mappingStatus: m.mappingStatus,
          confidence: m.confidence,
          isPlanDesignField: m.isPlanDesignField,
        })
        .where(eq(documentFieldProposals.id, row.proposal.id));
      await saveBackfillCursor("field-proposal-mapping-backfill", row.proposal.id);
    }
    return { mapped, unmapped, total: rows.length };
  }

  /**
   * Fills documents.effectiveDate for any document that doesn't have one yet,
   * using whatever date-bearing field Claude already extracted from it (or a
   * year guessed from the filename as a last resort). Safe to re-run on every
   * boot: already-dated rows are skipped, and a document with no usable date
   * anywhere stays null and is left to fall back to uploadedAt at query time.
   */
  async backfillDocumentEffectiveDates(): Promise<{ dated: number; undated: number; total: number }> {
    const { backfillCursor, saveBackfillCursor } = await import("./backfillProgress");
    const cursor = await backfillCursor("document-effective-date-backfill");
    const { deriveDocumentEffectiveDate } = await import("./fieldGrouping");
    const undatedDocs = await db.select().from(documents).where(and(maintainableDocument, sql`${documents.id} > ${cursor}`, isNull(documents.effectiveDate))).orderBy(asc(documents.id));
    let dated = 0;
    let undated = 0;
    for (const doc of undatedDocs) {
      const proposalsOnDoc = await db.select({ fieldKey: documentFieldProposals.fieldKey, proposedValue: documentFieldProposals.proposedValue })
        .from(documentFieldProposals)
        .where(eq(documentFieldProposals.documentId, doc.id));
      const derived = deriveDocumentEffectiveDate(doc.documentName, proposalsOnDoc);
      if (derived) {
        await db.update(documents).set({ effectiveDate: derived }).where(eq(documents.id, doc.id));
        dated++;
      } else {
        undated++;
      }
      await saveBackfillCursor("document-effective-date-backfill", doc.id);
    }
    return { dated, undated, total: undatedDocs.length };
  }

  /**
   * Collapses the PENDING review queue from one row per (document, field) to
   * one row per (client, target field) — the unit a reviewer actually cares
   * about. Superseded, matched, conflicting, and still-needing-review states
   * are computed live against documents.effectiveDate and the record's current
   * value, never persisted, so they can't go stale as new proposals or manual
   * edits land.
   */
  async getGroupedFieldProposals(): Promise<import("./fieldGrouping").GroupedFieldProposalsResult> {
    const { FIELD_MAPPINGS } = await import("./fieldMapping");
    type QueueState = "CONFLICT" | "NEEDS_REVIEW" | "SUPERSEDED" | "MATCHED" | "UNMAPPED";

    const rows = await db.select({
      proposal: documentFieldProposals,
      clientName: clients.clientName,
      clientCode: clients.clientCode,
      documentName: documents.documentName,
      documentEffectiveDate: documents.effectiveDate,
      documentUploadedAt: documents.uploadedAt,
      sourceLocation: documentFieldProposals.sourceLocation,
    })
      .from(documentFieldProposals)
      .innerJoin(clients, eq(documentFieldProposals.clientId, clients.id))
      .innerJoin(documents, eq(documentFieldProposals.documentId, documents.id))
      .where(eq(documentFieldProposals.status, "PENDING"));

    type Row = typeof rows[number];
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.proposal.clientId}|${r.proposal.targetTable}|${r.proposal.targetId ?? "none"}|${r.proposal.targetField}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const clientsMap = new Map<number, { clientId: number; clientName: string; clientCode: string; fields: any[] }>();
    let totalSuperseded = 0, totalMatched = 0, totalNeedsReview = 0, totalConflicts = 0;

    for (const [key, groupRows] of Array.from(groups.entries())) {
      const sorted = [...groupRows].sort((a, b) => {
        const dateA = (a.documentEffectiveDate || a.documentUploadedAt).getTime();
        const dateB = (b.documentEffectiveDate || b.documentUploadedAt).getTime();
        return dateB - dateA;
      });
      const top = sorted[0];
      const topYear = (top.documentEffectiveDate || top.documentUploadedAt).getFullYear();

      const toCandidate = (r: Row, coercedValue: string | null) => ({
        proposalId: r.proposal.id,
        proposedValue: r.proposal.proposedValue,
        coercedValue,
        documentId: r.proposal.documentId,
        documentName: r.documentName,
        effectiveDate: (r.documentEffectiveDate || r.documentUploadedAt).toISOString(),
        sourceLocation: r.proposal.sourceLocation,
      });

      const coerceOf = (r: Row): string | null => {
        const mapping = FIELD_MAPPINGS[r.proposal.fieldKey];
        if (!mapping) return r.proposal.proposedValue.trim() || null;
        const c = mapping.coerce(r.proposal.proposedValue);
        return c === null ? null : String(c);
      };

      const sameYear = sorted.filter((r) => (r.documentEffectiveDate || r.documentUploadedAt).getFullYear() === topYear);
      const older = sorted.filter((r) => (r.documentEffectiveDate || r.documentUploadedAt).getFullYear() !== topYear);

      const distinctValues = new Set(sameYear.map((r) => coerceOf(r) ?? `__raw__:${r.proposal.proposedValue.trim()}`));
      const isMapped = top.proposal.mappingStatus === "MAPPED";
      let state: QueueState;
      let candidates: ReturnType<typeof toCandidate>[];
      let currentValue: string | null = null;

      if (!isMapped) {
        state = "UNMAPPED";
        candidates = [toCandidate(top, null)];
      } else if (distinctValues.size > 1) {
        state = "CONFLICT";
        candidates = sameYear.map((r) => toCandidate(r, coerceOf(r)));
        totalConflicts++;
      } else {
        currentValue = top.proposal.targetId != null
          ? await this.getLiveFieldValue(top.proposal.targetTable, top.proposal.targetId, top.proposal.targetField)
          : null;
        const coerced = coerceOf(top);
        if (coerced !== null && currentValue !== null && coerced === currentValue) {
          state = "MATCHED";
          totalMatched++;
        } else {
          state = "NEEDS_REVIEW";
          totalNeedsReview++;
        }
        candidates = [toCandidate(top, coerced)];
      }

      const superseded = older.map((r) => toCandidate(r, coerceOf(r)));
      totalSuperseded += superseded.length;
      // Same-year losers in a non-conflict scenario can't happen (distinctValues.size <= 1 means they all agree),
      // but if there were duplicate same-year rows they still count as superseded history, not extra review items.
      const extraSameYear = state !== "CONFLICT" ? sameYear.slice(1).map((r) => toCandidate(r, coerceOf(r))) : [];
      totalSuperseded += extraSameYear.length;

      const [clientId, targetTable, targetIdRaw, targetField] = key.split("|");
      if (!clientsMap.has(top.proposal.clientId)) {
        clientsMap.set(top.proposal.clientId, {
          clientId: top.proposal.clientId, clientName: top.clientName, clientCode: top.clientCode, fields: [],
        });
      }
      clientsMap.get(top.proposal.clientId)!.fields.push({
        key,
        clientId: top.proposal.clientId,
        targetTable,
        targetId: targetIdRaw === "none" ? null : parseInt(targetIdRaw, 10),
        targetField,
        fieldKey: top.proposal.fieldKey,
        fieldLabel: top.proposal.fieldLabel,
        mappingStatus: top.proposal.mappingStatus,
        confidence: top.proposal.confidence,
        isPlanDesignField: top.proposal.isPlanDesignField,
        state,
        currentValue,
        candidates,
        superseded: [...superseded, ...extraSameYear],
      });
    }

    // Unmapped fields (no matching column on the record) aren't actionable — nothing
    // to confirm them onto — so they're excluded from the headline review count and
    // shown separately, deduplicated the same way, as reference material for the
    // categorization-gap work rather than something Kim/Steve must clear.
    const clientsArr = Array.from(clientsMap.values()).map((c) => ({
      ...c,
      needsReviewCount: c.fields.filter((f) => f.state === "NEEDS_REVIEW" || f.state === "CONFLICT").length,
      conflictCount: c.fields.filter((f) => f.state === "CONFLICT").length,
      unmappedCount: c.fields.filter((f) => f.state === "UNMAPPED").length,
      fields: c.fields.sort((a, b) => {
        const order: Record<string, number> = { CONFLICT: 0, NEEDS_REVIEW: 1, UNMAPPED: 2, MATCHED: 3, SUPERSEDED: 4 };
        return order[a.state] - order[b.state];
      }),
    })).sort((a, b) => b.needsReviewCount - a.needsReviewCount);

    const totalUnmapped = clientsArr.reduce((sum, c) => sum + c.unmappedCount, 0);

    return {
      clients: clientsArr,
      totals: {
        totalProposals: rows.length,
        superseded: totalSuperseded,
        matched: totalMatched,
        needsReview: totalNeedsReview,
        conflicts: totalConflicts,
        unmapped: totalUnmapped,
      },
    };
  }

  async undoFieldChange(historyId: number, undoneBy: string): Promise<FieldChangeHistory> {
    return db.transaction(async (tx) => {
      const [history] = await tx.select().from(fieldChangeHistory).where(eq(fieldChangeHistory.id, historyId));
      if (!history) throw new Error("History entry not found");
      if (history.undoneAt) throw new Error("Already undone");

      const table = history.targetTable === "clients" ? clients : plans;
      await tx.update(table as any)
        .set({ [history.targetField]: history.oldValue, updatedAt: new Date() } as any)
        .where(eq((table as any).id, history.targetId));

      const [updated] = await tx.update(fieldChangeHistory)
        .set({ undoneBy, undoneAt: new Date() })
        .where(eq(fieldChangeHistory.id, historyId))
        .returning();
      return updated;
    });
  }

  async getIssues(clientId: number): Promise<Issue[]> {
    return db.select().from(issues).where(eq(issues.clientId, clientId)).orderBy(desc(issues.createdAt));
  }

  async getAllIssues(status?: string): Promise<(Issue & { clientName: string; clientCode: string })[]> {
    const allIssues = status
      ? await db.select().from(issues).where(eq(issues.status, status as any)).orderBy(desc(issues.createdAt))
      : await db.select().from(issues).orderBy(desc(issues.createdAt));
    return Promise.all(allIssues.map(async (issue) => {
      const client = await this.getClient(issue.clientId);
      return { ...issue, clientName: client?.clientName ?? "Unknown", clientCode: client?.clientCode ?? "" };
    }));
  }

  async getIssue(id: number): Promise<Issue | undefined> {
    const [issue] = await db.select().from(issues).where(eq(issues.id, id));
    return issue;
  }

  async createIssue(issue: InsertIssue): Promise<Issue> {
    const [created] = await db.insert(issues).values(issue).returning();
    return created;
  }

  async updateIssue(id: number, data: Partial<InsertIssue & { resolvedAt: Date; followUpAt: Date | null }>): Promise<Issue | undefined> {
    const [updated] = await db.update(issues).set({ ...data, updatedAt: new Date() }).where(eq(issues.id, id)).returning();
    return updated;
  }

  async getActiveIssueCount(clientId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(issues).where(and(eq(issues.clientId, clientId), eq(issues.status, "ACTIVE")));
    return result?.count ?? 0;
  }

  async getTotalActiveIssueCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(issues).where(eq(issues.status, "ACTIVE"));
    return result?.count ?? 0;
  }

  async getOverdueFollowUpCount(): Promise<number> {
    const now = new Date();
    const allActive = await db.select().from(issues).where(eq(issues.status, "ACTIVE"));
    return allActive.filter(i => i.followUpAt && new Date(i.followUpAt) <= now).length;
  }

  async getPprUploads(clientId: number): Promise<PprUpload[]> {
    return db.select().from(pprUploads).where(eq(pprUploads.clientId, clientId)).orderBy(desc(pprUploads.reportYear), desc(pprUploads.reportMonth));
  }

  async getPprGroupedUploads(clientId: number): Promise<PprMonthGroup[]> {
    const rows = await db.select().from(pprUploads)
      .where(eq(pprUploads.clientId, clientId))
      .orderBy(desc(pprUploads.reportYear), desc(pprUploads.reportMonth));
    const groups = new Map<string, PprMonthGroup>();
    for (const row of rows) {
      const key = `${row.reportYear}-${String(row.reportMonth).padStart(2, "0")}`;
      if (!groups.has(key)) {
        groups.set(key, { reportYear: row.reportYear, reportMonth: row.reportMonth, pdf: null, excel: null, notes: row.notes ?? null, uploadedAt: row.uploadedAt });
      }
      const g = groups.get(key)!;
      const ft = row.fileType?.toUpperCase();
      if (ft === "PDF") { g.pdf = row; }
      else if (ft === "EXCEL") { g.excel = row; }
      else {
        const ext = (row.fileName || "").split(".").pop()?.toLowerCase();
        if (ext === "pdf") { if (!g.pdf) g.pdf = row; }
        else { if (!g.excel) g.excel = row; }
      }
      if (row.notes && !g.notes) g.notes = row.notes;
      if (row.uploadedAt > g.uploadedAt) g.uploadedAt = row.uploadedAt;
    }
    return Array.from(groups.values());
  }

  async getPprUpload(id: number): Promise<PprUpload | undefined> {
    const [ppr] = await db.select().from(pprUploads).where(eq(pprUploads.id, id));
    return ppr;
  }

  async findPprUploadByType(clientId: number, reportMonth: number, reportYear: number, fileType: string): Promise<PprUpload | undefined> {
    const [row] = await db.select().from(pprUploads).where(
      and(
        eq(pprUploads.clientId, clientId),
        eq(pprUploads.reportMonth, reportMonth),
        eq(pprUploads.reportYear, reportYear),
        eq(pprUploads.fileType, fileType.toUpperCase()),
      )
    );
    return row;
  }

  async createPprUpload(ppr: InsertPprUpload): Promise<PprUpload> {
    const [created] = await db.insert(pprUploads).values(ppr).returning();
    return created;
  }

  async updatePprUpload(id: number, data: Partial<InsertPprUpload>): Promise<PprUpload | undefined> {
    const [updated] = await db.update(pprUploads).set(data).where(eq(pprUploads.id, id)).returning();
    return updated;
  }

  async deletePprUpload(id: number): Promise<void> {
    await db.delete(pprUploads).where(eq(pprUploads.id, id));
  }

  async getPprMetrics(clientId: number): Promise<PprMetrics[]> {
    return db.select().from(pprMetrics)
      .where(eq(pprMetrics.clientId, clientId))
      .orderBy(desc(pprMetrics.reportYear), desc(pprMetrics.reportMonth));
  }

  async upsertPprMetrics(metrics: InsertPprMetrics): Promise<PprMetrics> {
    const existing = await db.select().from(pprMetrics).where(
      and(
        eq(pprMetrics.clientId, metrics.clientId),
        eq(pprMetrics.reportMonth, metrics.reportMonth),
        eq(pprMetrics.reportYear, metrics.reportYear),
        metrics.planName ? eq(pprMetrics.planName, metrics.planName) : sql`plan_name IS NULL`,
      )
    );
    if (existing.length > 0) {
      const [updated] = await db.update(pprMetrics)
        .set({ ...metrics, importedAt: new Date() })
        .where(eq(pprMetrics.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(pprMetrics).values(metrics).returning();
    return created;
  }

  async getPprMetricsSummary(): Promise<any[]> {
    const allMetrics = await db.select().from(pprMetrics).orderBy(desc(pprMetrics.reportYear), desc(pprMetrics.reportMonth));
    const latestByClient: Record<number, any> = {};
    for (const m of allMetrics) {
      if (!latestByClient[m.clientId]) {
        latestByClient[m.clientId] = m;
      }
    }
    const result = [];
    for (const [clientId, metric] of Object.entries(latestByClient)) {
      const client = await this.getClient(Number(clientId));
      if (client) {
        result.push({ ...metric, clientName: client.clientName, clientCode: client.clientCode });
      }
    }
    return result.sort((a, b) => Number(b.ytdLossRatio ?? 0) - Number(a.ytdLossRatio ?? 0));
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }

  async getRecentAuditLogs(limit: number): Promise<AuditLog[]> {
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  async getDashboardStats() {
    const [totalResult] = await db.select({ count: count() }).from(clients);
    // Counted from the derived state so the tiles agree with the Clients tabs.
    // A client in its notice period or run-out still counts as active here,
    // because it is still being serviced.
    const allClientRows = await db.select().from(clients);
    const activeResult = {
      count: allClientRows.filter((c) => {
        const state = deriveClientState(c);
        return state !== "PROSPECT" && countsAsActive(state);
      }).length,
    };
    const terminatedResult = {
      count: allClientRows.filter((c) => deriveClientState(c) === "CLOSED").length,
    };
    const [issueResult] = await db.select({ count: count() }).from(issues).where(eq(issues.status, "ACTIVE"));

    const sixtyDaysFromNow = new Date();
    sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);
    const allActivePlans = await db.select().from(plans).where(eq(plans.isArchived, false));
    let expiringCount = 0;
    for (const plan of allActivePlans) {
      const expiry = new Date(plan.effectiveDate);
      expiry.setMonth(expiry.getMonth() + 12);
      if (expiry <= sixtyDaysFromNow && expiry > new Date()) {
        expiringCount++;
      }
    }

    return {
      totalClients: totalResult?.count ?? 0,
      activeClients: activeResult?.count ?? 0,
      terminatedClients: terminatedResult?.count ?? 0,
      activeIssues: issueResult?.count ?? 0,
      expiringPlans: expiringCount,
    };
  }

  async getClientsWithActiveIssues() {
    const allClients = await db.select().from(clients).orderBy(asc(clients.clientName));
    const result = [];
    for (const client of allClients) {
      const activeCount = await this.getActiveIssueCount(client.id);
      if (activeCount > 0) {
        const recentIssues = await db.select().from(issues)
          .where(and(eq(issues.clientId, client.id), eq(issues.status, "ACTIVE")))
          .orderBy(desc(issues.createdAt)).limit(1);
        result.push({
          ...client,
          activeIssueCount: activeCount,
          mostRecentIssue: recentIssues[0] || null,
        });
      }
    }
    return result.sort((a, b) => b.activeIssueCount - a.activeIssueCount);
  }

  async getExpiringPlans() {
    const sixtyDaysFromNow = new Date();
    sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);
    const allActivePlans = await db.select().from(plans).where(eq(plans.isArchived, false));
    const result = [];
    for (const plan of allActivePlans) {
      const expiry = new Date(plan.effectiveDate);
      expiry.setMonth(expiry.getMonth() + 12);
      if (expiry <= sixtyDaysFromNow) {
        const client = await this.getClient(plan.clientId);
        const daysUntil = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        result.push({
          ...plan,
          clientName: client?.clientName ?? "Unknown",
          expiryDate: expiry,
          daysUntilExpiration: daysUntil,
        });
      }
    }
    return result.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
  }

  async getDashboardRenewals(): Promise<any[]> {
    const { renewals } = await import("@shared/schema");
    const { computeRenewalBuckets } = await import("./renewal-buckets");
    const sources = await db.select({client:clients,renewal:renewals}).from(renewals).innerJoin(clients,eq(clients.id,renewals.clientId));
    const buckets = computeRenewalBuckets(sources.filter(s => deriveClientState(s.client) === "ACTIVE"));
    return [...buckets.upcoming, ...buckets.current, ...buckets.complete];
  }

  async getDashboardIssues(): Promise<any[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const all = await db.select({
      id: issues.id,
      clientId: issues.clientId,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      issueType: issues.issueType,
      createdAt: issues.createdAt,
      resolvedAt: issues.resolvedAt,
      resolutionNotes: issues.resolutionNotes,
      clientName: clients.clientName,
      clientCode: clients.clientCode,
    })
    .from(issues)
    .leftJoin(clients, eq(issues.clientId, clients.id))
    .where(
      or(
        eq(issues.status, "ACTIVE"),
        and(
          eq(issues.status, "RESOLVED"),
          gte(issues.resolvedAt, thirtyDaysAgo)
        )
      )
    )
    .orderBy(asc(issues.createdAt));
    return all;
  }

  async globalSearch(q: string): Promise<any[]> {
    const term = `%${q}%`;
    const qLower = q.toLowerCase();
    const found = await db.select().from(clients).where(
      or(
        ilike(clients.clientName, term),
        ilike(clients.brokerFirmName, term),
        ilike(clients.brokerContactName, term),
        ilike(clients.adminContactName, term),
        ilike(clients.decisionMakerName, term),
        ilike(clients.clientCode, term),
        sql`${clients.planType}::text ILIKE ${term}`,
      )
    ).orderBy(asc(clients.clientName)).limit(50);
    return Promise.all(found.map(async c => {
      const count = await this.getActiveIssueCount(c.id);
      const nameMatch = c.clientName?.toLowerCase().includes(qLower) || c.clientCode?.toLowerCase().includes(qLower);
      let matchedOn = "client";
      if (!nameMatch) {
        if (c.brokerFirmName?.toLowerCase().includes(qLower) || c.brokerContactName?.toLowerCase().includes(qLower)) {
          matchedOn = "broker";
        } else if (c.adminContactName?.toLowerCase().includes(qLower) || c.decisionMakerName?.toLowerCase().includes(qLower)) {
          matchedOn = "contact";
        } else if (c.planType?.toLowerCase().includes(qLower)) {
          matchedOn = "plan";
        }
      }
      return { ...c, activeIssueCount: count, matchedOn };
    }));
  }

  async createCommunication(comm: InsertCommunication): Promise<Communication> {
    const [created] = await db.insert(communications).values(comm).returning();
    return created;
  }

  async updateCommunication(id: number, data: Partial<Communication>): Promise<Communication | undefined> {
    const [updated] = await db.update(communications).set(data).where(eq(communications.id, id)).returning();
    return updated;
  }

  async getCommunication(id: number): Promise<Communication | undefined> {
    const [comm] = await db.select().from(communications).where(eq(communications.id, id));
    return comm;
  }

  /**
   * Loads attachments, tasks and client names for a whole batch of
   * communications in a fixed number of queries rather than three per row.
   *
   * The previous per-row version issued roughly 3N round trips, which was
   * tolerable for one client's history but not for the dashboard feed, which
   * reads every unresolved message on every poll.
   */
  private async enrichComms(comms: Communication[]) {
    if (!comms.length) return [];
    const ids = comms.map(c => c.id);

    const [attachments, rawTasks, links] = await Promise.all([
      db.select().from(communicationAttachments)
        .where(inArray(communicationAttachments.communicationId, ids))
        .orderBy(asc(communicationAttachments.uploadedAt)),
      db.select().from(communicationTasks)
        .where(inArray(communicationTasks.communicationId, ids))
        .orderBy(asc(communicationTasks.createdAt)),
      db.select().from(communicationClients)
        .where(inArray(communicationClients.communicationId, ids)),
    ]);

    const linkedClientIds = Array.from(new Set(links.map(l => l.clientId)));
    const clientRows = linkedClientIds.length
      ? await db.select({ id: clients.id, clientName: clients.clientName, clientCode: clients.clientCode })
          .from(clients).where(inArray(clients.id, linkedClientIds))
      : [];
    const clientById = new Map(clientRows.map(c => [c.id, c]));

    // Tasks arrive decorated so a message showing a task that covers two
    // accounts says so, rather than silently showing only the first.
    const tasks = await this.decorateTasks(rawTasks);

    // Tasks may now exist without a parent message, so the key is nullable in
    // the type even though every row read here was fetched by communication id.
    const groupByComm = <T extends { communicationId: number | null }>(rows: T[]) => {
      const m = new Map<number, T[]>();
      for (const r of rows) {
        if (r.communicationId == null) continue;
        const existing = m.get(r.communicationId);
        if (existing) existing.push(r);
        else m.set(r.communicationId, [r]);
      }
      return m;
    };
    const attByComm = groupByComm(attachments);
    const taskByComm = groupByComm(tasks);
    const linkByComm = groupByComm(links);

    return comms.map(c => {
      const myLinks = linkByComm.get(c.id) ?? [];
      return {
        ...c,
        attachments: attByComm.get(c.id) ?? [],
        tasks: taskByComm.get(c.id) ?? [],
        clientIds: myLinks.map(l => l.clientId),
        clientCodes: myLinks.map(l => clientById.get(l.clientId)?.clientCode ?? ""),
        clientNames: myLinks.map(l => clientById.get(l.clientId)?.clientName ?? "Unknown"),
      };
    });
  }

  async getClientCommunications(clientId: number) {
    const links = await db.select().from(communicationClients).where(eq(communicationClients.clientId, clientId));
    if (!links.length) return [];
    const commIds = links.map(l => l.communicationId);
    const comms = await db.select().from(communications).where(inArray(communications.id, commIds)).orderBy(desc(communications.receivedAt));
    return this.enrichComms(comms);
  }

  /**
   * The dashboard triage feed: every unresolved communication, newest first.
   *
   * There is deliberately no date window and no limit. A message Kim has not
   * dealt with is exactly the thing that must not scroll quietly out of view,
   * so the only way out of this list is an explicit resolution.
   */
  async getCommunicationFeed() {
    const comms = await db.select().from(communications)
      .where(eq(communications.status, "ACTIVE"))
      .orderBy(desc(communications.receivedAt));
    return this.enrichComms(comms);
  }

  /**
   * Resolves a communication and stamps who did it and when.
   *
   * Any of its tasks still sitting untouched (OPEN) are closed out with the
   * same note, because leaving them behind would strand work under a message
   * that now reads as finished. Tasks already promoted to the to-do list are
   * left alone: Kim put them there on purpose and works them separately.
   */
  async resolveCommunication(id: number, opts: { resolutionType: string; note: string; user: string }) {
    const resolvedAt = new Date();
    return db.transaction(async tx => {
      // Conditional on ACTIVE, so two people resolving the same message at once
      // cannot overwrite the first person's note.
      const [comm] = await tx.update(communications).set({
        status: "RESOLVED",
        resolutionType: opts.resolutionType,
        resolutionNote: opts.note,
        resolvedAt,
        resolvedBy: opts.user,
      }).where(and(
        eq(communications.id, id),
        eq(communications.status, "ACTIVE"),
      )).returning();

      if (!comm) return null;

      await tx.update(communicationTasks).set({
        status: "RESOLVED",
        isCompleted: true,
        completedAt: resolvedAt,
        resolvedAt,
        resolvedBy: opts.user,
        resolutionNote: opts.note,
      }).where(and(
        eq(communicationTasks.communicationId, id),
        eq(communicationTasks.status, "OPEN"),
      ));

      return resolvedAt;
    });
  }

  /**
   * Undo for a mis-click on "Read: no task needed".
   *
   * Tasks auto-closed by that same action are revived by matching the exact
   * resolution timestamp, so an undo cannot disturb anything resolved earlier
   * and by hand.
   */
  async unresolveCommunication(id: number): Promise<"ok" | "not_resolved" | "has_note" | "expired"> {
    return db.transaction(async tx => {
      const [comm] = await tx.select().from(communications).where(eq(communications.id, id));
      if (!comm || comm.status !== "RESOLVED") return "not_resolved" as const;

      // Undo exists for a mis-click on "Read: no task needed" and nothing else.
      // A typed resolution note is the audit trail, so it is never erasable.
      if (comm.resolutionType !== "READ_NO_TASK") return "has_note" as const;
      if (!comm.resolvedAt) return "not_resolved" as const;
      if (Date.now() - comm.resolvedAt.getTime() > UNDO_WINDOW_MS) return "expired" as const;

      await tx.update(communicationTasks).set({
        status: "OPEN",
        isCompleted: false,
        completedAt: null,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      }).where(and(
        eq(communicationTasks.communicationId, id),
        eq(communicationTasks.status, "RESOLVED"),
        eq(communicationTasks.resolvedAt, comm.resolvedAt),
      ));

      await tx.update(communications).set({
        status: "ACTIVE",
        resolutionType: null,
        resolutionNote: null,
        resolvedAt: null,
        resolvedBy: null,
      }).where(eq(communications.id, id));

      return "ok" as const;
    });
  }

  // ── App settings — small admin-tunable knobs, one row per key ──

  async getAppSetting(key: string): Promise<AppSetting | undefined> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row;
  }

  async setAppSetting(key: string, value: string, updatedBy: string): Promise<AppSetting> {
    const [row] = await db.insert(appSettings).values({ key, value, updatedBy })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy, updatedAt: new Date() } })
      .returning();
    return row;
  }

  async getTriageMinPriority(): Promise<string> {
    const row = await this.getAppSetting(TRIAGE_MIN_PRIORITY_KEY);
    return row?.value ?? TRIAGE_MIN_PRIORITY_DEFAULT;
  }

  /**
   * The moment the label-scoped historical backfill's census discovered this
   * thread (gmail_backfill_threads.created_at), or null if the thread was
   * never in scope. This is a per-thread timestamp, not a per-thread
   * boolean — a censused thread is not muted forever. Only messages that
   * existed AT census time are historical; anything sent after is genuine
   * live mail (a real reply on an old thread) and must go through normal
   * extraction/triage even though its thread appears in the census. See
   * gmailMessages.isHistoricalImport for how callers use this.
   */
  async getBackfillCensusTimestamp(mailbox: string, gmailThreadId: string): Promise<Date | null> {
    const [row] = await db.select({ createdAt: gmailBackfillThreads.createdAt }).from(gmailBackfillThreads)
      .where(and(eq(gmailBackfillThreads.mailbox, mailbox), eq(gmailBackfillThreads.gmailThreadId, gmailThreadId)))
      .limit(1);
    return row?.createdAt ?? null;
  }

  /**
   * Bounded, one-time catch-up set: RECEIVED messages that live on a
   * backfill-censused thread, were sent AFTER that thread's census
   * timestamp (so they're genuine live mail, not historical filler), and
   * never got a triage task — because whichever pipeline captured them
   * (before the per-message isHistoricalImport fix existed) treated the
   * whole thread as historical and skipped extraction outright. Expected to
   * match a small number of rows once, then nothing ever again as new mail
   * always goes through the fixed per-message check at write time.
   */
  async getUnextractedPostCensusMessages(): Promise<GmailMessage[]> {
    const rows = await db.select({ message: gmailMessages })
      .from(gmailMessages)
      .innerJoin(gmailThreads, eq(gmailThreads.id, gmailMessages.threadId))
      .innerJoin(gmailBackfillThreads, and(
        eq(gmailBackfillThreads.gmailThreadId, gmailThreads.gmailThreadId),
        eq(gmailBackfillThreads.mailbox, gmailThreads.mailbox),
      ))
      .leftJoin(communicationTasks, eq(communicationTasks.gmailMessageId, gmailMessages.id))
      .where(and(
        eq(gmailThreads.mailbox, SYNC_MAILBOX),
        eq(gmailMessages.isHistoricalImport, false),
        eq(gmailMessages.direction, "RECEIVED"),
        sql`${gmailMessages.sentAt} > ${gmailBackfillThreads.createdAt}`,
        isNull(communicationTasks.id),
      ));
    return rows.map(r => r.message);
  }

  /**
   * The per-owner Gmail-native triage feed: AI-extracted action items whose
   * priority meets the tunable TRIAGE_MIN_PRIORITY setting, joined out to the
   * message they came from so the row can show a client name (falling back
   * to the sender's name) and link straight to the actual email.
   *
   * `owner` is a specific person's name, or "ALL" to show everyone's queue —
   * the dashboard uses this for Steve's toggle between his own tasks, Kim's,
   * and the combined view. Kim herself only ever sees her own.
   */
  async getGmailTriageFeed(owner: string, status: "OPEN" | "RESOLVED"): Promise<any[]> {
    const minPriority = await this.getTriageMinPriority();
    const minRank = PRIORITY_RANK[minPriority] ?? 0;

    const conditions = [
      sql`${communicationTasks.gmailMessageId} IS NOT NULL`,
      eq(communicationTasks.status, status),
      // Backstop: exclude historical-import mail even if a task somehow
      // exists for it (extraction should already have skipped it — this is
      // the third, independent layer, not a substitute for that check).
      eq(gmailMessages.isHistoricalImport, false),
    ];
    if (owner !== "ALL") conditions.push(eq(communicationTasks.owner, owner));

    const rows = await db.select({
      task: communicationTasks,
      message: gmailMessages,
    }).from(communicationTasks)
      .innerJoin(gmailMessages, eq(communicationTasks.gmailMessageId, gmailMessages.id))
      .where(and(...conditions))
      .orderBy(desc(communicationTasks.createdAt));

    const filtered = status === "OPEN"
      ? rows.filter(r => PRIORITY_RANK[r.task.aiPriority ?? "MEDIUM"] >= minRank)
      : rows;

    const taskIds = filtered.map(r => r.task.id);
    const clientLinks = taskIds.length
      ? await db.select({ taskId: taskClients.taskId, clientId: taskClients.clientId, clientName: clients.clientName })
          .from(taskClients).innerJoin(clients, eq(taskClients.clientId, clients.id))
          .where(inArray(taskClients.taskId, taskIds))
      : [];
    const clientsByTask = new Map<number, { id: number; clientName: string }[]>();
    for (const l of clientLinks) {
      const list = clientsByTask.get(l.taskId) ?? [];
      list.push({ id: l.clientId, clientName: l.clientName });
      clientsByTask.set(l.taskId, list);
    }

    return filtered.map(r => ({
      id: r.task.id,
      description: r.task.description,
      dueDate: r.task.dueDate,
      dateReview: r.task.dateReview,
      owner: r.task.owner,
      aiPriority: r.task.aiPriority,
      createdAt: r.task.createdAt,
      resolvedAt: r.task.resolvedAt,
      resolvedBy: r.task.resolvedBy,
      resolutionNote: r.task.resolutionNote,
      gmailMessageId: r.message.id,
      gmailThreadId: r.message.threadId,
      subject: r.message.subject,
      senderName: r.message.fromName,
      senderEmail: r.message.fromEmail,
      clients: clientsByTask.get(r.task.id) ?? [],
      // Display name resolution: client name if resolved, else the sender's
      // display name, else their bare address — never a blank row.
      displayName: (clientsByTask.get(r.task.id) ?? []).map(c => c.clientName).join(", ") || r.message.fromName || r.message.fromEmail,
    }));
  }

  /**
   * One-click dismiss, no confirmation and no mandatory note — this is the
   * Gmail-native triage queue, deliberately lighter-weight than the legacy
   * communications resolve flow. Un-resolving it later has no time limit
   * (see unresolveGmailTask), so a wrong dismiss is never unrecoverable.
   */
  async dismissGmailTask(id: number, byUser: string): Promise<CommunicationTask | undefined> {
    const resolvedAt = new Date();
    const [row] = await db.update(communicationTasks).set({
      status: "RESOLVED",
      isCompleted: true,
      completedAt: resolvedAt,
      resolvedAt,
      resolvedBy: byUser,
      resolutionNote: "Dismissed from triage.",
    }).where(and(eq(communicationTasks.id, id), sql`${communicationTasks.gmailMessageId} IS NOT NULL`))
      .returning();
    return row;
  }

  /** Unlimited-time undo — unlike the legacy communications undo, there is no expiry window here. */
  async unresolveGmailTask(id: number): Promise<CommunicationTask | undefined> {
    const [row] = await db.update(communicationTasks).set({
      status: "OPEN",
      isCompleted: false,
      completedAt: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    }).where(and(
      eq(communicationTasks.id, id),
      sql`${communicationTasks.gmailMessageId} IS NOT NULL`,
      eq(communicationTasks.status, "RESOLVED"),
    )).returning();
    return row;
  }

  async getAllCommunications(filters?: { senderDomain?: string; senderName?: string; clientId?: number; unmatched?: boolean; isInternal?: boolean }) {
    let comms: Communication[];

    if (filters?.clientId) {
      const links = await db.select().from(communicationClients).where(eq(communicationClients.clientId, filters.clientId));
      if (!links.length) return [];
      comms = await db.select().from(communications).where(inArray(communications.id, links.map(l => l.communicationId))).orderBy(desc(communications.receivedAt));
    } else if (filters?.unmatched) {
      comms = await db.select().from(communications).where(eq(communications.isUnmatched, true)).orderBy(desc(communications.receivedAt));
    } else {
      const conditions = [];
      if (filters?.senderDomain) conditions.push(eq(communications.senderDomain, filters.senderDomain));
      if (filters?.senderName) conditions.push(ilike(communications.senderName, `%${filters.senderName}%`));
      if (filters?.isInternal !== undefined) conditions.push(eq(communications.isInternal, filters.isInternal));
      comms = conditions.length
        ? await db.select().from(communications).where(and(...conditions)).orderBy(desc(communications.receivedAt))
        : await db.select().from(communications).orderBy(desc(communications.receivedAt));
    }

    return this.enrichComms(comms);
  }

  async assignCommunicationToClients(commId: number, assignments: { clientId: number; confidence: string }[]) {
    for (const a of assignments) {
      await db.insert(communicationClients).values({ communicationId: commId, clientId: a.clientId, matchConfidence: a.confidence }).onConflictDoNothing();
    }
    if (assignments.length > 0) {
      await db.update(communications).set({ isUnmatched: false }).where(eq(communications.id, commId));
    }
  }

  async updateClientAssignment(commId: number, clientId: number) {
    await db.insert(communicationClients).values({ communicationId: commId, clientId, matchConfidence: "manual" }).onConflictDoNothing();
    await db.update(communications).set({ isUnmatched: false }).where(eq(communications.id, commId));
  }

  async getDistinctSenders() {
    const rows = await db.selectDistinctOn([communications.senderEmail], {
      senderEmail: communications.senderEmail,
      senderName: communications.senderName,
      senderDomain: communications.senderDomain,
    }).from(communications).orderBy(communications.senderEmail);
    return rows;
  }

  async createCommunicationAttachment(att: InsertCommunicationAttachment): Promise<CommunicationAttachment> {
    const [created] = await db.insert(communicationAttachments).values(att).returning();
    return created;
  }

  async getCommunicationAttachment(id: number): Promise<CommunicationAttachment | undefined> {
    const [att] = await db.select().from(communicationAttachments).where(eq(communicationAttachments.id, id));
    return att;
  }

  async createCommunicationTask(task: InsertCommunicationTask): Promise<CommunicationTask> {
    // The flat clientId is mirrored into the join table so a task created by an
    // older caller is still visible through the many-client read path.
    return db.transaction(async tx => {
      const [created] = await tx.insert(communicationTasks).values(task).returning();
      if (created.clientId != null) {
        await tx.insert(taskClients)
          .values({ taskId: created.id, clientId: created.clientId, matchConfidence: "manual" })
          .onConflictDoNothing();
      }
      return created;
    });
  }

  /**
   * Creates one task covering several clients.
   *
   * Used by email ingest, where a message matched to two accounts used to
   * produce two duplicate tasks. One job is one task: resolving it writes one
   * note and closes it on every account it touches.
   */
  async createTaskWithClients(
    task: InsertCommunicationTask,
    matches: { clientId: number; confidence: string }[],
  ): Promise<CommunicationTask> {
    if (task.gmailMessageId) {
      const { ingestEmailTask } = await import("./email-task-intake");
      return await ingestEmailTask(task,matches) as any;
    }
    return db.transaction(async tx => {
      const [created] = await tx.insert(communicationTasks)
        .values({ ...task, clientId: matches[0]?.clientId ?? null })
        .returning();
      await this.writeTaskClients(tx, created.id, matches);
      return created;
    });
  }

  /**
   * A to-do Kim typed herself, with no email behind it.
   *
   * It goes straight onto the list under its priority: there is no triage step
   * for something she has already decided needs doing. It lands at the bottom
   * of its section so it does not jump ahead of work that has been waiting.
   *
   * An empty client list is a general to-do and is a legitimate outcome.
   */
  async createManualTodo(input: {
    description: string;
    priority: string;
    clients: { clientId: number; confidence: string }[];
  }): Promise<CommunicationTask> {
    const now = new Date();
    return db.transaction(async tx => {
      const [{ maxOrder } = { maxOrder: null as number | null }] = await tx
        .select({ maxOrder: sql<number | null>`max(${communicationTasks.sortOrder})` })
        .from(communicationTasks)
        .where(and(eq(communicationTasks.status, "TODO"), eq(communicationTasks.priority, input.priority)));

      const [created] = await tx.insert(communicationTasks).values({
        communicationId: null,
        clientId: input.clients[0]?.clientId ?? null,
        description: input.description,
        dueDate: null,
        isCompleted: false,
        status: "TODO",
        priority: input.priority,
        todoAddedAt: now,
        origin: "MANUAL",
        sortOrder: (maxOrder ?? 0) + 1,
      } as any).returning();

      await this.writeTaskClients(tx, created.id, input.clients);
      return created;
    });
  }

  /**
   * Corrects which clients a to-do is about after the AI's first guess.
   *
   * Only unresolved work can be re-pointed. Once a task carries a resolution
   * note, moving it to a different account would rewrite history.
   */
  async setTodoClients(
    taskId: number,
    clientIds: number[],
  ): Promise<CommunicationTask | undefined> {
    return db.transaction(async tx => {
      const [task] = await tx.select().from(communicationTasks)
        .where(and(
          eq(communicationTasks.id, taskId),
          inArray(communicationTasks.status, ["OPEN", "TODO"]),
        ));
      if (!task) return undefined;

      await this.writeTaskClients(tx, taskId, clientIds.map(clientId => ({ clientId, confidence: "manual" })));
      const [updated] = await tx.select().from(communicationTasks).where(eq(communicationTasks.id, taskId));
      return updated;
    });
  }

  /**
   * Decorates tasks with their clients and subject in three queries, not 3N.
   *
   * `clients` is the real answer and may hold none, one or several. The flat
   * clientName/clientCode remain as a mirror of the first one so older callers
   * that only ever expected a single client keep rendering.
   */
  private async decorateTasks(tasks: CommunicationTask[]) {
    if (!tasks.length) return [];
    const taskIds = tasks.map(t => t.id);
    const commIds = Array.from(new Set(tasks.map(t => t.communicationId).filter((v): v is number => v != null)));

    const [links, commRows] = await Promise.all([
      db.select({ taskId: taskClients.taskId, clientId: taskClients.clientId })
        .from(taskClients).where(inArray(taskClients.taskId, taskIds)),
      commIds.length
        ? db.select({ id: communications.id, subject: communications.subject, senderEmail: communications.senderEmail, senderName: communications.senderName })
            .from(communications).where(inArray(communications.id, commIds))
        : Promise.resolve([]),
    ]);

    const linkedClientIds = Array.from(new Set(links.map(l => l.clientId)));
    const clientRows = linkedClientIds.length
      ? await db.select({ id: clients.id, clientName: clients.clientName, clientCode: clients.clientCode })
          .from(clients).where(inArray(clients.id, linkedClientIds))
      : [];

    const clientById = new Map(clientRows.map(c => [c.id, c]));
    const commById = new Map(commRows.map(c => [c.id, c]));

    const clientsByTask = new Map<number, { id: number; clientName: string; clientCode: string }[]>();
    for (const l of links) {
      const client = clientById.get(l.clientId);
      if (!client) continue;
      const list = clientsByTask.get(l.taskId) ?? [];
      list.push(client);
      clientsByTask.set(l.taskId, list);
    }
    // Stable, readable order on every record and every list.
    for (const list of Array.from(clientsByTask.values())) {
      list.sort((a, b) => a.clientName.localeCompare(b.clientName));
    }

    return tasks.map(t => {
      const attached = clientsByTask.get(t.id) ?? [];
      const comm = t.communicationId != null ? commById.get(t.communicationId) : undefined;
      return {
        ...t,
        clients: attached,
        clientName: attached[0]?.clientName ?? null,
        clientCode: attached[0]?.clientCode ?? null,
        communicationSubject: comm?.subject ?? null,
        communicationSender: comm?.senderName ?? comm?.senderEmail ?? null,
      };
    });
  }

  /**
   * Rewrites which clients a task is about, inside the caller's transaction.
   *
   * The flat clientId is kept in step as a mirror of the first attachment so
   * the two never disagree about who the work belongs to.
   */
  private async writeTaskClients(
    tx: any,
    taskId: number,
    entries: { clientId: number; confidence: string }[],
  ) {
    const seen = new Set<number>();
    const unique = entries.filter(e => {
      if (!Number.isFinite(e.clientId) || seen.has(e.clientId)) return false;
      seen.add(e.clientId);
      return true;
    });

    await tx.delete(taskClients).where(eq(taskClients.taskId, taskId));
    if (unique.length) {
      await tx.insert(taskClients).values(
        unique.map(e => ({ taskId, clientId: e.clientId, matchConfidence: e.confidence })),
      );
    }
    await tx.update(communicationTasks)
      .set({ clientId: unique[0]?.clientId ?? null })
      .where(eq(communicationTasks.id, taskId));
    return unique.map(e => e.clientId);
  }

  /** Fresh suggestions awaiting triage — not yet on the to-do list, not resolved. */
  async getOpenTasks() {
    const tasks = await db.select().from(communicationTasks)
      .where(eq(communicationTasks.status, "OPEN"))
      .orderBy(asc(communicationTasks.dueDate));
    return this.decorateTasks(tasks);
  }

  /**
   * The to-do list. Ordering is applied by the shared comparator so the server
   * and the browser cannot disagree about what "oldest first" means.
   */
  async getTodos() {
    const tasks = await db.select().from(communicationTasks)
      .where(eq(communicationTasks.status, "TODO"));
    const decorated = await this.decorateTasks(tasks);
    return this.collapseGroups(decorated.sort(compareTodos));
  }

  /** Same list, filtered to one person's own items — the "My Tasks" view. */
  async getTodosForOwner(owner: string) {
    const tasks = await db.select().from(communicationTasks)
      .where(and(eq(communicationTasks.status, "TODO"), eq(communicationTasks.owner, owner)));
    const decorated = await this.decorateTasks(tasks);
    return this.collapseGroups(decorated.sort(compareTodos));
  }

  /**
   * Folds tasks that share a groupId (the same underlying job, extracted more
   * than once) into one row. The earliest-created task in the group is kept
   * in place — its position in the priority order does not change — and
   * carries the others as `relatedTasks` for the UI to list underneath it.
   */
  private collapseGroups<T extends { id: number; groupId: string | null; createdAt: any; description: string; communicationSubject?: string | null }>(
    tasks: T[],
  ): (T & { relatedTasks: { id: number; description: string; communicationSubject: string | null }[] })[] {
    const byGroup = new Map<string, T[]>();
    for (const t of tasks) {
      if (!t.groupId) continue;
      const list = byGroup.get(t.groupId) ?? [];
      list.push(t);
      byGroup.set(t.groupId, list);
    }
    const suppressed = new Set<number>();
    const relatedByPrimary = new Map<number, { id: number; description: string; communicationSubject: string | null }[]>();
    for (const group of Array.from(byGroup.values())) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const [primary, ...rest] = sorted;
      relatedByPrimary.set(primary.id, rest.map(r => ({ id: r.id, description: r.description, communicationSubject: r.communicationSubject ?? null })));
      for (const r of rest) suppressed.add(r.id);
    }
    return tasks
      .filter(t => !suppressed.has(t.id))
      .map(t => ({ ...t, relatedTasks: relatedByPrimary.get(t.id) ?? [] }));
  }

  /** Every open (OPEN or TODO) item owned by one person — used by the daily digest. */
  async getOpenTasksForOwner(owner: string) {
    const tasks = await db.select().from(communicationTasks)
      .where(and(inArray(communicationTasks.status, ["OPEN", "TODO"]), eq(communicationTasks.owner, owner)))
      .orderBy(asc(communicationTasks.dueDate));
    return this.decorateTasks(tasks);
  }

  /** Other still-open tasks for a client, for the dedup check against a freshly-created task. */
  async getOpenTasksForClientExcept(clientId: number, excludeTaskId: number) {
    const rows = await db.select({ id: communicationTasks.id, description: communicationTasks.description })
      .from(communicationTasks)
      .innerJoin(taskClients, eq(taskClients.taskId, communicationTasks.id))
      .where(and(
        eq(taskClients.clientId, clientId),
        inArray(communicationTasks.status, ["OPEN", "TODO"]),
        ne(communicationTasks.id, excludeTaskId),
      ));
    // A client can appear twice if a task touches it via more than one link path; ids are unique so dedupe defensively.
    const seen = new Map<number, { id: number; description: string }>();
    for (const r of rows) seen.set(r.id, r);
    return Array.from(seen.values());
  }

  /**
   * Groups `taskId` with `matchTaskId` as the same underlying job. Reuses the
   * match's existing groupId if it already has one (so a third repeat joins
   * the same group instead of starting a new pair), otherwise mints one from
   * the match's own id.
   */
  async groupTaskWith(taskId: number, matchTaskId: number) {
    const [match] = await db.select({ groupId: communicationTasks.groupId })
      .from(communicationTasks).where(eq(communicationTasks.id, matchTaskId));
    const groupId = match?.groupId ?? `job-${matchTaskId}`;
    await db.update(communicationTasks).set({ groupId })
      .where(inArray(communicationTasks.id, [taskId, matchTaskId]));
    return groupId;
  }

  /** Reassigns a task to another person. Either owner can hand work to the other. */
  async setTaskOwner(id: number, owner: string) {
    const [updated] = await db.update(communicationTasks)
      .set({ owner })
      .where(eq(communicationTasks.id, id))
      .returning();
    return updated;
  }

  /**
   * Moves a task onto the to-do list under a priority.
   *
   * New arrivals land at the bottom of their section by taking a sortOrder one
   * past the current maximum, so promoting something never jumps the queue
   * ahead of items that have already been waiting.
   */
  async moveTaskToTodo(id: number, priority: string, openOwner?: string) {
    return db.transaction(async tx => {
      const [{ maxOrder } = { maxOrder: null as number | null }] = await tx
        .select({ maxOrder: sql<number | null>`max(${communicationTasks.sortOrder})` })
        .from(communicationTasks)
        .where(and(eq(communicationTasks.status, "TODO"), eq(communicationTasks.priority, priority)));

      // Only unfinished work can be filed. A resolved task stays resolved; it
      // cannot be dragged back into the queue and quietly lose its note.
      const [updated] = await tx.update(communicationTasks).set({
        status: "TODO",
        priority,
        todoAddedAt: new Date(),
        sortOrder: (maxOrder ?? 0) + 1,
      }).where(and(
        eq(communicationTasks.id, id),
        inArray(communicationTasks.status, ["OPEN", "TODO"]),
        ...(openOwner ? [eq(communicationTasks.owner,openOwner),eq(communicationTasks.status,"OPEN")] : []),
      )).returning();
      return updated;
    });
  }

  /**
   * Resolves a task with a mandatory note.
   *
   * When this was the last piece of outstanding work on its communication, the
   * communication itself resolves too and drops out of Kim's feed. If other
   * work remains under that message it stays in the feed, because it has not
   * genuinely been dealt with yet.
   */
  async resolveCommunicationTask(id: number, note: string, user: string, openOwner?: string) {
    const resolvedAt = new Date();
    return db.transaction(async tx => {
      // Resolving something already resolved would overwrite the original note,
      // so the update only applies to work that is genuinely still outstanding.
      const [updated] = await tx.update(communicationTasks).set({
        status: "RESOLVED",
        isCompleted: true,
        completedAt: resolvedAt,
        resolvedAt,
        resolvedBy: user,
        resolutionNote: note,
      }).where(and(
        eq(communicationTasks.id, id),
        inArray(communicationTasks.status, ["OPEN", "TODO"]),
        ...(openOwner ? [eq(communicationTasks.owner,openOwner),eq(communicationTasks.status,"OPEN")] : []),
      )).returning();

      if (!updated) return { task: undefined, communicationResolved: false };

      // A to-do Kim typed herself has no email behind it, so there is no
      // conversation to close out alongside it. It simply resolves.
      if (updated.communicationId == null) {
        return { task: updated, communicationResolved: false };
      }

      // Counted inside the same transaction as the sibling updates, so a task
      // resolved concurrently cannot make both calls think they were last.
      const [remaining] = await tx.select({ n: count() }).from(communicationTasks)
        .where(and(
          eq(communicationTasks.communicationId, updated.communicationId),
          inArray(communicationTasks.status, ["OPEN", "TODO"]),
        ));

      let communicationResolved = false;
      if ((remaining?.n ?? 0) === 0) {
        const [comm] = await tx.update(communications).set({
          status: "RESOLVED",
          resolutionType: "RESOLVED",
          resolutionNote: note,
          resolvedAt,
          resolvedBy: user,
        }).where(and(
          eq(communications.id, updated.communicationId),
          eq(communications.status, "ACTIVE"),
        )).returning();
        communicationResolved = !!comm;
      }

      return { task: updated, communicationResolved };
    });
  }

  /**
   * Rewrites drag ordering within one priority section.
   *
   * Only ids that are genuinely TODO at the given priority are touched, so a
   * stale browser payload cannot drag a resolved item back into the list.
   */
  async reorderTodos(priority: string, orderedIds: number[]) {
    if (!orderedIds.length) return 0;
    return db.transaction(async tx => {
      const current = await tx.select({ id: communicationTasks.id }).from(communicationTasks)
        .where(and(
          eq(communicationTasks.status, "TODO"),
          eq(communicationTasks.priority, priority),
        ));

      // The payload must be exactly this section as it stands right now. A
      // browser working from a stale list would otherwise leave the items it
      // never sent sitting on old positions, and the section order would come
      // out as neither drag intended.
      const submitted = new Set(orderedIds);
      const stale = current.length !== submitted.size
        || current.some(t => !submitted.has(t.id));
      if (stale) throw new StaleOrderError();

      let position = 0;
      for (const id of orderedIds) {
        position += 1;
        await tx.update(communicationTasks).set({ sortOrder: position }).where(eq(communicationTasks.id, id));
      }
      return position;
    });
  }

  /**
   * Every task touching this client, read through the join table so a to-do
   * covering two accounts shows on both records rather than only the first.
   */
  async getClientTasks(clientId: number): Promise<DecoratedTask[]> {
    const rows = await db.select({ task: communicationTasks })
      .from(communicationTasks)
      .innerJoin(taskClients, eq(taskClients.taskId, communicationTasks.id))
      .where(eq(taskClients.clientId, clientId))
      .orderBy(asc(communicationTasks.dueDate));
    return this.decorateTasks(rows.map(r => r.task));
  }

  /**
   * The manually captured to-dos on a client record: the phone calls and
   * conversations that never arrived as mail, so have no communication to sit
   * under. Resolved ones come back too, because the note is the point.
   */
  async getClientManualTodos(clientId: number) {
    const rows = await db.select({ task: communicationTasks })
      .from(communicationTasks)
      .innerJoin(taskClients, eq(taskClients.taskId, communicationTasks.id))
      .where(and(
        eq(taskClients.clientId, clientId),
        isNull(communicationTasks.communicationId),
      ));
    const decorated = await this.decorateTasks(rows.map(r => r.task));
    return decorated.sort(compareTodos);
  }

  /**
   * To-dos that belong to the business rather than to any account.
   *
   * Defined by having no client attached at all, whatever the source. Work that
   * came in on unmatched mail and was filed onto the list belongs here too: it
   * is genuinely not on anybody's record.
   */
  async getGeneralTodos(opts: { resolved: boolean }) {
    // Outstanding work is read whole: something Kim has not dealt with is
    // exactly what must not scroll out of view. Resolved history only grows,
    // so it is capped at the most recent stretch of it.
    const base = db.select().from(communicationTasks)
      .where(and(
        eq(communicationTasks.status, opts.resolved ? "RESOLVED" : "TODO"),
        sql`NOT EXISTS (SELECT 1 FROM ${taskClients} WHERE ${taskClients.taskId} = ${communicationTasks.id})`,
      ));

    const rows = opts.resolved
      ? await base.orderBy(desc(communicationTasks.resolvedAt)).limit(200)
      : await base;

    const decorated = await this.decorateTasks(rows);
    return opts.resolved
      ? decorated.sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))
      : decorated.sort(compareTodos);
  }

  async getUnreadCommunicationsCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(communications).where(eq(communications.isUnmatched, true));
    return result?.count ?? 0;
  }

  async getClientsByBrokerFirm(firm: string): Promise<(Client & { plans: Plan[] })[]> {
    const term = `%${firm}%`;
    const matchingClients = await db.select().from(clients)
      .where(ilike(clients.brokerFirmName, term))
      .orderBy(asc(clients.clientName));
    return Promise.all(matchingClients.map(async (c) => {
      const clientPlans = await db.select().from(plans)
        .where(and(eq(plans.clientId, c.id), eq(plans.isArchived, false)))
        .orderBy(asc(plans.effectiveDate));
      return { ...c, plans: clientPlans };
    }));
  }

  /**
   * The brokerage firms already on file, for the firm picker.
   *
   * There is no brokerage table: firm identity lives as text on the clients that
   * carry it, so the list of firms is whatever is already in use. History is folded
   * in as well, otherwise a firm a client has moved away from would vanish from the
   * picker and get retyped as a fresh variant the next time it came up.
   *
   * "N/A" is excluded because it is not a firm, it is how a missing broker was
   * spelled before the flag existed.
   */
  async getBrokerFirms(): Promise<{ name: string; clientCount: number }[]> {
    const inUse = await db.select({
      name: sql<string>`btrim(${clients.brokerFirmName})`,
      clientCount: count(),
    }).from(clients)
      .where(sql`${clients.brokerFirmName} IS NOT NULL AND btrim(${clients.brokerFirmName}) <> ''`)
      .groupBy(sql`btrim(${clients.brokerFirmName})`);

    const historic = await db.selectDistinct({
      name: sql<string>`btrim(${brokerHistory.brokerFirmName})`,
    }).from(brokerHistory)
      .where(sql`${brokerHistory.brokerFirmName} IS NOT NULL AND btrim(${brokerHistory.brokerFirmName}) <> ''`);

    // Keyed case-insensitively so "Hub International" and "HUB International" do not
    // both offer themselves as choices. The spelling carried by the most clients wins
    // the display, because that is the house spelling in practice. Deciding that two
    // similar names are the same firm is a human call and is never done here.
    // clientCount is the total across every spelling; winnerCount is the count behind
    // the spelling currently being displayed. They have to be tracked separately, or
    // comparing the next variant against a running total makes the winner depend on
    // the order the variants arrive in.
    const byKey = new Map<string, { name: string; clientCount: number; winnerCount: number }>();
    for (const row of inUse) {
      const name = (row.name ?? "").trim();
      if (!name || name.toUpperCase() === "N/A") continue;
      const key = name.toLowerCase();
      const clientCount = Number(row.clientCount ?? 0);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { name, clientCount, winnerCount: clientCount });
        continue;
      }
      existing.clientCount += clientCount;
      if (clientCount > existing.winnerCount) {
        existing.name = name;
        existing.winnerCount = clientCount;
      }
    }
    for (const row of historic) {
      const name = (row.name ?? "").trim();
      if (!name || name.toUpperCase() === "N/A") continue;
      const key = name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { name, clientCount: 0, winnerCount: 0 });
    }

    return Array.from(byKey.values())
      .map(({ name, clientCount }) => ({ name, clientCount }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  async getBrokerHistory(clientId: number): Promise<BrokerHistory[]> {
    return db.select().from(brokerHistory)
      .where(eq(brokerHistory.clientId, clientId))
      .orderBy(desc(brokerHistory.effectiveDate));
  }

  async addBrokerChange(clientId: number, newBroker: {
    brokerFirmName: string | null;
    brokerContactName: string | null;
    brokerPhone: string | null;
    brokerEmail: string | null;
    effectiveDate: Date;
  }): Promise<void> {
    const termDate = new Date(newBroker.effectiveDate);
    termDate.setDate(0);

    // One transaction: broker_history, the flat columns on the client and
    // broker_contacts are three descriptions of the same fact. A partial failure here
    // is exactly the drift that keeping two tables invites.
    await db.transaction(async (tx) => {
    const [currentRecord] = await tx.select().from(brokerHistory)
      .where(and(eq(brokerHistory.clientId, clientId), isNull(brokerHistory.terminationDate)))
      .orderBy(desc(brokerHistory.effectiveDate))
      .limit(1);

      const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
      if (!client) throw new Error(`Client ${clientId} not found`);

      if (!currentRecord) {
        if (client.brokerStatus === "BROKER" && (client.brokerFirmName || client.brokerContactName)) {
          // The outgoing broker predates the history table, so its start date is not
          // recorded anywhere. The month the CRM record was created is the usual proxy,
          // but for a book imported after the fact that month is often LATER than the
          // date the broker was retired, which would write a row that ends before it
          // begins. Fall back to the month the relationship ended so the row is a floor
          // on an unknown start rather than a backwards range.
          const d = new Date(client.createdAt);
          const createdMonth = new Date(d.getFullYear(), d.getMonth(), 1);
          const termMonth = new Date(termDate.getFullYear(), termDate.getMonth(), 1);
          const seedDate = createdMonth <= termDate ? createdMonth : termMonth;
          await tx.insert(brokerHistory).values({
            clientId,
            brokerFirmName: client.brokerFirmName,
            brokerContactName: client.brokerContactName,
            brokerPhone: client.brokerPhone,
            brokerEmail: client.brokerEmail,
            effectiveDate: seedDate,
            terminationDate: termDate,
          });
        }
      } else {
        await tx.update(brokerHistory)
          .set({ terminationDate: termDate })
          .where(eq(brokerHistory.id, currentRecord.id));
      }

      await tx.insert(brokerHistory).values({
        clientId,
        brokerFirmName: newBroker.brokerFirmName,
        brokerContactName: newBroker.brokerContactName,
        brokerPhone: newBroker.brokerPhone,
        brokerEmail: newBroker.brokerEmail,
        effectiveDate: newBroker.effectiveDate,
        terminationDate: null,
      });

      await tx.update(clients).set({
        brokerFirmName: newBroker.brokerFirmName,
        brokerContactName: newBroker.brokerContactName,
        brokerPhone: newBroker.brokerPhone,
        brokerEmail: newBroker.brokerEmail,
        brokerStatus: "BROKER",
        updatedAt: new Date(),
      }).where(eq(clients.id, clientId));

      // A change of broker of record replaces the people too. Terminating the outgoing
      // contacts on the same date keeps broker_contacts and broker_history telling the
      // same story — leaving the old firm's staff attached to the new firm is exactly
      // the drift that having two tables invites.
      await tx.update(brokerContacts)
        .set({ terminationDate: termDate, isPrimary: false, updatedAt: new Date() })
        .where(and(eq(brokerContacts.clientId, clientId), isNull(brokerContacts.terminationDate)));

      if (newBroker.brokerContactName || newBroker.brokerEmail) {
        const contactName = newBroker.brokerContactName ?? newBroker.brokerEmail!;
        // The incoming lead may be someone already on file under a past firm — the
        // business key is (client, name), so re-insert would collide. Reinstate instead.
        const [prior] = await tx.select().from(brokerContacts)
          .where(and(
            eq(brokerContacts.clientId, clientId),
            sql`lower(${brokerContacts.contactName}) = lower(${contactName})`,
          ));
        if (prior) {
          await tx.update(brokerContacts).set({
            email: newBroker.brokerEmail,
            phone: newBroker.brokerPhone,
            isPrimary: true,
            effectiveDate: newBroker.effectiveDate,
            terminationDate: null,
            updatedAt: new Date(),
          }).where(eq(brokerContacts.id, prior.id));
        } else {
          await tx.insert(brokerContacts).values({
            clientId,
            contactName,
            email: newBroker.brokerEmail,
            phone: newBroker.brokerPhone,
            isPrimary: true,
            effectiveDate: newBroker.effectiveDate,
          });
        }
      }
    });
  }

  async getBrokerContacts(clientId: number): Promise<BrokerContact[]> {
    return db.select().from(brokerContacts)
      .where(eq(brokerContacts.clientId, clientId))
      .orderBy(desc(brokerContacts.isPrimary), asc(brokerContacts.contactName));
  }

  /**
   * Writes the whole contact set for one client.
   *
   * Rows are matched to existing ones by name so that re-running a corrections file
   * updates the person already on file instead of adding a second copy, and so that
   * effective/termination dates survive an edit that only changed an email.
   *
   * The primary flag is cleared across the client first: the database allows only one
   * serving primary per client, and clearing up front means a swap between two people
   * does not momentarily violate it.
   */
  async replaceBrokerContacts(clientId: number, contacts: BrokerContactInput[]): Promise<BrokerContact[]> {
    return db.transaction(async (tx) => applyBrokerContacts(tx, clientId, contacts));
  }

  /**
   * Every serving broker address per client, for the email matcher. Includes the flat
   * column so a client whose contacts were never populated still contributes its one
   * address rather than dropping out of matching entirely.
   */
  /**
   * Every serving broker contact name, by client.
   *
   * The email matcher works from addresses; a typed to-do works from names,
   * because "Call Annette" is how the work actually gets written down.
   */
  async getBrokerNamesByClient(): Promise<Map<number, string[]>> {
    const rows = await db.select({
      clientId: brokerContacts.clientId,
      contactName: brokerContacts.contactName,
    }).from(brokerContacts).where(isNull(brokerContacts.terminationDate));

    const map = new Map<number, string[]>();
    for (const r of rows) {
      const name = r.contactName?.trim();
      if (!name) continue;
      const list = map.get(r.clientId) ?? [];
      if (!list.some(n => n.toLowerCase() === name.toLowerCase())) list.push(name);
      map.set(r.clientId, list);
    }
    return map;
  }

  async getBrokerEmailsByClient(): Promise<Map<number, string[]>> {
    const rows = await db.select({
      clientId: brokerContacts.clientId,
      email: brokerContacts.email,
    }).from(brokerContacts).where(isNull(brokerContacts.terminationDate));

    const map = new Map<number, string[]>();
    for (const r of rows) {
      const email = r.email?.trim();
      if (!email) continue;
      const list = map.get(r.clientId) ?? [];
      if (!list.some(e => e.toLowerCase() === email.toLowerCase())) list.push(email);
      map.set(r.clientId, list);
    }
    return map;
  }

  // ── Renewal pipeline ────────────────────────────────────────────────────────

  async getRenewalProgress(planId: number): Promise<RenewalProgress | null> {
    throw new Error("Per-plan progress retired. Use the client/year renewal.");
  }

  async upsertRenewalProgress(planId: number, clientId: number, data: Record<string, any>): Promise<RenewalProgress> {
    throw new Error("Per-plan progress retired. Use the client/year renewal.");
  }

  // ── Prospect pipeline ───────────────────────────────────────────────────────

  async getProspectProgress(clientId: number): Promise<any | null> {
    const [row] = await db.select().from(prospectProgress).where(eq(prospectProgress.clientId, clientId));
    return row ?? null;
  }

  async upsertProspectProgress(clientId: number, data: Record<string, any>): Promise<any> {
    const existing = await this.getProspectProgress(clientId);
    if (existing) {
      const [updated] = await db.update(prospectProgress)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(prospectProgress.clientId, clientId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(prospectProgress)
        .values({ clientId, ...data })
        .returning();
      return created;
    }
  }

  // ── Stalled pipelines dashboard ─────────────────────────────────────────────

  async getStalledPipelines(): Promise<any[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    function nextAnniversary(effectiveDate: Date): Date {
      const month = effectiveDate.getMonth();
      let candidate = new Date(todayStart.getFullYear(), month, 1);
      if (candidate <= todayStart) candidate = new Date(todayStart.getFullYear() + 1, month, 1);
      return candidate;
    }

    function subtractMonths(date: Date, n: number): Date {
      const d = new Date(date);
      d.setMonth(d.getMonth() - n);
      return d;
    }

    function daysSince(from: Date): number {
      return Math.floor((todayStart.getTime() - from.getTime()) / 86400000);
    }

    const result: any[] = [];

    const { renewals } = await import("@shared/schema");
    const { renewalSteps, renewalIsComplete } = await import("@shared/renewal-progress");
    const renewalRows = await db.select({ renewal: renewals, client: clients }).from(renewals)
      .innerJoin(clients, eq(clients.id, renewals.clientId));
    for (const { renewal, client } of renewalRows) {
      if (renewal.suppressed || deriveClientState(client) !== "ACTIVE" || renewalIsComplete(renewal)) continue;
      const clockStart = new Date(renewal.updatedAt);
      const daysOverdue = daysSince(clockStart) - 14;
      if (daysOverdue >= 0) result.push({
        type: "renewal", renewalId: renewal.id, clientId: client.id,
        clientName: client.clientName, clientCode: client.clientCode,
        planName: `${renewal.planYear} renewal`,
        step: renewalSteps.find(k => !renewal.steps[k]) ?? "Employee handouts",
        clockStartDate: clockStart.toISOString().slice(0,10), daysOverdue,
      });
    }

    // Prospect pipeline — PROSPECT clients
    const prospectRows = await db
      .select({ client: clients, prog: prospectProgress })
      .from(clients)
      .leftJoin(prospectProgress, eq(prospectProgress.clientId, clients.id))
      .where(eq(clients.clientStatus, "PROSPECT" as any));

    for (const { client, prog } of prospectRows) {
      if (!prog?.step1Date) continue;
      if (prog.step3Date) continue;

      const stepSeq = [
        { label: "New Proposal Requested", date: prog.step1Date },
        { label: "Proposal Received",      date: prog.step2Date ?? null },
        { label: "Proposal Sent",          date: prog.step3Date ?? null },
      ];

      const currentIdx = stepSeq.findIndex(s => !s.date);
      if (currentIdx <= 0) continue;

      const prevDate = stepSeq[currentIdx - 1].date;
      if (!prevDate) continue;
      const clockStart = new Date(prevDate);

      const stalledDays = daysSince(clockStart) - 14;
      if (stalledDays >= 0) {
        result.push({
          type: "prospect",
          clientId: client.id,
          clientName: client.clientName,
          clientCode: client.clientCode,
          planName: null,
          step: stepSeq[currentIdx].label,
          clockStartDate: clockStart.toISOString().split("T")[0],
          daysOverdue: stalledDays,
        });
      }
    }

    return result.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  // ── Plan performance facts ──────────────────────────────────────────────────

  async insertPlanPerformanceFact(data: InsertPlanPerformanceFacts): Promise<PlanPerformanceFacts> {
    const [row] = await db.insert(planPerformanceFacts).values(data).returning();
    return row;
  }

  async supersedePlanPerformanceFact(id: number): Promise<void> {
    await db.update(planPerformanceFacts)
      .set({ supersededAt: new Date() })
      .where(eq(planPerformanceFacts.id, id));
  }

  async getCurrentFactsForClient(clientId: number): Promise<PlanPerformanceFacts[]> {
    return db.select().from(planPerformanceFacts)
      .where(and(eq(planPerformanceFacts.clientId, clientId), isNull(planPerformanceFacts.supersededAt)))
      .orderBy(asc(planPerformanceFacts.reportYear), asc(planPerformanceFacts.reportMonth));
  }

  async getCurrentFactsForPlan(planId: number): Promise<PlanPerformanceFacts[]> {
    return db.select().from(planPerformanceFacts)
      .where(and(eq(planPerformanceFacts.planId, planId), isNull(planPerformanceFacts.supersededAt)))
      .orderBy(asc(planPerformanceFacts.reportYear), asc(planPerformanceFacts.reportMonth));
  }

  async getAllCurrentFacts(): Promise<PlanPerformanceFacts[]> {
    return db.select().from(planPerformanceFacts)
      .where(isNull(planPerformanceFacts.supersededAt));
  }

  async getCurrentFactByKey(clientId: number, planId: number, month: number, year: number): Promise<PlanPerformanceFacts | null> {
    const [row] = await db.select().from(planPerformanceFacts)
      .where(and(
        eq(planPerformanceFacts.clientId, clientId),
        eq(planPerformanceFacts.planId, planId),
        eq(planPerformanceFacts.reportMonth, month),
        eq(planPerformanceFacts.reportYear, year),
        isNull(planPerformanceFacts.supersededAt),
      ));
    return row ?? null;
  }

  async getAllActivePlans(): Promise<Plan[]> {
    return db.select().from(plans).where(eq(plans.isArchived, false)).orderBy(asc(plans.clientId));
  }

  // ── PPR import batches ──────────────────────────────────────────────────────

  async createPprImportBatch(data: InsertPprImportBatch): Promise<PprImportBatch> {
    const [row] = await db.insert(pprImportBatches).values(data).returning();
    return row;
  }

  async updatePprImportBatch(id: number, data: Partial<InsertPprImportBatch>): Promise<PprImportBatch | undefined> {
    const [row] = await db.update(pprImportBatches).set(data).where(eq(pprImportBatches.id, id)).returning();
    return row;
  }

  async getPprImportBatches(): Promise<PprImportBatch[]> {
    return db.select().from(pprImportBatches).orderBy(desc(pprImportBatches.uploadedAt));
  }

  async getPprImportBatch(id: number): Promise<PprImportBatch | undefined> {
    const [row] = await db.select().from(pprImportBatches).where(eq(pprImportBatches.id, id));
    return row;
  }

  // ── PPR held rows ───────────────────────────────────────────────────────────

  async createPprHeldRow(data: InsertPprHeldRow): Promise<PprHeldRow> {
    const [row] = await db.insert(pprHeldRows).values(data).returning();
    return row;
  }

  async getPprHeldRows(batchId?: number): Promise<PprHeldRow[]> {
    if (batchId !== undefined) {
      return db.select().from(pprHeldRows)
        .where(eq(pprHeldRows.batchId, batchId))
        .orderBy(asc(pprHeldRows.createdAt));
    }
    return db.select().from(pprHeldRows).orderBy(desc(pprHeldRows.createdAt));
  }

  async updatePprHeldRow(id: number, data: Partial<PprHeldRow>): Promise<PprHeldRow | undefined> {
    const [row] = await db.update(pprHeldRows).set(data as any).where(eq(pprHeldRows.id, id)).returning();
    return row;
  }

  // ── Gmail inbox (full mail, not just attachment backfill) ───────────────────

  async getGmailThreadByGmailId(gmailThreadId: string): Promise<GmailThread | undefined> {
    const [row] = await db.select().from(gmailThreads).where(eq(gmailThreads.gmailThreadId, gmailThreadId));
    return row;
  }

  /** Same race as createGmailMessage: two runs can reach a brand-new thread's first message together, so losing the insert returns the winner's row. */
  async createGmailThreadTolerant(data: InsertGmailThread): Promise<GmailThread> {
    const [row] = await db.insert(gmailThreads).values(data as any).onConflictDoNothing().returning();
    if (row) return row;
    const existing = await this.getGmailThreadByGmailId((data as any).gmailThreadId);
    if (existing) return existing;
    throw new Error(`Gmail thread ${(data as any).gmailThreadId} could not be inserted and does not exist`);
  }

  async createGmailThread(data: InsertGmailThread): Promise<GmailThread> {
    const [row] = await db.insert(gmailThreads).values(data).returning();
    return row;
  }

  async updateGmailThread(id: number, data: Partial<InsertGmailThread>): Promise<GmailThread | undefined> {
    const [row] = await db.update(gmailThreads).set(data as any).where(eq(gmailThreads.id, id)).returning();
    return row;
  }

  async getGmailMessageByGmailId(gmailMessageId: string): Promise<GmailMessage | undefined> {
    const [row] = await db.select().from(gmailMessages).where(eq(gmailMessages.gmailMessageId, gmailMessageId));
    return row;
  }

  /** True when a previous pass already looked at this Gmail id and decided not to store it (allow-list). One indexed lookup instead of downloading the message again to reach the same verdict. */
  async isGmailMessageSkipped(gmailMessageId: string): Promise<boolean> {
    const [row] = await db.select({ id: gmailSkippedMessages.id }).from(gmailSkippedMessages)
      .where(eq(gmailSkippedMessages.gmailMessageId, gmailMessageId));
    return !!row;
  }

  /** Records a skip. ON CONFLICT DO NOTHING because two mailboxes' runs can reach the same id, and a re-walk can reach it again before the first row is visible. */
  async recordSkippedGmailMessage(mailbox: string, gmailMessageId: string, reason = "NOT_ALLOWLISTED"): Promise<void> {
    await db.execute(sql`
      INSERT INTO gmail_skipped_messages (mailbox, gmail_message_id, reason)
      VALUES (${mailbox}, ${gmailMessageId}, ${reason})
      ON CONFLICT (gmail_message_id) DO NOTHING
    `);
  }

  /**
   * Forgets every recorded skip and sends the mailboxes back for a fresh walk.
   *
   * Called when the allow-list changes: a skip is a verdict reached under the
   * old rules, and a newly approved domain has to be able to pull in mail that
   * was previously passed over. The next walk re-downloads those messages once
   * to judge them again, which is the price of the rules having changed.
   */
  async forgetGmailSkipsAndRewalk(): Promise<{ skipsCleared: number; mailboxesReset: number }> {
    const cleared: any = await db.execute(sql`DELETE FROM gmail_skipped_messages`);
    const reset: any = await db.execute(sql`
      UPDATE gmail_import_state
         SET caught_up_at = NULL, walk_started_at = NULL, last_processed_internal_date = NULL, walk_failures = 0
       WHERE mailbox LIKE '%#full' AND run_state <> 'RUNNING'
    `);
    return {
      skipsCleared: cleared?.rowCount ?? 0,
      mailboxesReset: reset?.rowCount ?? 0,
    };
  }

  /** Cross-mailbox dedupe: the same email seen via two connected mailboxes (Steve CCs clientservice@, or a message lands in both Kim's and clientservice@'s mailbox) has two different Gmail message ids but one Message-ID header. */
  async getGmailMessageByMessageIdHeader(messageIdHeader: string): Promise<GmailMessage | undefined> {
    const [row] = await db.select().from(gmailMessages).where(eq(gmailMessages.messageIdHeader, messageIdHeader));
    return row;
  }

  async getCommunicationByMessageIdHeader(messageIdHeader: string): Promise<Communication | undefined> {
    const [row] = await db.select().from(communications).where(eq(communications.messageIdHeader, messageIdHeader));
    return row;
  }

  /**
   * Conflict-tolerant insert. The sync checks getGmailMessageByGmailId before
   * calling this, and that check is still the primary dedupe — but a
   * check-then-insert cannot survive two runs working the same page at once,
   * which is exactly what produced the duplicate-key errors in production.
   * The single-flight guard is the fix; this is the safety net, so a race
   * returns the existing row instead of throwing.
   */
  async createGmailMessage(data: InsertGmailMessage): Promise<{ message: GmailMessage; created: boolean }> {
    const [row] = await db.insert(gmailMessages).values(data).onConflictDoNothing().returning();
    if (row) return { message: row, created: true };
    // Lost the race on the Gmail id: another run stored this exact message
    // moments ago. The caller must not treat it as new — filing, extraction
    // and counting have already happened (or are happening) on that run.
    const existing = await this.getGmailMessageByGmailId((data as any).gmailMessageId);
    if (existing) return { message: existing, created: false };
    // Lost to the partial unique index on message_id_header instead: the same
    // email reached two connected mailboxes and the other copy won the race.
    // The sync already has a counter for that case, so it is signalled rather
    // than reported as an error.
    const header = (data as any).messageIdHeader;
    if (header) {
      const crossMailbox = await this.getGmailMessageByMessageIdHeader(header);
      if (crossMailbox) throw new DuplicateMessageHeaderError((data as any).gmailMessageId);
    }
    // No row inserted and none found: a constraint other than the id keys
    // rejected this, and swallowing that would hide a real data problem.
    throw new Error(`Gmail message ${(data as any).gmailMessageId} could not be inserted and does not exist`);
  }

  /** One stored message by our own id — what Reply and Forward anchor to, so threading follows the message the sender was actually looking at. */
  async getGmailMessageById(id: number): Promise<GmailMessage | undefined> {
    const [row] = await db.select().from(gmailMessages).where(eq(gmailMessages.id, id));
    return row;
  }

  async getGmailMessagesForThread(threadId: number): Promise<GmailMessage[]> {
    return db.select().from(gmailMessages).where(eq(gmailMessages.threadId, threadId)).orderBy(asc(gmailMessages.sentAt));
  }

  // ── Stored vs sorted ────────────────────────────────────────────────────────
  // Storing a message and sorting its thread are two separate facts, tracked
  // separately, because a run that dies between them used to leave the thread
  // unsorted forever: the messages existed, so every later run skipped them.

  /** Marks a thread as having new mail that has not been through the sorting pass. Called as each message is stored. */
  async markGmailThreadNeedsSorting(threadId: number): Promise<void> {
    await db.update(gmailThreads).set({ needsSorting: true } as any).where(eq(gmailThreads.id, threadId));
  }

  /**
   * Clears the flag, but only if every message on the thread that needs an
   * action-item decision has one. The condition is evaluated in the database,
   * in the same statement, which is what makes it safe against the two ways
   * the flag could otherwise be cleared over unsorted mail: a message whose
   * extraction failed mid-pass, and new mail stored by another run while this
   * pass was working the thread. Either leaves the thread queued.
   *
   * Returns false when the thread stayed flagged.
   */
  async markGmailThreadSortedIfComplete(threadId: number): Promise<boolean> {
    const result: any = await db.execute(sql`
      UPDATE gmail_threads SET needs_sorting = false, sorted_at = now()
      WHERE id = ${threadId}
        AND NOT EXISTS (
          SELECT 1 FROM gmail_messages m
          WHERE m.thread_id = ${threadId}
            AND m.direction = 'RECEIVED'
            AND m.is_historical_import = false
            AND m.triage_extracted_at IS NULL
        )
      RETURNING id
    `);
    return (result.rowCount ?? result.rows?.length ?? 0) > 0;
  }

  /** Threads carrying stored-but-unsorted mail, newest first so recent (operationally relevant) mail is recovered before a year-old backlog. */
  async getThreadsNeedingSorting(limit: number, mailbox?: string): Promise<GmailThread[]> {
    const where = mailbox
      ? and(eq(gmailThreads.needsSorting, true), eq(gmailThreads.mailbox, mailbox))
      : eq(gmailThreads.needsSorting, true);
    return db.select().from(gmailThreads).where(and(where, eq(gmailThreads.mailbox, SYNC_MAILBOX))).orderBy(desc(gmailThreads.latestMessageAt)).limit(limit);
  }

  async countThreadsNeedingSorting(mailbox?: string): Promise<number> {
    const where = mailbox
      ? and(eq(gmailThreads.needsSorting, true), eq(gmailThreads.mailbox, mailbox))
      : eq(gmailThreads.needsSorting, true);
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(gmailThreads).where(and(where, eq(gmailThreads.mailbox, SYNC_MAILBOX)));
    return row?.n ?? 0;
  }

  /** Received, non-historical messages on a thread whose action-item extraction decision has not been made yet. Survives an interrupted run; the in-memory list did not. */
  async getMessagesAwaitingExtraction(threadId: number): Promise<GmailMessage[]> {
    return db.select().from(gmailMessages)
      .where(and(
        eq(gmailMessages.threadId, threadId),
        eq(gmailMessages.direction, "RECEIVED"),
        eq(gmailMessages.isHistoricalImport, false),
        isNull(gmailMessages.triageExtractedAt),
      ))
      .orderBy(asc(gmailMessages.sentAt));
  }

  /** Records that extraction has made its decision about these messages — tasks created or deliberately none. */
  async markMessagesTriageExtracted(messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return;
    await db.update(gmailMessages).set({ triageExtractedAt: new Date() } as any).where(inArray(gmailMessages.id, messageIds));
  }

  async setGmailThreadClients(threadId: number, matches: { clientId: number; confidence: string }[]): Promise<void> {
    await db.delete(gmailThreadClients).where(eq(gmailThreadClients.threadId, threadId));
    if (matches.length === 0) return;
    await db.insert(gmailThreadClients).values(
      matches.map((m) => ({ threadId, clientId: m.clientId, matchConfidence: m.confidence })),
    );
  }

  async getGmailThreadClientIds(threadId: number): Promise<number[]> {
    const rows = await db.select({ clientId: gmailThreadClients.clientId }).from(gmailThreadClients).where(eq(gmailThreadClients.threadId, threadId));
    return rows.map((r) => r.clientId);
  }

  async createGmailAttachment(data: InsertGmailAttachment): Promise<GmailAttachment> {
    const [row] = await db.insert(gmailAttachments).values(data).returning();
    return row;
  }

  async getGmailAttachmentsForMessages(messageIds: number[]): Promise<GmailAttachment[]> {
    if (messageIds.length === 0) return [];
    return db.select().from(gmailAttachments).where(inArray(gmailAttachments.messageId, messageIds));
  }

  async getGmailAttachmentByGmailIds(gmailMessageId: string, gmailAttachmentId: string): Promise<GmailAttachment | undefined> {
    const [msg] = await db.select().from(gmailMessages).where(eq(gmailMessages.gmailMessageId, gmailMessageId));
    if (!msg) return undefined;
    const [row] = await db.select().from(gmailAttachments)
      .where(and(eq(gmailAttachments.messageId, msg.id), eq(gmailAttachments.gmailAttachmentId, gmailAttachmentId)));
    return row;
  }

  /**
   * Filters/searches threads. `viewerIsAdmin` gates private-thread visibility —
   * every non-admin caller (search, counts, list, summaries) goes through this
   * one predicate so a private thread cannot leak through a code path that
   * forgot to check.
   */
  async searchGmailThreads(params: {
    viewerIsAdmin: boolean;
    view?: "matched" | "unassigned" | "not_business" | "all";
    clientId?: number;
    personEmail?: string;
    domain?: string;
    text?: string;
    /** When true, `text` also matches quoted history, not just each message's new part. */
    includeQuoted?: boolean;
    dateFrom?: Date;
    dateTo?: Date;
    direction?: "sent" | "received";
    hasAttachment?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ threads: GmailThread[]; total: number }> {
    const conditions: any[] = [];
    if (!params.viewerIsAdmin) conditions.push(eq(gmailThreads.isPrivate, false));
    if (params.view === "matched") conditions.push(eq(gmailThreads.businessStatus, "MATCHED"));
    else if (params.view === "unassigned") conditions.push(eq(gmailThreads.businessStatus, "UNASSIGNED"));
    else if (params.view === "not_business") conditions.push(eq(gmailThreads.businessStatus, "NOT_BUSINESS"));
    if (params.dateFrom) conditions.push(gte(gmailThreads.latestMessageAt, params.dateFrom));
    if (params.dateTo) conditions.push(lte(gmailThreads.latestMessageAt, params.dateTo));

    if (params.clientId !== undefined) {
      const threadIds = await db.select({ threadId: gmailThreadClients.threadId }).from(gmailThreadClients)
        .where(eq(gmailThreadClients.clientId, params.clientId));
      const ids = threadIds.map((t) => t.threadId);
      if (ids.length === 0) return { threads: [], total: 0 };
      conditions.push(inArray(gmailThreads.id, ids));
    }

    if (params.personEmail || params.domain || params.direction || params.hasAttachment !== undefined || params.text) {
      const msgConditions: any[] = [];
      if (params.personEmail) {
        const p = params.personEmail.toLowerCase();
        msgConditions.push(or(
          eq(gmailMessages.fromEmail, p),
          sql`${gmailMessages.toEmails}::text ILIKE ${"%" + p + "%"}`,
          sql`${gmailMessages.ccEmails}::text ILIKE ${"%" + p + "%"}`,
        ));
      }
      if (params.domain) {
        const d = params.domain.toLowerCase();
        msgConditions.push(or(
          sql`${gmailMessages.fromEmail} ILIKE ${"%@" + d}`,
          sql`${gmailMessages.toEmails}::text ILIKE ${"%@" + d + "%"}`,
          sql`${gmailMessages.ccEmails}::text ILIKE ${"%@" + d + "%"}`,
        ));
      }
      if (params.direction === "sent") msgConditions.push(eq(gmailMessages.direction, "SENT"));
      if (params.direction === "received") msgConditions.push(eq(gmailMessages.direction, "RECEIVED"));
      if (params.hasAttachment) msgConditions.push(eq(gmailMessages.hasAttachments, true));
      if (params.text) {
        const term = `%${params.text}%`;
        // Default: search each message's new text only (forwards already
        // carry their full content in bodyTextNew), so one old quoted
        // sentence doesn't surface every reply in a long thread. Opt into
        // matching quoted history too via includeQuoted.
        msgConditions.push(or(
          ilike(gmailMessages.subject, term),
          ilike(gmailMessages.bodyTextNew, term),
          ...(params.includeQuoted ? [ilike(gmailMessages.bodyText, term)] : []),
        ));
      }
      const matchingThreadIds = await db.selectDistinct({ threadId: gmailMessages.threadId }).from(gmailMessages)
        .where(and(...msgConditions));
      const ids = matchingThreadIds.map((t) => t.threadId);
      if (ids.length === 0) return { threads: [], total: 0 };
      conditions.push(inArray(gmailThreads.id, ids));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ value: total }] = await db.select({ value: count() }).from(gmailThreads).where(whereClause as any);
    const threads = await db.select().from(gmailThreads)
      .where(whereClause as any)
      .orderBy(desc(gmailThreads.latestMessageAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0);
    return { threads, total: Number(total) };
  }

  async getGmailInboxCounts(viewerIsAdmin: boolean): Promise<{ matched: number; unassigned: number; notBusiness: number; total: number }> {
    const base = viewerIsAdmin ? undefined : eq(gmailThreads.isPrivate, false);
    const rows = await db.select({ status: gmailThreads.businessStatus, value: count() }).from(gmailThreads)
      .where(base as any)
      .groupBy(gmailThreads.businessStatus);
    const result = { matched: 0, unassigned: 0, notBusiness: 0, total: 0 };
    for (const r of rows) {
      const n = Number(r.value);
      result.total += n;
      if (r.status === "MATCHED") result.matched = n;
      else if (r.status === "UNASSIGNED") result.unassigned = n;
      else if (r.status === "NOT_BUSINESS") result.notBusiness = n;
    }
    return result;
  }

  async getDistinctGmailDomains(): Promise<string[]> {
    const rows = await db.execute<{ domain: string }>(sql`
      SELECT DISTINCT lower(split_part(from_email, '@', 2)) AS domain FROM gmail_messages
      WHERE from_email LIKE '%@%' ORDER BY 1
    `);
    return (rows.rows as any[]).map((r) => r.domain).filter(Boolean);
  }

  async getGmailThread(id: number): Promise<GmailThread | undefined> {
    const [row] = await db.select().from(gmailThreads).where(eq(gmailThreads.id, id));
    return row;
  }

  async assignGmailThreadToClient(threadId: number, clientId: number, byUser: string): Promise<void> {
    await db.insert(gmailThreadClients).values({ threadId, clientId, matchConfidence: "manual" });
    await db.update(gmailThreads).set({ businessStatus: "MATCHED" }).where(eq(gmailThreads.id, threadId));
  }

  async setGmailThreadPrivate(threadId: number, isPrivate: boolean): Promise<void> {
    await db.update(gmailThreads).set({ isPrivate }).where(eq(gmailThreads.id, threadId));
  }

  /** Computes the new-text/quoted-history split for any Gmail message imported before that split existed. Idempotent — only touches rows where body_text_new is still null. */
  async backfillGmailQuoteSplits(): Promise<number> {
    const { splitQuotedText } = await import("./gmailQuoteStrip");
    const rows = await db.select({ id: gmailMessages.id, bodyText: gmailMessages.bodyText, subject: gmailMessages.subject })
      .from(gmailMessages)
      .where(sql`${gmailMessages.bodyTextNew} IS NULL AND ${gmailMessages.threadId} IN (SELECT id FROM gmail_threads WHERE mailbox = ${SYNC_MAILBOX})`);
    for (const row of rows) {
      const split = splitQuotedText(row.bodyText, row.subject);
      await db.update(gmailMessages).set({
        bodyTextNew: split.newText,
        hasQuotedText: split.hasQuotedText,
        isForward: split.isForward,
      }).where(eq(gmailMessages.id, row.id));
    }
    return rows.length;
  }

  /** Deletes the signature-logo/icon documents the first attachment-only backfill filed as real documents, and their filing records. Idempotent — matches by name pattern, safe to re-run. */
  async cleanupEmbeddedImageDocuments(): Promise<{ deleted: number; documentIds: number[] }> {
    const pattern = sql`(
      document_name ~* '^image[0-9]*\.(png|jpe?g|gif)$'
      OR document_name ~* '^icon[0-9]*\.(png|jpe?g)$'
      OR document_name ~* '^warning_triangle'
      OR document_name ~* '^~wrd[0-9]*\.'
      OR document_name ~* '^cc-district_'
    )`;
    const rows = await db.execute<{ id: number }>(sql`
      SELECT id FROM documents WHERE source_gmail_message_id IS NOT NULL AND ${pattern} AND ${maintainableDocument}
    `);
    const ids: number[] = (rows.rows as any[]).map((r) => r.id);
    if (ids.length === 0) return { deleted: 0, documentIds: [] };
    await db.update(communicationAttachments).set({ filedAsDocumentId: null }).where(inArray(communicationAttachments.filedAsDocumentId, ids));
    await db.delete(documentFieldProposals).where(inArray(documentFieldProposals.documentId, ids));
    await db.delete(documents).where(inArray(documents.id, ids));
    return { deleted: ids.length, documentIds: ids };
  }

  // ── Sending identities & per-user send permissions ──────────────────────

  async getAllSendingIdentities(): Promise<SendingIdentity[]> {
    return db.select().from(sendingIdentities).orderBy(asc(sendingIdentities.email));
  }

  async getSendingIdentity(id: number): Promise<SendingIdentity | undefined> {
    const [row] = await db.select().from(sendingIdentities).where(eq(sendingIdentities.id, id));
    return row;
  }

  async getSendingIdentityByEmail(email: string): Promise<SendingIdentity | undefined> {
    const [row] = await db.select().from(sendingIdentities).where(eq(sendingIdentities.email, email.toLowerCase()));
    return row;
  }

  async createSendingIdentity(data: InsertSendingIdentity): Promise<SendingIdentity> {
    const [row] = await db.insert(sendingIdentities).values({ ...data, email: data.email.toLowerCase() }).returning();
    return row;
  }

  async updateSendingIdentitySignature(id: number, signature: string): Promise<SendingIdentity | undefined> {
    const [row] = await db.update(sendingIdentities).set({ signature }).where(eq(sendingIdentities.id, id)).returning();
    return row;
  }

  /** Identities a given user is permitted to send as. The permission check itself lives in this table, never in an if/else on name or role. */
  async getSendingIdentitiesForUser(userId: number): Promise<SendingIdentity[]> {
    const rows = await db.select({ identity: sendingIdentities })
      .from(userSendingIdentities)
      .innerJoin(sendingIdentities, eq(userSendingIdentities.sendingIdentityId, sendingIdentities.id))
      .where(and(eq(userSendingIdentities.userId, userId), eq(sendingIdentities.isActive, true)));
    return rows.map(r => r.identity);
  }

  async userMaySendAs(userId: number, identityEmail: string): Promise<boolean> {
    const [row] = await db.select({ id: userSendingIdentities.id })
      .from(userSendingIdentities)
      .innerJoin(sendingIdentities, eq(userSendingIdentities.sendingIdentityId, sendingIdentities.id))
      .where(and(
        eq(userSendingIdentities.userId, userId),
        eq(sendingIdentities.isActive, true),
        eq(sendingIdentities.email, identityEmail.toLowerCase()),
      ));
    return !!row;
  }

  /** Full permission matrix for the admin settings screen: every user paired with the identity ids they may send as. */
  async getAllUserSendingIdentities(): Promise<UserSendingIdentity[]> {
    return db.select().from(userSendingIdentities);
  }

  /** Replaces one user's entire permitted-identity set in a single transaction, so a partial save never leaves them with zero or duplicate rows. */
  async setUserSendingIdentities(userId: number, identityIds: number[]): Promise<void> {
    await db.transaction(async tx => {
      await tx.delete(userSendingIdentities).where(eq(userSendingIdentities.userId, userId));
      if (identityIds.length === 0) return;
      await tx.insert(userSendingIdentities).values(identityIds.map(sendingIdentityId => ({ userId, sendingIdentityId })));
    });
  }

  /**
   * Logs a message the CRM actually sent through Mailgun. Auto-resolved on
   * creation (status RESOLVED) — an outbound message is already-actioned by
   * definition and must not show up in the ACTIVE triage feed asking someone
   * to work it.
   */
  async createOutboundCommunication(data: {
    subject: string | null;
    fromEmail: string;
    fromName: string;
    to: string[];
    bodyText: string;
    replyToEmail: string | null;
    sentByUserId: number;
    sentByUserName: string;
    clientIds: number[];
  }): Promise<Communication> {
    const domain = data.fromEmail.split("@")[1]?.toLowerCase() || null;
    const [comm] = await db.insert(communications).values({
      subject: data.subject || "(no subject)",
      senderEmail: data.fromEmail.toLowerCase(),
      senderName: data.fromName,
      senderDomain: domain,
      bodyText: data.bodyText,
      bodyHtml: null,
      isInternal: false,
      isUnmatched: data.clientIds.length === 0,
      source: "sent",
      direction: "OUTBOUND",
      recipientEmails: data.to.map(e => e.toLowerCase()),
      replyToEmail: data.replyToEmail,
      sentByUserId: data.sentByUserId,
      sentByUserName: data.sentByUserName,
      status: "RESOLVED",
      resolutionType: "SENT",
      resolutionNote: `Sent by ${data.sentByUserName}.`,
      resolvedAt: new Date(),
      resolvedBy: data.sentByUserName,
    }).returning();
    if (data.clientIds.length > 0) {
      await this.assignCommunicationToClients(comm.id, data.clientIds.map(clientId => ({ clientId, confidence: "manual" })));
    }
    return comm;
  }

  // ── Documents offered on a send ─────────────────────────────────────────────

  /**
   * The client's current document of each kind — what "attach the SPD" means
   * when three SPDs have been filed over two years. Superseded and older
   * versioned rows stay in the database and on the Documents tab; they are
   * simply not what a send offers by default.
   */
  async getCurrentDocumentsForClient(clientId: number): Promise<Document[]> {
    return db.select().from(documents)
      .where(and(eq(documents.clientId, clientId), eq(documents.isCurrent, true)))
      .orderBy(desc(documents.uploadedAt));
  }

  async getGlobalDocuments(includeSuperseded = false): Promise<GlobalDocument[]> {
    const rows = await db.select().from(globalDocuments).orderBy(desc(globalDocuments.uploadedAt));
    return includeSuperseded ? rows : rows.filter((d) => d.isCurrent);
  }

  async getGlobalDocument(id: number): Promise<GlobalDocument | undefined> {
    const [row] = await db.select().from(globalDocuments).where(eq(globalDocuments.id, id));
    return row;
  }

  /** A re-upload under the same name supersedes the old one rather than replacing it, so a message sent last month can still be traced to the file that actually went. */
  async createGlobalDocument(data: InsertGlobalDocument): Promise<GlobalDocument> {
    await db.update(globalDocuments).set({ isCurrent: false })
      .where(and(eq(globalDocuments.name, data.name), eq(globalDocuments.isCurrent, true)));
    const [row] = await db.insert(globalDocuments).values(data).returning();
    return row;
  }

  // ── Outbound mail, recorded where the rest of the mail lives ───────────────

  /**
   * Files a message the CRM just sent into the Gmail-native tables, so the
   * reply appears in the thread immediately instead of waiting for the next
   * sync to notice our own Sent folder.
   *
   * Conflict-tolerant on purpose: sync may reach the same message first (it
   * is in the sender's Sent folder the moment Gmail accepts it), and losing
   * that race must not turn a successful send into an error the sender sees.
   */
  async recordOutboundGmailMessage(data: {
    gmailMessageId: string;
    gmailThreadId: string;
    mailbox: string;
    fromEmail: string;
    fromName: string;
    toEmails: string[];
    ccEmails: string[];
    subject: string | null;
    bodyText: string;
    messageIdHeader: string | null;
    sentByUserId: number;
    sentByUserName: string;
    clientIds: number[];
  }): Promise<{ threadId: number; messageId: number | null }> {
    const sentAt = new Date();
    let thread = await this.getGmailThreadByGmailId(data.gmailThreadId);
    if (!thread) {
      thread = await this.createGmailThreadTolerant({
        gmailThreadId: data.gmailThreadId,
        mailbox: data.mailbox,
        subject: data.subject,
        latestMessageAt: sentAt,
        messageCount: 0,
        // A thread we started by sending is business by definition, and it is
        // linked to whichever clients the composer was opened from.
        businessStatus: data.clientIds.length > 0 ? "MATCHED" : "UNASSIGNED",
      } as any);
    }
    if (data.clientIds.length > 0) {
      const existing = await this.getGmailThreadClientIds(thread.id);
      const missing = data.clientIds.filter((id) => !existing.includes(id));
      if (missing.length > 0) {
        await this.setGmailThreadClients(thread.id, [
          ...existing.map((clientId) => ({ clientId, confidence: "manual" })),
          ...missing.map((clientId) => ({ clientId, confidence: "manual" })),
        ]);
      }
    }
    let messageId: number | null = null;
    try {
      const { message } = await this.createGmailMessage({
        gmailMessageId: data.gmailMessageId,
        threadId: thread.id,
        mailbox: data.mailbox,
        fromEmail: data.fromEmail.toLowerCase(),
        fromName: data.fromName,
        toEmails: data.toEmails.map((e) => e.toLowerCase()),
        ccEmails: data.ccEmails.map((e) => e.toLowerCase()),
        subject: data.subject,
        bodyText: data.bodyText,
        bodyTextNew: data.bodyText,
        hasQuotedText: false,
        isForward: false,
        sentAt,
        direction: "SENT",
        hasAttachments: false,
        messageIdHeader: data.messageIdHeader,
        // Our own send has no action items to extract — the decision is made
        // here rather than left for the sorting pass to reconsider forever.
        triageExtractedAt: sentAt,
        sentByUserId: data.sentByUserId,
        sentByUserName: data.sentByUserName,
      } as any);
      messageId = message.id;
    } catch {
      // Sync got there first, or the same Message-ID already exists from
      // another connected mailbox. Either way the message is stored.
    }
    await this.updateGmailThread(thread.id, {
      latestMessageAt: sentAt,
      messageCount: (await this.getGmailMessagesForThread(thread.id)).length,
    } as any);
    return { threadId: thread.id, messageId };
  }
}

export const storage = new DatabaseStorage();
