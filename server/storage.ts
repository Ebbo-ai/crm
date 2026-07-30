import { db } from "./db";
import { eq, and, ilike, sql, desc, asc, count, inArray, isNull, or, gte, lte } from "drizzle-orm";
import {
  users, clients, plans, rateCards, documents, issues, pprUploads, pprMetrics, auditLogs,
  communications, communicationClients, communicationAttachments, communicationTasks, brokerHistory,
  renewalProgress, prospectProgress, planPerformanceFacts, pprImportBatches, pprHeldRows,
  type RenewalProgress,
  type User, type InsertUser,
  type Client, type InsertClient,
  type Plan, type InsertPlan,
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
  type PlanPerformanceFacts, type InsertPlanPerformanceFacts,
  type PprImportBatch, type InsertPprImportBatch,
  type PprHeldRow, type InsertPprHeldRow,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  getClients(search?: string, status?: string): Promise<(Client & { activeIssueCount: number })[]>;
  getClient(id: number): Promise<Client | undefined>;
  getClientByCode(code: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, data: Partial<InsertClient>): Promise<Client | undefined>;

  getPlans(clientId: number): Promise<Plan[]>;
  getPlan(id: number): Promise<Plan | undefined>;
  createPlan(plan: InsertPlan): Promise<Plan>;
  updatePlan(id: number, data: Partial<InsertPlan>): Promise<Plan | undefined>;
  getActivePlanCount(clientId: number): Promise<number>;

  getRateCards(planId: number): Promise<RateCard[]>;
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
  assignCommunicationToClients(commId: number, assignments: { clientId: number; confidence: string }[]): Promise<void>;
  updateClientAssignment(commId: number, clientId: number): Promise<void>;
  getDistinctSenders(): Promise<{ senderEmail: string; senderName: string | null; senderDomain: string | null }[]>;

  createCommunicationAttachment(att: InsertCommunicationAttachment): Promise<CommunicationAttachment>;
  getCommunicationAttachment(id: number): Promise<CommunicationAttachment | undefined>;

  createCommunicationTask(task: InsertCommunicationTask): Promise<CommunicationTask>;
  getOpenTasks(): Promise<(CommunicationTask & { clientName: string | null; communicationSubject: string | null })[]>;
  completeCommunicationTask(id: number): Promise<void>;
  getClientTasks(clientId: number): Promise<CommunicationTask[]>;
  getUnreadCommunicationsCount(): Promise<number>;

  getBrokerHistory(clientId: number): Promise<BrokerHistory[]>;
  addBrokerChange(clientId: number, newBroker: { brokerFirmName: string | null; brokerContactName: string | null; brokerPhone: string | null; brokerEmail: string | null; effectiveDate: Date }): Promise<void>;

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
    if (status === "active") {
      conditions.push(eq(clients.clientStatus, "ACTIVE" as any));
    } else if (status === "terminated") {
      conditions.push(eq(clients.clientStatus, "TERMINATED" as any));
    } else if (status === "prospect") {
      conditions.push(eq(clients.clientStatus, "PROSPECT" as any));
    }

    const clientList = conditions.length > 0
      ? await db.select().from(clients).where(and(...conditions)).orderBy(asc(clients.clientName))
      : await db.select().from(clients).orderBy(asc(clients.clientName));

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

  async getClientByCode(code: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.clientCode, code));
    return client;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [created] = await db.insert(clients).values(client).returning();
    return created;
  }

  async updateClient(id: number, data: Partial<InsertClient>): Promise<Client | undefined> {
    const [updated] = await db.update(clients).set({ ...data, updatedAt: new Date() }).where(eq(clients.id, id)).returning();
    return updated;
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

  async getRateCards(planId: number): Promise<RateCard[]> {
    return db.select().from(rateCards).where(eq(rateCards.planId, planId));
  }

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
    const [activeResult] = await db.select({ count: count() }).from(clients).where(eq(clients.isActive, true));
    const [terminatedResult] = await db.select({ count: count() }).from(clients).where(eq(clients.isActive, false));
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
    const activeClients = await db.select().from(clients).where(eq(clients.isActive, true));
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

  private async enrichComm(comm: Communication) {
    const attachments = await db.select().from(communicationAttachments).where(eq(communicationAttachments.communicationId, comm.id)).orderBy(asc(communicationAttachments.uploadedAt));
    const tasks = await db.select().from(communicationTasks).where(eq(communicationTasks.communicationId, comm.id)).orderBy(asc(communicationTasks.dueDate));
    return { ...comm, attachments, tasks };
  }

  async getClientCommunications(clientId: number) {
    const links = await db.select().from(communicationClients).where(eq(communicationClients.clientId, clientId));
    if (!links.length) return [];
    const commIds = links.map(l => l.communicationId);
    const comms = await db.select().from(communications).where(inArray(communications.id, commIds)).orderBy(desc(communications.receivedAt));
    return Promise.all(comms.map(c => this.enrichComm(c)));
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

    return Promise.all(comms.map(async c => {
      const links = await db.select().from(communicationClients).where(eq(communicationClients.communicationId, c.id));
      const clientNames = await Promise.all(links.map(async l => {
        const client = await this.getClient(l.clientId);
        return client?.clientName ?? "Unknown";
      }));
      const enriched = await this.enrichComm(c);
      return { ...enriched, clientNames };
    }));
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
    const [created] = await db.insert(communicationTasks).values(task).returning();
    return created;
  }

  async getOpenTasks() {
    const tasks = await db.select().from(communicationTasks).where(eq(communicationTasks.isCompleted, false)).orderBy(asc(communicationTasks.dueDate));
    return Promise.all(tasks.map(async t => {
      const client = t.clientId ? await this.getClient(t.clientId) : null;
      const comm = await this.getCommunication(t.communicationId);
      return { ...t, clientName: client?.clientName ?? null, communicationSubject: comm?.subject ?? null };
    }));
  }

  async completeCommunicationTask(id: number) {
    await db.update(communicationTasks).set({ isCompleted: true, completedAt: new Date() }).where(eq(communicationTasks.id, id));
  }

  async getClientTasks(clientId: number): Promise<CommunicationTask[]> {
    return db.select().from(communicationTasks).where(eq(communicationTasks.clientId, clientId)).orderBy(asc(communicationTasks.dueDate));
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

    const [currentRecord] = await db.select().from(brokerHistory)
      .where(and(eq(brokerHistory.clientId, clientId), isNull(brokerHistory.terminationDate)))
      .orderBy(desc(brokerHistory.effectiveDate))
      .limit(1);

    if (!currentRecord) {
      const client = await this.getClient(clientId);
      if (client?.hasBroker && (client.brokerFirmName || client.brokerContactName)) {
        const d = new Date(client.createdAt);
        const seedDate = new Date(d.getFullYear(), d.getMonth(), 1);
        await db.insert(brokerHistory).values({
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
      await db.update(brokerHistory)
        .set({ terminationDate: termDate })
        .where(eq(brokerHistory.id, currentRecord.id));
    }

    await db.insert(brokerHistory).values({
      clientId,
      brokerFirmName: newBroker.brokerFirmName,
      brokerContactName: newBroker.brokerContactName,
      brokerPhone: newBroker.brokerPhone,
      brokerEmail: newBroker.brokerEmail,
      effectiveDate: newBroker.effectiveDate,
      terminationDate: null,
    });

    await db.update(clients).set({
      brokerFirmName: newBroker.brokerFirmName,
      brokerContactName: newBroker.brokerContactName,
      brokerPhone: newBroker.brokerPhone,
      brokerEmail: newBroker.brokerEmail,
      hasBroker: true,
      updatedAt: new Date(),
    }).where(eq(clients.id, clientId));
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
