// ══════════════════════════════════════════════════════════════
// Relay Routes — SUT API relay agent status + CDS proxy
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { CdsClient } from "../../../connectors/cds/cds-client.js";
import { log } from "./logs.routes.js";
import { setService } from "../services/service-state.service.js";

const router = Router();

router.post("/status", (_req, res) => {
    res.json({ running: false });
});

router.post("/check", async (_req, res) => {
    const connections = Array.from(activeCdsConnections.entries());
    if (connections.length === 0) {
        setService("relay", "disconnected", "No active CDS connections");
        res.json({ ok: true, status: "disconnected", connections: [] });
        return;
    }
    const statuses = connections.map(([key, cds]) => ({
        key,
        connected: cds.isConnected,
    }));
    const anyAlive = statuses.some(s => s.connected);
    setService("relay", anyAlive ? "connected" : "error", `${statuses.filter(s => s.connected).length}/${statuses.length} connections alive`);
    res.json({ ok: true, status: anyAlive ? "connected" : "error", connections: statuses });
});

/**
 * POST /i/:cdsId/stop — Stop CDS simulation
 * POST /i/:cdsId/reset — Full CDS reset cycle
 * POST /i/:cdsId/start — Start CDS simulation
 *
 * cdsId format: cds-{ip}-{port}  (e.g. cds-192-168-100-10-51001)
 */
function parseCdsId(cdsId: string): { ip: string; port: number } | null {
    const match = cdsId.match(/^cds-([\d.]+)-(\d+)$/);
    if (!match) return null;
    return { ip: match[1], port: parseInt(match[2], 10) };
}

// Persistent connection pool to avoid TCP thrashing
const activeCdsConnections = new Map<string, CdsClient>();

export async function getCds(ip: string, port: number): Promise<CdsClient | null> {
    const key = `${ip}:${port}`;
    let cds = activeCdsConnections.get(key);
    
    if (!cds) {
        cds = new CdsClient(ip, port);
        activeCdsConnections.set(key, cds);
    }
    
    const connected = await cds.connect();
    if (!connected) {
        activeCdsConnections.delete(key);
        return null;
    }
    return cds;
}

router.post("/i/:cdsId/stop", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) {
        res.status(400).json({ error: "Invalid CDS ID format" });
        return;
    }
    log("info", `CDS stop relay to ${info.ip}:${info.port}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) {
        res.status(502).json({ error: "Cannot connect to CDS" });
        return;
    }
    const ok = await cds.stop();
    // Do NOT disconnect, keep connection alive in the pool
    res.json({ ok });
});

router.post("/i/:cdsId/reset", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) {
        res.status(400).json({ error: "Invalid CDS ID format" });
        return;
    }
    log("info", `CDS reset relay to ${info.ip}:${info.port}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) {
        res.status(502).json({ error: "Cannot connect to CDS" });
        return;
    }
    const ok = await cds.reset();
    res.json({ ok });
});

router.post("/i/:cdsId/start", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) {
        res.status(400).json({ error: "Invalid CDS ID format" });
        return;
    }
    log("info", `CDS start relay to ${info.ip}:${info.port}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) {
        res.status(502).json({ error: "Cannot connect to CDS" });
        return;
    }
    const ok = await cds.start();
    res.json({ ok });
});

// ── CDS Lifecycle: Configure, Validate, Defaults ──

router.post("/i/:cdsId/configure-cds", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) {
        res.status(400).json({ error: "Invalid CDS ID format" });
        return;
    }
    const { specification, chargeMode, sinkId, mode } = req.body;
    if (specification == null || chargeMode == null || sinkId == null) {
        res.status(400).json({ error: "Missing required fields: specification, chargeMode, sinkId" });
        return;
    }
    log("info", `CDS configure-cds: spec=${specification} mode=${chargeMode} sink=${sinkId}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) {
        res.status(502).json({ error: "Cannot connect to CDS" });
        return;
    }
    const ok = await cds.configureCds({ specification, chargeMode, sinkId, mode: mode ?? 2 });
    res.json({ ok });
});

router.post("/i/:cdsId/configure-ev", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) {
        res.status(400).json({ error: "Invalid CDS ID format" });
        return;
    }
    log("info", `CDS configure-ev: ${JSON.stringify(req.body)}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) {
        res.status(502).json({ error: "Cannot connect to CDS" });
        return;
    }
    const ok = await cds.configureEv(req.body);
    res.json({ ok });
});

router.post("/i/:cdsId/validate", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) {
        res.status(400).json({ error: "Invalid CDS ID format" });
        return;
    }
    const cds = await getCds(info.ip, info.port);
    if (!cds) {
        res.status(502).json({ error: "Cannot connect to CDS" });
        return;
    }
    try {
        const statusPid = await cds.readPid(3);   // Status
        const errorsPid = await cds.readPid(6);   // Errors
        const warningsPid = await cds.readPid(4); // Warnings
        const statusVal = statusPid?.value as number | undefined;
        const errorsVal = errorsPid?.value as number | undefined;
        const warningsVal = warningsPid?.value as number | undefined;

        const hasErrors = errorsVal != null && errorsVal !== 0;
        const hasErrorPending = statusVal != null && (statusVal & 2) !== 0; // ErrorPending = 2
        const healthy = !hasErrors && !hasErrorPending;

        res.json({
            ok: healthy,
            healthy,
            status: statusVal,
            statusDesc: statusVal != null ? cds.getStatusDescription(statusVal) : [],
            errors: errorsVal,
            errorsDesc: hasErrors ? `Error flags: ${errorsVal}` : "None",
            warnings: warningsVal,
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message || "Validation failed" });
    }
});

router.post("/i/:cdsId/defaults", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) {
        res.status(400).json({ error: "Invalid CDS ID format" });
        return;
    }
    log("info", `CDS restore defaults to ${info.ip}:${info.port}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) {
        res.status(502).json({ error: "Cannot connect to CDS" });
        return;
    }
    const ok = await cds.configureEv({
        EVMaximumVoltageLimit: 500,
        EVMinimumVoltageLimit: 400,
        EVMaximumCurrentLimit: 50,
        EVMinimumCurrentLimit: 0,
        EVMaximumPowerLimit: 10000,
        BatteryCapacity: 50000,
        EVstateOfCharge: 50,
    });
    res.json({ ok });
});

export default router;
