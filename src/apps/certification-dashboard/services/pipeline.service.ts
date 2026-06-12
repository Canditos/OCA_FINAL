import { execFile, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { OcttClient } from "../../../connectors/octt/index.js";
import { CdsClient } from "../../../connectors/cds/index.js";
import { log as broadcastLog } from "../routes/logs.routes.js";
import { broadcast } from "./sse.service.js";
import { wsBroadcast } from "./websocket.service.js";
import { effectiveConfig } from "../config/dashboard.config.js";

// Helper to broadcast to both SSE and WebSocket
function broadcastAll(type: string, data: unknown): void {
    broadcast(type, data);
    wsBroadcast(type, data);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HISTORY_FILE = path.resolve(__dirname, "../../../../logs/runs-history.json");
const PIPELINE_CONFIG_PATH = path.resolve(__dirname, "../config/pipeline.config.json");

let playwrightProcess: ChildProcess | null = null;
let isRunning = false;
let aborted = false;
let lastResults: any[] = [];
let verdictMap = new Map<string, { verdict: string; duration: number }>();
let pendingRunMetadata: RunMetadata = {};
let bootMetadataCapturedThisRun = false;

export interface RunMetadata {
    sut?: string;
    firmwareVersion?: string;
    testPlan?: string;
    environment?: string;
    jiraIssueKey?: string;
    source?: "jira-upload" | "log-inferred" | "sut-bootnotification";
    updatedAt?: string;
}

export interface RunHistoryEntry {
    id: string;
    timestamp: string;
    configName: string;
    total: number;
    pass: number;
    fail: number;
    inconc: number;
    error: number;
    passRate: number;
    results: any[];
    metadata?: RunMetadata;
}

export function isPlaywrightRunning(): boolean {
    return isRunning;
}

export function getLastResults(): any[] {
    return lastResults;
}

export function clearLastResults(): void {
    lastResults = [];
    verdictMap.clear();
}

// Load timeout configuration from config file - DYNAMICALLY on each run
interface PipelineConfig {
    rebootTests: string[];
    chargingTests?: string[];
    cdsResetBeforeCharging?: boolean;
    cdsResetTimeoutMs?: number;
    timeouts: {
        default: { maxTimeoutPeriod: number; longOperationTimeout: number; maxTimeDeviation: number };
        reboot: { maxTimeoutPeriod: number; longOperationTimeout: number; maxTimeDeviation: number };
    };
}

function loadPipelineConfig(): PipelineConfig {
    try {
        const raw = fs.readFileSync(PIPELINE_CONFIG_PATH, "utf-8");
        return JSON.parse(raw);
    } catch (e) {
        broadcastLog("warn", `Failed to load pipeline config, using defaults: ${e}`, "pipeline");
        return {
            rebootTests: [],
            chargingTests: [],
            cdsResetBeforeCharging: true,
            cdsResetTimeoutMs: 15000,
            timeouts: {
                default: { maxTimeoutPeriod: 70, longOperationTimeout: 450, maxTimeDeviation: 4 },
                reboot: { maxTimeoutPeriod: 600, longOperationTimeout: 650, maxTimeDeviation: 4 },
            },
        };
    }
}

function getRebootTests(): string[] {
    return loadPipelineConfig().rebootTests;
}

function getChargingTests(): string[] {
    return loadPipelineConfig().chargingTests || [];
}

function getCdsResetEnabled(): boolean {
    return loadPipelineConfig().cdsResetBeforeCharging ?? true;
}

function getTimeouts(profile: "default" | "reboot"): OcttTimeouts {
    const config = loadPipelineConfig();
    const t = config.timeouts[profile];
    return {
        max_timeout_period: String(t.maxTimeoutPeriod),
        long_operation_timeout: String(t.longOperationTimeout),
        max_time_deviation: String(t.maxTimeDeviation),
    };
}

/**
 * Checks if any tests in the batch require CDS (charging tests).
 */
function batchNeedsCds(tests: string[]): boolean {
    const chargingTests = getChargingTests();
    return tests.some(t => chargingTests.includes(t));
}

/**
 * Ensures the CDS is in a ready (stopped) state before running charging tests.
 * Performs: connect → stop → reset → verify stopped state.
 * @returns true if CDS is ready, false if reset failed
 */
async function ensureCdsReady(): Promise<boolean> {
    if (!getCdsResetEnabled()) {
        broadcastLog("info", "CDS reset skipped (disabled in config)", "cds");
        return true;
    }

    const ip = effectiveConfig.cds.ip;
    const port = effectiveConfig.cds.port;
    
    if (!ip) {
        broadcastLog("warn", "CDS not configured, skipping reset", "cds");
        return true;
    }

    broadcastLog("info", `Ensuring CDS ready at ${ip}:${port}...`, "cds");
    
    const cds = new CdsClient(ip, port);
    const startTime = Date.now();

    try {
        // Connect to CDS
        const connected = await cds.connect();
        if (!connected) {
            broadcastLog("warn", "CDS connect failed, will proceed anyway", "cds");
            return true; // Don't block pipeline if CDS unreachable
        }

        // Read current status
        const status = cds.statusValue.getValue();
        const flags = cds.getStatusDescription(status);
        broadcastLog("info", `CDS current status: ${flags.join(", ") || "Idle"}`, "cds");

        // If already stopped/idle, we're ready
        if (flags.includes("Stopped") || flags.length === 0) {
            broadcastLog("info", "CDS already in ready state", "cds");
            await cds.disconnect();
            return true;
        }

        // Otherwise, perform reset
        broadcastLog("info", "CDS not ready, performing reset...", "cds");
        
        const resetOk = await cds.reset();
        const elapsed = Date.now() - startTime;
        
        if (resetOk) {
            broadcastLog("info", `CDS reset complete (${elapsed}ms), ready for charging tests`, "cds");
        } else {
            broadcastLog("warn", `CDS reset returned false after ${elapsed}ms, proceeding anyway`, "cds");
        }

        await cds.disconnect();
        return resetOk;
    } catch (e: any) {
        const elapsed = Date.now() - startTime;
        broadcastLog("warn", `CDS reset error (${elapsed}ms): ${e.message}, proceeding anyway`, "cds");
        try { await cds.disconnect(); } catch { /* ignore */ }
        return true; // Don't block pipeline on CDS errors
    }
}

type OcttTimeouts = {
    max_timeout_period: string;
    long_operation_timeout: string;
    max_time_deviation: string;
};

type TimeoutProfile = "reboot" | "default";

type TimeoutBatch = {
    profile: TimeoutProfile;
    tests: string[];
};

function isRebootTest(testName: string): boolean {
    return getRebootTests().includes(testName);
}

async function retryOctt<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (e: any) {
            lastError = e;
            if (attempt < maxAttempts) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                broadcastLog("warn", `OCTT ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`, "playwright");
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

function buildTimeoutBatches(testcaseNames: string[]): TimeoutBatch[] {
    const batches: TimeoutBatch[] = [];
    for (const testName of testcaseNames) {
        const profile: TimeoutProfile = isRebootTest(testName) ? "reboot" : "default";
        const last = batches[batches.length - 1];
        if (!last || last.profile !== profile) {
            batches.push({ profile, tests: [testName] });
        } else {
            last.tests.push(testName);
        }
    }
    return batches;
}

function parseBootMetadataFromLogLine(line: string): RunMetadata | null {
    if (!/BootNotification/i.test(line)) return null;

    let payload: any = null;

    const frameStart = line.indexOf("[2,");
    if (frameStart >= 0) {
        const frameRaw = line.slice(frameStart).trim();
        try {
            const parsed = JSON.parse(frameRaw);
            if (Array.isArray(parsed) && parsed[2] === "BootNotification" && parsed[3] && typeof parsed[3] === "object") {
                payload = parsed[3];
            }
        } catch { /* ignore parse errors */ }
    }

    if (!payload) {
        const payloadMatch = line.match(/"BootNotification"\s*,\s*(\{.*\})\s*\]?\s*$/);
        if (payloadMatch) {
            try {
                payload = JSON.parse(payloadMatch[1]);
            } catch { /* ignore parse errors */ }
        }
    }

    if (!payload || typeof payload !== "object") return null;

    const model = typeof payload.chargePointModel === "string" ? payload.chargePointModel.trim() : "";
    const serial = typeof payload.chargePointSerialNumber === "string" ? payload.chargePointSerialNumber.trim() : "";
    const fw = typeof payload.firmwareVersion === "string" ? payload.firmwareVersion.trim() : "";

    if (!model && !serial && !fw) return null;

    return {
        sut: model || serial || undefined,
        firmwareVersion: fw || undefined,
        source: "sut-bootnotification",
    };
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function runPlaywright(testcaseNames: string[], configName: string): Promise<{ ok: boolean; error?: string }> {
    if (isRunning) return { ok: false, error: "Playwright already running" };
    isRunning = true;
    aborted = false;
    lastResults = [];
    verdictMap.clear();
    pendingRunMetadata = {};
    bootMetadataCapturedThisRun = false;

    const timeoutBatches = buildTimeoutBatches(testcaseNames);
    let originalTimeouts: OcttTimeouts | null = null;

    // Run asynchronously
    (async () => {
        try {
            originalTimeouts = await captureCurrentTimeouts(configName);

            for (let i = 0; i < timeoutBatches.length; i++) {
                if (aborted) break;
                const batch = timeoutBatches[i];
                const label = batch.profile === "reboot" ? "Reboot" : "Default";
                broadcastAll("pipeline", {
                    state: "starting",
                    message: `Batch ${i + 1}/${timeoutBatches.length}: ${label} timeouts (${batch.tests.length} tests)`,
                });
                await executePhase(batch.tests, configName, batch.profile);
            }
        } catch (e: any) {
            broadcastLog("error", "Pipeline run error: " + e.message, "pipeline");
        } finally {
            await finishPipelineRun(configName, originalTimeouts);
            isRunning = false;
        }
    })();

    return { ok: true };
}

async function executePhase(tests: string[], configName: string, profile: TimeoutProfile): Promise<void> {
    const targetTimeouts = getTimeouts(profile);
    const profileLabel = profile === "reboot" ? "Reboot" : "Default";
    const octt = new OcttClient(effectiveConfig.octt);

    // OCTT does not allow configuration save while a session is active.
    // Always stop any existing session before switching timeout profiles.
    try {
        await retryOctt(() => octt.stopSession(), "stop session", 2);
        await new Promise(r => setTimeout(r, 1500));
    } catch { /* ignore */ }

    // If this batch contains charging tests, ensure CDS is ready (stopped state)
    if (batchNeedsCds(tests)) {
        broadcastLog("info", `Batch contains charging tests, verifying CDS ready state...`, "playwright");
        await ensureCdsReady();
    }

    broadcastLog("info", `Applying ${profileLabel} timeouts (${targetTimeouts.max_timeout_period}/${targetTimeouts.long_operation_timeout})...`, "playwright");
    const applied = await applyTimeoutsWithValidation(configName, targetTimeouts);
    if (!applied) {
        throw new Error(`Could not enforce ${profileLabel} timeout profile before running tests`);
    }

    try {
        const result = await retryOctt(() => octt.startSession(configName), "start session");
        broadcastLog("info", `OCTT session started: ${JSON.stringify(result)}`, "playwright");

        for (let i = 0; i < 30; i++) {
            if (aborted) return;
            await new Promise(r => setTimeout(r, 1000));
            try {
                const status = await retryOctt(() => octt.getSutStatus(), "get SUT status", 2);
                if (status.isConnected) {
                    broadcastLog("info", "SUT connected", "playwright");
                    break;
                }
                broadcastLog("info", `Waiting for SUT connection... (${i + 1}s)`, "playwright");
            } catch { /* ignore */ }
        }
    } catch (e: any) {
        broadcastLog("error", `OCTT session failed after retries: ${e.message}`, "playwright");
    }

    return new Promise((resolve) => {
        const projectRoot = path.resolve(__dirname, "../../../..");
        const playwrightCli = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
        const args = ["test", "--reporter=list", "--workers=1"];
        const seenInPhase = new Set<string>();
        if (tests.length > 0) {
            const grep = tests.map(t => `Execute\\s+${escapeRegex(t)}(?:\\b|$)`).join("|");
            args.push(`--grep=${grep}`);
            broadcastLog("info", `Requested tests (${tests.length}): ${tests.join(", ")}`, "playwright");
        }

        let currentTestId: string | null = null;

        playwrightProcess = execFile(process.execPath, [playwrightCli, ...args], {
            cwd: projectRoot,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                OCTT_BASE_URL: effectiveConfig.octt.baseUrl,
                OCTT_TOKEN: effectiveConfig.octt.token,
                OCTT_CONFIG: configName,
                OCTT_SESSION_STARTED: "true",
                OCTT_MANAGE_SESSION: "true",
                CDS_IP: effectiveConfig.cds.ip,
                CDS_PORT: String(effectiveConfig.cds.port),
            },
        } as any);

        playwrightProcess.stdout?.on("data", (data: Buffer) => {
            const rawLines = data.toString().split("\n").filter(l => l.trim());
            for (const rawLine of rawLines) {
                const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r$/, '');
                broadcastLog("info", line.trim(), "playwright");

                if (!bootMetadataCapturedThisRun) {
                    const metadata = parseBootMetadataFromLogLine(line);
                    if (metadata && (metadata.sut || metadata.firmwareVersion)) {
                        annotateLatestRun(metadata);
                        bootMetadataCapturedThisRun = true;
                        broadcastLog("info", `BootNotification metadata (OCTT msg-in): SUT=${metadata.sut || "unknown"} FW=${metadata.firmwareVersion || "unknown"}`, "playwright");
                    }
                }

                const execMatch = line.match(/\[OCTT\] Executing\s+(\S+)/);
                if (execMatch) {
                    currentTestId = execMatch[1].replace(/\.+$/, "");
                    seenInPhase.add(currentTestId);
                    continue;
                }

                const verdictMatch = line.match(/\s*→\s+(\S+):\s+(PASS|FAIL|ERROR|INCONC)\s+\(([\d.]+)s\)/i);
                if (verdictMatch) {
                    const tcId = verdictMatch[1];
                    const verdict = verdictMatch[2].toLowerCase();
                    const duration = parseFloat(verdictMatch[3]);
                    if (!verdictMap.has(tcId)) verdictMap.set(tcId, { verdict, duration });
                    continue;
                }

                const verdictFallback = line.match(/\s*→\s+(PASS|FAIL|ERROR|INCONC)\s+\(([\d.]+)s\)/i);
                if (verdictFallback && currentTestId) {
                    const verdict = verdictFallback[1].toLowerCase();
                    const duration = parseFloat(verdictFallback[2]);
                    if (!verdictMap.has(currentTestId)) verdictMap.set(currentTestId, { verdict, duration });
                    continue;
                }

                const passMatch = line.match(/(?:ok|✓|✔)\s+\d+.*›.*Execute\s+([^\s(]+)(?:\s+\(([\d.]+)s\))?/);
                const failMatch = line.match(/(?:x|✘|✗|not ok)\s+\d+.*›.*Execute\s+([^\s(]+)(?:\s+\(([\d.]+)s\))?/);

                if (passMatch || failMatch) {
                    const matchObj = passMatch || failMatch;
                    const tcId = matchObj![1];
                    const inlineDurationStr = matchObj![2];
                    
                    const haveVerdict = verdictMap.get(tcId);
                    const verdict = haveVerdict ? haveVerdict.verdict : (failMatch ? "fail" : "pass");
                    let duration = haveVerdict?.duration;
                    if (!duration) duration = inlineDurationStr ? parseFloat(inlineDurationStr) : 0;

                    const existingIdx = lastResults.findIndex(r => r.testCase === tcId);
                    if (existingIdx !== -1) {
                        lastResults[existingIdx] = { testCase: tcId, verdict, duration };
                    } else {
                        lastResults.push({ testCase: tcId, verdict, duration });
                    }

                    broadcastAll("pipeline", { state: "testing", message: `${verdict.toUpperCase()}: ${tcId}`, results: [...lastResults] });
                }
            }
        });

        playwrightProcess.stderr?.on("data", (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) broadcastLog("warn", msg, "playwright");
        });

        playwrightProcess.on("exit", () => {
            if (tests.length > 0) {
                const missing = tests.filter(t => !seenInPhase.has(t));
                if (missing.length === tests.length) {
                    broadcastLog("error", `No requested tests executed in this batch. Requested: ${tests.join(", ")}`, "playwright");
                } else if (missing.length > 0) {
                    broadcastLog("warn", `Some requested tests were not executed: ${missing.join(", ")}`, "playwright");
                }
            }
            playwrightProcess = null;
            resolve();
        });

        playwrightProcess.on("error", (err) => {
            broadcastLog("error", `Playwright error: ${err.message}`, "playwright");
            playwrightProcess = null;
            resolve();
        });
    });
}

async function applyTimeouts(configName: string, timeouts: any) {
    try {
        const octt = new OcttClient(effectiveConfig.octt);
        const current = await octt.getConfiguration(configName);
        const updated = { ...current.data.config, ...timeouts };
        await octt.saveConfiguration(configName, updated);
    } catch (e: any) {
        broadcastLog("warn", `Failed to apply timeouts: ${e.message}`, "playwright");
    }
}

async function applyTimeoutsWithValidation(configName: string, timeouts: OcttTimeouts, maxAttempts = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await applyTimeouts(configName, timeouts);

        const current = await captureCurrentTimeouts(configName);
        const matches = !!current
            && current.max_timeout_period === String(timeouts.max_timeout_period)
            && current.long_operation_timeout === String(timeouts.long_operation_timeout)
            && current.max_time_deviation === String(timeouts.max_time_deviation);

        if (matches) return true;

        broadcastLog("warn", `Timeout validation failed (attempt ${attempt}/${maxAttempts})`, "playwright");
    }
    return false;
}

async function captureCurrentTimeouts(configName: string): Promise<OcttTimeouts | null> {
    try {
        const octt = new OcttClient(effectiveConfig.octt);
        const current = await octt.getConfiguration(configName);
        const cfg = current?.data?.config || {};
        const defaults = getTimeouts("default");

        return {
            max_timeout_period: String(cfg.max_timeout_period ?? defaults.max_timeout_period),
            long_operation_timeout: String(cfg.long_operation_timeout ?? defaults.long_operation_timeout),
            max_time_deviation: String(cfg.max_time_deviation ?? defaults.max_time_deviation),
        };
    } catch (e: any) {
        broadcastLog("warn", `Failed to capture original timeouts: ${e.message}`, "playwright");
        return null;
    }
}

async function finishPipelineRun(configName: string, originalTimeouts: OcttTimeouts | null) {
    const passCount = lastResults.filter(r => r.verdict === "pass").length;
    const failCount = lastResults.filter(r => r.verdict === "fail").length;
    const total = lastResults.length;

    try {
        const octt = new OcttClient(effectiveConfig.octt);
        await retryOctt(() => octt.stopSession(), "stop session (finish)", 2);
    } catch { /* ignore */ }

    // Always restore the original timeout profile so non-reboot runs are never contaminated.
    const timeoutsToRestore = originalTimeouts ?? getTimeouts("default");
    await applyTimeouts(configName, timeoutsToRestore);
    broadcastLog("info", "Pipeline finished. OCTT timeouts restored.", "playwright");

    if (lastResults.length > 0) saveRunToHistory(configName, lastResults);

    broadcastAll("pipeline", {
        state: aborted ? "cancelled" : (total > 0 ? "done" : "error"),
        message: aborted
            ? `Cancelled: ${passCount} pass, ${failCount} fail (${total} completed)`
            : `Complete: ${passCount} pass, ${failCount} fail (${total} total)`,
        results: lastResults,
    });
}

export function stopPlaywright(): void {
    if (playwrightProcess) {
        aborted = true;
        playwrightProcess.kill("SIGTERM");
        playwrightProcess = null;
        broadcastAll("pipeline", { state: "cancelled", message: "Aborting by user..." });
    }
}

// ── Run History Persistence ──

const MAX_HISTORY = 50;

export function getRunHistory(): RunHistoryEntry[] {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
            return JSON.parse(raw) as RunHistoryEntry[];
        }
    } catch { /* ignore corrupt file */ }
    return [];
}

