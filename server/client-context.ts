import { storage } from "./storage";
import { countsAsActive, deriveClientState } from "@shared/client-state";
import type { ClientRef } from "./claude";

/**
 * The book of business as the AI matchers see it.
 *
 * Both matchers get the same picture on purpose. An email is identified mostly
 * by addresses; a typed to-do is identified mostly by names ("Call Annette
 * about Ware"). Building the list in one place means neither can quietly lose a
 * signal the other has.
 *
 * Closed clients are excluded. They still hold broker firms and contact
 * addresses, so leaving them in lets a dead account win a domain or firm match
 * against the live client the message is actually about. Terminating and
 * run-out clients stay in: that is exactly when the wind-down correspondence
 * arrives.
 */
export async function buildClientRefs(): Promise<ClientRef[]> {
  const [allClients, brokerEmailMap, brokerNameMap] = await Promise.all([
    storage.getClients(),
    storage.getBrokerEmailsByClient(),
    storage.getBrokerNamesByClient(),
  ]);

  return allClients
    .filter(c => countsAsActive(deriveClientState(c)))
    .map(c => ({
      id: c.id,
      clientCode: c.clientCode,
      clientName: c.clientName,
      // Every person the brokerage has on the account, not just the lead:
      // correspondence routinely comes from the service rep, who is not the
      // mirrored flat address.
      brokerEmails: brokerEmailMap.get(c.id) ?? ([c.brokerEmail].filter(Boolean) as string[]),
      brokerNames: brokerNameMap.get(c.id) ?? ([c.brokerContactName].filter(Boolean) as string[]),
      brokerFirmName: c.brokerFirmName,
      adminContactName: c.adminContactName,
      adminContactEmail: c.adminContactEmail,
      decisionMakerName: c.decisionMakerName,
      decisionMakerEmail: c.decisionMakerEmail,
    }));
}
