// ══════════════════════════════════════════════════════════════
// API Request Schemas — Zod validation for all POST endpoints
// ══════════════════════════════════════════════════════════════

import { z } from "zod";

// ── CDS ──
export const cdsCheckSchema = z.object({
    ip: z.string().max(50).optional(),
    port: z.union([z.string(), z.number()]).optional(),
}).strict();

export const cdsConfigureSchema = z.object({
    ip: z.string().max(50).optional(),
    port: z.union([z.string(), z.number()]).optional(),
    profile: z.string().max(200).optional(),
}).strict();

// ── OCTT ──
export const octtCheckSchema = z.object({
    baseUrl: z.string().max(500).optional(),
    token: z.string().max(500).optional(),
}).strict();

export const octtCheckConfigSchema = z.object({
    configurationName: z.string().min(1).max(200),
    baseUrl: z.string().max(500).optional(),
    token: z.string().max(500).optional(),
}).strict();

export const octtConfigTimeoutsSchema = z.object({
    configurationName: z.string().min(1).max(200).optional(),
    maxTimeoutPeriod: z.union([z.string(), z.number()]).optional(),
    longOperationTimeout: z.union([z.string(), z.number()]).optional(),
}).strict();

// ── Pipeline ──
export const pipelineRunSchema = z.object({
    testcaseNames: z.array(z.string().min(1).max(200)).max(200).optional(),
    configurationName: z.string().min(1).max(200).optional(),
}).strict();

// ── Jira ──
export const jiraUploadSchema = z.object({
    sut: z.string().min(1).max(200),
    firmwareVersion: z.string().min(1).max(200),
    testPlan: z.string().max(500).optional(),
    environment: z.string().max(500).optional(),
}).strict();

// ── Config Save ──
export const configSaveSchema = z.object({
    octtBaseUrl: z.string().max(500).optional(),
    octtToken: z.string().max(500).optional(),
    // Accept both "1.6" and "ocpp1.6" formats, transform to canonical form
    octtOcppVersion: z.string().max(20).optional().transform(v => {
        if (v === "1.6") return "ocpp1.6";
        if (v === "2.0.1") return "ocpp2.0.1";
        return v;
    }),
    octtRole: z.enum(["CS", "CSMS"]).optional(),
    cdsIp: z.string().max(50).optional(),
    cdsPort: z.union([z.string(), z.number()]).optional(),
    cdsSink: z.union([z.string(), z.number()]).optional(),
    jiraBaseUrl: z.string().max(500).optional(),
    jiraEmail: z.string().max(300).optional(),
    jiraApiToken: z.string().max(500).optional(),
    jiraProjectKey: z.string().max(50).optional(),
    xrayClientId: z.string().max(200).optional(),
    xrayClientSecret: z.string().max(500).optional(),
}).strict();
