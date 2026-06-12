// ══════════════════════════════════════════════════════════════
// Swagger/OpenAPI Configuration
// ══════════════════════════════════════════════════════════════

import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: "3.0.3",
        info: {
            title: "OCPP Certification Dashboard API",
            version: "1.0.0",
            description: `
API for managing OCPP certification testing workflow.

## Features
- **Pipeline Control**: Run and monitor Playwright test executions
- **Service Monitoring**: Health checks for OCTT, CDS, and Jira integrations
- **Configuration**: Manage dashboard and test configurations
- **Results & Reports**: Access test results and generate reports

## Authentication
Currently no authentication required (internal use only).

## Rate Limiting
- Default: 100 requests per minute per IP
- Configurable via environment variables
            `,
            contact: {
                name: "OCPP Certification Team",
            },
        },
        servers: [
            {
                url: "http://localhost:3101",
                description: "Local development server",
            },
        ],
        tags: [
            { name: "Health", description: "Health and monitoring endpoints" },
            { name: "Status", description: "Dashboard status and service states" },
            { name: "Pipeline", description: "Playwright test runner control" },
            { name: "Config", description: "Dashboard configuration management" },
            { name: "CDS", description: "Keysight Charging Discovery System" },
            { name: "OCTT", description: "Open Charge Alliance Test Tool" },
            { name: "Jira", description: "Jira integration for test tracking" },
            { name: "Results", description: "Test results and history" },
            { name: "Reports", description: "Report generation" },
            { name: "Testcases", description: "Test case management" },
        ],
        components: {
            schemas: {
                Error: {
                    type: "object",
                    properties: {
                        ok: { type: "boolean", example: false },
                        error: { type: "string", example: "Error message" },
                        code: { type: "string", example: "ERROR_CODE" },
                    },
                },
                Success: {
                    type: "object",
                    properties: {
                        ok: { type: "boolean", example: true },
                    },
                },
                ServiceStatus: {
                    type: "string",
                    enum: ["disconnected", "connecting", "connected", "error"],
                },
                ServiceState: {
                    type: "object",
                    properties: {
                        status: { $ref: "#/components/schemas/ServiceStatus" },
                        label: { type: "string" },
                        info: { type: "string" },
                    },
                },
                HealthResponse: {
                    type: "object",
                    properties: {
                        status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
                        timestamp: { type: "string", format: "date-time" },
                        uptime: { type: "integer", description: "Uptime in seconds" },
                        version: { type: "string" },
                        node: { type: "string", description: "Node.js version" },
                        memory: {
                            type: "object",
                            properties: {
                                used: { type: "integer", description: "MB" },
                                total: { type: "integer", description: "MB" },
                                percentage: { type: "integer" },
                            },
                        },
                        connections: {
                            type: "object",
                            properties: {
                                websocket: { type: "integer" },
                            },
                        },
                        pipeline: {
                            type: "object",
                            properties: {
                                running: { type: "boolean" },
                                lastResultsCount: { type: "integer" },
                            },
                        },
                        services: {
                            type: "object",
                            additionalProperties: {
                                type: "object",
                                properties: {
                                    status: { type: "string" },
                                    configured: { type: "boolean" },
                                },
                            },
                        },
                    },
                },
                DashboardConfig: {
                    type: "object",
                    properties: {
                        octtBaseUrl: { type: "string", format: "uri" },
                        octtToken: { type: "string" },
                        cdsIp: { type: "string" },
                        cdsPort: { type: "integer" },
                        jiraBaseUrl: { type: "string", format: "uri" },
                        jiraApiToken: { type: "string" },
                        jiraProjectKey: { type: "string" },
                        jiraEmail: { type: "string", format: "email" },
                        ocppVersion: { type: "string", enum: ["1.6", "2.0.1", "ocpp1.6", "ocpp2.0.1"] },
                    },
                },
                PipelineRunRequest: {
                    type: "object",
                    properties: {
                        testcaseNames: {
                            type: "array",
                            items: { type: "string" },
                            maxItems: 500,
                            description: "List of test case names to run",
                        },
                        configurationName: {
                            type: "string",
                            default: "AUT_SID_SAT",
                            description: "OCTT configuration to use",
                        },
                    },
                },
                TestResult: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        status: { type: "string", enum: ["passed", "failed", "skipped", "pending"] },
                        duration: { type: "integer", description: "Duration in ms" },
                        error: { type: "string" },
                        timestamp: { type: "string", format: "date-time" },
                    },
                },
                CdsCheckRequest: {
                    type: "object",
                    properties: {
                        ip: { type: "string", description: "CDS IP address" },
                        port: { type: "integer", description: "CDS port" },
                    },
                },
                CdsMeasurements: {
                    type: "object",
                    properties: {
                        ok: { type: "boolean" },
                        timestamp: { type: "string", format: "date-time" },
                        voltage: { type: "number" },
                        current: { type: "number" },
                        power: { type: "number" },
                        statusFlags: { type: "array", items: { type: "string" } },
                    },
                },
                OcttCheckRequest: {
                    type: "object",
                    properties: {
                        baseUrl: { type: "string", format: "uri" },
                        token: { type: "string" },
                    },
                },
            },
            responses: {
                BadRequest: {
                    description: "Invalid request parameters",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                Conflict: {
                    description: "Operation conflict (e.g., pipeline already running)",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                ServerError: {
                    description: "Internal server error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        },
        paths: {
            // ── Health ──
            "/api/health": {
                get: {
                    tags: ["Health"],
                    summary: "Get comprehensive health status",
                    description: "Returns detailed health information for monitoring systems",
                    responses: {
                        "200": {
                            description: "Health status",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/HealthResponse" },
                                },
                            },
                        },
                    },
                },
            },
            "/api/health/live": {
                get: {
                    tags: ["Health"],
                    summary: "Kubernetes liveness probe",
                    responses: {
                        "200": { description: "Server is alive" },
                    },
                },
            },
            "/api/health/ready": {
                get: {
                    tags: ["Health"],
                    summary: "Kubernetes readiness probe",
                    responses: {
                        "200": { description: "Server is ready" },
                        "503": { description: "Server not ready" },
                    },
                },
            },
            "/api/health/check": {
                post: {
                    tags: ["Health"],
                    summary: "Force health check of all services",
                    responses: {
                        "200": {
                            description: "Health check triggered",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/Success" },
                                },
                            },
                        },
                    },
                },
            },
            // ── Status ──
            "/api/status": {
                get: {
                    tags: ["Status"],
                    summary: "Get dashboard status",
                    description: "Returns current service states, pipeline status, and config summary",
                    responses: {
                        "200": {
                            description: "Dashboard status",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            services: {
                                                type: "object",
                                                additionalProperties: { $ref: "#/components/schemas/ServiceState" },
                                            },
                                            pipeline: {
                                                type: "object",
                                                properties: {
                                                    running: { type: "boolean" },
                                                    resultsCount: { type: "integer" },
                                                },
                                            },
                                            config: { type: "object" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            // ── Pipeline ──
            "/api/pipeline/run-playwright": {
                post: {
                    tags: ["Pipeline"],
                    summary: "Start Playwright test execution",
                    requestBody: {
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/PipelineRunRequest" },
                            },
                        },
                    },
                    responses: {
                        "200": {
                            description: "Pipeline started",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/Success" },
                                },
                            },
                        },
                        "409": { $ref: "#/components/responses/Conflict" },
                        "500": { $ref: "#/components/responses/ServerError" },
                    },
                },
            },
            "/api/pipeline/stop-playwright": {
                post: {
                    tags: ["Pipeline"],
                    summary: "Stop running Playwright execution",
                    responses: {
                        "200": {
                            description: "Pipeline stopped",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/Success" },
                                },
                            },
                        },
                        "409": { $ref: "#/components/responses/Conflict" },
                    },
                },
            },
            // ── Config ──
            "/api/config": {
                get: {
                    tags: ["Config"],
                    summary: "Get current configuration",
                    responses: {
                        "200": {
                            description: "Current config",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/DashboardConfig" },
                                },
                            },
                        },
                    },
                },
                post: {
                    tags: ["Config"],
                    summary: "Update configuration",
                    requestBody: {
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/DashboardConfig" },
                            },
                        },
                    },
                    responses: {
                        "200": {
                            description: "Config updated",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/Success" },
                                },
                            },
                        },
                        "400": { $ref: "#/components/responses/BadRequest" },
                    },
                },
            },
            // ── CDS ──
            "/api/cds/check": {
                post: {
                    tags: ["CDS"],
                    summary: "Check CDS connection",
                    requestBody: {
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/CdsCheckRequest" },
                            },
                        },
                    },
                    responses: {
                        "200": {
                            description: "CDS status",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            ok: { type: "boolean" },
                                            status: { type: "integer" },
                                            flags: { type: "array", items: { type: "string" } },
                                        },
                                    },
                                },
                            },
                        },
                        "500": { $ref: "#/components/responses/ServerError" },
                    },
                },
            },
            "/api/cds/measurements": {
                get: {
                    tags: ["CDS"],
                    summary: "Get CDS measurements",
                    responses: {
                        "200": {
                            description: "Current measurements",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/CdsMeasurements" },
                                },
                            },
                        },
                        "503": {
                            description: "CDS not responding",
                        },
                    },
                },
            },
            // ── OCTT ──
            "/api/octt/check": {
                post: {
                    tags: ["OCTT"],
                    summary: "Check OCTT connection",
                    requestBody: {
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/OcttCheckRequest" },
                            },
                        },
                    },
                    responses: {
                        "200": {
                            description: "OCTT status",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            ok: { type: "boolean" },
                                            configurations: { type: "array", items: { type: "object" } },
                                        },
                                    },
                                },
                            },
                        },
                        "500": { $ref: "#/components/responses/ServerError" },
                    },
                },
            },
            "/api/octt/configurations": {
                get: {
                    tags: ["OCTT"],
                    summary: "List OCTT configurations",
                    responses: {
                        "200": {
                            description: "List of configurations",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            ok: { type: "boolean" },
                                            configurations: { type: "array", items: { type: "object" } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            // ── Jira ──
            "/api/jira/check": {
                post: {
                    tags: ["Jira"],
                    summary: "Check Jira connection",
                    responses: {
                        "200": {
                            description: "Jira status",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            ok: { type: "boolean" },
                                            user: { type: "string" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            // ── Results ──
            "/api/results": {
                get: {
                    tags: ["Results"],
                    summary: "Get last test results",
                    responses: {
                        "200": {
                            description: "Test results array",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "array",
                                        items: { $ref: "#/components/schemas/TestResult" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "/api/results/history": {
                get: {
                    tags: ["Results"],
                    summary: "Get test run history",
                    parameters: [
                        {
                            name: "limit",
                            in: "query",
                            schema: { type: "integer", default: 20 },
                            description: "Max number of runs to return",
                        },
                    ],
                    responses: {
                        "200": {
                            description: "Run history",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            runs: { type: "array", items: { type: "object" } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            // ── Testcases ──
            "/api/testcases": {
                get: {
                    tags: ["Testcases"],
                    summary: "List available test cases",
                    responses: {
                        "200": {
                            description: "Test cases list",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            ok: { type: "boolean" },
                                            testcases: { type: "array", items: { type: "object" } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            // ── SSE ──
            "/api/events": {
                get: {
                    tags: ["Status"],
                    summary: "Server-Sent Events stream",
                    description: "Real-time event stream for pipeline progress and service status updates",
                    responses: {
                        "200": {
                            description: "SSE stream",
                            content: {
                                "text/event-stream": {
                                    schema: { type: "string" },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    apis: [], // We define everything inline above
};

export const swaggerSpec = swaggerJsdoc(options);
