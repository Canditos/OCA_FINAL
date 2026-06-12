// ══════════════════════════════════════════════════════════════
// Tests for Dashboard Config
// ══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testConfigPath = path.resolve(__dirname, "../../dashboard-config.test.json");

describe("Dashboard Config", () => {
    let loadConfig: any;
    let saveConfig: any;
    let buildEffectiveConfig: any;

    beforeEach(async () => {
        const mod = await import("../../src/apps/certification-dashboard/config/dashboard.config.js");
        loadConfig = mod.loadConfig;
        saveConfig = mod.saveConfig;
        buildEffectiveConfig = mod.buildEffectiveConfig;
        
        // Clean up any existing test config
        try { unlinkSync(testConfigPath); } catch { /* ignore */ }
    });

    afterEach(() => {
        try { unlinkSync(testConfigPath); } catch { /* ignore */ }
    });

    it("should load default config when file does not exist", () => {
        const config = loadConfig();
        
        expect(config.octtOcppVersion).toBe("ocpp1.6");
        expect(config.octtRole).toBe("CS");
        expect(config.cdsPort).toBe(51001);
        expect(config.jiraProjectKey).toBe("CERT");
    });

    it("should save and load config", () => {
        const customConfig = {
            octtBaseUrl: "https://test.example.com",
            octtToken: "test-token",
            octtOcppVersion: "ocpp2.0.1",
            octtRole: "CSMS",
            cdsIp: "10.0.0.1",
            cdsPort: 52001,
            jiraBaseUrl: "https://jira.example.com",
            jiraEmail: "test@example.com",
            jiraApiToken: "jira-token",
            jiraProjectKey: "TEST",
        };

        saveConfig(customConfig);
        
        const loaded = loadConfig();
        expect(loaded.octtBaseUrl).toBe("https://test.example.com");
        expect(loaded.cdsPort).toBe(52001);
        expect(loaded.jiraProjectKey).toBe("TEST");
    });

    it("should merge with defaults for missing fields", () => {
        const partialConfig = {
            octtToken: "partial-token",
            cdsIp: "192.168.1.1",
        };

        saveConfig(partialConfig as any);
        const loaded = loadConfig();
        
        expect(loaded.octtToken).toBe("partial-token");
        expect(loaded.cdsIp).toBe("192.168.1.1");
        expect(loaded.octtOcppVersion).toBe("ocpp1.6");
        expect(loaded.cdsPort).toBe(51001);
    });

    it("should build effective config with env vars", () => {
        const saved = {
            octtBaseUrl: "",
            octtToken: "",
            octtOcppVersion: "ocpp1.6",
            octtRole: "CS",
            cdsIp: "",
            cdsPort: 51001,
            jiraBaseUrl: "",
            jiraEmail: "",
            jiraApiToken: "",
            jiraProjectKey: "",
        };

        const effective = buildEffectiveConfig(saved);
        
        expect(effective.octt).toBeDefined();
        expect(effective.cds).toBeDefined();
        expect(effective.jira).toBeDefined();
        expect(effective.octt.role).toBe("CS");
        expect(effective.cds.port).toBe(51001);
    });
});
