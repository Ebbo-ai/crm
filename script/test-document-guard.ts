/**
 * Checks the internal-only document guard against representative recipient
 * lists. Run with: npx tsx script/test-document-guard.ts
 *
 * Nothing in the app can attach a document to an email yet, so the guard is
 * exercised directly rather than through a UI that does not exist. When the
 * attach flow arrives with the Communications tab, these cases are the ones
 * it has to keep passing.
 */

import { checkDocumentRecipientGuard, checkOutboundDocumentGuard, extractEmailAddress } from "../server/documentGuards";
import { INTERNAL_ONLY_DOCUMENT_CATEGORIES } from "../shared/documentPolicy";

const TRANSMITTAL = { id: 101, documentName: "Plan Transmittal, Plan Year 2026", category: "PLAN_TRANSMITTAL" };
const COMMISSION = { id: 102, documentName: "Broker Commission Schedule 2026", category: "BROKER_COMPENSATION" };
const HANDOUT = { id: 103, documentName: "Open Enrollment Handout", category: "HANDOUT" };

const KIM = "kim.anderson@simple.us";
const STEVE = "steve.schultz@simple.us";
const DENTAL = "office@simple.dental";
const TPA = `admin@${process.env.INTERNAL_EMAIL_DOMAIN || "90degreebenefits.com"}`;
const CLIENT = "hr@acmewidgets.com";
const BROKER = "jane@brokerfirm.com";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}

console.log("\n── Recipient lists ──");

check(
  "internal-only recipients: allowed",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [KIM, STEVE], cc: [DENTAL], bcc: [TPA] }).allowed,
  true,
);

check(
  "one external among internals (To): blocked",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [KIM, CLIENT, STEVE] }).allowed,
  false,
);

check(
  "external in Cc only: blocked",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [KIM], cc: [BROKER] }).allowed,
  false,
);

// The one that gets missed: Bcc is invisible in most compose UIs once sent.
const bccResult = checkOutboundDocumentGuard([TRANSMITTAL], { to: [KIM, STEVE], cc: [TPA], bcc: [BROKER] });
check("external in Bcc only: blocked", bccResult.allowed, false);
check("Bcc refusal names the field", bccResult.blocked[0]?.recipients[0], { field: "Bcc", address: BROKER });
check("Bcc refusal names the document", bccResult.blocked[0]?.documentName, TRANSMITTAL.documentName);

console.log("\n── Documents in the message ──");

check(
  "transmittal alone, external recipient: blocked",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [CLIENT] }).allowed,
  false,
);

check(
  "transmittal mixed with a permitted document, external recipient: whole send blocked",
  checkOutboundDocumentGuard([HANDOUT, TRANSMITTAL], { to: [CLIENT] }).allowed,
  false,
);

check(
  "permitted document alone, external recipient: allowed",
  checkOutboundDocumentGuard([HANDOUT], { to: [CLIENT, BROKER] }).allowed,
  true,
);

check(
  "commission sheet (BROKER_COMPENSATION) to the broker: blocked",
  checkOutboundDocumentGuard([COMMISSION], { to: [BROKER] }).allowed,
  false,
);

check(
  "no documents at all: allowed",
  checkOutboundDocumentGuard([], { to: [CLIENT, BROKER] }).allowed,
  true,
);

check(
  "internal-only document, internal recipients, no attachments declared: allowed",
  checkOutboundDocumentGuard(undefined, { to: [CLIENT] }).allowed,
  true,
);

console.log("\n── Recipient parsing ──");

check("display-name form is read", extractEmailAddress("Jane Broker <jane@brokerfirm.com>"), BROKER);
check("case and spacing normalised", extractEmailAddress("  KIM.Anderson@Simple.US "), KIM);
check("unparseable recipient reads as nothing", extractEmailAddress("not an address"), null);

check(
  "display-name external recipient still blocked",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: ["Kim <kim.anderson@simple.us>", "HR Team <hr@acmewidgets.com>"] }).allowed,
  false,
);

check(
  "unparseable recipient fails closed",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [KIM, "whoever it was"] }).allowed,
  false,
);

check(
  "lookalike domain is external",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: ["someone@notsimple.us"] }).allowed,
  false,
);

check(
  "comma-separated string is split, not treated as one address",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: `${KIM}, ${CLIENT}` }).allowed,
  false,
);

// An address list pasted into one box arrives as a single array entry. Read
// only its last address and the outsider in front of it travels unnoticed.
check(
  "two addresses inside one array entry: both are checked",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [`Jane <${BROKER}>, Kim <${KIM}>`] }).allowed,
  false,
);

check(
  "outsider inside one Bcc array entry: blocked",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [KIM], bcc: [`${TPA}, ${BROKER}`] }).allowed,
  false,
);

check(
  "semicolon-separated entry is split",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [`${KIM}; ${CLIENT}`] }).allowed,
  false,
);

check(
  "two addresses in one entry, both internal: allowed",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [`${KIM}, ${STEVE}`] }).allowed,
  true,
);

// A comma inside a quoted display name is part of the name, not a separator.
check(
  "quoted display name containing a comma is one internal recipient",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [`"Anderson, Kim" <${KIM}>`] }).allowed,
  true,
);

check(
  "quoted display name hiding an outsider is still caught",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [`"Broker, Jane" <${BROKER}>`] }).allowed,
  false,
);

check(
  "two bare addresses separated by a space: both are checked",
  checkOutboundDocumentGuard([TRANSMITTAL], { to: [`${KIM} ${CLIENT}`] }).allowed,
  false,
);

console.log("\n── Message returned to the sender ──");

const message = checkOutboundDocumentGuard([TRANSMITTAL], { to: [KIM], bcc: [BROKER] }).message || "";
check("names the document", message.includes(TRANSMITTAL.documentName), true);
check("names the recipient", message.includes(BROKER), true);
check("names the field", message.includes("(Bcc)"), true);

console.log("\n── Single-category entry point ──");

check(
  "checkDocumentRecipientGuard still blocks",
  checkDocumentRecipientGuard("PLAN_TRANSMITTAL", [KIM, CLIENT]).allowed,
  false,
);
check(
  "checkDocumentRecipientGuard still allows",
  checkDocumentRecipientGuard("PLAN_TRANSMITTAL", [KIM, TPA]).allowed,
  true,
);
check(
  "unrestricted category passes",
  checkDocumentRecipientGuard("HANDOUT", [CLIENT]).allowed,
  true,
);

console.log(`\nInternal-only categories: ${INTERNAL_ONLY_DOCUMENT_CATEGORIES.join(", ")}`);
console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
