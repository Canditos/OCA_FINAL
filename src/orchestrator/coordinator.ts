// ══════════════════════════════════════════════════════════════
// Orchestrator — End-to-end test execution coordinator
// Wires OCTT, CDS, and Jira together for automated certification
// ══════════════════════════════════════════════════════════════

import { OcttClient } from "../connectors/octt/index.js";
import { CdsClient, Specification, ChargeMode, PidList, type CdsConfig, type EvConfig } from "../connectors/cds/index.js";
import { JiraClient } from "../connectors/jira/index.js";
import { dedup } from "../domain/dedup-engine.js";
import { mapToJiraIssue, mapToJiraComment } from "../domain/jira-mapper.js";
import { summarize, formatSummaryMarkdown } from "../domain/execution-summarizer.js";
import type { ReportEntry } from "../connectors/octt/types.js";

/**
 * Full configuration required to initialize the orchestrator.
 * Combines connection details for all three external systems.
 */
export interface OrchestratorConfig {
    /** OCTT API connection and versioning options */
    octt: {
        baseUrl: string;
        token: string;
        ocppVersion: string;
        role: "CS" | "CSMS";
    };
    /** Keysight CDS network address */
    cds: {
        ip: string;
        port: number;
    };
    /** Jira Cloud credentials and project */
    jira: {
        baseUrl: string;
        email: string;
        apiToken: string;
        projectKey: string;
    };
    /** CDS hardware configuration (specification, charge mode, sink) */
    cdsConfig: CdsConfig;
    /** Simulated EV electrical parameters */
    evConfig: EvConfig;
}

/**
 * Finite state machine states for the orchestrator lifecycle.
 * Used for progress reporting and UI status display.
 */
export type OrchestratorState =
    | "idle"
    | "connecting"
    | "configuring_lab"
    | "starting_session"
    | "running_tests"
    | "processing_results"
    | "syncing_jira"
    | "generating_summary"
    | "done"
    | "error";

/**
 * A single event in the orchestrator's internal log.
 */
export interface OrchestratorEvent {
    /** ISO timestamp of the event */
    timestamp: string;
    /** Orchestrator state at the time of the event */
    state: OrchestratorState;
    /** Human-readable message */
    message: string;
    /** Optional structured data attached to the event */
    data?: unknown;
}

/**
 * Coordinates the full certification pipeline:
 *   1. Lab preparation (CDS connect + configure)
 *   2. Test execution (OCTT session + run tests)
 *   3. Result processing (Jira sync + summary generation)
 *   4. Cleanup (stop CDS, close session)
 *
 * The orchestrator maintains an internal event log that can be
 * streamed to the dashboard UI for real-time progress visibility.
 */
export class Orchestrator {
    private octt: OcttClient;
    private cds: CdsClient;
    private jira: JiraClient;
    private state: OrchestratorState = "idle";
    private eventLog: OrchestratorEvent[] = [];

    /**
     * @param config - Complete orchestrator configuration
     */
    constructor(private config: OrchestratorConfig) {
        this.octt = new OcttClient(config.octt);
        this.cds = new CdsClient(config.cds.ip, config.cds.port);
        this.jira = new JiraClient(config.jira);
    }

    /**
     * Records an event to the internal log and echoes it to the console.
     */
    private emit(message: string, data?: unknown): void {
        const event: OrchestratorEvent = {
            timestamp: new Date().toISOString(),
            state: this.state,
            message,
            data,
        };
        this.eventLog.push(event);
        console.log(`[${event.state}] ${event.message}`);
    }

    /**
     * Returns a shallow copy of the orchestrator's event log.
     */
    getLog(): OrchestratorEvent[] {
        return [...this.eventLog];
    }

    /**
     * Returns the current orchestrator state.
     */
    getState(): OrchestratorState {
        return this.state;
    }

    // ── Phase 1: Connect & Prepare Lab ──

