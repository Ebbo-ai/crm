import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireAdmin } from "./auth";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";

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
      res.json(clientList);
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

  app.post("/api/clients", requireAuth, async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.terminationDate && typeof body.terminationDate === "string") {
        body.terminationDate = new Date(body.terminationDate);
      }
      const client = await storage.createClient(body);
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
      res.json({ ...client, activeIssueCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/clients/:id", requireAuth, async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.terminationDate && typeof body.terminationDate === "string") {
        body.terminationDate = new Date(body.terminationDate);
      }
      const updated = await storage.updateClient(parseInt(req.params.id), body);
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
      const cards = req.body.map((card: any) => ({ ...card, planId }));
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

  app.get("/api/clients/:id/documents", requireAuth, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const docs = await storage.getDocuments(parseInt(req.params.id), category);
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/documents", requireAuth, (req, res, next) => {
    (req as any).uploadSubDir = "documents";
    next();
  }, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "File is required" });
      const doc = await storage.createDocument({
        clientId: parseInt(req.params.id),
        documentName: req.body.documentName,
        category: req.body.category,
        filePath: req.file.path,
        fileName: req.file.originalname,
        notes: req.body.notes || null,
        uploadedBy: (req.user as any).fullName,
      });
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

  app.get("/api/documents/:docId/download", requireAuth, async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.docId));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.download(doc.filePath, doc.fileName);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/documents/:docId", requireAuth, async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.docId));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      try { fs.unlinkSync(doc.filePath); } catch {}
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

  app.get("/api/clients/:id/ppr", requireAuth, async (req, res) => {
    try {
      const pprList = await storage.getPprUploads(parseInt(req.params.id));
      res.json(pprList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/ppr", requireAuth, (req, res, next) => {
    (req as any).uploadSubDir = "ppr";
    next();
  }, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "File is required" });
      const ppr = await storage.createPprUpload({
        clientId: parseInt(req.params.id),
        reportMonth: parseInt(req.body.reportMonth),
        reportYear: parseInt(req.body.reportYear),
        filePath: req.file.path,
        fileName: req.file.originalname,
        notes: req.body.notes || null,
        uploadedBy: (req.user as any).fullName,
      });
      await storage.createAuditLog({
        userId: (req.user as any).id,
        userName: (req.user as any).fullName,
        action: "uploaded",
        entity: "ppr",
        entityId: ppr.id,
        details: `Uploaded PPR for ${req.body.reportMonth}/${req.body.reportYear}`,
      });
      res.status(201).json(ppr);
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
      const clientsWithIssues = await storage.getClientsWithActiveIssues();
      res.json(clientsWithIssues);
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

  return httpServer;
}
