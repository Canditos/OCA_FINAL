// ══════════════════════════════════════════════════════════════
// Health Routes — Monitoring & liveness endpoints
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import os from "os";
import { wsClientCount } from "../services/websocket.service.js";
import { isPlaywrightRunning, getLastResults } from "../services/pipeline.service.js";
import { effectiveConfig } from "../config/dashboard.config.js";
import { getRateLimitStats } from "../middleware/rate-limiter.js";
import { getHealthCheckConfig, getRetryStats, forceHealthCheck } from "../services/health-check.service.js";
import { getAllServices } from "../services/service-state.service.js";

const router = Router();
const startTime = Date.now();

interface HealthStatus {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    uptime: number;
    version: string;
    node: string;
    memory: {
        used: number;
        total: number;
        percentage: number;
    };
    connections: {
        websocket: number;
    };
    pipeline: {
        running: boolean;
        lastResultsCount: number;
    };
    services: Record<string, { status: string; configured: boolean }>;
    rateLimit: {
        activeClients: number;
        windowMs: number;
        maxRequests: number;
    };
    healthChecks: {
        enabled: boolean;
        intervalMs: number;
        retries: Record<string, number>;
    };
}

/**
 * GET /api/health
 * Returns comprehensive health status for monitoring systems
 */
router.get("/", (_req, res) => {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const rateLimitStats = getRateLimitStats();
    const healthCheckConfig = getHealthCheckConfig();
    const serviceStates = getAllServices();

    const health: HealthStatus = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: process.env.npm_package_version || "1.0.0",
        node: process.version,
        memory: {
            used: Math.round(memUsage.heapUsed / 1024 / 1024),
            total: Math.round(memUsage.heapTotal / 1024 / 1024),
            percentage: Math.round((usedMem / totalMem) * 100),
        },
        connections: {
            websocket: wsClientCount(),
        },
        pipeline: {
            running: isPlaywrightRunning(),
            lastResultsCount: getLastResults().length,
        },
        services: {
            octt: { 
                status: serviceStates.octt?.status || "disconnected",
                configured: Boolean(effectiveConfig.octt.baseUrl && effectiveConfig.octt.token),
            },
            cds: { 
                status: serviceStates.cds?.status || "disconnected",
                configured: Boolean(effectiveConfig.cds.ip),
            },
            jira: { 
                status: serviceStates.jira?.status || "disconnected",
                configured: Boolean(effectiveConfig.jira.baseUrl && effectiveConfig.jira.apiToken),
            },
        },
        rateLimit: {
            activeClients: rateLimitStats.activeClients,
            windowMs: rateLimitStats.config.windowMs,
            maxRequests: rateLimitStats.config.maxRequests,
        },
        healthChecks: {
            enabled: healthCheckConfig.enabled,
            intervalMs: healthCheckConfig.intervalMs,
            retries: getRetryStats(),
        },
    };

    // Determine overall status based on service states
    const hasError = Object.values(serviceStates).some(s => s.status === "error");
    const hasDisconnected = Object.values(serviceStates).some(s => s.status === "disconnected");
    
    if (hasError) {
        health.status = "degraded";
    }
    if (!health.services.octt.configured || !health.services.cds.configured) {
        health.status = "degraded";
    }
    if (health.memory.percentage > 90) {
        health.status = "degraded";
    }

    res.json(health);
});

/**
 * GET /api/health/live
 * Simple liveness check (for k8s/docker health checks)
 */
router.get("/live", (_req, res) => {
    res.status(200).json({ ok: true });
});

/**
 * GET /api/health/ready
 * Readiness check - confirms services are configured
 */
router.get("/ready", (_req, res) => {
    const ready = Boolean(effectiveConfig.octt.baseUrl && effectiveConfig.cds.ip);
    res.status(ready ? 200 : 503).json({ ready });
});

/**
 * POST /api/health/check
 * Force an immediate health check of all services
 */
router.post("/check", async (_req, res) => {
    try {
        await forceHealthCheck();
        res.json({ ok: true, message: "Health check completed" });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
