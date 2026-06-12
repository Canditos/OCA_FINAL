// ══════════════════════════════════════════════════════════════
// Dashboard Configuration — Persistence & Validation
// ══════════════════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encryptConfig, decryptConfig } from "./crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.DASHBOARD_CONFIG_PATH
    ? path.resolve(process.env.DASHBOARD_CONFIG_PATH)
    : path.resolve(__dirname, "../../../../dashboard-config.json");

/** Shape of the persisted dashboard configuration */
export interface SavedConfig {
    octtBaseUrl: string;
    octtToken: string;
    octtOcppVersion: string;
    octtRole: string;
    cdsIp: string;
    cdsPort: number;
    cdsSink: number;
    jiraBaseUrl: string;
    jiraEmail: string;
    jiraApiToken: string;
    jiraProjectKey: string;
}

const defaultConfig: SavedConfig = {
    octtBaseUrl: "",
    octtToken: "",
    octtOcppVersion: "ocpp1.6",
    octtRole: "CS",
    cdsIp: "192.168.100.10",
    cdsPort: 51001,
    cdsSink: 12,
    jiraBaseUrl: "",
    jiraEmail: "",
    jiraApiToken: "",
    jiraProjectKey: "CERT",
};

/** Load config from disk or return defaults. Decrypts sensitive fields. */
export function loadConfig(): SavedConfig {
    try {
        if (existsSync(configPath)) {
            const raw = readFileSync(configPath, "utf-8");
            const parsed = JSON.parse(raw);
            return decryptConfig({ ...defaultConfig, ...parsed }) as SavedConfig;
        }
    } catch { /* ignore */ }
    return defaultConfig;
}

/** Save config to disk. Encrypts sensitive fields before writing. */
export function saveConfig(cfg: SavedConfig): void {
    try {
        const encrypted = encryptConfig(cfg);
        writeFileSync(configPath, JSON.stringify(encrypted, null, 2), "utf-8");
    } catch (e) {
        console.error("[Config] Failed to save:", e);
    }
}

/** Merge env vars with saved config (saved takes precedence) */
export function buildEffectiveConfig(saved: SavedConfig) {
    return {
        octt: {
            baseUrl: saved.octtBaseUrl || process.env.OCTT_BASE_URL || "",
            token: saved.octtToken || process.env.OCTT_TOKEN || "",
            ocppVersion: saved.octtOcppVersion || process.env.OCTT_OCPP_VERSION || "ocpp1.6",
            role: (saved.octtRole || process.env.OCTT_ROLE || "CS") as "CS" | "CSMS",
        },
        cds: {
            ip: saved.cdsIp || process.env.CDS_IP || "192.168.100.10",
            port: saved.cdsPort || parseInt(process.env.CDS_PORT ?? "51001", 10),
            sink: saved.cdsSink || parseInt(process.env.CDS_SINK_ID ?? "12", 10),
        },
        jira: {
            baseUrl: saved.jiraBaseUrl || process.env.JIRA_BASE_URL || "",
            email: saved.jiraEmail || process.env.JIRA_EMAIL || "",
            apiToken: saved.jiraApiToken || process.env.JIRA_API_TOKEN || "",
            projectKey: saved.jiraProjectKey || process.env.JIRA_PROJECT_KEY || "CERT",
        },
    };
}

/** Current config instance (mutable, updated on save) */
export let currentConfig = loadConfig();
export let effectiveConfig = buildEffectiveConfig(currentConfig);

/** Update config after save */
export function updateConfig(newCfg: Partial<SavedConfig>): void {
    currentConfig = { ...currentConfig, ...newCfg };
    saveConfig(currentConfig);
    effectiveConfig = buildEffectiveConfig(currentConfig);
}
