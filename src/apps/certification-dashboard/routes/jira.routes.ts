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

const router = Router();

export function getLocalTestPlans(): string[] {
    const plans = new Set<string>();
    const planPath = path.resolve(process.cwd(), "scripts/output/test-plans/test-plan.json");

    try {
        const raw = fs.readFileSync(planPath, "utf-8");
        const plan = JSON.parse(raw);
        const configuration = typeof plan?.meta?.configuration === "string" ? plan.meta.configuration.trim() : "";
        const ocppVersion = typeof plan?.meta?.ocppVersion === "string" ? plan.meta.ocppVersion.trim() : "";
        const role = typeof plan?.meta?.role === "string" ? plan.meta.role.trim() : "";

        if (configuration) plans.add(configuration);
        if (ocppVersion && role && configuration) {
            plans.add(`OCPP ${ocppVersion} ${role} - ${configuration}`);
        }
    } catch {
        // Local test plan artifacts are optional; Jira metadata remains the primary source.
    }

    return Array.from(plans).sort();
}

export function buildXrayStepResults(steps: Array<{ id?: string }>, status: string): any[] | undefined {
    if (!steps || steps.length === 0) return undefined;
    return steps.map((_step, idx) => {
        const comment = `Step ${idx + 1} automatically marked as ${status} by the test runner.`;
        return {
            status,
            actualResult: comment,
            comment,
        };
    });
}

