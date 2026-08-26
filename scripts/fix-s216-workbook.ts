/**
 * One-off: correct the S-216 entries in the merged contacts workbook for the
 * derived-termination model.
 *
 * The Clients row was built when `is_active=false` was the only lever that would
 * pull a client out of the overdue renewal queue. Under the derived model that
 * lever now means "closed long ago, no date on file", which would suppress
 * S-216's PPRs and hold their run-out claims. The termination date alone does
 * the job, so the client stays active. The review note is rewritten to match.
 */
import * as XLSX from "xlsx";
import fs from "fs";

const path = "reports/broker-contacts-merged-2026-08-26.xlsx";
const wb = XLSX.read(fs.readFileSync(path), { type: "buffer", cellDates: true });

// ── Clients sheet: is_active back to TRUE ────────────────────────────────────
const ws = wb.Sheets["Clients"];
const range = XLSX.utils.decode_range(ws["!ref"]!);

// Locate columns by header rather than by letter, so this does not silently
// patch the wrong cell if the layout ever moves.
let isActiveCol = -1;
let codeCol = -1;
for (let c = range.s.c; c <= range.e.c; c++) {
  const header = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]?.v;
  if (header === "is_active") isActiveCol = c;
  if (header === "client_code") codeCol = c;
}
if (isActiveCol < 0 || codeCol < 0) throw new Error("Could not find is_active / client_code columns");

let patched = 0;
for (let r = range.s.r + 1; r <= range.e.r; r++) {
  const code = String(ws[XLSX.utils.encode_cell({ r, c: codeCol })]?.v ?? "");
  if (code.replace("-0", "-") !== "S-216") continue;
  const addr = XLSX.utils.encode_cell({ r, c: isActiveCol });
  console.log(`S-216 is_active was ${JSON.stringify(ws[addr]?.v ?? null)} at ${addr}, now TRUE`);
  ws[addr] = { t: "s", v: "TRUE" };
  patched++;
}
console.log("client rows patched:", patched);

// ── Review Notes: rewrite the S-216 note ─────────────────────────────────────
const notesWs = wb.Sheets["Review Notes"];
const notesRange = XLSX.utils.decode_range(notesWs["!ref"]!);
let refCol = -1;
let detailCol = -1;
for (let c = notesRange.s.c; c <= notesRange.e.c; c++) {
  const header = notesWs[XLSX.utils.encode_cell({ r: notesRange.s.r, c })]?.v;
  if (header === "ref") refCol = c;
  if (header === "detail") detailCol = c;
}
if (refCol < 0 || detailCol < 0) throw new Error("Could not find ref / detail columns");

const newDetail =
  "has_broker set false, Kellie Haehnel (kellie.haehnel@crlmed.com, corrected from crimed) recorded " +
  "as the direct client contact, and termination date 2026-09-30. is_active stays TRUE on purpose: " +
  "the termination date alone now drives state. S-216 computes as TERMINATING, so the renewal is " +
  "suppressed immediately while the client stays active and visible, PPRs keep generating and " +
  "run-out claims keep importing through 2026-12-31.";

let notesPatched = 0;
for (let r = notesRange.s.r + 1; r <= notesRange.e.r; r++) {
  const ref = String(notesWs[XLSX.utils.encode_cell({ r, c: refCol })]?.v ?? "");
  if (!ref.startsWith("S-216")) continue;
  notesWs[XLSX.utils.encode_cell({ r, c: detailCol })] = { t: "s", v: newDetail };
  notesPatched++;
}
console.log("review notes patched:", notesPatched);

fs.writeFileSync(path, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("workbook written");
