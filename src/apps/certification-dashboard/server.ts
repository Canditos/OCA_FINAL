// ══════════════════════════════════════════════════════════════
// Certification Dashboard Server — Bootstrap
// ══════════════════════════════════════════════════════════════
//
// Previously a 2000-line monolith. Now delegates to modular routes
// and services for maintainability and testability.
// ══════════════════════════════════════════════════════════════

import express from "express";
import cors from "cors";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";

// Config
import { effectiveConfig } from "./config/dashboard.config.js";
import { swaggerSpec } from "./config/swagger.config.js";

// Services
import { addClient, removeClient } from "./services/sse.service.js";
import { initWebSocket, wsBroadcast } from "./services/websocket.service.js";
import { getAllServices } from "./services/service-state.service.js";
import { log } from "./routes/logs.routes.js";

// Middleware
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { rateLimiter } from "./middleware/rate-limiter.js";
import httpLogger from "./middleware/http-logger.js";
import { authMiddleware } from "./middleware/auth.middleware.js";

// Routes
import statusRoutes from "./routes/status.routes.js";
import logsRoutes from "./routes/logs.routes.js";
import healthRoutes from "./routes/health.routes.js";
import cdsRoutes from "./routes/cds.routes.js";
import octtRoutes from "./routes/octt.routes.js";
import pipelineRoutes from "./routes/pipeline.routes.js";
import pipelineConfigRoutes from "./routes/pipeline-config.routes.js";
import jiraRoutes from "./routes/jira.routes.js";
import docsRoutes from "./routes/docs.routes.js";
import relayRoutes from "./routes/relay.routes.js";
import testcasesRoutes from "./routes/testcases.routes.js";
import resultsRoutes from "./routes/results.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import configRoutes from "./routes/config.routes.js";
import sutRoutes from "./routes/sut.routes.js";
import authStatusRoutes from "./routes/auth.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.CERT_DASHBOARD_PORT ?? "3101", 10);

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(httpLogger);
app.use(rateLimiter);

// ── Auth status (no auth required — tells frontend if auth is enabled) ──
app.use("/api/auth", authStatusRoutes);

// ── Auth middleware (applied to /api/* routes; static files are public) ──
app.use("/api", authMiddleware);

// ── API Documentation ──
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "OCPP Certification Dashboard API",
}));
app.get("/api-docs.json", (_req, res) => res.json(swaggerSpec));

