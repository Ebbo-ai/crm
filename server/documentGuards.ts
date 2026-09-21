/**
 * Server-side attachment guards for document categories that must never
 * reach certain recipients. Pure and side-effect free, so it can be called
 * from any future send/compose path (and unit tested) without depending on
 * request/response objects.
 *
 * Currently covers PLAN_TRANSMITTAL: it carries the admin fee breakdown,
 * which must stay internal to Simple/90 Degree Benefits. This is a hard
 * block, not a dismissible warning — callers must refuse the send/attach
 * outright when `allowed` is false, never offer a confirm-anyway dialog.
 *
 * Not yet wired into a route — the compose/attach flow that will call this
 * belongs to Requirement 2 (client Communications tab), which is out of
 * scope for the Phase 1 consolidation this module was added for. See
 * replit.md "Document model" for the record of what still needs wiring.
 */

const INTERNAL_ONLY_CATEGORIES = new Set(["PLAN_TRANSMITTAL"]);

export interface RecipientGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Domains a document tagged as internal-only may be sent to: Simple's own
 * domain and 90 Degree Benefits (the TPA). Everything else — the client, a
 * broker, anyone else — is refused.
 */
function internalAllowedDomains(): Set<string> {
  const ninetyDb = (process.env.INTERNAL_EMAIL_DOMAIN || "90degreebenefits.com").toLowerCase();
  // simple.dental is Simple Benefits' earlier domain (pre-dating the move to
  // simple.us) — still live, still ours, so still internal for this guard.
  return new Set([ninetyDb, "simple.us", "simple.dental"]);
}

/**
 * Checks whether a document of the given category may be attached to a
 * message going to the given recipients. Call this for every recipient
 * (To/Cc/Bcc) before allowing an attach or send to proceed.
 */
export function checkDocumentRecipientGuard(category: string, recipientEmails: string[]): RecipientGuardResult {
  if (!INTERNAL_ONLY_CATEGORIES.has(category)) return { allowed: true };

  const allowedDomains = internalAllowedDomains();
  const offenders = recipientEmails.filter((email) => {
    const domain = email.split("@")[1]?.toLowerCase();
    return !domain || !allowedDomains.has(domain);
  });

  if (offenders.length > 0) {
    return {
      allowed: false,
      reason: `This document contains an internal admin fee breakdown and cannot be sent to: ${offenders.join(", ")}. Remove these recipients or attach a different document.`,
    };
  }
  return { allowed: true };
}
