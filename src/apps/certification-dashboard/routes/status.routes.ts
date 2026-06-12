// ══════════════════════════════════════════════════════════════
// Status Routes — Service health and dashboard config
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { getAllServices } from "../services/service-state.service.js";
import { isPlaywrightRunning, getLastResults } from "../services/pipeline.service.js";
import { effectiveConfig } from "../config/dashboard.config.js";

const router = Router();

router.get("/", (_req, res) => {
    res.json({
        services: getAllServices(),
        pipeline: {
            running: isPlaywrightRunning(),
            resultsCount: getLastResults().length,
        },
        config: {
            octtUrl: effectiveConfig.octt.baseUrl,
            octtToken: effectiveConfig.octt.token ? effectiveConfig.octt.token.slice(0, 8) + "..." : "",
            cdsIp: effectiveConfig.cds.ip,
            cdsPort: effectiveConfig.cds.port,
            jiraProjectKey: effectiveConfig.jira.projectKey,
        },
    });
});

export default router;
