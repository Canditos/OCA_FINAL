// ══════════════════════════════════════════════════════════════
// Jira Routes — Issue tracking and test execution upload
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import fs from "fs";
import path from "path";
import { JiraClient } from "../../../connectors/jira/index.js";
import { OcttClient } from "../../../connectors/octt/index.js";
import { log } from "./logs.routes.js";
import { setService } from "../services/service-state.service.js";
import { effectiveConfig } from "../config/dashboard.config.js";
import { annotateLatestRun, getLastResults, getRunHistory } from "../services/pipeline.service.js";
import { validate } from "../middleware/validate.js";
import { jiraUploadSchema } from "../schemas/api.schemas.js";
import {
    parseXrayUrl,
    buildXrayStepResults,
    getXrayFieldIds,
    prepareTestEntry,
    uploadAndAttach,
    validateTestInExecution,
    findTestKeyForUpload,
} from "../services/xray-upload.service.js";

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

let metadataCache: any = null;
let metadataCacheTime = 0;

const METADATA_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
}

router.get("/metadata", async (_req, res) => {
    try {
        if (metadataCache && Date.now() - metadataCacheTime < 5 * 60 * 1000) {
            return res.json({ ok: true, metadata: metadataCache });
        }

        const client = new JiraClient(effectiveConfig.jira);
        
        let suts: string[] = [];
        let firmwares: string[] = [];
        let testPlans: string[] = [];

        // 1. Fetch FW Version and DUT values from Xray Cloud custom fields
        try {
            if (effectiveConfig.xray?.clientId && effectiveConfig.xray?.clientSecret) {
                const xrayFields = await withTimeout(
                    client.getXrayCustomFieldsSpec(
                        effectiveConfig.xray.clientId,
                        effectiveConfig.xray.clientSecret,
                        effectiveConfig.jira.projectKey
                    ),
                    METADATA_TIMEOUT_MS
                );
                
                const fwField = xrayFields.find((f: any) => f.name === "FW Version");
                const dutField = xrayFields.find((f: any) => f.name === "DUT");

                if (fwField && fwField.values) {
                    firmwares = fwField.values.filter((v: string) => v !== "no run (SKIPPED or BLOCKED)");
                }
                if (dutField && dutField.values) {
                    suts = dutField.values.filter((v: string) => v !== "no run (SKIPPED or BLOCKED)");
                }
                log("debug", `Xray custom fields: ${firmwares.length} FW versions, ${suts.length} SUTs`, "jira");
            } else {
                log("warn", "Xray credentials not configured — skipping custom field fetch", "jira");
            }
        } catch (err: any) {
            log("warn", `Could not load custom fields from Xray settings: ${err.message}`, "jira");
        }

        // 2. If Xray fields query returned nothing, try fetching FW from recent test execution issues
        if (firmwares.length === 0) {
            try {
                const fwFieldId = (await client.getFieldIds(["FW Version"]))["FW Version"];
                if (fwFieldId) {
                    const jql = `project = "${effectiveConfig.jira.projectKey}" AND issuetype = "Test Execution" ORDER BY created DESC`;
                    const recent = await client.search(jql, ["summary"], 20);
                    const fwSet = new Set<string>();
                    for (const issue of recent.issues) {
                        const val = (issue.fields as any)[fwFieldId];
                        if (val && typeof val === "string" && val !== "no run (SKIPPED or BLOCKED)") {
                            fwSet.add(val);
                        }
                    }
                    if (fwSet.size > 0) {
                        firmwares = Array.from(fwSet).sort();
                        log("info", `Fallback: found ${firmwares.length} FW versions from recent executions`, "jira");
                    }
                }
            } catch (err: any) {
                log("warn", `Fallback FW fetch failed: ${err.message}`, "jira");
            }
        }

        // 3. Fetch real Test Plans from Jira (issuetype = "Test Plan")
        try {
            const plans = await withTimeout(client.searchTestPlans(), METADATA_TIMEOUT_MS);
            testPlans = plans.map(p => p.key + (p.summary ? ` — ${p.summary}` : ""));
            log("debug", `Found ${testPlans.length} Test Plans in Jira`, "jira");
        } catch (err: any) {
            // silent: client method may not be available
        }

        metadataCache = { suts, firmwares, testPlans };
        metadataCacheTime = Date.now();

        res.json({
            ok: true,
            metadata: metadataCache
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get("/test-executions", async (req, res) => {
    const testPlan = String(req.query.testPlan || "").trim();
    if (!testPlan) {
        return res.status(400).json({ ok: false, error: "testPlan is required" });
    }

    try {
        const client = new JiraClient(effectiveConfig.jira);
        let executions: Array<{ key: string; summary?: string }> = [];

        try {
            if (effectiveConfig.xray?.clientId && effectiveConfig.xray?.clientSecret) {
                const testPlanKey = await client.findTestPlanKey(testPlan);
                if (testPlanKey) {
                    const issueDetails = await client.getIssue(testPlanKey);
                    const token = await client.authenticateXray(effectiveConfig.xray.clientId, effectiveConfig.xray.clientSecret);
                    executions = await client.getXrayTestPlanExecutions(issueDetails.id, token);
                }
            }
        } catch (err: any) {
            log("warn", `Could not load Xray executions for Test Plan ${testPlan}: ${err.message}`, "jira");
        }

        if (executions.length === 0) {
            executions = await client.searchTestExecutions(testPlan);
        }

        res.json({
            ok: true,
            testPlan,
            executions: executions
                .filter((item, idx, arr) => item.key && arr.findIndex(other => other.key === item.key) === idx)
                .sort((a, b) => a.key.localeCompare(b.key)),
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post("/upload-execution", validate(jiraUploadSchema), async (req, res) => {
    const { sut, firmwareVersion, testPlan, environment, runId, testExecutionKey, ocppBackend } = req.body;

    try {
        const client = new JiraClient(effectiveConfig.jira);
        const octt = new OcttClient(effectiveConfig.octt);

        let finalTestExecutionKey = testExecutionKey;
        let finalTestPlan = testPlan ? testPlan.split(" ")[0] : testPlan;

        if (testExecutionKey && (testExecutionKey.startsWith("http://") || testExecutionKey.startsWith("https://"))) {
            const parsed = parseXrayUrl(testExecutionKey);
            if (parsed) {
                finalTestExecutionKey = parsed.testExecutionKey;
                if (parsed.testPlanId) finalTestPlan = parsed.testPlanId;
            }
        }

        if (!finalTestExecutionKey) throw new Error("Test Execution Key is required.");

        const history = getRunHistory();
        const entry = runId ? history.find(h => h.id === runId) : history[0];
        const results = entry ? entry.results || [] : getLastResults();
        const configurationName = entry?.configName || "AUT_SID_SAT";

        if (results.length === 0) throw new Error("No test results found to upload.");

        if (!effectiveConfig.xray?.clientId || !effectiveConfig.xray?.clientSecret) {
            throw new Error("Xray Client ID and Secret are not configured in the Dashboard settings.");
        }
        const token = await client.authenticateXray(effectiveConfig.xray.clientId, effectiveConfig.xray.clientSecret);

        const fieldIds = await getXrayFieldIds();

        log("info", `Resolving Jira keys, steps, and downloading evidence for ${results.length} tests...`, "jira");
        const testsWithEvidence = await Promise.all(results.map(async (r) => {
            const testKey = await findTestKeyForUpload(client, r.testCase, finalTestExecutionKey, token);
            if (!testKey) {
                throw new Error(
                    `Test case "${r.testCase}" does not exist in Jira. ` +
                    `Create the Test issue in Jira first with the summary containing "${r.testCase}".`
                );
            }

            await validateTestInExecution(client, finalTestExecutionKey, testKey, token);

            const xrayStatus = r.verdict === "pass" ? "PASSED" : "FAILED";

            return prepareTestEntry({
                client, octt, testKey, testCase: r.testCase, xrayStatus, token, fieldIds,
                firmwareVersion, sut, ocppBackend, configurationName,
            });
        }));

        const payload: any = {
            testExecutionKey: finalTestExecutionKey || undefined,
            tests: testsWithEvidence.map((t: any) => t.testEntry)
        };
        if (finalTestPlan) payload.info = { testPlanKey: finalTestPlan };

        const finalKey = await uploadAndAttach(
            client, payload, token,
            testsWithEvidence.filter((t: any) => t.zipBuffer).map((t: any) => ({ testCase: t.testCase, zipBuffer: t.zipBuffer })),
            finalTestExecutionKey
        );

        annotateLatestRun({
            sut,
            firmwareVersion,
            testPlan: finalTestPlan,
            environment,
            jiraIssueKey: finalKey,
            source: "jira-upload",
        });

        log("info", `Uploaded execution to Xray: ${finalKey}`, "jira");
        res.json({
            ok: true,
            issueKey: finalKey,
            url: `${effectiveConfig.jira.baseUrl}/browse/${finalKey}`,
            summary: {
                total: results.length,
                passed: results.filter(r => r.verdict === "pass").length,
                failed: results.filter(r => r.verdict !== "pass").length,
                passRate: Math.round((results.filter(r => r.verdict === "pass").length / results.length) * 100)
            }
        });
    } catch (e: any) {
        log("error", `Jira upload-execution failed: ${e.message}`, "jira");
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get("/test-execution-tests", async (req, res) => {
    const testExecutionKey = String(req.query.testExecutionKey || "").trim();
    if (!testExecutionKey) {
        return res.status(400).json({ ok: false, error: "testExecutionKey is required" });
    }

    try {
        const client = new JiraClient(effectiveConfig.jira);

        if (!effectiveConfig.xray?.clientId || !effectiveConfig.xray?.clientSecret) {
            throw new Error("Xray Client ID and Secret are not configured.");
        }

        // Resolve key to numeric issue ID
        const issueDetails = await client.getIssue(testExecutionKey);

        // Authenticate with Xray
        const token = await client.authenticateXray(
            effectiveConfig.xray.clientId,
            effectiveConfig.xray.clientSecret
        );

        // Fetch tests from the execution via GraphQL
        const tests = await client.getXrayTestExecutionTests(issueDetails.id, token);

        log("info", `Loaded ${tests.length} tests from ${testExecutionKey}`, "jira");

        res.json({
            ok: true,
            testExecutionKey,
            tests: tests.map(t => ({
                key: t.key,
                testCaseName: t.testCaseName
            }))
        });
    } catch (e: any) {
        log("error", `Failed to load test execution tests: ${e.message}`, "jira");
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get("/execution-metadata", async (req, res) => {
    const testExecutionKey = String(req.query.testExecutionKey || "").trim();
    if (!testExecutionKey) {
        return res.status(400).json({ ok: false, error: "testExecutionKey is required" });
    }

    // Pre-flight: check that Jira credentials are actually configured
    if (!effectiveConfig.jira.apiToken) {
        log("warn", `Cannot fetch execution metadata: Jira API Token is not configured`, "jira");
        return res.status(400).json({
            ok: false,
            error: "Jira API Token is not configured. Go to Settings and add your Jira API Token, or run: npx tsx scripts/setup-jira.ts"
        });
    }

    try {
        const client = new JiraClient(effectiveConfig.jira);

        // Fetch the issue and extract custom fields for SUT, FW, OCPP backend
        const issue = await client.getIssue(testExecutionKey);
        const fields = issue.fields || {};

        let sut = "";
        let firmwareVersion = "";
        let ocppBackend = "";

        // Attempt to fetch Xray Test Run Custom Fields from the execution
        if (effectiveConfig.xray?.clientId && effectiveConfig.xray?.clientSecret) {
            try {
                const token = await client.authenticateXray(effectiveConfig.xray.clientId, effectiveConfig.xray.clientSecret);
                
                // First get the field names mapping from the project settings
                const xrayFields = await client.getXrayCustomFieldsSpec(
                    effectiveConfig.xray.clientId,
                    effectiveConfig.xray.clientSecret,
                    effectiveConfig.jira.projectKey
                );
                
                const fwFieldId = xrayFields.find((f: any) => f.name === "FW Version")?.id;
                const dutFieldId = xrayFields.find((f: any) => f.name === "DUT" || f.name === "SUT")?.id;
                const ocppFieldId = xrayFields.find((f: any) => f.name === "OCPP backend")?.id;

                // Then fetch the actual values from the first test run in this execution
                const testRunFields = await client.getXrayExecutionCustomFields(issue.id, token);

                const sutField = testRunFields.find((f: any) => f.id === dutFieldId);
                const fwField = testRunFields.find((f: any) => f.id === fwFieldId);
                const ocppField = testRunFields.find((f: any) => f.id === ocppFieldId);

                if (sutField && sutField.values && sutField.values.length > 0) sut = sutField.values[0];
                if (fwField && fwField.values && fwField.values.length > 0) firmwareVersion = fwField.values[0];
                if (ocppField && ocppField.values && ocppField.values.length > 0) ocppBackend = ocppField.values[0];
            } catch (err: any) {
                log("warn", `Failed to extract Xray Test Run custom fields: ${err.message}`, "jira");
            }
        }

        // Also try to extract test plan info from the issue's summary or links
        const summary = typeof fields.summary === "string" ? fields.summary : "";

        log("info", `Fetched execution metadata for ${testExecutionKey}: SUT=${sut || "—"}, FW=${firmwareVersion || "—"}`, "jira");

        res.json({
            ok: true,
            testExecutionKey,
            sut: sut || "",
            firmwareVersion: firmwareVersion || "",
            ocppBackend: ocppBackend || "",
            summary
        });
    } catch (e: any) {
        const status = e.response?.status;
        if (status === 404) {
            log("error", `Issue ${testExecutionKey} not found (404) — check the key or Jira permissions`, "jira");
            return res.status(404).json({ ok: false, error: `Issue "${testExecutionKey}" not found. Verify the key exists and your Jira credentials have access.` });
        }
        if (status === 401 || status === 403) {
            log("error", `Jira authentication failed (${status}) — check API Token and email`, "jira");
            return res.status(401).json({ ok: false, error: `Jira authentication failed (${status}). Check your API Token and email in Settings.` });
        }
        log("error", `Failed to load execution metadata for ${testExecutionKey}: ${e.message}`, "jira");
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
        } catch (e: any) { log("debug", `Could not load test case details: ${e.message}`, "jira"); }

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
        } catch (e: any) { log("debug", `Could not read log context for defect: ${e.message}`, "jira"); }

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
    const { testcase, testExecutionKey, testKey: reqTestKey, fwVersion, dut, ocppBackend, comment, configurationName, runId } = req.body;
    try {
        const client = new JiraClient(effectiveConfig.jira);
        const octt = new OcttClient(effectiveConfig.octt);

        let finalTestExecutionKey = testExecutionKey;
        let parsedTestKey = reqTestKey;

        if (testExecutionKey && (testExecutionKey.startsWith("http://") || testExecutionKey.startsWith("https://"))) {
            const parsed = parseXrayUrl(testExecutionKey);
            if (parsed) {
                finalTestExecutionKey = parsed.testExecutionKey;
                if (parsed.testKey) parsedTestKey = parsed.testKey;
            }
        }

        let testKey = parsedTestKey;
        
        if (!effectiveConfig.xray?.clientId || !effectiveConfig.xray?.clientSecret) {
            throw new Error("Xray Client ID and Secret are not configured in the Dashboard settings.");
        }
        const token = await client.authenticateXray(effectiveConfig.xray.clientId, effectiveConfig.xray.clientSecret);

        if (!testKey) {
            testKey = await findTestKeyForUpload(client, testcase, finalTestExecutionKey, token);
        }
        if (!testKey) throw new Error(`Could not find Jira Test Key for ${testcase}. Ensure the test exists in Jira with the TC name in the summary.`);

        const results = runId
            ? (getRunHistory().find(h => h.id === runId)?.results || [])
            : getLastResults();
        const testResult = results.find(r => r.testCase === testcase);
        const xrayStatus = testResult?.verdict === "pass" ? "PASSED" : "FAILED";

        if (finalTestExecutionKey) {
            await validateTestInExecution(client, finalTestExecutionKey, testKey, token);
        }

        const fieldIds = await getXrayFieldIds();
        const { testEntry, zipBuffer } = await prepareTestEntry({
            client, octt, testKey, testCase: testcase, xrayStatus, token, fieldIds,
            firmwareVersion: fwVersion, sut: dut, ocppBackend,
            configurationName: configurationName || "AUT_SID_SAT",
        });

        if (comment) testEntry.comment = comment;

        const payload: any = {
            testExecutionKey: finalTestExecutionKey,
            tests: [testEntry]
        };

        const response = await client.uploadXrayExecution(payload, token);

        if (zipBuffer && finalTestExecutionKey) {
            try {
                await client.addAttachment(finalTestExecutionKey, `${testcase}_logs.zip`, zipBuffer);
                log("info", `Attached ${testcase}_logs.zip to ${finalTestExecutionKey}`, "jira");
            } catch (attachErr: any) {
                log("warn", `Failed to attach ${testcase}_logs.zip to ${finalTestExecutionKey}: ${attachErr.message}`, "jira");
            }
        }

        log("info", `Uploaded execution to Xray ${finalTestExecutionKey} for ${testcase}`, "jira");
        res.json({ ok: true, issueKey: finalTestExecutionKey, message: `Successfully updated Xray Test Execution ${finalTestExecutionKey}` });
    } catch (e: any) {
        log("error", `Xray upload failed: ${e.message}`, "jira");
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get("/testplan/:key/tracking", async (req, res) => {
    const { key } = req.params;
    try {
        const client = new JiraClient(effectiveConfig.jira);
        const config = effectiveConfig;
        
        if (!config.xray?.clientId || !config.xray?.clientSecret) {
            return res.status(500).json({ error: "Xray Client ID and Secret are not configured." });
        }
        
        const token = await client.authenticateXray(config.xray.clientId, config.xray.clientSecret);
        
        const issue = await client.getIssue(key);
        if (!issue || !issue.id) {
            return res.status(404).json({ error: `Test Plan ${key} not found.` });
        }
        
        const { tests, executions } = await client.getXrayTestPlanTracking(issue.id, token);
        
        let passed = 0;
        let failed = 0;
        let executing = 0;
        let todo = 0;
        
        // Build a map of latest status for each test from Executions
        // Assuming executions are ordered newest to oldest, we find the first run for each test.
        // Wait, Xray GraphQL testExecutions doesn't strictly guarantee order, but usually latest first.
        // If not, we could iterate from oldest to newest to overwrite.
        // Actually, let's reverse the array to process oldest first so the latest overwrites.
        // Build a map of latest run data for each test from Executions
        const testStatusMap = new Map<string, { status: { name: string; color: string }, defects: string[], hasEvidence: boolean }>();
        const orderedExecutions = [...(executions || [])].reverse();
        
        for (const exec of orderedExecutions) {
            const runs = exec.testRuns?.results || [];
            for (const run of runs) {
                const testKey = run.test?.jira?.key;
                if (testKey && run.status) {
                    testStatusMap.set(testKey, {
                        status: run.status,
                        defects: Array.isArray(run.defects) ? run.defects : [],
                        hasEvidence: Array.isArray(run.evidence) && run.evidence.length > 0
                    });
                }
            }
        }
        
        let passedWithEvidence = 0;
        let passedWithoutEvidence = 0;
        let failedWithDefect = 0;
        let failedWithoutDefect = 0;

        const testList = tests.map(t => {
            const key = t.jira?.key;
            // Use the status from executions if available, otherwise strictly TODO
            const computedData = (key && testStatusMap.has(key)) 
                ? testStatusMap.get(key)! 
                : { status: { name: "TODO", color: "#5e6c84" }, defects: [], hasEvidence: false };
            
            const statusName = computedData.status.name || "TODO";
            const color = computedData.status.color || "#5e6c84";
            
            const n = statusName.toLowerCase();
            const hasDefect = computedData.defects.length > 0;

            if (n === "passed" || n === "pass") {
                passed++;
                if (computedData.hasEvidence) passedWithEvidence++;
                else passedWithoutEvidence++;
            }
            else if (n === "failed" || n === "fail") {
                failed++;
                if (hasDefect) failedWithDefect++;
                else failedWithoutDefect++;
            }
            else if (n === "executing") executing++;
            else todo++;
            
            return {
                key,
                summary: t.jira?.summary,
                status: statusName,
                color: color,
                defects: computedData.defects,
                hasDefect: hasDefect,
                hasEvidence: computedData.hasEvidence
            };
        });
        
        const total = passed + failed + executing + todo;
        const progress = total > 0 ? ((passed + failed) / total) * 100 : 0;
        const successRate = (passed + failed) > 0 ? (passed / (passed + failed)) * 100 : 0;


        const qualityGoal = total > 0 ? ((passedWithEvidence + failedWithDefect) / total) * 100 : 0;

        res.json({
            ok: true,
            testPlanKey: key,
            summary: issue.fields?.summary,
            stats: {
                total,
                passed,
                failed,
                todo,
                executing,
                progress: Math.round(progress),
                quality: {
                    passedWithEvidence,
                    passedWithoutEvidence,
                    failedWithDefect,
                    failedWithoutDefect,
                    goal: Math.round(qualityGoal)
                }
            },
            tests: testList,
            executions: executions.map(e => {
                const runs = e.testRuns?.results || [];
                let epCount = 0;
                let efCount = 0;
                let eeCount = 0;
                let etCount = 0;
                runs.forEach((r: any) => {
                    const s = (r.status?.name || "TODO").toLowerCase();
                    if (s === "passed") epCount++;
                    else if (s === "failed") efCount++;
                    else if (s === "executing") eeCount++;
                    else etCount++;
                });
                const eTotal = epCount + efCount + eeCount + etCount;
                const eProgress = eTotal > 0 ? ((epCount + efCount) / eTotal) * 100 : 0;
                return {
                    key: e.jira?.key,
                    summary: e.jira?.summary,
                    total: eTotal,
                    passed: epCount,
                    failed: efCount,
                    executing: eeCount,
                    todo: etCount,
                    progress: Math.round(eProgress)
                };
            })
        });
    } catch (err: any) {
        log("error", `Failed to fetch tracking for ${key}: ${err.message}`, "jira");
        res.status(500).json({ error: err.message });
    }
});

export default router;

