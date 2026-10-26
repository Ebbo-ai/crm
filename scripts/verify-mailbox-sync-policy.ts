import assert from "node:assert/strict";
import fs from "node:fs";
import { isMailboxSyncEnabled, requireMailboxSyncEnabled } from "../server/mailboxSyncPolicy";

for (const mailbox of ["steve.schultz@simple.us", "clientservice@simple.us", "unknown@example.com"]) {
  assert.equal(isMailboxSyncEnabled(mailbox), false);
  assert.equal(isMailboxSyncEnabled(`${mailbox}#full`), false);
  assert.throws(() => requireMailboxSyncEnabled(mailbox), /ingestion is disabled/);
}
assert.equal(isMailboxSyncEnabled(" KIM.ANDERSON@SIMPLE.US "), true);
assert.equal(isMailboxSyncEnabled("kim.anderson@simple.us#full"), true);
assert.doesNotThrow(() => requireMailboxSyncEnabled("kim.anderson@simple.us"));
const full = fs.readFileSync("server/gmailFullSync.ts", "utf8");
assert.ok(full.indexOf("if (!isMailboxSyncEnabled(mailbox))") < full.indexOf("await storage.claimGmailSyncRun"));
assert.match(full, /if \(!isMailboxSyncEnabled\(account.mailbox\)\) continue/);
assert.match(full, /thread && !isMailboxSyncEnabled\(thread.mailbox\)/);
const backfill = fs.readFileSync("server/gmailLabelBackfill.ts", "utf8");
assert.equal(backfill.match(/requireMailboxSyncEnabled\(mailbox\);/g)?.length, 4);
const storage = fs.readFileSync("server/storage.ts", "utf8");
assert.match(storage, /where\(and\(where, eq\(gmailThreads.mailbox, SYNC_MAILBOX\)\)\)/);
assert.match(storage, /SELECT id FROM gmail_threads WHERE mailbox = \$\{SYNC_MAILBOX\}/);
assert.match(storage, /source_gmail_message_id IS NOT NULL AND \$\{pattern\} AND \$\{maintainableDocument\}/);
assert.match(fs.readFileSync(".replit", "utf8"), /deploymentTarget = "vm"/);
assert.match(fs.readFileSync("server/googleOAuth.ts", "utf8"), /steve.schultz@simple.us/);
assert.doesNotMatch(fs.readFileSync("server/gmailSend.ts", "utf8"), /requireMailboxSyncEnabled/);
assert.match(fs.readFileSync("server/digest.ts", "utf8"), /sendEmail/);
console.log("PASS: policy behavior and ingestion entry-point wiring; OAuth/sending and digest preserved. No database or Gmail calls.");
