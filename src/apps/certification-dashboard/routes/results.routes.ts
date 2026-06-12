import { Router } from "express";
import { getLastResults, getRunHistory, getHistoryTriageSummary, clearRunHistory, clearLastResults } from "../services/pipeline.service.js";
import { getLogs } from "./logs.routes.js";

const router = Router();

function enrichHistoryFromLogs(history: any[]) {
    const metadataLogs = getLogs()
        .filter(l => l.service === "jira" && typeof l.message === "string" && l.message.startsWith("Execution metadata:"))
        .map(l => {
            const sut = /SUT=([^\s].*?)\sFW=/.exec(l.message)?.[1]?.trim();
            const fw = /FW=([^\s].*?)\sENV=/.exec(l.message)?.[1]?.trim();
            const env = /ENV=([^\s].*?)\sPLAN=/.exec(l.message)?.[1]?.trim();
            const plan = /PLAN=(.+)$/.exec(l.message)?.[1]?.trim();
            return {
                timestamp: new Date(l.timestamp).getTime(),
                metadata: {
                    sut: sut || undefined,
                    firmwareVersion: fw || undefined,
                    environment: env || undefined,
                    testPlan: plan && plan !== "N/A" ? plan : undefined,
                    source: "log-inferred",
                },
            };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

    if (!metadataLogs.length) return history;

    return history.map(run => {
        if (run?.metadata?.sut || run?.metadata?.firmwareVersion) return run;
        const runTs = new Date(run.timestamp).getTime();
        const match = metadataLogs.find(m => m.timestamp >= runTs && (m.timestamp - runTs) <= 30 * 60 * 1000);
        if (!match) return run;
        return {
            ...run,
            metadata: {
                ...(run.metadata || {}),
                ...match.metadata,
            },
        };
    });
}

router.get("/", (_req, res) => {
    const results = getLastResults();
    res.json({ results, total: results.length });
});

// ── Run History ──

router.get("/history", (_req, res) => {
    const history = enrichHistoryFromLogs(getRunHistory());
    res.json(history);
});

router.get("/history/triage", (_req, res) => {
    const history = enrichHistoryFromLogs(getRunHistory());
    res.json(getHistoryTriageSummary(history));
});

router.post("/history/clear", (_req, res) => {
    clearRunHistory();
    res.json({ ok: true });
});

router.post("/reset", (_req, res) => {
    clearLastResults();
    res.json({ ok: true });
});

export default router;
