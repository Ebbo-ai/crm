import { storage } from "./storage";
import { classifyDomain } from "./claude";
import { buildExactAllowlist, isOwnDomain } from "./mailAllowlist";
import {
  getHeader,
  parseAddressList,
  getMessageMetadata,
  searchMessageIdsByLabel,
} from "./gmail";

/**
 * One-time historical backfill for a Gmail label, scoped to a single
 * counterparty domain census rather than per-message classification:
 *
 *   1. Census (this module, `runDomainCensusBatch`) — walk every message
 *      under the label, resolve one counterparty domain per thread (skipping
 *      Simple Benefits' own domains), and bucket each thread. Free-mail
 *      senders (gmail.com etc.) are resolved by exact address against the
 *      same allow-list used for steve.schultz@'s live sync, since a domain
 *      rule there would be meaningless. Threads with no resolvable non-own
 *      sender at all land in NO_EXTERNAL_DOMAIN for review.
 *   2. Classify (`classifyDomainsBatch`) — one Claude call per unique
 *      pending domain (never per thread), verdict applied to every thread
 *      from it.
 *   3. Only BUSINESS-domain and resolved-free-provider threads are ever
 *      eligible for the message-body import phase (not built by this
 *      module) — CONSUMER-domain and unresolved threads are never stored.
 *
 * Both passes are resumable: `gmail_backfill_threads` records one row per
 * thread the moment it's first seen, so an interrupted run picks up exactly
 * where it left off instead of re-walking already-censused threads. This
 * must only ever be triggered explicitly (an admin action) — never wired
 * into the poller or run-on-restart, since it's a one-time historical pass,
 * not an ongoing sync.
 */

const FREE_PROVIDER_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com",
]);

/** Bounds one census call the same way MAX_MESSAGES_PER_RUN bounds gmailFullSync — call again to continue. */
const MAX_THREADS_PER_CENSUS_BATCH = 200;
const MAX_DOMAINS_PER_CLASSIFY_BATCH = 40;

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

function stateKeyForCensus(label: string): string {
  return `backfillCensus:${label}`;
}

export interface CensusBatchResult {
  threadsScanned: number;
  done: boolean;
  errors: string[];
}

/**
 * Processes up to MAX_THREADS_PER_CENSUS_BATCH not-yet-seen threads under
 * the label. Every message on a thread is checked (not just the first) so a
 * thread where Steve is only cc'd on message 3 still resolves to the real
 * counterparty. Call repeatedly (the persisted Gmail pageToken cursor
 * advances each call) until `done` is true.
 */
export async function runDomainCensusBatch(mailbox: string, label: string): Promise<CensusBatchResult> {
  const stateKey = stateKeyForCensus(label);
  const state = await storage.getGmailImportState(stateKey);
  let pageToken: string | undefined = state?.lastProcessedInternalDate || undefined;
  const exactAllowlist = await buildExactAllowlist();

  const query = `label:"${label}"`;
  const result: CensusBatchResult = { threadsScanned: 0, done: false, errors: [] };
  const seenThreadsThisBatch = new Set<string>();

  do {
    const page = await searchMessageIdsByLabel(mailbox, query, pageToken, 100);
    for (const ref of page.messages || []) {
      if (seenThreadsThisBatch.has(ref.threadId)) continue; // another message on a thread already resolved this batch
      const already = await storage.getBackfillThread(mailbox, label, ref.threadId);
      if (already) continue; // resumable: skip threads a prior (interrupted) run already recorded

      try {
        // Gmail's list endpoint returns message ids, not grouped by thread —
        // fetch every message id search would otherwise skip on this thread by
        // asking Gmail directly for the thread's message list via one more
        // metadata call per candidate message. To bound API calls, resolve
        // from this message's own headers first; only widen to a full thread
        // fetch if this message alone is own-domain-only or unparseable.
        const meta = await getMessageMetadata(mailbox, ref.id);
        const addresses: string[] = [];
        for (const h of ["From", "To", "Cc"]) {
          for (const a of parseAddressList(getHeader(meta.payload, h))) addresses.push(a.email);
        }
        const external = addresses.filter((a) => a.toLowerCase() !== mailbox.toLowerCase());

        let category: string;
        let domain: string | null = null;
        let resolvedContactEmail: string | null = null;

        const nonOwnExternal = external.filter((a) => !isOwnDomain(domainOf(a)));
        if (nonOwnExternal.length === 0) {
          category = external.length > 0 ? "OWN_ONLY" : "NO_EXTERNAL_DOMAIN";
        } else {
          // Prefer a non-free-provider domain if this thread has one — a
          // free-mail cc alongside a real business domain shouldn't hide it.
          const businessCandidate = nonOwnExternal.find((a) => {
            const d = domainOf(a);
            return d && !FREE_PROVIDER_DOMAINS.has(d);
          });
          if (businessCandidate) {
            domain = domainOf(businessCandidate);
            category = "DOMAIN_PENDING";
          } else {
            // Every non-own external address is on a free provider.
            const exactMatch = nonOwnExternal.find((a) => exactAllowlist.has(a.toLowerCase()));
            if (exactMatch) {
              category = "FREE_PROVIDER_RESOLVED";
              resolvedContactEmail = exactMatch.toLowerCase();
            } else {
              category = "FREE_PROVIDER_UNRESOLVED";
            }
          }
        }

        await storage.createBackfillThread({ mailbox, label, gmailThreadId: ref.threadId, domain, category, resolvedContactEmail });
        if (domain && category === "DOMAIN_PENDING") {
          await storage.incrementBackfillDomainCount(mailbox, label, domain);
        }
        seenThreadsThisBatch.add(ref.threadId);
        result.threadsScanned++;
      } catch (err: any) {
        result.errors.push(`thread ${ref.threadId}: ${err?.message || String(err)}`);
      }
    }
    pageToken = page.nextPageToken;
    await storage.upsertGmailImportState(stateKey, { lastProcessedInternalDate: pageToken || null, lastRunAt: new Date() });
    if (result.threadsScanned >= MAX_THREADS_PER_CENSUS_BATCH) break;
  } while (pageToken);

  result.done = !pageToken;
  return result;
}

