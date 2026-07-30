import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireAdmin } from "./auth";
import { matchEmailToClients, processEmail, queryClientCommunications } from "./claude";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

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

  app.get("/api/clients/check-code/:code", requireAuth, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const existing = await storage.getClientByCode(code);
      res.json({ exists: !!existing, clientId: existing?.id || null });
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
      const engineRes = await fetch("http://127.0.0.1:5001/generate-renewal-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name:        client.clientName,
          group_id:          client.clientCode || String(client.id),
          prepared_for:      client.clientName,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!engineRes.ok) {
        let msg = "Rating engine error";
        try { msg = ((await engineRes.json()) as any).error || msg; } catch {}
        return res.status(502).json({ message: msg });
      }

      const { pdf_b64, scenarios, total_pages, advisories } =
        (await engineRes.json()) as any;

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
        const pdfParse = (await import("pdf-parse")).default;
        const parsed = await pdfParse(buffer);
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
  app.post("/api/email/inbound", emailUpload.any(), (req, res) => {
    // Verify Mailgun webhook signature if key is configured
    const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (signingKey) {
      const { timestamp, token, signature } = req.body;
      if (timestamp && token && signature) {
        const hmac = crypto.createHmac("sha256", signingKey);
        hmac.update(timestamp + token);
        const computed = hmac.digest("hex");
        if (computed !== signature) {
          console.error("Mailgun webhook: invalid signature");
          return res.status(403).json({ message: "Invalid Mailgun signature" });
        }
      }
    }

    // Respond immediately so Mailgun doesn't time out — process async in background
    res.status(200).json({ ok: true });

    // Capture everything from req synchronously before going async
    const body = req.body;
    const files = (req.files as Express.Multer.File[]) || [];

    // Helper: race any promise against a timeout
    function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
      return Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);
    }

    setImmediate(async () => {
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

        // ── STEP 3: Claude enrichment (with 30s timeout so it can't hang) ──────
        const fullText = `From: ${senderName ? `${senderName} <${senderEmail}>` : senderEmail}\nSubject: ${subject}\n\n${bodyText}`;
        const allClients = await storage.getClients();

        const [matches, processed] = await Promise.all([
          withTimeout(
            matchEmailToClients(fullText, allClients.map(c => ({
              id: c.id, clientCode: c.clientCode, clientName: c.clientName,
              brokerEmail: c.brokerEmail, brokerFirmName: c.brokerFirmName,
              adminContactEmail: c.adminContactEmail, decisionMakerEmail: c.decisionMakerEmail,
            }))),
            30000,
            [] as { clientId: number; confidence: "high" | "medium" | "low" }[]
          ),
          withTimeout(
            processEmail(fullText, attachmentTexts),
            30000,
            { summary: "AI processing timed out.", actionItems: [] }
          ),
        ]);

        // ── STEP 4: Update record with Claude results ──────────────────────────
        await storage.updateCommunication(comm.id, {
          claudeSummary: processed.summary,
          claudeActionItems: JSON.stringify(processed.actionItems),
          isUnmatched: matches.length === 0,
        });

        // ── STEP 5: Assign to clients and create tasks ─────────────────────────
        if (matches.length > 0) {
          await storage.assignCommunicationToClients(comm.id, matches);
          for (const item of processed.actionItems) {
            const dueDate = item.dueDate ? new Date(item.dueDate) : null;
            for (const m of matches) {
              await storage.createCommunicationTask({
                communicationId: comm.id, clientId: m.clientId,
                description: item.description,
                dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
              });
            }
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

        console.log(`[email-inbound] Enriched #${comm.id} — matched ${matches.length} clients, ${processed.actionItems.length} tasks`);
      } catch (err: any) {
        console.error("[email-inbound] Error:", err?.message || err);
      }
    });
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
      });

      for (const att of attachmentMeta) {
        await storage.createCommunicationAttachment({
          communicationId: comm.id, filename: att.filename, mimeType: att.mimeType,
          sizeBytes: att.sizeBytes, storagePath: att.storagePath, claudeAnalysis: null,
        });
      }

      if (parsedClientIds.length > 0) {
        await storage.assignCommunicationToClients(comm.id, parsedClientIds.map(id => ({ clientId: id, confidence: "manual" })));
        for (const item of processed.actionItems) {
          const dueDate = item.dueDate ? new Date(item.dueDate) : null;
          for (const cid of parsedClientIds) {
            await storage.createCommunicationTask({
              communicationId: comm.id, clientId: cid, description: item.description,
              dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
            });
          }
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

  app.post("/api/communication-tasks/:id/complete", requireAuth, async (req, res) => {
    try {
      await storage.completeCommunicationTask(parseInt(req.params.id));
      res.json({ ok: true });
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
        clients: allClients.map(c => ({ id: c.id, client_code: c.clientCode, client_name: c.clientName })),
        plans: allPlans.map(p => ({
          id: p.id, client_id: p.clientId, plan_name: p.planName,
          effective_date: p.effectiveDate, plan_year: p.planYear,
        })),
        current_facts: allFacts.map(f => ({
          id: f.id, client_id: f.clientId, plan_id: f.planId,
          report_month: f.reportMonth, report_year: f.reportYear,
          version: f.version, paid_claims: f.paidClaims, submitted_charges: f.submittedCharges,
        })),
      };

      const flaskRes = await fetch("http://127.0.0.1:5001/parse-ppr-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_b64: fileB64, file_ext: fileExt, context }),
        signal: AbortSignal.timeout(120_000),
      });

      const parsed = await flaskRes.json() as any;
      if (!flaskRes.ok) {
        return res.status(500).json({ message: parsed.error || "Parser failed" });
      }

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
      const planMonths: { month: number; year: number }[] = [];
      for (let i = 0; i < 12; i++) {
        let m = startMonth + i;
        let y = reportPlanYear!;
        if (m > 12) { m -= 12; y++; }
        planMonths.push({ month: m, year: y });
      }

      const planFacts = allFacts.filter(f => f.planId === plan.id);
      const cards = await storage.getRateCards(plan.id);

      const monthsPayload = planMonths.map(({ month, year }) => {
        const fact = planFacts.find(f => f.reportMonth === month && f.reportYear === year);

        // Admin fee total: pick rate card effective for this month (or the latest)
        let adminFeeTotal: number | null = null;
        if (fact) {
          const monthDate = new Date(year, month - 1, 1);
          const tierTotals: Record<string, number> = {};
          for (const tier of ["EE", "EE_SPOUSE", "EE_CHILD", "FAMILY"]) {
            const valid = cards
              .filter(rc => rc.tier === tier && (!rc.effectiveDate || new Date(rc.effectiveDate) <= monthDate))
              .sort((a, b) => {
                const da = a.effectiveDate ? new Date(a.effectiveDate).getTime() : 0;
                const db = b.effectiveDate ? new Date(b.effectiveDate).getTime() : 0;
                return db - da;
              });
            if (valid.length) tierTotals[tier] = parseFloat(valid[0].totalFee);
          }

          const ee   = fact.eeCount ?? 0;
          const eesp = fact.eeSpouseCount ?? 0;
          const eech = fact.eeChildCount ?? 0;
          const fam  = fact.familyCount ?? 0;
          const total = (ee * (tierTotals["EE"] ?? 0)) +
                        (eesp * (tierTotals["EE_SPOUSE"] ?? 0)) +
                        (eech * (tierTotals["EE_CHILD"] ?? 0)) +
                        (fam  * (tierTotals["FAMILY"] ?? 0));
          if (total > 0) adminFeeTotal = Math.round(total * 100) / 100;
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

      const flaskRes = await fetch("http://127.0.0.1:5001/generate-ppr-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, output_format: format }),
        signal: AbortSignal.timeout(60_000),
      });

      const result: any = await flaskRes.json();
      if (!flaskRes.ok) return res.status(500).json({ message: result.error || "Report generation failed" });

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
      if ((err as any).status === 404) return res.status(404).json({ message: err.message });
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

      const flaskRes = await fetch("http://127.0.0.1:5001/generate-ppr-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, output_format: "pdf" }),
        signal: AbortSignal.timeout(60_000),
      });

      const result: any = await flaskRes.json();
      if (!flaskRes.ok) return res.status(500).json({ message: result.error || "Report generation failed" });

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
      if ((err as any).status === 404) return res.status(404).json({ message: err.message });
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
