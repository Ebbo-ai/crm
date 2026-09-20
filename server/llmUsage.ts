import { db } from "./db";
import { llmUsageLog } from "@shared/schema";
import { and, gte, sql as dsql } from "drizzle-orm";
import { storage } from "./storage";

/**
 * Approximate published list pricing, USD per token. These are estimates for
 * visibility and budgeting — not what Anthropic actually bills, which can
 * differ with prompt caching, batch discounts, or price changes. Good enough
 * to catch a runaway loop before it burns real money; not good enough to
 * reconcile against an invoice.
 */
const PRICING_PER_TOKEN_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  "claude-sonnet-4-5": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

const DEFAULT_DAILY_CEILING_USD = 20;
export const LLM_DAILY_CEILING_SETTING_KEY = "LLM_DAILY_CEILING_USD";

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_PER_TOKEN_USD[model];
  if (!pricing) return 0;
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

/**
 * Call right after every anthropic.messages.create() returns, using the
 * response's own usage block — never a pre-call estimate, which would drift
 * from what actually got billed as prompts vary in length.
 */
export async function recordLlmCall(params: {
  mailbox: string;
  callType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  try {
    const cost = estimateCostUsd(params.model, params.inputTokens, params.outputTokens);
    await db.insert(llmUsageLog).values({
      mailbox: params.mailbox,
      callType: params.callType,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      estimatedCostUsd: cost.toFixed(6),
    });
  } catch (err: any) {
    // Never let usage logging take down the actual LLM call it's tracking.
    console.error("[llmUsage] failed to record call:", err?.message || String(err));
  }
}

export async function getDailyCeilingUsd(): Promise<number> {
  const row = await storage.getAppSetting(LLM_DAILY_CEILING_SETTING_KEY);
  const parsed = row?.value ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_CEILING_USD;
}

export async function setDailyCeilingUsd(value: number, updatedBy: string): Promise<void> {
  await storage.setAppSetting(LLM_DAILY_CEILING_SETTING_KEY, String(value), updatedBy);
}

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getTodaySpendUsd(): Promise<number> {
  const rows = await db
    .select({ total: dsql<string>`COALESCE(SUM(${llmUsageLog.estimatedCostUsd}), 0)` })
    .from(llmUsageLog)
    .where(gte(llmUsageLog.createdAt, startOfTodayUtc()));
  return Number(rows[0]?.total || 0);
}

/**
 * Gate checked once per sync run (not once per call) so behaviour is stable
 * across a single run — cheap enough to re-check next run a few minutes
 * later. Only enrichment (matching/classifying/summarizing/extracting) is
 * gated; raw message ingestion never stops, so mail keeps arriving in the
 * CRM even with LLM spend paused for the day.
 */
export async function isEnrichmentPaused(): Promise<{ paused: boolean; todaySpend: number; ceiling: number }> {
  const [todaySpend, ceiling] = await Promise.all([getTodaySpendUsd(), getDailyCeilingUsd()]);
  return { paused: todaySpend >= ceiling, todaySpend, ceiling };
}

export interface LlmUsageSummary {
  todaySpendUsd: number;
  ceilingUsd: number;
  paused: boolean;
  byMailbox: { mailbox: string; calls: number; costUsd: number }[];
  byCallType: { callType: string; calls: number; costUsd: number }[];
  totalCalls: number;
  totalCostUsd: number;
}

export async function getUsageSummary(): Promise<LlmUsageSummary> {
  const [{ paused, todaySpend, ceiling }, byMailboxRows, byCallTypeRows, totalsRows] = await Promise.all([
    isEnrichmentPaused(),
    db
      .select({
        mailbox: llmUsageLog.mailbox,
        calls: dsql<string>`COUNT(*)`,
        costUsd: dsql<string>`COALESCE(SUM(${llmUsageLog.estimatedCostUsd}), 0)`,
      })
      .from(llmUsageLog)
      .groupBy(llmUsageLog.mailbox),
    db
      .select({
        callType: llmUsageLog.callType,
        calls: dsql<string>`COUNT(*)`,
        costUsd: dsql<string>`COALESCE(SUM(${llmUsageLog.estimatedCostUsd}), 0)`,
      })
      .from(llmUsageLog)
      .groupBy(llmUsageLog.callType),
    db
      .select({
        calls: dsql<string>`COUNT(*)`,
        costUsd: dsql<string>`COALESCE(SUM(${llmUsageLog.estimatedCostUsd}), 0)`,
      })
      .from(llmUsageLog),
  ]);

  return {
    todaySpendUsd: todaySpend,
    ceilingUsd: ceiling,
    paused,
    byMailbox: byMailboxRows.map((r) => ({ mailbox: r.mailbox, calls: Number(r.calls), costUsd: Number(r.costUsd) })),
    byCallType: byCallTypeRows.map((r) => ({ callType: r.callType, calls: Number(r.calls), costUsd: Number(r.costUsd) })),
    totalCalls: Number(totalsRows[0]?.calls || 0),
    totalCostUsd: Number(totalsRows[0]?.costUsd || 0),
  };
}
