import { Client } from "@replit/object-storage";

/**
 * Thin wrapper around the Object Storage bucket bound to this Repl. Every
 * attachment pulled from Gmail goes here — never local disk — so ingesting a
 * mailbox's worth of history doesn't depend on the container's ephemeral
 * filesystem. Attachments filed before this migration stay on local disk
 * (see communicationAttachments.storageBackend) and are read through the old
 * path.
 */
const client = new Client();

export async function uploadAttachmentBytes(key: string, buffer: Buffer): Promise<void> {
  const { ok, error } = await client.uploadFromBytes(key, buffer);
  if (!ok) {
    throw new Error(`Object Storage upload failed for ${key}: ${error?.message || JSON.stringify(error)}`);
  }
}

export async function downloadAttachmentBytes(key: string): Promise<Buffer> {
  const { ok, value, error } = await client.downloadAsBytes(key);
  if (!ok) {
    throw new Error(`Object Storage download failed for ${key}: ${error?.message || JSON.stringify(error)}`);
  }
  // downloadAsBytes resolves a one-element tuple containing the Buffer.
  return value[0];
}

export async function deleteAttachmentBytes(key: string): Promise<void> {
  const { ok, error } = await client.delete(key);
  if (!ok) {
    throw new Error(`Object Storage delete failed for ${key}: ${error?.message || JSON.stringify(error)}`);
  }
}
