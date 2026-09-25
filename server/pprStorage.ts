import fs from "fs";
import { uploadAttachmentBytes, downloadAttachmentBytes, deleteAttachmentBytes } from "./objectStorage";

/**
 * PPR files live in Object Storage, not on the container's disk. A deployment
 * gets a fresh filesystem on every publish, so anything written under
 * `uploads/` disappeared the next time the app was released — the ppr_uploads
 * rows survived but pointed at files that no longer existed.
 *
 * ppr_uploads.filePath holds the Object Storage key for everything written
 * since that change. Rows written before it hold an absolute disk path;
 * readPprFile/removePprFile check the filesystem first so those still resolve
 * for as long as the file happens to be there, rather than hard-failing.
 */
export function pprObjectKey(clientId: number, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `ppr/${clientId}/${safeName}`;
}

/** Stores the file's bytes and returns the key to persist in ppr_uploads.filePath. */
export async function savePprFile(clientId: number, fileName: string, bytes: Buffer): Promise<string> {
  const key = pprObjectKey(clientId, fileName);
  await uploadAttachmentBytes(key, bytes);
  return key;
}

/** True for a pre-Object-Storage row whose file is still on this container's disk. */
function isLegacyDiskPath(filePath: string): boolean {
  if (!filePath.startsWith("/") && !filePath.includes("uploads/")) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export async function readPprFile(filePath: string): Promise<Buffer> {
  if (isLegacyDiskPath(filePath)) return fs.readFileSync(filePath);
  return downloadAttachmentBytes(filePath);
}

/**
 * Best-effort removal. A leftover object is harmless once its ppr_uploads row
 * is gone, so a failure here never fails the user's delete or replace — but it
 * is logged rather than swallowed silently, so a bucket that starts refusing
 * deletes is visible in the logs instead of quietly accumulating files.
 */
export async function removePprFile(filePath: string): Promise<void> {
  if (isLegacyDiskPath(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err: any) {
      console.warn(`[ppr] could not remove local file ${filePath}: ${err?.message || err}`);
    }
    return;
  }
  try {
    await deleteAttachmentBytes(filePath);
  } catch (err: any) {
    console.warn(`[ppr] could not remove stored file ${filePath}: ${err?.message || err}`);
  }
}
