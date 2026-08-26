/**
 * One-off: runs the merged contact workbook through the real import in validate
 * mode, which executes the whole write inside a transaction and rolls it back, so
 * the counts below are what an apply would actually do.
 */
import fs from "fs";
import path from "path";
import { runImport } from "../server/crm-import";

const file = path.resolve(import.meta.dirname, "../reports/broker-contacts-merged-2026-08-26.xlsx");

runImport(fs.readFileSync(file), "validate")
  .then((r: any) => {
    console.log("ok:", r.ok);
    console.log("counts:", JSON.stringify(r.counts, null, 1));
    console.log("brokerContactsRemoved:", r.brokerContactsRemoved);
    const errs = (r.issues ?? []).filter((i: any) => i.severity === "error");
    const warns = (r.issues ?? []).filter((i: any) => i.severity === "warning");
    console.log(`\nERRORS (${errs.length}):`);
    errs.forEach((i: any) => console.log(`  [${i.sheet}${i.row ? " r" + i.row : ""}] ${i.ref ?? ""} ${i.message}`));
    console.log(`\nWARNINGS (${warns.length}):`);
    warns.forEach((i: any) => console.log(`  [${i.sheet}${i.row ? " r" + i.row : ""}] ${i.ref ?? ""} ${i.message}`));
    process.exit(0);
  })
  .catch((e: any) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
