import { db } from "./db";
import { clients, brokerContacts, vendorContacts } from "@shared/schema";
import { storage } from "./storage";

/**
 * Steve's mailbox is a personal account that also carries 30 years of
 * business correspondence, so it is the one mailbox the CRM never ingests
 * wholesale. A message is only ever looked at if its counterparty is a known
 * business contact: an exact address (client/broker contacts, kim.anderson@,
 * clientservice@, the 90 Degree Benefits vendor contacts) or a domain an
 * admin has explicitly approved (an employer's or brokerage's own domain).
 *
 * Free mail providers are never eligible as a domain rule — matching on
 * "gmail.com" would sweep in Steve's own personal mail — so any contact who
 * happens to use one of these is only ever matched by exact address, never
 * by domain.
 */
const FREE_PROVIDER_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com",
]);

/** simple.us is the CRM's own domain (Kim/Steve/clientservice@) — never a candidate as a generic "domain" rule; those three addresses are handled as exact matches instead. */
const OWN_DOMAIN = "simple.us";

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

function isEligibleDomain(domain: string | null): domain is string {
  return !!domain && !FREE_PROVIDER_DOMAINS.has(domain) && domain !== OWN_DOMAIN;
}

/**
 * Scans clients, broker contacts, and the 90 Degree Benefits vendor contacts
 * for domains, and stages any not already on file as pending review
 * (approved = null). Never overwrites a domain an admin has already reviewed
 * — safe to re-run any time a client or broker contact is added.
 */
export async function refreshMailAllowlistCandidates(): Promise<{ added: number; totalCandidates: number }> {
  const candidates: { domain: string; source: string; sourceLabel: string | null }[] = [];

  const clientRows = await db.select({
    clientName: clients.clientName,
    decisionMakerEmail: clients.decisionMakerEmail,
    adminContactEmail: clients.adminContactEmail,
  }).from(clients);
  for (const c of clientRows) {
    for (const email of [c.decisionMakerEmail, c.adminContactEmail]) {
      const domain = email ? domainOf(email) : null;
      if (isEligibleDomain(domain)) candidates.push({ domain, source: "CLIENT", sourceLabel: c.clientName });
    }
  }

  const brokerRows = await db.select({ email: brokerContacts.email, contactName: brokerContacts.contactName }).from(brokerContacts);
  for (const b of brokerRows) {
    const domain = b.email ? domainOf(b.email) : null;
    if (isEligibleDomain(domain)) candidates.push({ domain, source: "BROKER", sourceLabel: b.contactName });
  }

  const vendorRows = await db.select({ email: vendorContacts.email, name: vendorContacts.name }).from(vendorContacts);
  for (const v of vendorRows) {
    const domain = v.email ? domainOf(v.email) : null;
    if (isEligibleDomain(domain)) candidates.push({ domain, source: "VENDOR", sourceLabel: v.name || "90 Degree Benefits" });
  }

  // Collapse to one row per domain (keep the first label seen) before handing to storage, which itself skips domains already on file.
  const seen = new Map<string, { domain: string; source: string; sourceLabel: string | null }>();
  for (const c of candidates) if (!seen.has(c.domain)) seen.set(c.domain, c);
  const deduped = Array.from(seen.values());

  const added = await storage.addCandidateMailAllowlistDomains(deduped);
  return { added, totalCandidates: deduped.length };
}

export interface AllowlistCheck {
  allowed: boolean;
  reason: "exact_address" | "approved_domain" | "not_allowed";
}

/**
 * Every exact address Steve's mailbox is allowed to surface: the two shared
 * mailboxes, every client/broker contact's own address (regardless of
 * domain — a broker on gmail.com is still a known business contact), and the
 * 90 Degree Benefits vendor contacts.
 */
export async function buildExactAllowlist(): Promise<Set<string>> {
  const addresses = new Set<string>(["kim.anderson@simple.us", "clientservice@simple.us"]);

  const clientRows = await db.select({
    decisionMakerEmail: clients.decisionMakerEmail,
    adminContactEmail: clients.adminContactEmail,
    brokerEmail: clients.brokerEmail,
  }).from(clients);
  for (const c of clientRows) {
    for (const email of [c.decisionMakerEmail, c.adminContactEmail, c.brokerEmail]) {
      if (email) addresses.add(email.trim().toLowerCase());
    }
  }

  const brokerRows = await db.select({ email: brokerContacts.email }).from(brokerContacts);
  for (const b of brokerRows) if (b.email) addresses.add(b.email.trim().toLowerCase());

  const vendorRows = await db.select({ email: vendorContacts.email }).from(vendorContacts);
  for (const v of vendorRows) if (v.email) addresses.add(v.email.trim().toLowerCase());

  return addresses;
}

/** True when at least one counterparty address is one of the 90 Degree Benefits vendor contacts — used to file otherwise-unmatched threads to the vendor entity instead of leaving them unassigned. */
export async function isVendorCorrespondence(addresses: string[]): Promise<boolean> {
  const vendorRows = await db.select({ email: vendorContacts.email }).from(vendorContacts);
  const vendorAddresses = new Set(vendorRows.map(v => v.email?.trim().toLowerCase()).filter((e): e is string => !!e));
  if (vendorAddresses.size === 0) return false;
  return addresses.some(a => vendorAddresses.has(a.trim().toLowerCase()));
}

/** Every counterparty address on the message (from/to/cc) is checked; any single match allows the whole message through. */
export async function checkAllowlist(addresses: string[]): Promise<AllowlistCheck> {
  const exact = await buildExactAllowlist();
  const approvedDomains = await storage.getApprovedMailAllowlistDomains();
  for (const raw of addresses) {
    const email = raw.trim().toLowerCase();
    if (exact.has(email)) return { allowed: true, reason: "exact_address" };
    const domain = domainOf(email);
    if (domain && approvedDomains.has(domain)) return { allowed: true, reason: "approved_domain" };
  }
  return { allowed: false, reason: "not_allowed" };
}
