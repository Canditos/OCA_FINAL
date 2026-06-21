// ══════════════════════════════════════════════════════════════
// Config Routes — Dashboard configuration persistence
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { currentConfig, updateConfig, effectiveConfig } from "../config/dashboard.config.js";
import { log } from "./logs.routes.js";
import { validate } from "../middleware/validate.js";
import { configSaveSchema } from "../schemas/api.schemas.js";

const router = Router();

// Mask sensitive fields for logging
function maskConfig(cfg: Record<string, unknown>): string {
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg)) {
        if (k.toLowerCase().includes("token") || k.toLowerCase().includes("password") || k.toLowerCase().includes("apitoken")) {
            masked[k] = v ? "***" : "(empty)";
        } else if (k.toLowerCase().includes("url") && typeof v === "string") {
            // Show domain only for URLs
            try {
                const url = new URL(v);
                masked[k] = url.hostname;
            } catch (e: any) {
                console.debug("[config] URL parse error during masking:", e.message);
                masked[k] = v;
            }
        } else {
            masked[k] = v;
        }
    }
    return JSON.stringify(masked);
}

router.get("/", (_req, res) => {
    res.json(currentConfig);
});

router.post("/", validate(configSaveSchema), (req, res) => {
    try {
        log("info", `Config updated: ${maskConfig(req.body)}`, "config");
        updateConfig(req.body);
        res.json({ ok: true });
    } catch (e: any) {
        log("error", `Config save error: ${e.message}`, "config");
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
