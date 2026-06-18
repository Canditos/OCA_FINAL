// ══════════════════════════════════════════════════════════════
// OpenAPI / Swagger Documentation
// ══════════════════════════════════════════════════════════════
//
// Auto-generated API documentation available at /api/docs
// ══════════════════════════════════════════════════════════════

import { Router } from "express";

const router = Router();

const openApiSpec = {
    openapi: "3.0.0",
    info: {
        title: "OCPP Certification Dashboard API",
        version: "1.0.0",
        description: "REST API for OCPP certification pipeline automation",
    },
    servers: [{ url: "http://localhost:3101/api" }],
    paths: {
        "/status": {
            get: {
                summary: "Get dashboard status",
                tags: ["Status"],
                responses: {
                    "200": {
                        description: "Service states and pipeline info",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        services: { type: "object" },
                                        pipeline: { type: "object" },
                                        config: { type: "object" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/logs": {
            get: {
                summary: "Get recent log entries",
                tags: ["Logs"],
                responses: {
                    "200": {
                        description: "Array of log entries",
                    },
                },
            },
        },
        "/cds/check": {
            post: {
                summary: "Check CDS connectivity",
                tags: ["CDS"],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    ip: { type: "string" },
                                    port: { type: "number" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "CDS status and flags" },
                    "500": { description: "Connection error" },
                },
            },
        },
        "/cds/measurements": {
            get: {
                summary: "Get live CDS measurements",
                tags: ["CDS"],
                responses: {
                    "200": { description: "Voltage, current, SoC, CP state" },
                },
            },
        },
        "/octt/check": {
            post: {
                summary: "Check OCTT connectivity",
                tags: ["OCTT"],
                responses: {
                    "200": { description: "OCTT config list" },
                },
            },
        },
        "/octt/config-timeouts": {
            post: {
                summary: "Update OCTT timeouts",
                tags: ["OCTT"],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    configurationName: { type: "string" },
                                    maxTimeoutPeriod: { type: "string" },
                                    longOperationTimeout: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Timeouts updated" },
                },
            },
        },
        "/pipeline/run-playwright": {
            post: {
                summary: "Start Playwright test execution",
                tags: ["Pipeline"],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    testcaseNames: { type: "array", items: { type: "string" } },
                                    configurationName: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Playwright started" },
                    "409": { description: "Already running" },
                },
            },
        },
        "/pipeline/stop-playwright": {
            post: {
                summary: "Stop Playwright execution",
                tags: ["Pipeline"],
                responses: {
                    "200": { description: "Stopped" },
                },
            },
        },
        "/jira/upload-execution": {
            post: {
                summary: "Upload test results to Jira",
                tags: ["Jira"],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["sut", "firmwareVersion", "testExecutionKey"],
                                properties: {
                                    sut: { type: "string" },
                                    firmwareVersion: { type: "string" },
                                    testPlan: { type: "string" },
                                    testExecutionKey: { type: "string" },
                                    environment: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Issue created" },
                    "400": { description: "Missing required fields" },
                },
            },
        },
        "/events": {
            get: {
                summary: "SSE event stream",
                tags: ["Events"],
                responses: {
                    "200": {
                        description: "Server-sent events stream",
                        content: {
                            "text/event-stream": {},
                        },
                    },
                },
            },
        },
    },
};

router.get("/", (_req, res) => {
    res.json(openApiSpec);
});

export default router;
