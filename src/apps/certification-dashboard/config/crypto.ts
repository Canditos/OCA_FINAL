// ══════════════════════════════════════════════════════════════
// Config Encryption — AES-256-GCM for sensitive fields
// ══════════════════════════════════════════════════════════════
//
// Uses ENCRYPTION_KEY env var if set (same key = works across machines).
// Falls back to machine-specific key from hostname.
// ══════════════════════════════════════════════════════════════

import crypto from "crypto";
import { hostname } from "os";

const ALGORITHM = "aes-256-gcm";
const SENSITIVE_FIELDS = ["octtToken", "jiraApiToken", "jiraEmail", "xrayClientSecret", "dashboardApiKey"] as const;

/**
 * Derives a 32-byte key from ENCRYPTION_KEY env var (cross-machine portable),
 * or falls back to machine hostname.
 */
function deriveKey(): Buffer {
    const material = process.env.ENCRYPTION_KEY || crypto.createHash("sha256").update(hostname() + "-ocpp-dashboard").digest("hex");
    return crypto.scryptSync(material, "ocpp-cert-v1", 32);
}

/**
 * Encrypt a single string value.
 * Returns "enc:iv:tag:ciphertext" or the original if falsy.
 */
function encryptValue(value: string): string {
    if (!value) return value;
    const key = deriveKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a single string value.
 * Returns original if not encrypted or falsy.
 */
function decryptValue(value: string): string {
    if (!value || !value.startsWith("enc:")) return value;
    try {
        const key = deriveKey();
        const parts = value.slice(4).split(":");
        if (parts.length !== 3) return value;
        const iv = Buffer.from(parts[0], "hex");
        const tag = Buffer.from(parts[1], "hex");
        const encrypted = Buffer.from(parts[2], "hex");
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (e: any) {
        console.warn("[crypto] Decryption failed:", e.message);
        return value; // Corrupted or wrong key — return as-is
    }
}

/**
 * Encrypt sensitive fields in a config object.
 * Returns a new object — does NOT mutate.
 */
export function encryptConfig<T extends Record<string, any>>(config: T): T {
    const result = { ...config } as Record<string, any>;
    for (const field of SENSITIVE_FIELDS) {
        if (typeof result[field] === "string" && result[field] && !result[field].startsWith("enc:")) {
            result[field] = encryptValue(result[field]);
        }
    }
    return result as T;
}

/**
 * Decrypt sensitive fields in a config object.
 * Returns a new object — does NOT mutate.
 */
export function decryptConfig<T extends Record<string, any>>(config: T): T {
    const result = { ...config } as Record<string, any>;
    for (const field of SENSITIVE_FIELDS) {
        if (typeof result[field] === "string" && result[field]) {
            result[field] = decryptValue(result[field]);
        }
    }
    return result as T;
}
