import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ocrPageImage } from "./claude";

const execFileAsync = promisify(execFile);

/** Below this many characters, a PDF's native text layer counts as "image-only" and triggers OCR. */
const OCR_TRIGGER_THRESHOLD = 40;
/** Bounds OCR cost per document — most PPRs/renewal letters are well under this. */
const MAX_OCR_PAGES = 8;

export interface ExtractionResult {
  text: string;
  ocrUsed: boolean;
}

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Renders PDF pages to PNG via Ghostscript, one file per page, for the vision OCR fallback. */
async function rasterizePdfPages(buffer: Buffer, maxPages: number): Promise<Buffer[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-ocr-"));
  const inputPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(inputPath, buffer);
  const outPattern = path.join(tmpDir, "page-%03d.png");
  try {
    await execFileAsync("gs", [
      "-dNOPAUSE",
      "-dBATCH",
      "-dSAFER",
      "-sDEVICE=png16m",
      "-r150",
      `-dLastPage=${maxPages}`,
      `-sOutputFile=${outPattern}`,
      inputPath,
    ]);
    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();
    return files.map((f) => fs.readFileSync(path.join(tmpDir, f)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Extracts text from an attachment buffer by mime type. PDFs whose native
 * text layer is empty or near-empty (scanned images) fall back to Claude
 * vision OCR, page by page, bounded to MAX_OCR_PAGES so a large scanned
 * packet can't run away in cost.
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  try {
    if (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      const nativeText = parsed.text.trim();
      if (nativeText.length >= OCR_TRIGGER_THRESHOLD) {
        return { text: nativeText.slice(0, 30000), ocrUsed: false };
      }
      // Native layer is empty/near-empty — this is a scanned/image-only PDF.
      const pageCount = parsed.numpages || 1;
      const pagesToOcr = Math.min(pageCount, MAX_OCR_PAGES);
      const images = await rasterizePdfPages(buffer, pagesToOcr);
      const transcripts = await Promise.all(
        images.map((img, i) => ocrPageImage(img, `page ${i + 1} of ${pageCount}`)),
      );
      const ocrText = transcripts.filter(Boolean).join("\n\n---\n\n");
      return { text: ocrText.slice(0, 30000) || nativeText, ocrUsed: ocrText.length > 0 };
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.toLowerCase().endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value.slice(0, 30000), ocrUsed: false };
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel" ||
      filename.toLowerCase().endsWith(".xlsx") ||
      filename.toLowerCase().endsWith(".xls")
    ) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheets = workbook.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        return `--- Sheet: ${name} ---\n${csv}`;
      });
      return { text: sheets.join("\n\n").slice(0, 30000), ocrUsed: false };
    }

    if (mimeType?.startsWith("text/")) {
      return { text: buffer.toString("utf8").slice(0, 30000), ocrUsed: false };
    }
  } catch (err: any) {
    console.error(`[documentExtraction] failed for ${filename}:`, err?.message || String(err));
  }
  return { text: "", ocrUsed: false };
}