    /**
     * Prepares the test lab:
     *   1. Connects to the CDS
     *   2. Verifies OCTT SUT status
     *   3. Resets the CDS
     *   4. Configures CDS and EV parameters
     *
     * @returns true if all preparation steps succeeded
     */
    async prepareLab(): Promise<boolean> {
        try {
            this.state = "connecting";

            // Establish TCP connection to Keysight CDS
            this.emit("Connecting to CDS...");
            const cdsConnected = await this.cds.connect();
            if (!cdsConnected) {
                this.emit("Failed to connect to CDS", { ip: this.config.cds.ip });
                this.state = "error";
                return false;
            }
            this.emit("CDS connected");

            // Verify that the OCTT server sees the SUT as reachable
            this.emit("Checking SUT connection...");
            const sutStatus = await this.octt.getSutStatus();
            this.emit("SUT status retrieved", sutStatus);

            // Reset CDS to a known idle state before applying new config
            this.state = "configuring_lab";
            this.emit("Resetting CDS...");
            const resetOk = await this.cds.reset();
            if (!resetOk) {
                this.emit("CDS reset failed");
                this.state = "error";
                return false;
            }
            this.emit("CDS reset complete");

            // Apply charging specification and mode
            this.emit("Configuring CDS...");
            const configOk = await this.cds.configureCds(this.config.cdsConfig);
            if (!configOk) {
                this.emit("CDS configuration failed");
                this.state = "error";
                return false;
            }

            // Apply EV electrical parameters (voltage/current limits, etc.)
            this.emit("Configuring EV parameters...");
            const evOk = await this.cds.configureEv(this.config.evConfig);
            if (!evOk) {
                this.emit("EV configuration failed");
                this.state = "error";
                return false;
            }

            this.emit("Lab preparation complete ✅");
            return true;
        } catch (error) {
            this.state = "error";
            this.emit("Lab preparation error", { error: String(error) });
            return false;
        }
    }

    // ── Phase 2: Execute Tests ──

    /**
     * Executes test cases through OCTT:
     *   1. Starts an OCTT session
     *   2. Starts the CDS EV simulation
     *   3. Runs each test case sequentially
     *
     * @param configurationName - OCTT configuration profile to use
     * @param testcaseNames     - Optional subset of tests (runs all if omitted)
     * @returns Array of OCTT report entries
     */
    async executeTests(configurationName: string, testcaseNames?: string[]): Promise<ReportEntry[]> {
        try {
            this.state = "starting_session";
            this.emit(`Starting OCTT session with config: ${configurationName}`);
            await this.octt.startSession(configurationName);

            // Start CDS EV simulation (OCTT manages plugin/plugout via SUT EV API)
            this.emit("Starting CDS EV simulation...");
            const started = await this.cds.start();
            if (!started) {
                this.emit("CDS start failed");
                this.state = "error";
                return [];
            }

            // If no explicit test list provided, fetch all cases from OCTT
            if (!testcaseNames || testcaseNames.length === 0) {
                const testCases = await this.octt.listTestCases(configurationName);
                testcaseNames = testCases.data.testcasesData
                    .flatMap((group) => group.data.map((tc) => tc.testcase_name));
                this.emit(`Found ${testcaseNames.length} test cases`);
            }

            // Execute each test sequentially
            this.state = "running_tests";
            const allResults: ReportEntry[] = [];

            for (let index = 0; index < testcaseNames.length; index++) {
                const name = testcaseNames[index];
                this.emit(`[${index + 1}/${testcaseNames.length}] Executing: ${name}`);

                try {
                    const result = await this.octt.executeTestCase(name);
                    if (result.data && result.data.length > 0) {
                        allResults.push(...result.data);
                        const verdict = result.data[0].verdict;
                        this.emit(`  → ${verdict}`, { testcase: name, verdict });
                    }
                } catch (error) {
                    this.emit(`  → Error executing ${name}: ${error}`, { testcase: name, error: String(error) });
                }
            }

            this.emit(`Test execution complete: ${allResults.length} results`);
            return allResults;
        } catch (error) {
            this.state = "error";
            this.emit("Test execution error", { error: String(error) });
            return [];
        }
    }

