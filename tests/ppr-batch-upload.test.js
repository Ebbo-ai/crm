/**
 * Integration test: POST /api/ppr/batch-monthly
 *
 * Verifies three critical behaviors:
 *   (a) A ZIP with both PDF and Excel for the same client/month creates TWO separate DB rows
 *   (b) Re-uploading the same ZIP replaces existing rows (upsert), not duplicate inserts
 *   (c) Files with unrecognized client codes are skipped, not crashed
 *
 * Run: node tests/ppr-batch-upload.test.js
 * Requires the app server to be running on http://localhost:5000
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import pg from "pg";
import path from "path";
import fs from "fs";

const BASE_URL = "http://localhost:5000";
const ADMIN_EMAIL = "admin@simplebenefits.com";
const ADMIN_PASSWORD = "Admin123!";

// Test fixtures: June 2026 for client S-001 (Acme Manufacturing Corp — seeded)
// and a non-existent client S-999 to verify skip behavior
const TEST_MONTH = 6;
const TEST_YEAR = 2026;
const TEST_MONTH_ABBR = "Jun";

function buildMixedZip() {
  const zip = new AdmZip();
  zip.addFile(
    `s001_AcmeMfg_${TEST_MONTH_ABBR}${TEST_YEAR}.pdf`,
    Buffer.from("%PDF-1.4 synthetic test content for S-001 PDF")
  );
  zip.addFile(
    `s001_AcmeMfg_${TEST_MONTH_ABBR}${TEST_YEAR}.xlsx`,
    Buffer.from("PK synthetic test content for S-001 Excel")
  );
  zip.addFile(
    `s999_Unknown_${TEST_MONTH_ABBR}${TEST_YEAR}.pdf`,
    Buffer.from("%PDF-1.4 synthetic test content for non-existent S-999")
  );
  return zip.toBuffer();
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  assert.equal(res.status, 200, "Login should return 200");
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "Login should set a session cookie");
  return setCookie.split(";")[0];
}

async function postBatchZip(sessionCookie, zipBuffer) {
  const blob = new Blob([zipBuffer], { type: "application/zip" });
  const formData = new FormData();
  formData.append("zipFile", blob, "batch_test.zip");

  const res = await fetch(`${BASE_URL}/api/ppr/batch-monthly`, {
    method: "POST",
    headers: { Cookie: sessionCookie },
    body: formData,
  });
  assert.equal(res.status, 200, "Batch upload should return 200");
  return res.json();
}

async function countPprRows(pool, month, year) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM ppr_uploads WHERE report_month = $1 AND report_year = $2",
    [month, year]
  );
  return rows[0].n;
}

async function cleanupTestRows(pool, month, year) {
  await pool.query(
    "DELETE FROM ppr_uploads WHERE report_month = $1 AND report_year = $2",
    [month, year]
  );
}

function cleanupTestFiles(clientId) {
  const dir = path.join("uploads", "ppr", String(clientId));
  const patterns = [`_${TEST_MONTH_ABBR}${TEST_YEAR}.pdf`, `_${TEST_MONTH_ABBR}${TEST_YEAR}.xlsx`];
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (patterns.some((p) => f.endsWith(p))) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
}

describe("POST /api/ppr/batch-monthly — mixed PDF+Excel ZIP", () => {
  let sessionCookie;
  let zipBuffer;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  before(async () => {
    sessionCookie = await login();
    zipBuffer = buildMixedZip();
    await cleanupTestRows(pool, TEST_MONTH, TEST_YEAR);
    cleanupTestFiles(1);
  });

  after(async () => {
    await cleanupTestRows(pool, TEST_MONTH, TEST_YEAR);
    cleanupTestFiles(1);
    await pool.end();
  });

  test("(a) Mixed ZIP routes PDF + Excel to two separate DB rows and skips unrecognized client", async () => {
    const data = await postBatchZip(sessionCookie, zipBuffer);

    assert.equal(data.imported, 2, "Should import 2 files (PDF + Excel for S-001)");
    assert.equal(data.skipped, 1, "Should skip 1 file (S-999 not found)");
    assert.equal(data.errors, 0, "Should have 0 errors");

    const pdfResult = data.results.find(
      (r) => r.file === `s001_AcmeMfg_${TEST_MONTH_ABBR}${TEST_YEAR}.pdf`
    );
    assert.ok(pdfResult, "PDF result entry should exist");
    assert.equal(pdfResult.status, "imported", "PDF should be imported");
    assert.equal(pdfResult.fileType, "PDF", "PDF fileType should be PDF");
    assert.equal(pdfResult.reportMonth, TEST_MONTH, "PDF reportMonth should match");
    assert.equal(pdfResult.reportYear, TEST_YEAR, "PDF reportYear should match");

    const xlsxResult = data.results.find(
      (r) => r.file === `s001_AcmeMfg_${TEST_MONTH_ABBR}${TEST_YEAR}.xlsx`
    );
    assert.ok(xlsxResult, "Excel result entry should exist");
    assert.equal(xlsxResult.status, "imported", "Excel should be imported");
    assert.equal(xlsxResult.fileType, "EXCEL", "Excel fileType should be EXCEL");

    const skipResult = data.results.find(
      (r) => r.file === `s999_Unknown_${TEST_MONTH_ABBR}${TEST_YEAR}.pdf`
    );
    assert.ok(skipResult, "Unrecognized client result should exist");
    assert.equal(skipResult.status, "skipped", "Unrecognized client should be skipped");
    assert.ok(
      skipResult.error && skipResult.error.toLowerCase().includes("not found"),
      `Skip reason should mention 'not found', got: ${skipResult.error}`
    );

    const rowCount = await countPprRows(pool, TEST_MONTH, TEST_YEAR);
    assert.equal(rowCount, 2, "DB should have exactly 2 ppr_uploads rows after first upload");
  });

  test("(b) Re-uploading the same ZIP upserts existing rows — no duplicate inserts", async () => {
    const rowsBefore = await countPprRows(pool, TEST_MONTH, TEST_YEAR);

    const data = await postBatchZip(sessionCookie, zipBuffer);
    assert.equal(data.imported, 2, "Second upload should still report 2 imported");
    assert.equal(data.skipped, 1, "Second upload should still skip S-999");
    assert.equal(data.errors, 0, "Second upload should have 0 errors");

    const rowsAfter = await countPprRows(pool, TEST_MONTH, TEST_YEAR);
    assert.equal(
      rowsAfter,
      rowsBefore,
      `Row count must stay at ${rowsBefore} after re-upload (upsert, not duplicate insert)`
    );
  });

  test("(c) Unrecognized client code produces a skipped entry, not a server error", async () => {
    const skipZip = new AdmZip();
    skipZip.addFile(
      `s999_Nonexistent_${TEST_MONTH_ABBR}${TEST_YEAR}.pdf`,
      Buffer.from("dummy content")
    );

    const data = await postBatchZip(sessionCookie, skipZip.toBuffer());
    assert.equal(data.imported, 0, "ZIP with only unrecognized client should import 0");
    assert.equal(data.skipped, 1, "ZIP with only unrecognized client should skip 1");
    assert.equal(data.errors, 0, "ZIP with only unrecognized client should produce 0 errors");
    assert.equal(data.results[0].status, "skipped", "Result status should be 'skipped'");
  });
});
