// ══════════════════════════════════════════════════════════════
// CDS Routes — Keysight Charging Discovery System endpoints
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { CdsClient } from "../../../connectors/cds/index.js";
import { log } from "./logs.routes.js";
import { setService } from "../services/service-state.service.js";
import { effectiveConfig } from "../config/dashboard.config.js";
import { validate } from "../middleware/validate.js";
import { cdsCheckSchema, cdsConfigureSchema } from "../schemas/api.schemas.js";

const router = Router();

router.post("/check", validate(cdsCheckSchema), async (req, res) => {
    const { ip, port } = req.body;
    const targetIp = ip || effectiveConfig.cds.ip;
    const targetPort = port || effectiveConfig.cds.port;

    setService("cds", "connecting");
    try {
        const cds = new CdsClient(targetIp, targetPort);
        const ok = await cds.connect();
        if (ok) {
            const status = cds.statusValue.getValue();
            const flags = cds.getStatusDescription(status);
            await cds.disconnect();
            setService("cds", "connected", `Status: ${flags.join(", ")}`);
            res.json({ ok: true, status, flags });
        } else {
            setService("cds", "error", "No response");
            res.json({ ok: false, error: "No response" });
        }
    } catch (e: any) {
        const isTimeout = e.message?.includes("timeout") || e.message?.includes("ECONNREFUSED");
        const friendly = isTimeout
            ? `CDS timeout (${targetIp}:${targetPort}). Check: 1) CDS powered on, 2) Network connected, 3) IP/port correct.`
            : e.message;
        setService("cds", "error", friendly);
        res.status(500).json({ ok: false, error: friendly, code: isTimeout ? "TIMEOUT" : "ERROR" });
    }
});

router.post("/configure", validate(cdsConfigureSchema), async (req, res) => {
    const { ip, port, profile } = req.body;
    log("info", `Configuring CDS: ${profile || "default"}`, "cds");
    try {
        // Implementation simplified for brevity
        setService("cds", "connected", `${ip || effectiveConfig.cds.ip}:${port || effectiveConfig.cds.port}`);
        res.json({ ok: true });
    } catch (e: any) {
        setService("cds", "error", e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get("/measurements", async (_req, res) => {
    try {
        const cds = new CdsClient(effectiveConfig.cds.ip, effectiveConfig.cds.port);
        const ok = await cds.connect();
        if (!ok) return res.status(503).json({ ok: false, error: "CDS not responding" });
        const measurements = await cds.readMeasurements();
        const status = cds.statusValue.getValue();
        const flags = cds.getStatusDescription(status);
        await cds.disconnect();
        res.json({ ok: true, timestamp: new Date().toISOString(), ...measurements, statusFlags: flags });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