    // ── Phase 3: Process Results & Sync Jira ──

    /**
     * Processes test results and syncs failures to Jira:
     *   - Creates new issues for unseen failures
     *   - Comments on existing open issues
     *   - Reopens closed issues when failures recur (regression detection)
     *
     * @param reports - OCTT report entries from test execution
     * @returns Summary of Jira actions taken
     */
    async processResults(reports: ReportEntry[]): Promise<{
        created: string[];
        commented: string[];
        reopened: string[];
        summary: string;
    }> {
        const result = { created: [] as string[], commented: [] as string[], reopened: [] as string[], summary: "" };

        try {
            // Only non-passing results need Jira attention
            const failures = reports.filter(
                (report) => report.verdict.toLowerCase() !== "pass"
            );
            this.emit(`Processing ${failures.length} failures out of ${reports.length} results`);

            this.state = "syncing_jira";

            for (const report of failures) {
                const dedupResult = await dedup(report, this.jira);

                switch (dedupResult.action) {
                    case "create": {
                        const issuePayload = mapToJiraIssue(report);
                        const issue = await this.jira.createIssue(issuePayload);
                        result.created.push(issue.key);
                        this.emit(`Created ${issue.key}: ${issuePayload.summary}`);
                        break;
                    }
                    case "comment": {
                        const issueKey = dedupResult.existingIssue!.key;
                        const comment = mapToJiraComment(report);
                        await this.jira.addComment(issueKey, comment);
                        result.commented.push(issueKey);
                        this.emit(`Commented on ${issueKey}`);
                        break;
                    }
                    case "reopen": {
                        const issueKey = dedupResult.existingIssue!.key;
                        const comment = mapToJiraComment(report);
                        await this.jira.transitionByName(issueKey, "Reopen", comment);
                        result.reopened.push(issueKey);
                        this.emit(`Reopened ${issueKey} (regression)`);
                        break;
                    }
                }
            }

            // Generate markdown summary for Slack/email/dashboard display
            this.state = "generating_summary";
            const summaryData = summarize(reports);
            result.summary = formatSummaryMarkdown(summaryData);
            this.emit("Summary generated", summaryData);

            this.state = "done";
            return result;
        } catch (error) {
            this.state = "error";
            this.emit("Result processing error", { error: String(error) });
            return result;
        }
    }

    // ── Full Pipeline ──

    /**
     * Runs the complete pipeline: lab preparation → test execution → result processing.
     * This is a convenience wrapper around the three main phases.
     *
     * @param configurationName - OCTT configuration profile
     * @param testcaseNames     - Optional subset of tests
     */
    async run(configurationName: string, testcaseNames?: string[]): Promise<void> {
        this.emit("=== Starting full certification pipeline ===");

        const labOk = await this.prepareLab();
        if (!labOk) {
            this.emit("Pipeline aborted: lab preparation failed");
            return;
        }

        const results = await this.executeTests(configurationName, testcaseNames);
        if (results.length === 0) {
            this.emit("Pipeline aborted: no test results");
            return;
        }

        const processResult = await this.processResults(results);
        this.emit("=== Pipeline complete ===", processResult);
    }

    // ── Cleanup ──

    /**
     * Performs graceful shutdown:
     *   - Stops the CDS EV simulation
     *   - Sets CP state to A1 (disconnected)
     *   - Closes the CDS TCP socket
     *   - Stops the OCTT session
     */
    async cleanup(): Promise<void> {
        try {
            await this.cds.stop();
            this.cds.writeSinglePid(PidList.CpStateEv, "int32", 1);
            await this.cds.disconnect();
            await this.octt.stopSession();
            this.emit("Cleanup complete");
        } catch (e: any) {
            this.emit("Cleanup error (non-fatal): " + e.message);
        }
    }
}
