// AES-256-GCM encryption for marketplace credentials and session data.
// Uses the VIAGOGO_CREDENTIAL_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
// Format stored in DB: ivHex:authTagHex:ciphertextHex

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const keyHex = process.env.VIAGOGO_CREDENTIAL_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "VIAGOGO_CREDENTIAL_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes)"
    );
  }
  return Buffer.from(keyHex, "hex");
}

export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptCredential(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted credential format");
  const [ivHex, authTagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Safely check if an encryption key is configured (for startup validation). */
export function encryptionKeyConfigured(): boolean {
  const k = process.env.VIAGOGO_CREDENTIAL_ENCRYPTION_KEY;
  return typeof k === "string" && k.length === 64;
}
