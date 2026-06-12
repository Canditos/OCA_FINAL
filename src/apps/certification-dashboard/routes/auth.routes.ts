// ══════════════════════════════════════════════════════════════
// Auth Routes — Status endpoint (no auth required)
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { effectiveConfig } from "../config/dashboard.config.js";

const router = Router();

router.get("/status", (_req, res) => {
    const key = effectiveConfig.dashboardApiKey || process.env.DASHBOARD_API_KEY || "";
    const configured = key.length > 0;
    res.json({
        required: configured,
        message: configured ? "Authentication is enabled. Include ?apiKey= or Authorization header." : "Auth is not configured — open access.",
        apiKeyHint: configured ? (key.slice(0, 4) + "..." + (key.length > 8 ? key.slice(-4) : "")) : null,
    });
});

export default router;
