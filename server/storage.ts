import { db } from "./db";
import { eq, and, ilike, sql, desc, asc, count } from "drizzle-orm";
import {
  users, clients, plans, rateCards, documents, issues, pprUploads, pprMetrics, auditLogs,
  type User, type InsertUser,
  type Client, type InsertClient,
  type Plan, type InsertPlan,
  type RateCard, type InsertRateCard,
  type Document, type InsertDocument,
  type Issue, type InsertIssue,
  type PprUpload, type InsertPprUpload,
  type PprMetrics, type InsertPprMetrics,
  type AuditLog, type InsertAuditLog,
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
  getPprUpload(id: number): Promise<PprUpload | undefined>;
  createPprUpload(ppr: InsertPprUpload): Promise<PprUpload>;
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
  getExpiringPlans(): Promise<any[]>;
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
      conditions.push(eq(clients.isActive, true));
    } else if (status === "terminated") {
      conditions.push(eq(clients.isActive, false));
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

  async getPprUpload(id: number): Promise<PprUpload | undefined> {
    const [ppr] = await db.select().from(pprUploads).where(eq(pprUploads.id, id));
    return ppr;
  }

  async createPprUpload(ppr: InsertPprUpload): Promise<PprUpload> {
    const [created] = await db.insert(pprUploads).values(ppr).returning();
    return created;
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
}

export const storage = new DatabaseStorage();
