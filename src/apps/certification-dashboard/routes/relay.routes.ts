// ══════════════════════════════════════════════════════════════
// Relay Routes — SUT API relay agent status + CDS proxy
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { CdsClient } from "../../../connectors/cds/cds-client.js";
import { log } from "./logs.routes.js";
import { setService } from "../services/service-state.service.js";

const router = Router();

import { isSutRelayRunning } from "../services/sut-relay.service.js";

router.post("/status", (_req, res) => {
    res.json({ running: isSutRelayRunning() });
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
    const match = cdsId.match(/^cds-([\d.-]+)-(\d+)$/);
    if (!match) return null;
    return { ip: match[1].replace(/-/g, "."), port: parseInt(match[2], 10) };
}

// Persistent connection pool to avoid TCP thrashing
const activeCdsConnections = new Map<string, CdsClient>();

// Mutex lock per CDS instance to prevent concurrent operations
const cdsLocks = new Map<string, Promise<void>>();

async function withCdsLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = cdsLocks.get(key) ?? Promise.resolve();
    let release: () => void;
    const nextLock = new Promise<void>(r => { release = r; });
    cdsLocks.set(key, nextLock);
    try {
        await prev;
        return await fn();
    } finally {
        release!();
    }
}

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
    if (!info) { res.status(400).json({ error: "Invalid CDS ID format" }); return; }
    const key = `${info.ip}:${info.port}`;
    log("info", `CDS stop relay to ${key}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) { res.status(502).json({ error: "Cannot connect to CDS" }); return; }
    const ok = await withCdsLock(key, () => cds.stop());
    res.json({ ok });
});

router.post("/i/:cdsId/reset", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) { res.status(400).json({ error: "Invalid CDS ID format" }); return; }
    const key = `${info.ip}:${info.port}`;
    log("info", `CDS reset relay to ${key}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) { res.status(502).json({ error: "Cannot connect to CDS" }); return; }
    const ok = await withCdsLock(key, () => cds.reset());
    res.json({ ok });
});

router.post("/i/:cdsId/start", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) { res.status(400).json({ error: "Invalid CDS ID format" }); return; }
    const key = `${info.ip}:${info.port}`;
    log("info", `CDS start relay to ${key}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) { res.status(502).json({ error: "Cannot connect to CDS" }); return; }
    const ok = await withCdsLock(key, () => cds.start());
    res.json({ ok });
});

// ── CDS Lifecycle: Configure, Validate, Defaults ──

router.post("/i/:cdsId/configure-cds", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) { res.status(400).json({ error: "Invalid CDS ID format" }); return; }
    const { specification, chargeMode, sinkId, mode } = req.body;
    if (specification == null || chargeMode == null || sinkId == null) {
        res.status(400).json({ error: "Missing required fields: specification, chargeMode, sinkId" }); return;
    }
    const key = `${info.ip}:${info.port}`;
    log("info", `CDS configure-cds: spec=${specification} mode=${chargeMode} sink=${sinkId}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) { res.status(502).json({ error: "Cannot connect to CDS" }); return; }
    const ok = await withCdsLock(key, () => cds.configureCds({ specification, chargeMode, sinkId, mode: mode ?? 2 }));
    res.json({ ok });
});

router.post("/i/:cdsId/configure-ev", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) { res.status(400).json({ error: "Invalid CDS ID format" }); return; }
    const key = `${info.ip}:${info.port}`;
    log("info", `CDS configure-ev: ${JSON.stringify(req.body)}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) { res.status(502).json({ error: "Cannot connect to CDS" }); return; }
    const ok = await withCdsLock(key, () => cds.configureEv(req.body));
    res.json({ ok });
});

router.post("/i/:cdsId/validate", async (req, res) => {
    const info = parseCdsId(req.params.cdsId);
    if (!info) { res.status(400).json({ error: "Invalid CDS ID format" }); return; }
    const key = `${info.ip}:${info.port}`;
    const cds = await getCds(info.ip, info.port);
    if (!cds) { res.status(502).json({ error: "Cannot connect to CDS" }); return; }
    try {
        const result = await withCdsLock(key, async () => {
            const statusPid = await cds.readPid(3);
            const errorsPid = await cds.readPid(6);
            const warningsPid = await cds.readPid(4);
            return { statusPid, errorsPid, warningsPid };
        });
        const statusVal = result.statusPid?.value as number | undefined;
        const errorsVal = result.errorsPid?.value as number | undefined;
        const warningsVal = result.warningsPid?.value as number | undefined;
        const hasErrors = errorsVal != null && errorsVal !== 0;
        const hasErrorPending = statusVal != null && (statusVal & 2) !== 0;
        const healthy = !hasErrors && !hasErrorPending;
        res.json({
            ok: healthy, healthy,
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
    if (!info) { res.status(400).json({ error: "Invalid CDS ID format" }); return; }
    const key = `${info.ip}:${info.port}`;
    log("info", `CDS restore defaults to ${key}`, "relay");
    const cds = await getCds(info.ip, info.port);
    if (!cds) { res.status(502).json({ error: "Cannot connect to CDS" }); return; }
    const ok = await withCdsLock(key, () => cds.configureEv({
        EVMaximumVoltageLimit: 500, EVMinimumVoltageLimit: 400,
        EVMaximumCurrentLimit: 50, EVMinimumCurrentLimit: 0,
        EVMaximumPowerLimit: 10000,
        BatteryCapacity: 50000, EVstateOfCharge: 50,
    }));
    res.json({ ok });
});

export default router;
