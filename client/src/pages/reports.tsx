import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Download, Search, FileText, Building2, Users } from "lucide-react";
import { PLAN_TYPE_LABELS, PLAN_BASIS_LABELS, TIER_LABELS, parseLocalDate, formatCurrency } from "@/lib/constants";

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtDate(v: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!v) return "—";
  try {
    const d = parseLocalDate(v);
    return d.toLocaleDateString("en-US", opts ?? { month: "long", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}

function fmtAnniversary(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    const d = parseLocalDate(v);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  } catch { return "—"; }
}

function fmtLossRatio(v: string | null | undefined): string {
  if (!v) return "—";
  return `${parseFloat(v).toFixed(1)}%`;
}

function fmtSurplusDeficit(v: string | null | undefined): { text: string; positive: boolean } {
  if (!v) return { text: "—", positive: true };
  const n = parseFloat(v);
  return {
    text: `${n >= 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    positive: n >= 0,
  };
}

function getRecentMetric(metrics: any[]): any | null {
  if (!metrics || metrics.length === 0) return null;
  return [...metrics].sort((a, b) => {
    if (a.reportYear !== b.reportYear) return b.reportYear - a.reportYear;
    return b.reportMonth - a.reportMonth;
  })[0];
}

// ─── Print Window ────────────────────────────────────────────────────────────

function openPrintWindow(html: string) {
  const win = window.open("", "_blank");
  if (!win) { alert("Please allow popups for this site to use Print / PDF."); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// ─── Client Summary HTML ─────────────────────────────────────────────────────

function buildClientSummaryHtml(client: any, plans: any[], metrics: any[]): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const activePlans = (plans ?? []).filter((p: any) => !p.isArchived);
  const anniversary = activePlans.length > 0 ? fmtAnniversary(activePlans[0].effectiveDate) : "—";
  const planTypeLabel = PLAN_TYPE_LABELS[client.planType] ?? client.planType;
  const metric = getRecentMetric(metrics ?? []);
  const surplusDeficit = metric ? fmtSurplusDeficit(metric.ytdSurplusDeficit) : null;

  const contactsHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #E2E8F0;border-top:0;">
      <div style="padding:18px 22px;border-right:1px solid #E2E8F0;">
        <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-weight:700;">Decision Maker</div>
        <div style="font-size:14px;font-weight:600;color:#2C3E50;margin-bottom:3px;">${client.decisionMakerName || "—"}</div>
        <div style="font-size:11px;color:#94A3B8;margin-bottom:6px;">${client.decisionMakerTitle || ""}</div>
        <div style="font-size:12px;color:#2E86C1;">${client.decisionMakerPhone || ""}</div>
        <div style="font-size:12px;color:#2E86C1;">${client.decisionMakerEmail || ""}</div>
      </div>
      <div style="padding:18px 22px;">
        <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-weight:700;">Admin Contact</div>
        <div style="font-size:14px;font-weight:600;color:#2C3E50;margin-bottom:3px;">${client.adminContactName || "—"}</div>
        <div style="font-size:11px;color:#94A3B8;margin-bottom:6px;">${client.adminContactTitle || ""}</div>
        <div style="font-size:12px;color:#2E86C1;">${client.adminContactPhone || ""}</div>
        <div style="font-size:12px;color:#2E86C1;">${client.adminContactEmail || ""}</div>
      </div>
    </div>`;

  const brokerHtml = client.hasBroker ? `
    <div style="margin-top:22px;">
      <div style="background:#2E86C1;color:white;padding:9px 20px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;border-radius:6px 6px 0 0;">Broker</div>
      <div style="border:1px solid #E2E8F0;border-top:0;padding:18px 22px;display:flex;gap:48px;flex-wrap:wrap;">
        <div><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Firm</div><div style="font-size:14px;font-weight:600;color:#2C3E50;">${client.brokerFirmName || "—"}</div></div>
        <div><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Contact</div><div style="font-size:13px;color:#2C3E50;">${client.brokerContactName || "—"}</div></div>
        <div><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Phone</div><div style="font-size:13px;color:#2E86C1;">${client.brokerPhone || "—"}</div></div>
        <div><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Email</div><div style="font-size:13px;color:#2E86C1;">${client.brokerEmail || "—"}</div></div>
      </div>
    </div>` : "";

  const plansHtml = activePlans.map((plan: any) => {
    const rates: any[] = plan.rateCards ?? [];
    const ratesTable = rates.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px;">
        <thead>
          <tr style="background:#F0F4F8;">
            <th style="text-align:left;padding:7px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E2E8F0;">Tier</th>
            <th style="text-align:right;padding:7px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E2E8F0;">Base Admin</th>
            <th style="text-align:right;padding:7px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E2E8F0;">Simple Fee</th>
            <th style="text-align:right;padding:7px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E2E8F0;">Network</th>
            <th style="text-align:right;padding:7px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E2E8F0;">Broker Fee</th>
            <th style="text-align:right;padding:7px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E2E8F0;">Total Fee</th>
            <th style="text-align:right;padding:7px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E2E8F0;">Monthly Premium</th>
          </tr>
        </thead>
        <tbody>
          ${rates.map((r: any) => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:7px 10px;font-weight:600;color:#2C3E50;">${TIER_LABELS[r.tier] ?? r.tier}</td>
              <td style="padding:7px 10px;text-align:right;color:#2C3E50;">${formatCurrency(r.baseAdminFee)}</td>
              <td style="padding:7px 10px;text-align:right;color:#2C3E50;">${formatCurrency(r.simpleFee)}</td>
              <td style="padding:7px 10px;text-align:right;color:#2C3E50;">${formatCurrency(r.networkFee)}</td>
              <td style="padding:7px 10px;text-align:right;color:#2C3E50;">${formatCurrency(r.brokerFee)}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:600;color:#1A5276;">${formatCurrency(r.totalFee)}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:700;color:#1A5276;">${formatCurrency(r.monthlyPremium)}</td>
            </tr>`).join("")}
        </tbody>
      </table>` : "<div style='font-size:12px;color:#94A3B8;margin-top:8px;'>No rate cards configured.</div>";

    return `
      <div style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin-bottom:14px;">
        <div style="background:#F8FAFC;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #E2E8F0;">
          <div>
            <span style="font-size:14px;font-weight:700;color:#1A5276;">${plan.planName}</span>
            <span style="margin-left:10px;font-size:11px;color:#94A3B8;background:#EFF6FF;padding:2px 8px;border-radius:10px;">Plan Year ${plan.planYear}</span>
          </div>
          <div style="text-align:right;font-size:11px;color:#64748B;">
            <span>Effective: ${fmtDate(plan.effectiveDate, { month: "long", day: "numeric", year: "numeric" })}</span>
            <span style="margin-left:16px;">Basis: ${PLAN_BASIS_LABELS[plan.planBasis] ?? plan.planBasis}</span>
          </div>
        </div>
        <div style="padding:12px 18px;">
          ${ratesTable}
        </div>
      </div>`;
  }).join("");

  const financialHtml = metric ? `
    <div style="margin-top:22px;">
      <div style="background:#1A5276;color:white;padding:9px 20px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;border-radius:6px 6px 0 0;">Financial Summary — ${MONTH_NAMES[(metric.reportMonth ?? 1) - 1]} ${metric.reportYear}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border:1px solid #E2E8F0;border-top:0;">
        <div style="padding:20px 22px;border-right:1px solid #E2E8F0;">
          <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700;">Plan</div>
          <div style="font-size:15px;font-weight:600;color:#2C3E50;">${metric.planName || "—"}</div>
        </div>
        <div style="padding:20px 22px;border-right:1px solid #E2E8F0;">
          <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700;">YTD Loss Ratio</div>
          <div style="font-size:26px;font-weight:800;color:${parseFloat(metric.ytdLossRatio) > 100 ? "#EF4444" : "#22C55E"};">${fmtLossRatio(metric.ytdLossRatio)}</div>
          ${metric.monthlyLossRatio ? `<div style="font-size:11px;color:#94A3B8;margin-top:4px;">Monthly: ${fmtLossRatio(metric.monthlyLossRatio)}</div>` : ""}
        </div>
        <div style="padding:20px 22px;">
          <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700;">YTD Plan Position (as billed)</div>
          ${surplusDeficit ? `<div style="font-size:22px;font-weight:800;color:${surplusDeficit.positive ? "#22C55E" : "#EF4444"};">${surplusDeficit.text}</div>` : "<div style='font-size:15px;color:#94A3B8;'>—</div>"}
        </div>
      </div>
    </div>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Client Summary — ${client.clientName}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#2C3E50;}@page{margin:.45in;}</style>
  </head><body>
  <div style="max-width:860px;margin:0 auto;padding:0;">
    <div style="background:linear-gradient(135deg,#1A5276 0%,#2E86C1 100%);padding:26px 30px;border-radius:8px 8px 0 0;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="color:#F5A623;font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:4px;">Simple Benefits TPA</div>
          <div style="color:white;font-size:22px;font-weight:800;letter-spacing:-0.3px;">CLIENT SUMMARY REPORT</div>
        </div>
        <div style="text-align:right;">
          <div style="color:rgba(255,255,255,.6);font-size:10px;">Generated ${today}</div>
          <div style="color:white;font-size:16px;font-weight:700;margin-top:4px;">${client.clientCode}</div>
        </div>
      </div>
    </div>
    <div style="background:#F5A623;padding:14px 30px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:20px;font-weight:800;color:#1A5276;">${client.clientName}</div>
      <div style="background:${client.isActive ? "#22C55E" : "#EF4444"};color:white;padding:4px 14px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:1px;">${client.isActive ? "ACTIVE" : "TERMINATED"}</div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;border:1px solid #E2E8F0;border-top:0;border-radius:0 0 0 0;">
      <div style="padding:16px 22px;border-right:1px solid #E2E8F0;">
        <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700;">Address</div>
        <div style="font-size:12px;color:#2C3E50;line-height:1.5;">${client.streetAddress}${client.suiteUnit ? ", " + client.suiteUnit : ""}<br>${client.city}, ${client.state} ${client.zipCode}</div>
      </div>
      <div style="padding:16px 22px;border-right:1px solid #E2E8F0;text-align:center;">
        <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700;">Employees</div>
        <div style="font-size:26px;font-weight:800;color:#1A5276;">${(client.numberOfEmployees ?? 0).toLocaleString()}</div>
      </div>
      <div style="padding:16px 22px;border-right:1px solid #E2E8F0;text-align:center;">
        <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700;">Plan Type</div>
        <div style="font-size:13px;font-weight:600;color:#2C3E50;">${planTypeLabel}</div>
      </div>
      <div style="padding:16px 22px;text-align:center;">
        <div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700;">Anniversary</div>
        <div style="font-size:13px;font-weight:600;color:#2C3E50;">${anniversary}</div>
      </div>
    </div>

    <div style="margin-top:22px;">
      <div style="background:#1A5276;color:white;padding:9px 20px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;border-radius:6px 6px 0 0;">Contacts</div>
      ${contactsHtml}
    </div>

    ${brokerHtml}

    ${activePlans.length > 0 ? `
    <div style="margin-top:22px;">
      <div style="background:#1A5276;color:white;padding:9px 20px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;border-radius:6px 6px 0 0;margin-bottom:12px;">Plans & Rates</div>
      ${plansHtml}
    </div>` : ""}

    ${financialHtml}

    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:9px;color:#CBD5E1;">Confidential — Simple Benefits TPA</div>
      <div style="font-size:9px;color:#CBD5E1;">${today}</div>
    </div>
  </div>
  </body></html>`;
}

// ─── Broker Report HTML ───────────────────────────────────────────────────────

function buildBrokerReportHtml(firm: string, clients: any[]): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const rows = clients.map((c: any) => {
    const activePlans = (c.plans ?? []).filter((p: any) => !p.isArchived);
    const anniversary = activePlans.length > 0 ? fmtAnniversary(activePlans[0].effectiveDate) : "—";
    const planNames = activePlans.map((p: any) => p.planName).join(", ") || "—";
    return `
      <tr style="border-bottom:1px solid #F1F5F9;">
        <td style="padding:10px 14px;font-weight:600;color:#2C3E50;">${c.clientName}<br><span style="font-size:10px;color:#94A3B8;font-weight:400;">${c.clientCode}</span></td>
        <td style="padding:10px 14px;color:#2C3E50;">${PLAN_TYPE_LABELS[c.planType] ?? c.planType}</td>
        <td style="padding:10px 14px;color:#64748B;">${planNames}</td>
        <td style="padding:10px 14px;text-align:center;color:#2C3E50;">${anniversary}</td>
        <td style="padding:10px 14px;text-align:center;font-weight:700;color:#1A5276;font-size:15px;">${(c.numberOfEmployees ?? 0).toLocaleString()}</td>
        <td style="padding:10px 14px;text-align:center;">
          <span style="background:${c.isActive ? "#DCFCE7" : "#FEE2E2"};color:${c.isActive ? "#166534" : "#991B1B"};padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;">${c.isActive ? "Active" : "Terminated"}</span>
        </td>
      </tr>`;
  }).join("");

  const totalEmployees = clients.reduce((s: number, c: any) => s + (c.numberOfEmployees ?? 0), 0);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Broker Report — ${firm}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#2C3E50;}@page{margin:.45in;}</style>
  </head><body>
  <div style="max-width:920px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#1A5276 0%,#2E86C1 100%);padding:26px 30px;border-radius:8px 8px 0 0;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="color:#F5A623;font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:4px;">Simple Benefits TPA</div>
          <div style="color:white;font-size:22px;font-weight:800;">BROKER REPORT</div>
        </div>
        <div style="text-align:right;">
          <div style="color:rgba(255,255,255,.6);font-size:10px;">Generated ${today}</div>
          <div style="color:white;font-size:11px;margin-top:4px;">${clients.length} Client${clients.length !== 1 ? "s" : ""} &nbsp;·&nbsp; ${totalEmployees.toLocaleString()} Total Employees</div>
        </div>
      </div>
    </div>
    <div style="background:#F5A623;padding:12px 30px;">
      <div style="font-size:18px;font-weight:800;color:#1A5276;">${firm}</div>
      <div style="font-size:11px;color:rgba(26,82,118,.7);margin-top:2px;">Broker Firm</div>
    </div>

    <table style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-top:0;">
      <thead>
        <tr style="background:#F8FAFC;border-bottom:2px solid #E2E8F0;">
          <th style="text-align:left;padding:10px 14px;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Client</th>
          <th style="text-align:left;padding:10px 14px;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Plan Type</th>
          <th style="text-align:left;padding:10px 14px;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Plan(s)</th>
          <th style="text-align:center;padding:10px 14px;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Anniversary</th>
          <th style="text-align:center;padding:10px 14px;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Employees</th>
          <th style="text-align:center;padding:10px 14px;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:#F0F4F8;border-top:2px solid #E2E8F0;">
          <td colspan="4" style="padding:10px 14px;font-weight:700;color:#1A5276;font-size:12px;">TOTALS</td>
          <td style="padding:10px 14px;text-align:center;font-weight:800;color:#1A5276;font-size:16px;">${totalEmployees.toLocaleString()}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;">
      <div style="font-size:9px;color:#CBD5E1;">Confidential — Simple Benefits TPA</div>
      <div style="font-size:9px;color:#CBD5E1;">${today}</div>
    </div>
  </div>
  </body></html>`;
}

// ─── In-App Preview ───────────────────────────────────────────────────────────

function StatBox({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-1 p-4 border border-gray-100 rounded-lg bg-white">
      <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest">{label}</span>
      <span className={`text-lg font-extrabold ${accent ?? "text-[#1A5276]"}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ children, color = "bg-[#1A5276]" }: { children: React.ReactNode; color?: string }) {
  return (
    <div className={`${color} text-white px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-t-md`}>
      {children}
    </div>
  );
}

function ClientSummaryPreview({ client, plans, metrics }: { client: any; plans: any[]; metrics: any[] }) {
  const activePlans = (plans ?? []).filter((p: any) => !p.isArchived);
  const anniversary = activePlans.length > 0 ? fmtAnniversary(activePlans[0].effectiveDate) : "—";
  const metric = getRecentMetric(metrics ?? []);
  const surplusDeficit = metric ? fmtSurplusDeficit(metric.ytdSurplusDeficit) : null;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-100">
      <div className="bg-gradient-to-r from-[#1A5276] to-[#2E86C1] px-7 py-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[#F5A623] text-[9px] font-bold uppercase tracking-[3px] mb-1">Simple Benefits TPA</p>
            <h2 className="text-white text-xl font-extrabold tracking-tight">CLIENT SUMMARY REPORT</h2>
          </div>
          <div className="text-right">
            <p className="text-white/60 text-[10px]">Generated {today}</p>
            <p className="text-white text-sm font-bold mt-1">{client.clientCode}</p>
          </div>
        </div>
      </div>
      <div className="bg-[#F5A623] px-7 py-3 flex justify-between items-center">
        <span className="text-[#1A5276] text-lg font-extrabold">{client.clientName}</span>
        <span className={`text-[10px] font-bold px-3 py-1 rounded-full text-white ${client.isActive ? "bg-[#22C55E]" : "bg-[#EF4444]"}`}>
          {client.isActive ? "ACTIVE" : "TERMINATED"}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-gray-100">
        <div className="p-4 border-r border-gray-100">
          <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Address</p>
          <p className="text-xs text-[#2C3E50] leading-relaxed">
            {client.streetAddress}{client.suiteUnit ? `, ${client.suiteUnit}` : ""}<br />
            {client.city}, {client.state} {client.zipCode}
          </p>
        </div>
        <div className="p-4 border-r border-gray-100 text-center">
          <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Employees</p>
          <p className="text-2xl font-extrabold text-[#1A5276]">{(client.numberOfEmployees ?? 0).toLocaleString()}</p>
        </div>
        <div className="p-4 border-r border-gray-100 text-center">
          <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Plan Type</p>
          <p className="text-sm font-semibold text-[#2C3E50]">{PLAN_TYPE_LABELS[client.planType] ?? client.planType}</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Anniversary</p>
          <p className="text-sm font-semibold text-[#2C3E50]">{anniversary}</p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <SectionHeader>Contacts</SectionHeader>
          <div className="grid grid-cols-2 border border-gray-100 border-t-0 rounded-b-md overflow-hidden">
            <div className="p-4 border-r border-gray-100">
              <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-2">Decision Maker</p>
              <p className="text-sm font-semibold text-[#2C3E50]">{client.decisionMakerName}</p>
              <p className="text-xs text-[#94A3B8]">{client.decisionMakerTitle}</p>
              <p className="text-xs text-[#2E86C1] mt-1">{client.decisionMakerPhone}</p>
              <p className="text-xs text-[#2E86C1]">{client.decisionMakerEmail}</p>
            </div>
            <div className="p-4">
              <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-2">Admin Contact</p>
              <p className="text-sm font-semibold text-[#2C3E50]">{client.adminContactName}</p>
              <p className="text-xs text-[#94A3B8]">{client.adminContactTitle}</p>
              <p className="text-xs text-[#2E86C1] mt-1">{client.adminContactPhone}</p>
              <p className="text-xs text-[#2E86C1]">{client.adminContactEmail}</p>
            </div>
          </div>
        </div>

        {client.hasBroker && (
          <div>
            <SectionHeader color="bg-[#2E86C1]">Broker</SectionHeader>
            <div className="border border-gray-100 border-t-0 rounded-b-md p-4 flex flex-wrap gap-8">
              <div><p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Firm</p><p className="text-sm font-semibold text-[#2C3E50]">{client.brokerFirmName}</p></div>
              <div><p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Contact</p><p className="text-sm text-[#2C3E50]">{client.brokerContactName || "—"}</p></div>
              <div><p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Phone</p><p className="text-sm text-[#2E86C1]">{client.brokerPhone || "—"}</p></div>
              <div><p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1">Email</p><p className="text-sm text-[#2E86C1]">{client.brokerEmail || "—"}</p></div>
            </div>
          </div>
        )}

        {activePlans.length > 0 && (
          <div>
            <SectionHeader>Plans &amp; Rates</SectionHeader>
            <div className="border border-gray-100 border-t-0 rounded-b-md overflow-hidden divide-y divide-gray-50">
              {activePlans.map((plan: any) => (
                <div key={plan.id} className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[#1A5276]">{plan.planName}</span>
                      <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">Year {plan.planYear}</span>
                    </div>
                    <div className="text-[10px] text-[#94A3B8]">
                      Effective: {fmtDate(plan.effectiveDate, { month: "long", day: "numeric", year: "numeric" })}
                      &nbsp;·&nbsp; {PLAN_BASIS_LABELS[plan.planBasis] ?? plan.planBasis}
                    </div>
                  </div>
                  {(plan.rateCards ?? []).length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[#F0F4F8]">
                            <th className="text-left px-3 py-2 font-semibold text-[#64748B]">Tier</th>
                            <th className="text-right px-3 py-2 font-semibold text-[#64748B]">Base Admin</th>
                            <th className="text-right px-3 py-2 font-semibold text-[#64748B]">Simple Fee</th>
                            <th className="text-right px-3 py-2 font-semibold text-[#64748B]">Network</th>
                            <th className="text-right px-3 py-2 font-semibold text-[#64748B]">Broker Fee</th>
                            <th className="text-right px-3 py-2 font-semibold text-[#64748B]">Total Fee</th>
                            <th className="text-right px-3 py-2 font-semibold text-[#64748B]">Monthly Premium</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.rateCards.map((r: any) => (
                            <tr key={r.id} className="border-t border-gray-50">
                              <td className="px-3 py-2 font-semibold text-[#2C3E50]">{TIER_LABELS[r.tier] ?? r.tier}</td>
                              <td className="px-3 py-2 text-right text-[#2C3E50]">{formatCurrency(r.baseAdminFee)}</td>
                              <td className="px-3 py-2 text-right text-[#2C3E50]">{formatCurrency(r.simpleFee)}</td>
                              <td className="px-3 py-2 text-right text-[#2C3E50]">{formatCurrency(r.networkFee)}</td>
                              <td className="px-3 py-2 text-right text-[#2C3E50]">{formatCurrency(r.brokerFee)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-[#1A5276]">{formatCurrency(r.totalFee)}</td>
                              <td className="px-3 py-2 text-right font-bold text-[#1A5276]">{formatCurrency(r.monthlyPremium)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-[#94A3B8]">No rate cards configured.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {metric && (
          <div>
            <SectionHeader>Financial Summary — {MONTH_NAMES[(metric.reportMonth ?? 1) - 1]} {metric.reportYear}</SectionHeader>
            <div className="grid grid-cols-3 border border-gray-100 border-t-0 rounded-b-md overflow-hidden">
              <div className="p-4 border-r border-gray-100">
                <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-2">Plan</p>
                <p className="text-sm font-semibold text-[#2C3E50]">{metric.planName || "—"}</p>
              </div>
              <div className="p-4 border-r border-gray-100">
                <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-2">YTD Loss Ratio</p>
                <p className={`text-2xl font-extrabold ${parseFloat(metric.ytdLossRatio) > 100 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>
                  {fmtLossRatio(metric.ytdLossRatio)}
                </p>
                {metric.monthlyLossRatio && (
                  <p className="text-[10px] text-[#94A3B8] mt-1">Monthly: {fmtLossRatio(metric.monthlyLossRatio)}</p>
                )}
              </div>
              <div className="p-4">
                <p className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-widest mb-2">YTD Plan Position (as billed)</p>
                {surplusDeficit && (
                  <p className={`text-2xl font-extrabold ${surplusDeficit.positive ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                    {surplusDeficit.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BrokerReportPreview({ firm, clients }: { firm: string; clients: any[] }) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const totalEmployees = clients.reduce((s: number, c: any) => s + (c.numberOfEmployees ?? 0), 0);
  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-100">
      <div className="bg-gradient-to-r from-[#1A5276] to-[#2E86C1] px-7 py-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[#F5A623] text-[9px] font-bold uppercase tracking-[3px] mb-1">Simple Benefits TPA</p>
            <h2 className="text-white text-xl font-extrabold tracking-tight">BROKER REPORT</h2>
          </div>
          <div className="text-right">
            <p className="text-white/60 text-[10px]">Generated {today}</p>
            <p className="text-white text-xs mt-1">{clients.length} Client{clients.length !== 1 ? "s" : ""} · {totalEmployees.toLocaleString()} Total Employees</p>
          </div>
        </div>
      </div>
      <div className="bg-[#F5A623] px-7 py-3">
        <p className="text-[#1A5276] text-lg font-extrabold">{firm}</p>
        <p className="text-[#1A5276]/60 text-[10px] mt-0.5">Broker Firm</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F8FAFC] border-b-2 border-gray-100">
              <th className="text-left px-4 py-3 text-[9px] font-bold text-[#64748B] uppercase tracking-widest">Client</th>
              <th className="text-left px-4 py-3 text-[9px] font-bold text-[#64748B] uppercase tracking-widest">Plan Type</th>
              <th className="text-left px-4 py-3 text-[9px] font-bold text-[#64748B] uppercase tracking-widest">Plan(s)</th>
              <th className="text-center px-4 py-3 text-[9px] font-bold text-[#64748B] uppercase tracking-widest">Anniversary</th>
              <th className="text-center px-4 py-3 text-[9px] font-bold text-[#64748B] uppercase tracking-widest">Employees</th>
              <th className="text-center px-4 py-3 text-[9px] font-bold text-[#64748B] uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c: any) => {
              const activePlans = (c.plans ?? []).filter((p: any) => !p.isArchived);
              const anniversary = activePlans.length > 0 ? fmtAnniversary(activePlans[0].effectiveDate) : "—";
              const planNames = activePlans.map((p: any) => p.planName).join(", ") || "—";
              return (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#2C3E50]">{c.clientName}</p>
                    <p className="text-[10px] text-[#94A3B8]">{c.clientCode}</p>
                  </td>
                  <td className="px-4 py-3 text-[#64748B] text-xs">{PLAN_TYPE_LABELS[c.planType] ?? c.planType}</td>
                  <td className="px-4 py-3 text-[#64748B] text-xs max-w-[200px] truncate">{planNames}</td>
                  <td className="px-4 py-3 text-center text-[#2C3E50] text-xs">{anniversary}</td>
                  <td className="px-4 py-3 text-center font-bold text-[#1A5276]">{(c.numberOfEmployees ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${c.isActive ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#FEE2E2] text-[#991B1B]"}`}>
                      {c.isActive ? "Active" : "Terminated"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-[#F0F4F8] border-t-2 border-gray-200">
              <td colSpan={4} className="px-4 py-3 font-bold text-[#1A5276] text-xs uppercase tracking-wide">Totals</td>
              <td className="px-4 py-3 text-center font-extrabold text-[#1A5276] text-base">{totalEmployees.toLocaleString()}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Client Summary ──────────────────────────────────────────────────────

function ClientSummaryTab() {
  const [selectedId, setSelectedId] = useState<string>("");

  const { data: allClients = [], isLoading: clientsLoading } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const { data: client, isLoading: clientLoading } = useQuery<any>({
    queryKey: ["/api/clients", selectedId],
    enabled: !!selectedId,
  });

  const { data: plansRaw = [], isLoading: plansLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", selectedId, "plans"],
    queryFn: () => fetch(`/api/clients/${selectedId}/plans`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    enabled: !!selectedId,
  });

  const { data: metrics = [], isLoading: metricsLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", selectedId, "ppr-metrics"],
    queryFn: () => fetch(`/api/clients/${selectedId}/ppr-metrics`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    enabled: !!selectedId,
  });

  const isDataLoading = clientLoading || plansLoading || metricsLoading;
  const hasData = !!selectedId && client && !isDataLoading;

  const handlePrint = () => {
    if (!hasData) return;
    const html = buildClientSummaryHtml(client, plansRaw, metrics);
    openPrintWindow(html);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex-1 max-w-xs">
          {clientsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger data-testid="select-report-client">
                <SelectValue placeholder="Select a client…" />
              </SelectTrigger>
              <SelectContent>
                {(allClients as any[]).map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)} data-testid={`option-client-${c.id}`}>
                    {c.clientCode} — {c.clientName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {hasData && (
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2 text-sm" onClick={handlePrint} data-testid="button-print-client-summary">
              <Printer className="w-4 h-4" /> Print
            </Button>
            <Button className="gap-2 text-sm bg-[#1A5276] text-white" onClick={handlePrint} data-testid="button-pdf-client-summary">
              <Download className="w-4 h-4" /> Download PDF
            </Button>
          </div>
        )}
      </div>

      {!selectedId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="w-12 h-12 text-[#CBD5E1] mb-4" />
          <p className="text-[#94A3B8] font-medium">Select a client to generate the summary report</p>
          <p className="text-sm text-[#CBD5E1] mt-1">Includes contacts, plans, rate cards and financial summary</p>
        </div>
      )}

      {selectedId && isDataLoading && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {hasData && (
        <ClientSummaryPreview client={client} plans={plansRaw} metrics={metrics} />
      )}
    </div>
  );
}

// ─── Tab: Broker Report ───────────────────────────────────────────────────────

function BrokerReportTab() {
  const [firmInput, setFirmInput] = useState("");
  const [searchFirm, setSearchFirm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchFirm(firmInput.trim()), 400);
    return () => clearTimeout(t);
  }, [firmInput]);

  const { data: clients = [], isFetching } = useQuery<any[]>({
    queryKey: ["/api/reports/broker", searchFirm],
    queryFn: () =>
      fetch(`/api/reports/broker?firm=${encodeURIComponent(searchFirm)}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : []),
    enabled: searchFirm.length >= 2,
  });

  const hasResults = searchFirm.length >= 2 && !isFetching && (clients as any[]).length > 0;

  const handlePrint = () => {
    if (!hasResults) return;
    const html = buildBrokerReportHtml(searchFirm, clients as any[]);
    openPrintWindow(html);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
          <Input
            ref={inputRef}
            value={firmInput}
            onChange={e => setFirmInput(e.target.value)}
            placeholder="Search broker firm name…"
            className="pl-9"
            data-testid="input-broker-search"
          />
        </div>
        {hasResults && (
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2 text-sm" onClick={handlePrint} data-testid="button-print-broker-report">
              <Printer className="w-4 h-4" /> Print
            </Button>
            <Button className="gap-2 text-sm bg-[#1A5276] text-white" onClick={handlePrint} data-testid="button-pdf-broker-report">
              <Download className="w-4 h-4" /> Download PDF
            </Button>
          </div>
        )}
      </div>

      {firmInput.length < 2 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="w-12 h-12 text-[#CBD5E1] mb-4" />
          <p className="text-[#94A3B8] font-medium">Search by broker firm name</p>
          <p className="text-sm text-[#CBD5E1] mt-1">Lists all clients, their plans, anniversary and headcount</p>
        </div>
      )}

      {firmInput.length >= 2 && isFetching && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {firmInput.length >= 2 && !isFetching && (clients as any[]).length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="w-10 h-10 text-[#CBD5E1] mb-3" />
          <p className="text-[#94A3B8] font-medium">No clients found for "{searchFirm}"</p>
          <p className="text-sm text-[#CBD5E1] mt-1">Try a different broker firm name</p>
        </div>
      )}

      {hasResults && (
        <BrokerReportPreview firm={searchFirm} clients={clients as any[]} />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5276]">Reports</h1>
        <p className="text-sm text-[#94A3B8] mt-1">Generate, view, print, and download formatted reports</p>
      </div>

      <Tabs defaultValue="client-summary">
        <TabsList className="bg-white border mb-6">
          <TabsTrigger value="client-summary" data-testid="tab-report-client-summary" className="gap-2 data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">
            <FileText className="w-3.5 h-3.5" /> Client Summary
          </TabsTrigger>
          <TabsTrigger value="broker" data-testid="tab-report-broker" className="gap-2 data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">
            <Building2 className="w-3.5 h-3.5" /> Broker Report
          </TabsTrigger>
        </TabsList>

        <TabsContent value="client-summary">
          <ClientSummaryTab />
        </TabsContent>

        <TabsContent value="broker">
          <BrokerReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