export function parseXrayUrl(urlStr: string | undefined): { testExecutionKey?: string; testKey?: string; testPlanId?: string } | null {
    if (!urlStr) return null;
    const trimmed = urlStr.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        return null;
    }
    try {
        const url = new URL(trimmed);
        const result: { testExecutionKey?: string; testKey?: string; testPlanId?: string } = {};

        // Parse search params
        const searchParams = url.searchParams;
        const testExecutionKey = searchParams.get("testExecutionKey") || searchParams.get("ac.testExecutionKey");
        const testKey = searchParams.get("testKey") || searchParams.get("ac.testKey");
        const testPlanId = searchParams.get("testPlanId") || searchParams.get("ac.testPlanId") || searchParams.get("testPlanKey") || searchParams.get("ac.testPlanKey");

        if (testExecutionKey) result.testExecutionKey = testExecutionKey;
        if (testKey) result.testKey = testKey;
        if (testPlanId) result.testPlanId = testPlanId;

        // Parse hash params
        let hash = url.hash;
        if (hash) {
            hash = hash.replace(/^#!?\/?[!?]?/, "");
            const hashParams = new URLSearchParams(hash);
            const hTestExecutionKey = hashParams.get("testExecutionKey") || hashParams.get("ac.testExecutionKey");
            const hTestKey = hashParams.get("testKey") || hashParams.get("ac.testKey");
            const hTestPlanId = hashParams.get("testPlanId") || hashParams.get("ac.testPlanId") || hashParams.get("testPlanKey") || hashParams.get("ac.testPlanKey");

            if (hTestExecutionKey) result.testExecutionKey = hTestExecutionKey;
            if (hTestKey) result.testKey = hTestKey;
            if (hTestPlanId) result.testPlanId = hTestPlanId;
        }

        return result;
    } catch {
        return null;
    }
}

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
        
        let suts: string[] = [];
        let firmwares: string[] = [];
        let testPlans: string[] = [];

        // 1. Fetch FW Version and DUT values from Xray Cloud custom fields
        try {
            if (effectiveConfig.xray?.clientId && effectiveConfig.xray?.clientSecret) {
                const xrayFields = await client.getXrayCustomFieldsSpec(
                    effectiveConfig.xray.clientId,
                    effectiveConfig.xray.clientSecret,
                    effectiveConfig.jira.projectKey
                );
                
                const fwField = xrayFields.find((f: any) => f.name === "FW Version");
                const dutField = xrayFields.find((f: any) => f.name === "DUT");

                if (fwField && fwField.values) {
                    firmwares = fwField.values.filter((v: string) => v !== "no run (SKIPPED or BLOCKED)");
                }
                if (dutField && dutField.values) {
                    suts = dutField.values.filter((v: string) => v !== "no run (SKIPPED or BLOCKED)");
                }
                log("info", `Xray custom fields: ${firmwares.length} FW versions, ${suts.length} SUTs`, "jira");
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
            const plans = await client.searchTestPlans();
            testPlans = plans.map(p => p.key + (p.summary ? ` — ${p.summary}` : ""));
            log("info", `Found ${testPlans.length} Test Plans in Jira`, "jira");
        } catch (err: any) {
            log("warn", `Could not search Test Plans: ${err.message}`, "jira");
        }

        res.json({
            ok: true,
            metadata: {
                suts,
                firmwares,
                testPlans
            }
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
                if (parsed.testPlanId) {
                    finalTestPlan = parsed.testPlanId;
                }
            }
        }

        if (!finalTestExecutionKey) {
            throw new Error("Test Execution Key is required.");
        }

        // 1. Get results and configuration name
        const history = getRunHistory();
        const entry = runId ? history.find(h => h.id === runId) : history[0];
        const results = entry ? entry.results || [] : getLastResults();
        const configurationName = entry?.configName || "AUT_SID_SAT";

        if (results.length === 0) {
            throw new Error("No test results found to upload.");
        }

        // 2. Authenticate with Xray Cloud
        if (!effectiveConfig.xray?.clientId || !effectiveConfig.xray?.clientSecret) {
            throw new Error("Xray Client ID and Secret are not configured in the Dashboard settings.");
        }
        const token = await client.authenticateXray(effectiveConfig.xray.clientId, effectiveConfig.xray.clientSecret);

        // 3.5 Fetch execution's test list for membership validation
        let executionTestKeys = new Set<string>();
        try {
            const execIssue = await client.getIssue(finalTestExecutionKey);
            if (execIssue && execIssue.id) {
                const execTests = await client.getXrayTestExecutionTests(execIssue.id, token);
                executionTestKeys = new Set(execTests.map(t => t.key));
                log("info", `Loaded ${executionTestKeys.size} tests from execution ${finalTestExecutionKey} for membership validation`, "jira");
            }
        } catch (err: any) {
            log("warn", `Could not verify execution test membership for ${finalTestExecutionKey}: ${err.message}`, "jira");
        }

        // 4. Process each test result and download evidence in parallel
        log("info", `Resolving Jira keys, steps, and downloading evidence for ${results.length} tests...`, "jira");
        const testsWithEvidence = await Promise.all(results.map(async (r) => {
            const testKey = await client.findTestKey(r.testCase);
            if (!testKey) {
                throw new Error(
                    `Test case "${r.testCase}" does not exist in Jira. ` +
                    `Create the Test issue in Jira first with the summary containing "${r.testCase}".`
                );
            }

            // Validate the test belongs to the target execution
            if (executionTestKeys.size > 0 && !executionTestKeys.has(testKey)) {
                throw new Error(
                    `Test ${testKey} (${r.testCase}) is not part of execution ${finalTestExecutionKey}. ` +
                    `Only tests already linked to this execution can be updated.`
                );
            }

            const xrayStatus = r.verdict === "pass" ? "PASSED" : "FAILED";

            // Fetch steps from Xray to map them to the same status
            let xraySteps: any[] | undefined = undefined;
            try {
                const issueDetails = await client.getIssue(testKey);
                if (issueDetails && issueDetails.id) {
                    const steps = await client.getXrayTestSteps(issueDetails.id, token);
                    if (steps && steps.length > 0) {
                        xraySteps = buildXrayStepResults(steps, xrayStatus);
                    }
                }
            } catch (stepErr: any) {
                log("warn", `Could not retrieve test steps for ${testKey}: ${stepErr.message}`, "jira");
            }

            let zipBuffer: Buffer | null = null;
            try {
                const reports = await octt.getReportsFiltered({
                    testcase_name: [r.testCase],
                    configuration_name: [configurationName]
                });
                if (reports.data && reports.data.length > 0) {
                    const latestReport = reports.data[0];
                    const logfileName = path.basename(latestReport.logfile);
                    const configName = latestReport.configuration;
                    zipBuffer = await octt.downloadReports({
                        format: "ZIP",
                        configuration_name: configName,
                        logfile_name: logfileName
                    });
                }
            } catch (err: any) {
                log("warn", `Could not download OCTT zip for ${r.testCase} evidence: ${err.message}`, "jira");
            }

            const customFields = [];

            const fwFieldId = "68f2fbd3a6fdbe3e4e952f0b";
            const dutFieldId = "68f2fbd3a6fdbe3e4e952f0e";
            const ocppFieldId = "68f2fbd3a6fdbe3e4e952f13";

            if (firmwareVersion) customFields.push({ id: fwFieldId, value: firmwareVersion });
            if (sut) customFields.push({ id: dutFieldId, value: sut });
            if (ocppBackend) customFields.push({ id: ocppFieldId, value: ocppBackend });

            const testEntry: any = {
                testKey,
                status: xrayStatus,
                steps: xraySteps,
                customFields: customFields.length > 0 ? customFields : undefined
            };

            if (zipBuffer) {
                testEntry.evidences = [{
                    data: zipBuffer.toString('base64'),
                    filename: `${r.testCase}_logs.zip`,
                    contentType: "application/zip"
                }];
            }

            return { testEntry, zipBuffer, testCase: r.testCase };
        }));

        // 5. Build Xray Payload
        const payload: any = {
            testExecutionKey: finalTestExecutionKey || undefined,
            tests: testsWithEvidence.map((t: any) => t.testEntry)
        };
        if (finalTestPlan) {
            payload.info = { testPlanKey: finalTestPlan };
        }

        log("info", `Uploading execution payload to Xray...`, "jira");
        const response = await client.uploadXrayExecution(payload, token);
        const finalKey = response.key || finalTestExecutionKey || "Unknown";

        // Upload attachments via Jira REST API directly to the execution issue
        for (const t of testsWithEvidence) {
            if (t.zipBuffer && finalKey && finalKey !== "Unknown") {
                try {
                    await client.addAttachment(finalKey, `${t.testCase}_logs.zip`, t.zipBuffer);
                    log("info", `Attached ${t.testCase}_logs.zip to ${finalKey}`, "jira");
                } catch (attachErr: any) {
                    log("warn", `Failed to attach ${t.testCase}_logs.zip to ${finalKey}: ${attachErr.message}`, "jira");
                }
            }
        }

        // 6. Annotate run history with the Test Execution key
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
                const content = fs.readFileSync(path.join(logDir, "utf-8"));
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
                if (parsed.testKey) {
                    parsedTestKey = parsed.testKey;
                }
            }
        }

        // 1. Find Test Key in Jira
        let testKey = parsedTestKey;
        if (!testKey) {
            testKey = await client.findTestKey(testcase);
        }
        if (!testKey) throw new Error(`Could not find Jira Test Key for ${testcase}. Ensure the test exists in Jira with the TC name in the summary.`);

        // 2. Get test result to determine status
        const results = runId
            ? (getRunHistory().find(h => h.id === runId)?.results || [])
            : getLastResults();
        const testResult = results.find(r => r.testCase === testcase);
        // Map dashboard verdict to Xray status (PASSED, FAILED)
        const xrayStatus = testResult?.verdict === "pass" ? "PASSED" : "FAILED";

        // 3. Authenticate with Xray Cloud
        if (!effectiveConfig.xray?.clientId || !effectiveConfig.xray?.clientSecret) {
            throw new Error("Xray Client ID and Secret are not configured in the Dashboard settings.");
        }
        const token = await client.authenticateXray(effectiveConfig.xray.clientId, effectiveConfig.xray.clientSecret);

        // 3.5 Validate the test belongs to the target execution (if provided)
        if (finalTestExecutionKey) {
            try {
                const execIssue = await client.getIssue(finalTestExecutionKey);
                if (execIssue && execIssue.id) {
                    const execTests = await client.getXrayTestExecutionTests(execIssue.id, token);
                    const execTestKeys = new Set(execTests.map(t => t.key));
                    if (execTestKeys.size > 0 && !execTestKeys.has(testKey)) {
                        throw new Error(
                            `Test ${testKey} is not part of execution ${finalTestExecutionKey}. ` +
                            `Only tests already linked to this execution can be updated.`
                        );
                    }
                }
            } catch (err: any) {
                if (err.message.includes("not part of execution")) throw err;
                log("warn", `Could not verify execution test membership for ${finalTestExecutionKey}: ${err.message}`, "jira");
            }
        }

        // Fetch steps from Xray to map them to the same status
        let xraySteps: any[] | undefined = undefined;
        try {
            const issueDetails = await client.getIssue(testKey);
            if (issueDetails && issueDetails.id) {
                const steps = await client.getXrayTestSteps(issueDetails.id, token);
                if (steps && steps.length > 0) {
                    xraySteps = buildXrayStepResults(steps, xrayStatus);
                }
            }
        } catch (stepErr: any) {
            log("warn", `Could not retrieve test steps for ${testKey}: ${stepErr.message}`, "jira");
        }

        // 5. Download Evidence (OCTT ZIP)
        let zipBuffer: Buffer | null = null;
        try {
            const reports = await octt.getReportsFiltered({
                testcase_name: [testcase],
                configuration_name: [configurationName || "AUT_SID_SAT"]
            });
            if (reports.data && reports.data.length > 0) {
                const latestReport = reports.data[0];
                const logfileName = path.basename(latestReport.logfile);
                const configName = latestReport.configuration;
                zipBuffer = await octt.downloadReports({
                    format: "ZIP",
                    configuration_name: configName,
                    logfile_name: logfileName
                });
            } else {
                log("warn", `No reports found for ${testcase} to upload as evidence`, "jira");
            }
        } catch (err: any) {
            log("warn", `Could not download OCTT zip for evidence: ${err.message}`, "jira");
        }

        // 4. Construct Custom Fields Array
        const customFields = [];

        const fwFieldId = "68f2fbd3a6fdbe3e4e952f0b";
        const dutFieldId = "68f2fbd3a6fdbe3e4e952f0e";
        const ocppFieldId = "68f2fbd3a6fdbe3e4e952f13";

        if (fwVersion) customFields.push({ id: fwFieldId, value: fwVersion });
        if (dut) customFields.push({ id: dutFieldId, value: dut });
        if (ocppBackend) customFields.push({ id: ocppFieldId, value: ocppBackend });

        // 5. Build Xray Payload
        const testObj: any = {
            testKey: reqTestKey,
            status: xrayStatus,
            steps: xraySteps,
            comment: comment || undefined,
            customFields: customFields.length > 0 ? customFields : undefined
        };

        if (zipBuffer) {
            testObj.evidences = [{
                data: zipBuffer.toString('base64'),
                filename: `${testcase}_logs.zip`,
                contentType: "application/zip"
            }];
        }

        const payload: any = {
            testExecutionKey: finalTestExecutionKey,
            tests: [testObj]
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

export default router;