export function clearRunHistory(): void {
    try {
        fs.writeFileSync(HISTORY_FILE, "[]", "utf-8");
    } catch { /* ignore */ }
}

function saveRunToHistory(configName: string, results: any[]): void {
    try {
        const dir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const history = getRunHistory();
        const pass = results.filter(r => r.verdict === "pass").length;
        const fail = results.filter(r => r.verdict === "fail").length;
        const inconc = results.filter(r => r.verdict === "inconc").length;
        const error = results.filter(r => r.verdict === "error").length;
        const total = results.length;

        const entry: RunHistoryEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            timestamp: new Date().toISOString(),
            configName,
            total,
            pass,
            fail,
            inconc,
            error,
            passRate: total > 0 ? Math.round((pass / total) * 100) : 0,
            results,
            metadata: Object.keys(pendingRunMetadata).length
                ? { ...pendingRunMetadata, updatedAt: new Date().toISOString() }
                : undefined,
        };

        history.unshift(entry);
        if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;

        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
        pendingRunMetadata = {};
    } catch (e: any) {
        broadcastLog("error", `Failed to save run history: ${e.message}`, "dashboard");
    }
}

export function annotateLatestRun(metadata: RunMetadata): boolean {
    try {
        if (isRunning) {
            pendingRunMetadata = {
                ...pendingRunMetadata,
                ...metadata,
                updatedAt: new Date().toISOString(),
            };
            return true;
        }

        const history = getRunHistory();
        if (!history.length) {
            pendingRunMetadata = {
                ...pendingRunMetadata,
                ...metadata,
                updatedAt: new Date().toISOString(),
            };
            return true;
        }

        const latest = history[0];
        latest.metadata = {
            ...(latest.metadata || {}),
            ...metadata,
            updatedAt: new Date().toISOString(),
        };

        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
        return true;
    } catch (e: any) {
        broadcastLog("warn", `Failed to annotate latest run metadata: ${e.message}`, "dashboard");
        return false;
    }
}

