import type { ClientRef } from "./claude";

/**
 * Deterministic (no-LLM) client matching used by the rolling full sync
 * (server/gmailFullSync.ts) to resolve a client from a group number or a
 * known contact address before ever spending an LLM call on it.
 */

const FREE_PROVIDER_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com"]);
const OWN_DOMAINS = new Set(["simple.us", "simple.dental"]);

export interface DeterministicLookup {
  addressToClientIds: Map<string, Set<number>>;
  domainToClientIds: Map<string, Set<number>>;
  /** Normalized "S-123" style group code -> client id. */
  codeToClientId: Map<string, number>;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/** Same normalization as server/crm-import.ts's normalizeCode — "S-020"/"S020"/"s 20" all collapse to "S-20". */
function normalizeGroupCode(code: string): string {
  const m = /^([A-Za-z]+)[-\s]*0*(\d+)$/.exec(String(code).trim());
  return m ? `${m[1].toUpperCase()}-${m[2]}` : String(code).trim().toUpperCase();
}

/** Built once per run from the same client/broker addresses buildClientRefs already exposes — no extra DB query needed. */
export function buildDeterministicLookup(clientRefs: ClientRef[]): DeterministicLookup {
  const addressToClientIds = new Map<string, Set<number>>();
  const domainToClientIds = new Map<string, Set<number>>();
  const codeToClientId = new Map<string, number>();

  const addAddress = (email: string | null | undefined, clientId: number) => {
    if (!email) return;
    const addr = email.trim().toLowerCase();
    if (!addr.includes("@")) return;
    if (!addressToClientIds.has(addr)) addressToClientIds.set(addr, new Set());
    addressToClientIds.get(addr)!.add(clientId);

    const domain = domainOf(addr);
    if (domain && !FREE_PROVIDER_DOMAINS.has(domain) && !OWN_DOMAINS.has(domain)) {
      if (!domainToClientIds.has(domain)) domainToClientIds.set(domain, new Set());
      domainToClientIds.get(domain)!.add(clientId);
    }
  };

  for (const c of clientRefs) {
    addAddress(c.decisionMakerEmail, c.id);
    addAddress(c.adminContactEmail, c.id);
    for (const e of c.brokerEmails || []) addAddress(e, c.id);
    if (c.clientCode) codeToClientId.set(normalizeGroupCode(c.clientCode), c.id);
  }

  return { addressToClientIds, domainToClientIds, codeToClientId };
}

/** Matches an "S###"/"S-###" style group number appearing in a subject or filename. */
function extractGroupCode(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const m = /\b([A-Za-z]{1,3})[-\s]?0*(\d{2,5})\b/.exec(text);
    if (m) return normalizeGroupCode(`${m[1]}-${m[2]}`);
  }
  return null;
}

export interface DeterministicMatchResult {
  clientIds: number[];
  method: "group_code" | "address" | "domain" | null;
}

/**
 * Tries, in order: (1) a group number in the subject or filename, (2) an
 * exact address match against From/To/Cc, (3) a domain match against
 * From/To/Cc. Returns every client id the winning method identifies —
 * almost always one, but an address/domain can legitimately belong to more
 * than one client record (a shared broker contact, a multi-division group).
 * Returns method: null (empty clientIds) when nothing deterministic hits,
 * meaning the caller should fall back to the LLM matcher.
 */
export function matchDeterministically(
  lookup: DeterministicLookup,
  input: { subject?: string | null; filename?: string | null; fromEmail?: string | null; toEmails?: string[]; ccEmails?: string[] },
): DeterministicMatchResult {
  const groupCode = extractGroupCode(input.subject, input.filename);
  if (groupCode && lookup.codeToClientId.has(groupCode)) {
    return { clientIds: [lookup.codeToClientId.get(groupCode)!], method: "group_code" };
  }

  const addresses = [input.fromEmail, ...(input.toEmails || []), ...(input.ccEmails || [])]
    .filter(Boolean)
    .map(a => a!.trim().toLowerCase());

  const addressHits = new Set<number>();
  for (const addr of addresses) {
    for (const id of Array.from(lookup.addressToClientIds.get(addr) || [])) addressHits.add(id);
  }
  if (addressHits.size > 0) return { clientIds: Array.from(addressHits), method: "address" };

  const domainHits = new Set<number>();
  for (const addr of addresses) {
    const domain = domainOf(addr);
    if (!domain) continue;
    for (const id of Array.from(lookup.domainToClientIds.get(domain) || [])) domainHits.add(id);
  }
  if (domainHits.size > 0) return { clientIds: Array.from(domainHits), method: "domain" };

  return { clientIds: [], method: null };
}
