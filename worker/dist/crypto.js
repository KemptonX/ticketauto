"use strict";
// AES-256-GCM — same scheme as TixTracker's src/lib/marketplace/encryption.ts
// Format: ivHex:authTagHex:ciphertextHex
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const crypto_1 = require("crypto");
const ALGORITHM = "aes-256-gcm";
function getKey() {
    const hex = process.env.VIAGOGO_CREDENTIAL_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
        throw new Error("VIAGOGO_CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string");
    }
    return Buffer.from(hex, "hex");
}
function encrypt(plaintext) {
    const key = getKey();
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}
function decrypt(stored) {
    const key = getKey();
    const parts = stored.split(":");
    if (parts.length !== 3)
        throw new Error("Invalid encrypted format");
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const data = Buffer.from(parts[2], "hex");
    const decipher = (0, crypto_1.createDecipheriv)(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
