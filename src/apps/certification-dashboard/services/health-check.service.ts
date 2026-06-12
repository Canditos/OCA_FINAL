// ══════════════════════════════════════════════════════════════
// Periodic Health Check Service — Auto-reconnect for OCTT/CDS
// ══════════════════════════════════════════════════════════════
//
// Runs background checks on external services and attempts
// automatic reconnection when services are down.
// ══════════════════════════════════════════════════════════════

import { setService, getService } from "./service-state.service.js";
import { effectiveConfig } from "../config/dashboard.config.js";
import { log } from "../routes/logs.routes.js";

interface HealthCheckConfig {
    enabled: boolean;
    intervalMs: number;
    retryDelayMs: number;
    maxRetries: number;
}

const config: HealthCheckConfig = {
    enabled: process.env.HEALTH_CHECK_ENABLED !== "false",
    intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? "30000", 10), // 30 seconds
    retryDelayMs: parseInt(process.env.HEALTH_CHECK_RETRY_DELAY_MS ?? "5000", 10), // 5 seconds
    maxRetries: parseInt(process.env.HEALTH_CHECK_MAX_RETRIES ?? "3", 10),
};

let checkInterval: NodeJS.Timeout | null = null;
let isChecking = false;

// Track retry counts per service
const retryCount = new Map<string, number>();

/**
 * Check OCTT connectivity and attempt reconnection
 */
async function checkOctt(): Promise<void> {
    const { baseUrl, token } = effectiveConfig.octt;
    if (!baseUrl || !token) return;

    const currentState = getService("octt");
    if (currentState?.status === "running") return; // Don't interrupt running operations

    try {
        const { OcttClient } = await import("../../../connectors/octt/index.js");
        const client = new OcttClient(effectiveConfig.octt);
        const result = await client.listConfigurations();
        
        // Success - reset retry count
        retryCount.set("octt", 0);
        
        if (currentState?.status !== "connected") {
            setService("octt", "connected", `${result.configurations.length} configs`);
            log("info", "OCTT auto-reconnected", "health-check");
        }
    } catch (e: any) {
        const retries = retryCount.get("octt") ?? 0;
        
        if (currentState?.status === "connected") {
            // Was connected, now failed
            setService("octt", "error", `Connection lost: ${e.message?.slice(0, 40) || "Unknown error"}`);
            log("warn", `OCTT connection lost: ${e.message}`, "health-check");
        }
        
        if (retries < config.maxRetries) {
            retryCount.set("octt", retries + 1);
            log("info", `OCTT reconnect attempt ${retries + 1}/${config.maxRetries}`, "health-check");
        }
    }
}

/**
 * Check CDS connectivity and attempt reconnection
 */
async function checkCds(): Promise<void> {
    const { ip, port } = effectiveConfig.cds;
    if (!ip) return;

    const currentState = getService("cds");
    if (currentState?.status === "running") return; // Don't interrupt running operations

    try {
        const { CdsClient } = await import("../../../connectors/cds/index.js");
        const cds = new CdsClient(ip, port);
        const connected = await cds.connect();
        
        if (connected) {
            await cds.disconnect();
            
            // Success - reset retry count
            retryCount.set("cds", 0);
            
            if (currentState?.status !== "connected") {
                setService("cds", "connected", `${ip}:${port}`);
                log("info", "CDS auto-reconnected", "health-check");
            }
        } else {
            throw new Error("Connection failed");
        }
    } catch (e: any) {
        const retries = retryCount.get("cds") ?? 0;
        
        if (currentState?.status === "connected") {
            // Was connected, now failed
            setService("cds", "error", `Connection lost: ${e.message?.slice(0, 40) || "Unknown error"}`);
            log("warn", `CDS connection lost: ${e.message}`, "health-check");
        }
        
        if (retries < config.maxRetries) {
            retryCount.set("cds", retries + 1);
            log("info", `CDS reconnect attempt ${retries + 1}/${config.maxRetries}`, "health-check");
        }
    }
}

/**
 * Run all health checks
 */
async function runHealthChecks(): Promise<void> {
    if (isChecking) return; // Prevent concurrent checks
    isChecking = true;

    try {
        await Promise.all([
            checkOctt(),
            checkCds(),
        ]);
    } catch (e) {
        console.error("[health-check] Error during health checks:", e);
    } finally {
        isChecking = false;
    }
}

/**
 * Start periodic health checks
 */
export function startHealthChecks(): void {
    if (!config.enabled) {
        console.log("[health-check] Periodic health checks disabled");
        return;
    }

    if (checkInterval) {
        clearInterval(checkInterval);
    }

    console.log(`[health-check] Starting periodic checks every ${config.intervalMs / 1000}s`);
    
    // Run initial check after a short delay
    setTimeout(runHealthChecks, 5000);
    
    // Schedule periodic checks
    checkInterval = setInterval(runHealthChecks, config.intervalMs);
}

/**
 * Stop periodic health checks
 */
export function stopHealthChecks(): void {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
        console.log("[health-check] Periodic checks stopped");
    }
}

/**
 * Force an immediate health check
 */
export function forceHealthCheck(): Promise<void> {
    return runHealthChecks();
}

/**
 * Get health check configuration
 */
export function getHealthCheckConfig(): HealthCheckConfig {
    return { ...config };
}

/**
 * Get current retry counts
 */
export function getRetryStats(): Record<string, number> {
    return Object.fromEntries(retryCount);
}