export function getHistoryTriageSummary(history?: RunHistoryEntry[]) {
    const entries = history || getRunHistory();

    const byEquipment: Record<string, { runs: number; total: number; pass: number; fail: number; inconc: number; error: number; passRate: number }> = {};
    const byFirmware: Record<string, { runs: number; total: number; pass: number; fail: number; inconc: number; error: number; passRate: number }> = {};

    for (const run of entries) {
        const sut = (run.metadata?.sut || "Unknown").trim() || "Unknown";
        const fw = (run.metadata?.firmwareVersion || "Unknown").trim() || "Unknown";

        if (!byEquipment[sut]) byEquipment[sut] = { runs: 0, total: 0, pass: 0, fail: 0, inconc: 0, error: 0, passRate: 0 };
        if (!byFirmware[fw]) byFirmware[fw] = { runs: 0, total: 0, pass: 0, fail: 0, inconc: 0, error: 0, passRate: 0 };

        for (const bucket of [byEquipment[sut], byFirmware[fw]]) {
            bucket.runs += 1;
            bucket.total += run.total || 0;
            bucket.pass += run.pass || 0;
            bucket.fail += run.fail || 0;
            bucket.inconc += run.inconc || 0;
            bucket.error += run.error || 0;
            bucket.passRate = bucket.total > 0 ? Math.round((bucket.pass / bucket.total) * 100) : 0;
        }
    }

    return {
        totalRuns: entries.length,
        byEquipment,
        byFirmware,
    };
}