// ── API Routes ──
app.use("/api/health", healthRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/logs", logsRoutes);
app.use("/api/cds", cdsRoutes);
app.use("/api/octt", octtRoutes);
app.use("/api/pipeline", pipelineRoutes);
app.use("/api/pipeline-config", pipelineConfigRoutes);
app.use("/api/jira", jiraRoutes);
app.use("/api/docs", docsRoutes);
app.use("/api", relayRoutes);
app.use("/api/relay", relayRoutes);
app.use("/api/testcases", testcasesRoutes);
app.use("/api/results", resultsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/config", configRoutes);
app.use("/api/sut", sutRoutes);

// ── SSE Endpoint ──
app.get("/api/events", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    const id = addClient(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

    // Send current service states so the UI lights are correct immediately
    const services = getAllServices();
    for (const [key, state] of Object.entries(services)) {
        const s = state as any;
        res.write(`event: status\ndata: ${JSON.stringify({ service: key, status: s.status, info: s.info })}\n\n`);
    }

    req.on("close", () => removeClient(id));
});

// ── Static Files ──
// Use source public folder since tsc doesn't copy static assets
const publicPath = path.resolve(__dirname, "../../../src/apps/certification-dashboard/public");
app.use(express.static(publicPath));

// Fallback to index.html for SPA routing
app.get("/", (_req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
});

// ── Error Handling (must be last) ──
app.use(notFoundHandler);
app.use(errorHandler);

// ── Create HTTP Server & Initialize WebSocket ──
const server = http.createServer(app);
initWebSocket(server);

// ── Start ──
server.listen(PORT, async () => {
    console.log(`[Cert Dashboard] http://localhost:${PORT}`);
    log("info", `Dashboard started on port ${PORT}`, "dashboard");

    // Auto-check services on startup
    const { setService } = await import("./services/service-state.service.js");
    const { OcttClient } = await import("../../connectors/octt/index.js");

    // Check OCTT
    if (effectiveConfig.octt.baseUrl && effectiveConfig.octt.token) {
        try {
            setService("octt", "connecting");
            const client = new OcttClient(effectiveConfig.octt);
            const result = await client.listConfigurations();
            setService("octt", "connected", `${result.configurations.length} configs`);
        } catch (e: any) {
            setService("octt", "error", e.message?.slice(0, 60) || "Connection failed");
        }
    }

    // Check CDS + establish persistent relay connection
    try {
        setService("cds", "connecting");
        const { getCds } = await import("./routes/relay.routes.js");
        const cds = await getCds(effectiveConfig.cds.ip, effectiveConfig.cds.port || 51001);
        if (cds?.isConnected) {
            setService("cds", "connected", `${effectiveConfig.cds.ip}:${effectiveConfig.cds.port}`);
            setService("relay", "connected", `${effectiveConfig.cds.ip}:${effectiveConfig.cds.port}`);
        } else {
            setService("cds", "error", "Connection failed");
            setService("relay", "error", "Connection failed");
        }
    } catch (e: any) {
        setService("cds", "error", e.message?.slice(0, 60) || "Connection failed");
        setService("relay", "error", e.message?.slice(0, 60) || "Connection failed");
    }

    // Check Jira
    if (effectiveConfig.jira.baseUrl && effectiveConfig.jira.apiToken) {
        try {
            setService("jira", "connecting");
            const axios = (await import("axios")).default;
            await axios.get(`${effectiveConfig.jira.baseUrl}/rest/api/3/project/${effectiveConfig.jira.projectKey}`, {
                auth: { username: effectiveConfig.jira.email, password: effectiveConfig.jira.apiToken },
                timeout: 5000,
            });
            setService("jira", "connected", effectiveConfig.jira.projectKey || "OK");
        } catch (e: any) {
            setService("jira", "error", e.message?.slice(0, 60) || "Connection failed");
        }
    }

    // Start periodic health checks for auto-reconnect
    const { startHealthChecks } = await import("./services/health-check.service.js");
    startHealthChecks();

    // Start SUT API Relay automatically
    const { startSutRelay } = await import("./services/sut-relay.service.js");
    startSutRelay();

    // Start SUT Automation Bridge on port 3100 to map OCTT commands to CDS
    const fakeSutApp = express();
    fakeSutApp.use(express.json());
    fakeSutApp.use(async (req, res) => {
        log("info", `[SUT Bridge 3100] Received ${req.method} ${req.url}`, "sut");
        
        try {
            const { effectiveConfig } = await import("./config/dashboard.config.js");
            const axios = (await import("axios")).default;
            const port = process.env.CERT_DASHBOARD_PORT ?? "3101";
            const cdsId = `cds-${effectiveConfig.cds.ip.replace(/\./g, "-")}-${effectiveConfig.cds.port}`;
            
            if (req.url.includes("plugin")) {
                log("info", "[SUT Bridge] Translating 'plugin' to CDS Start...", "sut");
                setTimeout(() => {
                    axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/start`).catch(err => log("error", `[SUT Bridge] Failed CDS Start: ${err.message}`, "sut"));
                }, 1000);
            } else if (req.url.includes("plugout") || req.url.includes("unplug")) {
                log("info", "[SUT Bridge] Translating 'plugout' to CDS Stop...", "sut");
                setTimeout(() => {
                    axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/stop`).catch(err => log("error", `[SUT Bridge] Failed CDS Stop: ${err.message}`, "sut"));
                }, 1000);
            } else if (req.url.includes("reboot")) {
                log("warn", "=========================================================================", "sut");
                log("warn", "🚨 AÇÃO MANUAL NECESSÁRIA: Por favor, reinicie o posto FISICAMENTE AGORA!", "sut");
                log("warn", "=========================================================================", "sut");
            } else {
                log("warn", `[SUT Bridge] Unsupported operation on 3100: ${req.url}. Returning 501.`, "sut");
                return res.status(501).json({ ok: false, error: "Not Implemented" });
            }
        } catch (e: any) {
            log("error", `[SUT Bridge] Failed to control CDS: ${e.message}`, "sut");
            return res.status(500).json({ ok: false, error: e.message });
        }
        
        res.json({ ok: true, status: "Accepted by SUT Bridge" });
    });
    fakeSutApp.listen(3100, () => {
        log("info", "SUT Automation Bridge running on port 3100", "sut");
    });
});

// ── Graceful Shutdown ──
process.on("SIGINT", async () => {
    const { stopHealthChecks } = await import("./services/health-check.service.js");
    stopHealthChecks();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    const { stopHealthChecks } = await import("./services/health-check.service.js");
    stopHealthChecks();
    process.exit(0);
});
