// ══════════════════════════════════════════════════════════════
// Pipeline Routes — Playwright runner control
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { runPlaywright, stopPlaywright, isPlaywrightRunning } from "../services/pipeline.service.js";
import { log } from "./logs.routes.js";
import { validate } from "../middleware/validate.js";
import { pipelineRunSchema } from "../schemas/api.schemas.js";

const router = Router();

router.post("/run-playwright", validate(pipelineRunSchema), async (req, res) => {
    const { testcaseNames, configurationName } = req.body || {};
    if (isPlaywrightRunning()) {
        return res.status(409).json({ ok: false, error: "Playwright already running" });
    }
    const result = await runPlaywright(testcaseNames || [], configurationName || "AUT_SID_SAT");
    if (result.ok) {
        res.json({ ok: true, message: "Playwright started" });
    } else {
        res.status(500).json(result);
    }
});

router.post("/stop-playwright", (_req, res) => {
    if (!isPlaywrightRunning()) {
        return res.status(409).json({ ok: false, error: "No Playwright running" });
    }
    stopPlaywright();
    log("warn", "Playwright cancelled", "playwright");
    res.json({ ok: true });
});

export default router;
