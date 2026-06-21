// ══════════════════════════════════════════════════════════════
// Pipeline Config Routes — Runtime timeout configuration
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { reloadPipelineConfig } from "../services/pipeline.service.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../config/pipeline.config.json");

// Schema for timeout update
const timeoutUpdateSchema = z.object({
    profile: z.enum(["default", "reboot"]),
    maxTimeoutPeriod: z.number().min(10).max(3600),
    longOperationTimeout: z.number().min(10).max(3600),
    maxTimeDeviation: z.number().min(1).max(60),
});

const rebootTestsSchema = z.object({
    rebootTests: z.array(z.string().min(1).max(100)).max(50),
});

interface PipelineConfig {
    rebootTests: string[];
    timeouts: {
        default: { maxTimeoutPeriod: number; longOperationTimeout: number; maxTimeDeviation: number };
        reboot: { maxTimeoutPeriod: number; longOperationTimeout: number; maxTimeDeviation: number };
    };
}

function loadConfig(): PipelineConfig {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
        return JSON.parse(raw);
    } catch (e: any) {
        console.warn("[pipeline-config] Failed to load config, using defaults:", e.message);
        return {
            rebootTests: [],
            timeouts: {
                default: { maxTimeoutPeriod: 70, longOperationTimeout: 450, maxTimeDeviation: 4 },
                reboot: { maxTimeoutPeriod: 600, longOperationTimeout: 650, maxTimeDeviation: 4 },
            },
        };
    }
}

function saveConfig(config: PipelineConfig): void {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * GET /api/pipeline-config
 * Returns current pipeline configuration (timeouts, reboot tests)
 */
router.get("/", (_req, res) => {
    res.json(loadConfig());
});

/**
 * PUT /api/pipeline-config/timeouts
 * Update timeout settings for a profile
 */
router.put("/timeouts", validate(timeoutUpdateSchema), (req, res) => {
    const { profile, maxTimeoutPeriod, longOperationTimeout, maxTimeDeviation } = req.body;
    const config = loadConfig();
    config.timeouts[profile as "default" | "reboot"] = {
        maxTimeoutPeriod,
        longOperationTimeout,
        maxTimeDeviation,
    };
    saveConfig(config);
    reloadPipelineConfig();
    res.json({ ok: true, timeouts: config.timeouts });
});

/**
 * PUT /api/pipeline-config/reboot-tests
 * Update list of tests that require reboot timeouts
 */
router.put("/reboot-tests", validate(rebootTestsSchema), (req, res) => {
    const { rebootTests } = req.body;
    const config = loadConfig();
    config.rebootTests = rebootTests;
    saveConfig(config);
    reloadPipelineConfig();
    res.json({ ok: true, rebootTests });
});

export default router;
