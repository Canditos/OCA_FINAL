// ══════════════════════════════════════════════════════════════
// Unit Tests — Utilities and helpers
// ══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { z } from "zod";

// Test Zod schemas directly
import {
    configSaveSchema,
    pipelineRunSchema,
    cdsCheckSchema,
    octtCheckSchema,
    jiraUploadSchema,
} from "../../../src/apps/certification-dashboard/schemas/api.schemas.js";

describe("API Schemas", () => {
    describe("configSaveSchema", () => {
        it("accepts valid config", () => {
            const result = configSaveSchema.safeParse({
                octtBaseUrl: "https://example.com",
                octtToken: "abc123",
                cdsIp: "192.168.1.1",
                cdsPort: 51001,
            });
            expect(result.success).toBe(true);
        });

        it("accepts empty object", () => {
            const result = configSaveSchema.safeParse({});
            expect(result.success).toBe(true);
        });

        it("transforms OCPP version 1.6 to ocpp1.6", () => {
            const result = configSaveSchema.safeParse({
                octtOcppVersion: "1.6",
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.octtOcppVersion).toBe("ocpp1.6");
            }
        });

        it("transforms OCPP version 2.0.1 to ocpp2.0.1", () => {
            const result = configSaveSchema.safeParse({
                octtOcppVersion: "2.0.1",
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.octtOcppVersion).toBe("ocpp2.0.1");
            }
        });

        it("rejects extra fields in strict mode", () => {
            const result = configSaveSchema.safeParse({
                unknownField: "value",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("pipelineRunSchema", () => {
        it("accepts valid testcase names", () => {
            const result = pipelineRunSchema.safeParse({
                testcaseNames: ["tc_001", "tc_002"],
                configurationName: "AUT_SID_SAT",
            });
            expect(result.success).toBe(true);
        });

        it("accepts empty arrays", () => {
            const result = pipelineRunSchema.safeParse({
                testcaseNames: [],
            });
            expect(result.success).toBe(true);
        });

        it("rejects too many testcases", () => {
            const testcases = Array.from({ length: 201 }, (_, i) => `tc_${i}`);
            const result = pipelineRunSchema.safeParse({
                testcaseNames: testcases,
            });
            expect(result.success).toBe(false);
        });
    });

    describe("cdsCheckSchema", () => {
        it("accepts IP and port", () => {
            const result = cdsCheckSchema.safeParse({
                ip: "192.168.100.10",
                port: 51001,
            });
            expect(result.success).toBe(true);
        });

        it("accepts port as string", () => {
            const result = cdsCheckSchema.safeParse({
                ip: "192.168.100.10",
                port: "51001",
            });
            expect(result.success).toBe(true);
        });
    });

    describe("octtCheckSchema", () => {
        it("accepts URL and token", () => {
            const result = octtCheckSchema.safeParse({
                baseUrl: "https://octt.example.com",
                token: "secret-token-123",
            });
            expect(result.success).toBe(true);
        });

        it("rejects overly long URLs", () => {
            const result = octtCheckSchema.safeParse({
                baseUrl: "https://" + "a".repeat(600),
            });
            expect(result.success).toBe(false);
        });
    });
});

describe("Jira Upload Schema", () => {
    it("requires a test execution key", () => {
        const result = jiraUploadSchema.safeParse({
            sut: "COR #1",
            firmwareVersion: "FW v9.1.0 - DEV",
            ocppBackend: "OCTT",
        });

        expect(result.success).toBe(false);
    });

    it("accepts an optional testPlan with a test execution key", () => {
        const result = jiraUploadSchema.safeParse({
            sut: "COR #1",
            firmwareVersion: "FW v9.1.0 - DEV",
            testExecutionKey: "XPECD-5264",
            testPlan: "Legacy plan",
        });

        expect(result.success).toBe(true);
    });
});

describe("Config Masking", () => {
    // Test the masking function logic (inline test)
    function maskConfig(cfg: Record<string, unknown>): Record<string, unknown> {
        const masked: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cfg)) {
            if (k.toLowerCase().includes("token") || k.toLowerCase().includes("password") || k.toLowerCase().includes("apitoken")) {
                masked[k] = v ? "***" : "(empty)";
            } else if (k.toLowerCase().includes("url") && typeof v === "string") {
                try {
                    const url = new URL(v);
                    masked[k] = url.hostname;
                } catch {
                    masked[k] = v;
                }
            } else {
                masked[k] = v;
            }
        }
        return masked;
    }

    it("masks token fields", () => {
        const result = maskConfig({ octtToken: "secret123" });
        expect(result.octtToken).toBe("***");
    });

    it("masks password fields", () => {
        const result = maskConfig({ jiraPassword: "mypass" });
        expect(result.jiraPassword).toBe("***");
    });

    it("shows (empty) for empty tokens", () => {
        const result = maskConfig({ token: "" });
        expect(result.token).toBe("(empty)");
    });

    it("extracts hostname from URLs", () => {
        const result = maskConfig({ baseUrl: "https://example.com/path" });
        expect(result.baseUrl).toBe("example.com");
    });

    it("preserves non-sensitive fields", () => {
        const result = maskConfig({ cdsIp: "192.168.1.1", cdsPort: 51001 });
        expect(result.cdsIp).toBe("192.168.1.1");
        expect(result.cdsPort).toBe(51001);
    });
});
