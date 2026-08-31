import { db } from "./db";
import { eq, and, ilike, sql, desc, asc, count, inArray, isNull, or, gte, lte } from "drizzle-orm";
import {
  users, clients, plans, rateCards, planTiers, documents, issues, pprUploads, pprMetrics, auditLogs,
  communications, communicationClients, communicationAttachments, communicationTasks, taskClients, brokerHistory, brokerContacts,
  renewalProgress, prospectProgress, planPerformanceFacts, pprImportBatches, pprHeldRows,
  type RenewalProgress,
  type User, type InsertUser,
  type Client, type InsertClient,
  type Plan, type InsertPlan,
  type PlanTier,
  type RateCard, type InsertRateCard,
  type Document, type InsertDocument,
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
} from "@shared/schema";
import { countsAsActive, deriveClientState } from "@shared/client-state";
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
  moveTaskToTodo(id: number, priority: string): Promise<CommunicationTask | undefined>;
  resolveCommunicationTask(id: number, note: string, user: string): Promise<{ task: CommunicationTask | undefined; communicationResolved: boolean }>;
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
    const [created] = await db.insert(plans).values(plan).returning();
    return created;
  }

  async updatePlan(id: number, data: Partial<InsertPlan>): Promise<Plan | undefined> {
    const [updated] = await db.update(plans).set({ ...data, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
    return updated;
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

  async createDocument(doc: InsertDocument): Promise<Document> {
    const [created] = await db.insert(documents).values(doc).returning();
    return created;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
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
    // Only genuinely active clients have a renewal to chase. A client with a
    // known departure drops off this list immediately, even though it stays
    // active everywhere else.
    const activeClients = (await db.select().from(clients))
      .filter((c) => deriveClientState(c) === "ACTIVE");
    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const result: any[] = [];
    for (const client of activeClients) {
      const clientPlans = await db.select().from(plans).where(and(eq(plans.clientId, client.id), eq(plans.isArchived, false)));
      for (const plan of clientPlans) {
        const eff = new Date(plan.effectiveDate);
        // Compute next anniversary on or after today
        let nextYear = todayMidnight.getFullYear();
        let candidate = new Date(nextYear, eff.getMonth(), eff.getDate());
        if (candidate < todayMidnight) {
          candidate = new Date(nextYear + 1, eff.getMonth(), eff.getDate());
        }
        const renewalDate = candidate;
        const dueDate = new Date(renewalDate);
        dueDate.setMonth(dueDate.getMonth() - (plan.renewalDueMonthsBefore || 3));
        const daysUntilDue = Math.ceil((dueDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
        const daysUntilRenewal = Math.ceil((renewalDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
        let status: string;
        if (plan.isRenewalComplete && plan.renewalCompletedDate) {
          const daysSince = Math.ceil((todayMidnight.getTime() - new Date(plan.renewalCompletedDate).getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince > 30) continue;
          status = "completed";
        } else if (plan.isRenewalComplete) {
          continue;
        } else if (daysUntilDue < 0) {
          status = "overdue";
        } else if (daysUntilDue <= 30) {
          status = "due-soon";
        } else {
          status = "ok";
        }
        result.push({
          ...plan,
          clientName: client.clientName,
          clientCode: client.clientCode,
          clientId: client.id,
          renewalDate,
          dueDate,
          daysUntilDue,
          daysUntilRenewal,
          status,
        });
      }
    }
    const order: Record<string, number> = { overdue: 0, "due-soon": 1, completed: 2, ok: 3 };
    return result.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.daysUntilDue - b.daysUntilDue;
    });
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
    return decorated.sort(compareTodos);
  }

  /**
   * Moves a task onto the to-do list under a priority.
   *
   * New arrivals land at the bottom of their section by taking a sortOrder one
   * past the current maximum, so promoting something never jumps the queue
   * ahead of items that have already been waiting.
   */
  async moveTaskToTodo(id: number, priority: string) {
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
  async resolveCommunicationTask(id: number, note: string, user: string) {
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
        if (client.hasBroker && (client.brokerFirmName || client.brokerContactName)) {
          const d = new Date(client.createdAt);
          const seedDate = new Date(d.getFullYear(), d.getMonth(), 1);
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
        hasBroker: true,
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
    const [row] = await db.select().from(renewalProgress).where(eq(renewalProgress.planId, planId));
    return row ?? null;
  }

  async upsertRenewalProgress(planId: number, clientId: number, data: Record<string, any>): Promise<RenewalProgress> {
    const existing = await this.getRenewalProgress(planId);
    if (existing) {
      const [updated] = await db.update(renewalProgress)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(renewalProgress.planId, planId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(renewalProgress)
        .values({ planId, clientId, ...data })
        .returning();
      return created;
    }
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

    // Renewal pipeline — ACTIVE clients, non-archived plans
    const renewalRows = await db
      .select({ plan: plans, client: clients, prog: renewalProgress })
      .from(clients)
      .innerJoin(plans, and(eq(plans.clientId, clients.id), eq(plans.isArchived, false)))
      .leftJoin(renewalProgress, eq(renewalProgress.planId, plans.id))
      .where(eq(clients.clientStatus, "ACTIVE" as any));

    for (const { plan, client, prog } of renewalRows) {
      if (prog?.step7Date) continue;
      // Renewals are suppressed once a departure is known, so a terminating or
      // run-out client must not be reported as a stalled pipeline.
      if (deriveClientState(client) !== "ACTIVE") continue;

      const eff = plan.effectiveDate instanceof Date
        ? new Date(plan.effectiveDate.getTime())
        : new Date(String(plan.effectiveDate) + "T00:00:00");
      eff.setHours(0, 0, 0, 0);

      const monthsBefore = plan.renewalDueMonthsBefore ?? 3;
      const dueDate = subtractMonths(nextAnniversary(eff), monthsBefore);

      const stepSeq = [
        { key: "step1Date", label: "Renewal Requested",          date: prog?.step1Date ?? null },
        { key: "step2Date", label: "Renewal Processed",          date: prog?.step2Date ?? null },
        { key: "step3Date", label: "Renewal Sent",               date: prog?.step3Date ?? null },
        { key: "step5Date", label: "Renewal Accepted",           date: prog?.step5Date ?? null },
        { key: "step6Date", label: "Signed Form Attached",       date: prog?.step6Date ?? null },
        { key: "step7Date", label: "Form Emailed to 90 Degree",  date: prog?.step7Date ?? null },
      ];

      const currentIdx = stepSeq.findIndex(s => !s.date);
      if (currentIdx < 0) continue;

      let clockStart: Date | null = null;
      if (currentIdx === 0) {
        clockStart = dueDate;
      } else {
        const prev = stepSeq[currentIdx - 1].date;
        clockStart = prev ? new Date(prev) : null;
        // For step5: check if a step4 revision is more recent than step3
        if (stepSeq[currentIdx].key === "step5Date") {
          const revs: string[] = Array.isArray(prog?.step4Revisions) ? (prog.step4Revisions as string[]) : [];
          if (revs.length > 0) {
            const latestRev = new Date([...revs].sort().at(-1)!);
            if (!clockStart || latestRev > clockStart) clockStart = latestRev;
          }
        }
      }

      if (!clockStart) continue;
      const stalledDays = daysSince(clockStart) - 14;
      if (stalledDays >= 0) {
        result.push({
          type: "renewal",
          clientId: client.id,
          clientName: client.clientName,
          clientCode: client.clientCode,
          planName: plan.planName,
          step: stepSeq[currentIdx].label,
          clockStartDate: clockStart.toISOString().split("T")[0],
          daysOverdue: stalledDays,
        });
      }
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
}

export const storage = new DatabaseStorage();