export interface ClassifyBatchResult {
  domainsClassified: number;
  businessDomains: string[];
  consumerDomains: string[];
  done: boolean;
}

/**
 * One Claude call per still-PENDING domain, verdict applied to every thread
 * recorded against it. Sample subjects come from a fresh label+domain
 * search rather than anything stored during census, so classification can
 * be re-run independently (e.g. after a prompt tweak) without re-censusing.
 */
export async function classifyDomainsBatch(mailbox: string, label: string): Promise<ClassifyBatchResult> {
  const pending = (await storage.getPendingBackfillDomains(mailbox, label)).slice(0, MAX_DOMAINS_PER_CLASSIFY_BATCH);
  const result: ClassifyBatchResult = { domainsClassified: 0, businessDomains: [], consumerDomains: [], done: pending.length === 0 };

  for (const row of pending) {
    let sampleSubjects: string[] = [];
    try {
      const page = await searchMessageIdsByLabel(mailbox, `label:"${label}" "${row.domain}"`, undefined, 8);
      for (const ref of (page.messages || []).slice(0, 8)) {
        const meta = await getMessageMetadata(mailbox, ref.id);
        const subject = getHeader(meta.payload, "Subject");
        if (subject) sampleSubjects.push(subject);
      }
    } catch {
      // Sampling failure just means the classifier gets fewer signals, not a hard stop.
    }

    const { verdict } = await classifyDomain(row.domain, sampleSubjects, { mailbox });
    await storage.setBackfillDomainVerdict(row.id, verdict, "claude-haiku-4-5");
    await db_updateThreadsForDomain(mailbox, label, row.domain, verdict);
    result.domainsClassified++;
    if (verdict === "BUSINESS") result.businessDomains.push(row.domain);
    else result.consumerDomains.push(row.domain);
  }

  const stillPending = await storage.getPendingBackfillDomains(mailbox, label);
  result.done = stillPending.length === 0;
  return result;
}

/** Flips every DOMAIN_PENDING thread row for this domain to the domain's verdict. Kept private — routes only ever call the batch functions above. */
async function db_updateThreadsForDomain(mailbox: string, label: string, domain: string, verdict: "BUSINESS" | "CONSUMER"): Promise<void> {
  const rows = await storage.getBackfillThreadsByCategories(mailbox, label, ["DOMAIN_PENDING"], false);
  for (const row of rows) {
    if (row.domain === domain) await storage.updateBackfillThreadCategory(row.id, verdict);
  }
}

export interface BackfillReport {
  label: string;
  totalThreadsCensused: number;
  byCategory: Record<string, number>;
  businessDomains: { domain: string; threadCount: number }[];
  consumerDomains: { domain: string; threadCount: number }[];
  pendingDomains: number;
  censusComplete: boolean;
}

export async function getBackfillReport(mailbox: string, label: string): Promise<BackfillReport> {
  const byCategoryRows = await storage.countBackfillThreadsByCategory(mailbox, label);
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const r of byCategoryRows) { byCategory[r.category] = r.count; total += r.count; }

  const domains = await storage.getBackfillDomains(mailbox, label);
  const state = await storage.getGmailImportState(stateKeyForCensus(label));

  return {
    label,
    totalThreadsCensused: total,
    byCategory,
    businessDomains: domains.filter(d => d.verdict === "BUSINESS").map(d => ({ domain: d.domain, threadCount: d.threadCount })),
    consumerDomains: domains.filter(d => d.verdict === "CONSUMER").map(d => ({ domain: d.domain, threadCount: d.threadCount })),
    pendingDomains: domains.filter(d => d.verdict === "PENDING").length,
    censusComplete: !state?.lastProcessedInternalDate,
  };
}

/** Feeds every BUSINESS-verdict domain back into the mail allow-list as a pending candidate (never auto-approved) so it's reviewed once, in the same place every other domain rule is reviewed. */
export async function feedBusinessDomainsToAllowlist(mailbox: string, label: string): Promise<number> {
  const domains = await storage.getBackfillDomains(mailbox, label);
  const business = domains.filter(d => d.verdict === "BUSINESS");
  return storage.addCandidateMailAllowlistDomains(
    business.map(d => ({ domain: d.domain, source: "GMAIL_BACKFILL", sourceLabel: `"${label}" label (${d.threadCount} threads)` })),
  );
}
