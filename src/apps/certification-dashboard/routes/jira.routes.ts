// ══════════════════════════════════════════════════════════════
// Jira Routes — Issue tracking and test execution upload
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { JiraClient } from "../../../connectors/jira/index.js";
import { log } from "./logs.routes.js";
import { setService } from "../services/service-state.service.js";
import { effectiveConfig } from "../config/dashboard.config.js";
import { annotateLatestRun, getLastResults } from "../services/pipeline.service.js";
import { validate } from "../middleware/validate.js";
import { jiraUploadSchema } from "../schemas/api.schemas.js";

const router = Router();

router.post("/check", async (_req, res) => {
    try {
        const client = new JiraClient(effectiveConfig.jira);
        await client.search(`project=${effectiveConfig.jira.projectKey}`, undefined, 1);
        setService("jira", "connected", `Project: ${effectiveConfig.jira.projectKey}`);
        res.json({ ok: true, projectKey: effectiveConfig.jira.projectKey });
    } catch (e: any) {
        setService("jira", "error", e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get("/metadata", async (_req, res) => {
    try {
        const client = new JiraClient(effectiveConfig.jira);
        const metadata = await client.getExecutionMetadata();
        res.json({ ok: true, metadata });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post("/upload-execution", validate(jiraUploadSchema), async (req, res) => {
    const { sut, firmwareVersion, testPlan, environment } = req.body;

    try {
        const client = new JiraClient(effectiveConfig.jira);
        const results = getLastResults();
        const passed = results.filter(r => r.verdict === "pass").length;
        const failed = results.filter(r => r.verdict === "fail").length;
        const total = results.length;
        const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

        const summary = `[OCPP 1.6] Test Execution — ${sut} | FW ${firmwareVersion} | ${passRate}% pass`;
        const description = [
            `h2. Test Execution Summary`,
            `| *SUT* | ${sut} |`,
            `| *Firmware* | ${firmwareVersion} |`,
            `| *Pass Rate* | ${passRate}% |`,
            `| *Total* | ${total} |`,
            ``,
            `h2. Results`,
            `| *Test* | *Verdict* | *Duration* |`,
            ...results.map(r => `| ${r.testCase} | ${r.verdict} | ${r.duration}s |`),
        ].join("\n");

        const issue = await client.createIssue({
            summary,
            description,
            issueType: "Task",
            priority: failed > 0 ? "High" : "Medium",
            labels: ["ocpp", "certification", "test-execution"],
        });

        annotateLatestRun({
            sut,
            firmwareVersion,
            testPlan,
            environment,
            jiraIssueKey: issue.key,
            source: "jira-upload",
        });

        log("info", `Execution metadata: SUT=${sut} FW=${firmwareVersion} ENV=${environment || "Lab"} PLAN=${testPlan || "N/A"}`, "jira");
        log("info", `Created Test Execution ${issue.key}`, "jira");
        res.json({ ok: true, issueKey: issue.key, url: `${effectiveConfig.jira.baseUrl}/browse/${issue.key}` });
    } catch (e: any) {
        log("error", `Jira upload failed: ${e.message}`, "jira");
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post("/create-defect", async (req, res) => {
    // Creates a Jira defect (Bug) for a failing/inconc/error test case
    // with AI-generated description based on test metadata and log context.
    const { testCase, verdict } = req.body;
    if (!testCase || !verdict) {
        return res.status(400).json({ ok: false, error: "testCase and verdict are required" });
    }

    try {
        const client = new JiraClient(effectiveConfig.jira);

        // Check for existing open issue for this test case to prevent duplicates
        const existing = await client.findExistingIssue(testCase, verdict);
        if (existing) {
            return res.json({
                ok: true,
                issueKey: existing.key,
                url: `${effectiveConfig.jira.baseUrl}/browse/${existing.key}`,
                existing: true,
                message: `Existing open issue found: ${existing.key}`,
            });
        }

        // Fetch test case details from testcases route data
        let testCaseDescription = "";
        let testCaseSuite = "";
        const { getAllTestCases } = await import("./testcases.routes.js");
        try {
            const all = getAllTestCases();
            const found = (all as any[]).find((t: any) => t.id === testCase);
            if (found) {
                testCaseDescription = found.description || "";
                testCaseSuite = found.suite || "";
            }
        } catch { /* ignore */ }

        // Try to get log context for this test case from log files
        let logContext = "";
        try {
            const fs = await import("fs");
            const path = await import("path");
            const { fileURLToPath } = await import("url");
            const __dirname = path.dirname(fileURLToPath(import.meta.url));
            const logDir = path.resolve(__dirname, "../../../../logs");
            // Find the most recent log file that contains this test case
            const files = fs.existsSync(logDir) ? fs.readdirSync(logDir).filter((f: string) => f.endsWith(".log")).sort().reverse() : [];
            for (const f of files.slice(0, 5)) {
                if (logContext.length > 2000) break;
                const content = fs.readFileSync(path.join(logDir, f), "utf-8");
                const lines = content.split("\n").filter((l: string) => l.includes(testCase));
                if (lines.length > 0) {
                    logContext += lines.slice(0, 15).join("\n") + "\n";
                }
            }
            if (logContext.length > 3000) logContext = logContext.slice(0, 3000) + "\n... (truncated)";
        } catch { /* ignore */ }

        const summary = `[OCPP 1.6] ${testCase} — ${verdict.toUpperCase()}`;
        const description = [
            `h2. Test Failure Report`,
            `|| Field || Value ||`,
            `| Test Case | ${testCase} |`,
            `| Verdict | ${verdict} |`,
            `| Suite | ${testCaseSuite || "—"} |`,
            `| Description | ${testCaseDescription || "—"} |`,
            ``,
            `h3. AI Analysis`,
            `This defect was automatically generated from the certification pipeline.`,
            verdict === "fail" ? `The test case ${testCase} failed during execution.` :
            verdict === "inconc" ? `The test case ${testCase} completed with an inconclusive verdict (likely infrastructure timeout).` :
            `The test case ${testCase} encountered an error during execution.`,
            ``,
            logContext ? [
                `h3. Log Context`,
                `{code}${logContext}{code}`,
            ].join("\n") : `h3. Log Context`,
            logContext ? "" : "No detailed logs available for this test case.",
            ``,
            `h3. Suggested Next Steps`,
            `# Review the test execution logs for ${testCase}.`,
            `# Check if the OCTT cloud proxy timeout (10 min) was exceeded.`,
            `# Verify SUT WebSocket connection stability.`,
            `# Re-run the test to confirm reproducibility.`,
            `# Update this defect with findings.`,
        ].filter(Boolean).join("\n");

        const issue = await client.createIssue({
            summary,
            description,
            issueType: "Bug",
            priority: verdict === "error" ? "Highest" : verdict === "fail" ? "High" : "Medium",
            labels: ["ocpp", "certification", "defect", testCase, verdict],
        });

        log("info", `Created defect ${issue.key} for ${testCase} (${verdict})`, "jira");
        res.json({
            ok: true,
            issueKey: issue.key,
            url: `${effectiveConfig.jira.baseUrl}/browse/${issue.key}`,
            existing: false,
        });
    } catch (e: any) {
        log("error", `Defect creation failed: ${e.message}`, "jira");
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post("/upload", async (req, res) => {
    const { testcase, testplan, testexecution, ocppVersion, chargerNumber, comment } = req.body;
    try {
        const client = new JiraClient(effectiveConfig.jira);
        const summary = `[OCPP ${ocppVersion || "1.6"}] ${testcase} — ${chargerNumber || "N/A"}`;
        const description = [
            `h2. Test Case: ${testcase}`,
            `| *Test Plan* | ${testplan || "N/A"} |`,
            `| *Test Execution* | ${testexecution || "N/A"} |`,
            `| *OCPP Version* | ${ocppVersion || "1.6"} |`,
            `| *Charger Number* | ${chargerNumber || "N/A"} |`,
            ``,
            `h3. Comment`,
            comment || "No comment",
        ].join("\n");

        const issue = await client.createIssue({
            summary,
            description,
            issueType: "Task",
            priority: "Medium",
            labels: ["ocpp", "certification", testcase],
        });

        log("info", `Created issue ${issue.key} for ${testcase}`, "jira");
        res.json({ ok: true, issueKey: issue.key, message: `Created ${issue.key}` });
    } catch (e: any) {
        log("error", `Jira upload failed: ${e.message}`, "jira");
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
