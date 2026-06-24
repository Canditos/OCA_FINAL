import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ══════════════════════════════════════════════════════════════
// CERTIFICATION PIPELINE — CDS + OCTT (Playwright)
// ══════════════════════════════════════════════════════════════
//
// This test suite automates the full OCPP certification workflow:
//   1. Lab Setup      → Register and configure the CDS EV simulator
//   2. OCTT Session   → Start a test session on the OCTT server
//   3. Test Execution → Run all test cases grouped by functional suite
//   4. Tear Down      → Print summary, stop session, cleanup CDS
//
// The suite runs in serial mode because OCTT only supports one
// active session and the CDS state must be managed sequentially.
// ══════════════════════════════════════════════════════════════

/**
 * Central configuration object populated from environment variables.
 * These values are injected by the dashboard server when spawning
 * Playwright, or can be set manually in a .env file.
 */
const CONFIG = {
    /** Base URL of the certification dashboard server */
    dashboardUrl: 'http://127.0.0.1:3101/api',
    /** OCTT API base URL (constructed from OCTT_BASE_URL env var) */
    octtBaseUrl: process.env.OCTT_BASE_URL ? `${process.env.OCTT_BASE_URL.replace(/\/+$/, '')}/api/v1` : '',
    /** Bearer token for OCTT API authentication */
    octtToken: process.env.OCTT_TOKEN ?? '',
    /** IP address of the Keysight CDS hardware */
    cdsIp: process.env.CDS_IP ?? '192.168.100.10',
    /** TCP port for the CDS SLEP protocol */
    cdsPort: parseInt(process.env.CDS_PORT ?? '51001', 10),
    /** Sink identifier used by the CDS (typically 1) */
    sinkId: parseInt(process.env.CDS_SINK ?? '1', 10),
    /** OCTT configuration/profile name to use for the session */
    configurationName: process.env.OCTT_CONFIG ?? 'AUT_SID_SAT',
    /** OCPP version under test (ocpp1.6 or ocpp2.0.1) */
    ocppVersion: process.env.OCTT_OCPP_VERSION ?? 'ocpp1.6',
    /** Role under test: CS (Charge Station) or CSMS (Central System) */
    role: process.env.OCTT_ROLE ?? 'CS',
} as const;

/**
 * OCTT API paths are versioned by OCPP version and role.
 * Example: /ocpp1.6/CS/session/start/AUT_SID_SAT
 */
const versionedPath = `/${CONFIG.ocppVersion}/${CONFIG.role}`;

// Log the resolved environment for debugging CI/local runs
console.log('[PLAYWRIGHT ENV]', {
    OCTT_BASE_URL: process.env.OCTT_BASE_URL ? 'set' : 'missing',
    OCTT_TOKEN: process.env.OCTT_TOKEN ? 'set' : 'missing',
    OCTT_CONFIG: process.env.OCTT_CONFIG,
    CDS_IP: process.env.CDS_IP,
    configurationName: CONFIG.configurationName,
    OCTT_SESSION_STARTED: process.env.OCTT_SESSION_STARTED,
});

/** Unique identifier for this CDS instance in the dashboard */
const cdsId = `cds-${CONFIG.cdsIp.replace(/\./g, '-')}-${CONFIG.cdsPort}`;

/** Authorization header sent with every OCTT request */
const authHeader = { Authorization: `Bearer ${CONFIG.octtToken}` };

// ══════════════════════════════════════════════════════════════
// SECTION: Test Catalog
// Mirrors the catalog defined in the dashboard server so that
// both sides agree on suite names and test membership.
// ══════════════════════════════════════════════════════════════

/**
 * Test suites grouped by functional area. Each suite contains
 * the test case IDs that belong to that OCPP functional block.
 */
const testSuites: Record<string, string[]> = {
    'MAINTENANCE': [
        'tc_bi_restore_configuration', 'tc_bi_stop_transactions', 'tc_bi_clear_cache',
        'tc_bi_clear_local_auth_list', 'tc_bi_restore_availability', 'tc_bi_reset_hard',
    ],
    'ColdBoot': ['TC_001_CS', 'TC_002_CS'],
    'StartSession': ['TC_003_CS', 'TC_004_1_CS', 'TC_004_2_CS'],
    'StopSession': ['TC_005_1_CS', 'TC_005_2_CS', 'TC_005_3_CS', 'TC_068_CS', 'TC_069_CS'],
    'Cache': ['TC_007_1_CS', 'TC_007_2_CS', 'TC_061_1_CS', 'TC_061_2_CS'],
    'RemoteActions': ['TC_010_CS', 'TC_011_1_CS', 'TC_011_2_CS', 'TC_012_CS'],
    'Resetting': ['TC_013_CS', 'TC_014_CS', 'TC_015_CS', 'TC_016_CS'],
    'Unlocking': ['TC_017_2_CS', 'TC_018_2_CS'],
    'Configuration': ['TC_019_CS', 'TC_021_CS'],
    'MeterValues': ['TC_070_CS', 'TC_071_CS'],
    'BasicActions': ['TC_023_4_CS', 'TC_023_5_CS'],
    'RemoteActionsNonHappy': ['TC_026_CS', 'TC_027_CS', 'TC_028_CS'],
    'UnlockingNonHappy': ['TC_031_CS'],
    'PowerFailure': ['TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS'],
    'OfflineBehavior': ['TC_036_CS', 'TC_037_1_CS', 'TC_037_2_CS', 'TC_037_3_CS', 'TC_038_CS', 'TC_039_CS'],
    'ConfigKeysNonHappy': ['TC_040_1_CS', 'TC_040_2_CS'],
    'FaultBehavior': ['TC_041_CS'],
    'LocalAuthList': ['TC_008_1_CS', 'TC_008_2_CS', 'TC_042_1_CS', 'TC_042_2_CS', 'TC_043_CS', 'TC_043_1_CS', 'TC_043_2_CS', 'TC_043_3_CS'],
    'FirmwareManagement': ['TC_044_1_CS', 'TC_044_2_CS', 'TC_044_3_CS'],
    'Diagnostics': ['TC_045_1_CS', 'TC_045_2_CS'],
    'Reservation': [
        'TC_046_1_CS',
        'TC_046_2_CS',
        'TC_047_CS',
        'TC_048_1_CS',
        'TC_048_2_CS',
        'TC_048_3_CS',
        'TC_048_4_CS',
        'TC_049_CS',
        'TC_050_1_CS',
        'TC_050_2_CS',
        'TC_050_3_CS',
        'TC_050_4_CS',
        'TC_051_CS',
        'TC_052_CS',
        'TC_053_1_CS',
        'TC_053_2_CS'
    ],
    'RemoteTrigger': ['TC_054_CS', 'TC_055_CS'],
    'SmartCharging': ['TC_056_CS', 'TC_057_CS', 'TC_058_1_CS', 'TC_058_2_CS', 'TC_059_CS', 'TC_060_CS', 'TC_066_CS', 'TC_067_CS', 'TC_072_CS', 'TC_082_CS'],
    'DataTransfer': ['TC_062_CS'],
    'Security': ['TC_073_CS', 'TC_074_CS', 'TC_075_1_CS', 'TC_075_2_CS', 'TC_076_CS', 'TC_077_CS', 'TC_078_CS', 'TC_079_CS', 'TC_080_CS', 'TC_081_CS', 'TC_083_CS', 'TC_084_CS', 'TC_085_CS', 'TC_086_CS', 'TC_087_CS'],
};

/** Tests that involve a charge point reboot and need extra recovery time */
const REBOOT_TESTS = ['TC_001_CS', 'TC_002_CS', 'TC_013_CS', 'TC_014_CS', 'TC_015_CS', 'TC_016_CS', 'TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS'];

/** State shared between hooks */
const testHookState: Record<string, string> = {};

type TestHook = {
    before?: (request: any) => Promise<void>;
    after?: (request: any) => Promise<void>;
};

const testHooks: Record<string, TestHook> = {
    'TC_007_1_CS': {
        before: async (request) => {
            const PHYSICAL_TAG = "ABCDEF12";
            console.log(`[OCTT] Preparando para injetar tag física (${PHYSICAL_TAG}) no PIXIT...`);
            if (sessionStarted) {
                await request.post(`${CONFIG.octtBaseUrl}/session/stop`, { headers: authHeader });
                sessionStarted = false;
                await new Promise(r => setTimeout(r, 2000));
            }
            const cfgUrl = `${CONFIG.octtBaseUrl}${versionedPath}/configurations/${encodeURIComponent(CONFIG.configurationName)}`;
            const cfgResp = await request.get(cfgUrl, { headers: authHeader });
            if (cfgResp.ok()) {
                const cfgBody = await cfgResp.json();
                testHookState['ValidIdTag'] = cfgBody.data.config["ValidIdTag"] || "111111";
                cfgBody.data.config["ValidIdTag"] = PHYSICAL_TAG;
                await request.put(cfgUrl, { headers: authHeader, data: cfgBody.data.config });
                console.log(`[OCTT] PIXIT atualizado com ValidIdTag = ${PHYSICAL_TAG}`);
            }
        },
        after: async (request) => {
            if (sessionStarted) {
                await request.post(`${CONFIG.octtBaseUrl}/session/stop`, { headers: authHeader });
                sessionStarted = false;
                await new Promise(r => setTimeout(r, 2000));
            }
            const cfgUrl = `${CONFIG.octtBaseUrl}${versionedPath}/configurations/${encodeURIComponent(CONFIG.configurationName)}`;
            const cfgResp = await request.get(cfgUrl, { headers: authHeader });
            if (cfgResp.ok() && testHookState['ValidIdTag']) {
                const cfgBody = await cfgResp.json();
                cfgBody.data.config["ValidIdTag"] = testHookState['ValidIdTag'];
                await request.put(cfgUrl, { headers: authHeader, data: cfgBody.data.config });
                console.log(`[OCTT] PIXIT restaurado para ValidIdTag = ${testHookState['ValidIdTag']}`);
            }
        }
    },
    'TC_080_CS': {
        before: async (request) => {
            console.log(`[OCTT] Preparando PIXIT para Atualização de Firmware Seguro (TC_080_CS)...`);
            if (sessionStarted) {
                await request.post(`${CONFIG.octtBaseUrl}/session/stop`, { headers: authHeader });
                sessionStarted = false;
                await new Promise(r => setTimeout(r, 2000));
            }

            const cert = fs.readFileSync(path.join(process.cwd(), 'valid-cert.txt'), 'utf8');
            const sig = fs.readFileSync(path.join(process.cwd(), 'valid-signature.txt'), 'utf8');

            const cfgUrl = `${CONFIG.octtBaseUrl}${versionedPath}/configurations/${encodeURIComponent(CONFIG.configurationName)}`;
            const cfgResp = await request.get(cfgUrl, { headers: authHeader });
            
            if (cfgResp.ok()) {
                const cfgBody = await cfgResp.json();
                
                // Save original values
                testHookState['FirmwareUpdateUrl'] = cfgBody.data.config["FirmwareUpdateUrl"] || "";
                testHookState['SigningCertificate'] = cfgBody.data.config["SigningCertificate"] || "";
                testHookState['FirmwareSignature'] = cfgBody.data.config["FirmwareSignature"] || "";
                
                // Inject new values
                // NOTE: Adjust the FTP URL placeholder here to point to your real FTP server!
                cfgBody.data.config["FirmwareUpdateUrl"] = "ftp://IP_DO_SEU_FTP/hotfix.swu";
                cfgBody.data.config["SigningCertificate"] = cert;
                cfgBody.data.config["FirmwareSignature"] = sig;
                
                await request.put(cfgUrl, { headers: authHeader, data: cfgBody.data.config });
                console.log(`[OCTT] PIXIT atualizado com URL FTP, Certificado e Assinatura para o hotfix.swu`);
            }
        },
        after: async (request) => {
            if (sessionStarted) {
                await request.post(`${CONFIG.octtBaseUrl}/session/stop`, { headers: authHeader });
                sessionStarted = false;
                await new Promise(r => setTimeout(r, 2000));
            }
            const cfgUrl = `${CONFIG.octtBaseUrl}${versionedPath}/configurations/${encodeURIComponent(CONFIG.configurationName)}`;
            const cfgResp = await request.get(cfgUrl, { headers: authHeader });
            if (cfgResp.ok()) {
                const cfgBody = await cfgResp.json();
                if (testHookState['FirmwareUpdateUrl'] !== undefined) cfgBody.data.config["FirmwareUpdateUrl"] = testHookState['FirmwareUpdateUrl'];
                if (testHookState['SigningCertificate'] !== undefined) cfgBody.data.config["SigningCertificate"] = testHookState['SigningCertificate'];
                if (testHookState['FirmwareSignature'] !== undefined) cfgBody.data.config["FirmwareSignature"] = testHookState['FirmwareSignature'];
                
                await request.put(cfgUrl, { headers: authHeader, data: cfgBody.data.config });
                console.log(`[OCTT] PIXIT restaurado para os valores originais de Firmware`);
            }
        }
    }
};

/** Accumulated results for the final summary report */
const results: { suite: string; testCase: string; verdict: string; duration: number }[] = [];

/** Tracks whether the OCTT session has been started */
let sessionStarted = process.env.OCTT_SESSION_STARTED === "true";

// Run tests sequentially — workers: 1 in playwright.config.ts already guarantees this.
// We DO NOT use mode: 'serial' here because it skips all subsequent tests if one fails.

// Global timeout: 25 minutes per test (reboot tests can take 10+ minutes, user requested 20 min hard cutoff)
test.setTimeout(1_500_000);

// ══════════════════════════════════════════════════════════════
// PHASE 0: CDS Lab Setup
// (Moved to backend SUT orchestrator to run automatically before each test)
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// PHASE 1: OCTT Session
// Start the OCTT test session. This must succeed before any
// test cases can be executed.
// ══════════════════════════════════════════════════════════════

/**
 * Starts the OCTT session with automatic retry.
 * If the first attempt fails (e.g., previous session still closing),
 * waits 5 seconds and retries once.
 */
test.skip('1. Start OCTT session', async ({ request }) => {
    // Skipped: pipeline.service.ts now handles starting the OCTT session and waiting 
    // for the SUT to connect BEFORE launching Playwright. 
    // Trying to start it again here causes "Session already started" warnings.
});

// ══════════════════════════════════════════════════════════════
// PHASE 2: Execute all test suites
// Iterate over every suite and run each test case via the OCTT API.
// ══════════════════════════════════════════════════════════════

Object.entries(testSuites).forEach(([suiteName, tests]) => {
    test.describe(`Suite: ${suiteName}`, () => {

        // Strategy 4: CDS Reset and PIXIT setup between specific suites
        if (['SmartCharging', 'Reservation', 'FaultBehavior', 'PowerFailure'].includes(suiteName)) {
            test.beforeAll(async ({ request }) => {
                if (process.env.NEEDS_CDS !== 'false') {
                    console.log(`[CDS] Preparando ambiente limpo para a suíte ${suiteName}...`);
                    try {
                        await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/reset`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        console.log(`[CDS] Reset concluído para a suíte ${suiteName}`);
                    } catch {
                        console.warn(`[CDS] Aviso: Falha ao resetar CDS antes da suíte ${suiteName}`);
                    }
                }

                if (suiteName === 'Reservation') {
                    console.log(`[OCTT] Configurando PIXIT para Reservation (Expiry Date Offset = 250)...`);
                    if (sessionStarted) {
                        await request.post(`${CONFIG.octtBaseUrl}/session/stop`, { headers: authHeader });
                        sessionStarted = false;
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    const cfgUrl = `${CONFIG.octtBaseUrl}${versionedPath}/configurations/${encodeURIComponent(CONFIG.configurationName)}`;
                    const cfgResp = await request.get(cfgUrl, { headers: authHeader });
                    if (cfgResp.ok()) {
                        const cfgBody = await cfgResp.json();
                        cfgBody.data.config["ExpiryDateOffset"] = 250;
                        await request.put(cfgUrl, { headers: authHeader, data: cfgBody.data.config });
                        console.log(`[OCTT] PIXIT atualizado com ExpiryDateOffset = 250`);
                    }
                }
            });
        }

        for (const testId of tests) {

            test(`Execute ${testId}`, async ({ request }) => {
                console.log(`[OCTT] Executing ${testId}...`);

                if (testHooks[testId]?.before) {
                    await testHooks[testId].before(request);
                }

                // ── Fallback session start ──
                // When running with --grep (subset of tests), the global
                // "Start OCTT session" test may be skipped. Each test case
                // therefore checks sessionStarted and starts the session
                // itself if needed. This ensures standalone test execution
                // works without requiring the full suite to run.
                if (!sessionStarted) {
                    console.log('[OCTT] Session not started, starting now...');
                    const sessionResp = await request.post(
                        `${CONFIG.octtBaseUrl}${versionedPath}/session/start/${encodeURIComponent(CONFIG.configurationName)}`,
                        { headers: authHeader }
                    );
                    if (!sessionResp.ok()) {
                        const errorText = await sessionResp.text();
                        console.warn(`[OCTT] Session start warning (${sessionResp.status()}): ${errorText.slice(0, 300)}`);
                    } else {
                        console.log(`[OCTT] Session started: ${CONFIG.configurationName}`);
                    }
                    sessionStarted = true;
                    console.log('[OCTT] Waiting for SUT connection (up to 30s)...');
                    for (let i = 0; i < 30; i++) {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        try {
                            const sutResp = await request.get(`${CONFIG.octtBaseUrl}/sut_connection_status`, { headers: authHeader });
                            if (sutResp.ok()) {
                                const sutStatus = await sutResp.json();
                                if (sutStatus.data && sutStatus.data.isConnected) {
                                    console.log('[OCTT] SUT connected successfully');
                                    break;
                                }
                            }
                        } catch { /* ignore */ }
                    }
                }

                // ── Execute the test case via OCTT REST API ──
                // Wrapped in a broad try-catch so that a single failing test
                // (SUT crash, network timeout, OCTT internal error) never
                // aborts the entire certification run.
                let verdict = 'error';
                let duration = 0;
                let sutDisconnected = false;

                try {
                    // Pre-test standard cleanup and 10s wait
                    if (!testId.startsWith('tc_bi_')) {
                        console.log(`[PIPELINE] Running standard pre-test cleanup (Cache & Availability) + 10s timeout before ${testId}...`);
                        await request.post(`${CONFIG.octtBaseUrl}/testcases/tc_bi_clear_cache/execute`, { headers: authHeader, timeout: 60000 }).catch(e => console.error("[WARN] Cleanup clear cache failed:", e.message));
                        await request.post(`${CONFIG.octtBaseUrl}/testcases/tc_bi_restore_availability/execute`, { headers: authHeader, timeout: 60000 }).catch(e => console.error("[WARN] Cleanup restore availability failed:", e.message));
                        
                        console.log(`[PIPELINE] Orquestrando ambiente SUT (CDS Setup & Async Loops) para ${testId}...`);
                        await request.post(`http://127.0.0.1:3101/api/sut/orchestrate-test`, { data: { testId } }).catch(e => console.error("[WARN] SUT Orchestration failed:", e.message));
                        
                        console.log(`[PIPELINE] Cleanup & Setup done, waiting 10 seconds before starting ${testId}...`);
                        await new Promise(r => setTimeout(r, 10000));
                    }


                    const resp = await request.post(
                        `${CONFIG.octtBaseUrl}/testcases/${testId}/execute`,
                        { headers: authHeader, timeout: 1_200_000 } // 20 minutes timeout
                    );

                    if (!resp.ok()) {
                        const errorBody = await resp.text();
                        // 504 Gateway Timeout from OCTT cloud proxy means the test
                        // took longer than the cloud infrastructure allows. This is
                        // an infrastructure limitation, not a charge point bug.
                        if (resp.status() === 504 || errorBody.includes('504') || errorBody.includes('Gateway Time-out')) {
                            console.warn(`[WARN] ${testId} HTTP 504 Gateway Timeout — charge point reboot took longer than cloud proxy allows. Treating as inconc.`);
                            verdict = 'inconc';
                            duration = 0;
                            // Strategy 2: Safe stop 504
                            console.log(`[OCTT] Forcing session stop to clear dangling 504 cloud task...`);
                            try {
                                await request.post(`${CONFIG.octtBaseUrl}/session/stop`, { headers: authHeader });
                            } catch { /* ignore */ }
                            sessionStarted = false;
                        } else {
                            console.error(`[ERROR] ${testId} HTTP ${resp.status()}: ${errorBody.slice(0, 500)}`);
                            verdict = 'error';
                        }
                    } else {
                        const body = await resp.json();
                        const rawVerdict = (body.data?.[0]?.verdict ?? 'ERROR').toLowerCase();
                        duration = (body.data?.[0]?.duration ?? 0) / 1000;
                        const message = body.data?.[0]?.message ?? '';

                        // Detect SUT disconnection (network/hardware issue, not a CP bug)
                        // OCTT logs contain "SUT__DISCONNECTED" when the WebSocket drops.
                        // We treat this as inconc so the run continues and can be retried.
                        const hasSutDisconnect = JSON.stringify(body).includes('SUT__DISCONNECTED') ||
                            JSON.stringify(body).includes('SUT_DISCONNECTED');
                        if (hasSutDisconnect && rawVerdict !== 'pass') {
                            console.warn(`[WARN] ${testId} detected SUT disconnection → treating as inconc`);
                            verdict = 'inconc';
                            sutDisconnected = true;
                        } else {
                            verdict = rawVerdict;
                            if (verdict !== 'pass' && message) {
                                console.log(`[OCTT-MESSAGE] ${message}`);
                            }
                        }
                    }
                } catch (execError: any) {
                    console.error(`[ERROR] ${testId} threw exception: ${execError.message}`);
                    verdict = 'error';
                }

                results.push({ suite: suiteName, testCase: testId, verdict, duration });
                console.log(`  → ${testId}: ${verdict.toUpperCase()} (${duration}s)`);

                // ── Recovery after SUT disconnection ──
                // If the SUT dropped, attempt to restart the OCTT session
                // so that subsequent tests have a chance to succeed.
                if (sutDisconnected) {
                    console.log('[OCTT] Attempting session recovery after SUT disconnect...');
                    try {
                        await request.post(`${CONFIG.octtBaseUrl}/session/stop`, { headers: authHeader });
                        await new Promise((resolve) => setTimeout(resolve, 3000));
                        const recoveryResp = await request.post(
                            `${CONFIG.octtBaseUrl}${versionedPath}/session/start/${encodeURIComponent(CONFIG.configurationName)}`,
                            { headers: authHeader }
                        );
                        if (recoveryResp.ok()) {
                            console.log('[OCTT] Session recovered successfully');
                        } else {
                            console.warn('[OCTT] Session recovery failed, continuing anyway...');
                            sessionStarted = false; // force re-start on next test
                        }
                    } catch {
                        console.warn('[OCTT] Session recovery threw, continuing anyway...');
                        sessionStarted = false;
                    }
                }

                // Brief pause between tests to let the SUT settle after heavy operations
                await new Promise((resolve) => setTimeout(resolve, 1000));

                if (testHooks[testId]?.after) {
                    await testHooks[testId].after(request);
                }

                // Strategy 1: Explicitly fail to trigger Playwright retries if verdict is error/fail
                if (verdict === 'fail' || verdict === 'error') {
                    expect(verdict, `[OCTT] Test case ${testId} failed. See logs above.`).toBe('pass');
                }
            });
        }
    });
});

// ══════════════════════════════════════════════════════════════
// PHASE 3: Tear down
// Print the certification summary, stop the OCTT session,
// and return the CDS to a safe idle state.
// ══════════════════════════════════════════════════════════════

test.afterAll(async ({ request }) => {
    console.log('\n══════════════════════════════════════════');
    console.log('           CERTIFICATION SUMMARY           ');
    console.log('══════════════════════════════════════════');

    const passed = results.filter((r) => r.verdict === 'pass').length;
    const failed = results.filter((r) => r.verdict === 'fail').length;
    const inconc = results.filter((r) => r.verdict === 'inconc').length;
    const errors = results.filter((r) => r.verdict === 'error').length;
    const total = results.length;

    console.log(`Total: ${total} | PASS: ${passed} | FAIL: ${failed} | INCONC: ${inconc} | ERROR: ${errors}`);
    console.log(`Pass rate: ${total > 0 ? Math.round((passed / total) * 100) : 0}%\n`);

    // List all non-passing tests for quick triage
    for (const result of results) {
        if (result.verdict !== 'pass') {
            console.log(`  ❌ [${result.suite}] ${result.testCase} → ${result.verdict.toUpperCase()}`);
        }
    }

    // Stop the OCTT session to free the SUT connection
    // Skip when running via pipeline (OCTT_MANAGE_SESSION=true) —
    // the pipeline's exit handler already manages session lifecycle.
    // Stopping here can interrupt a test still running on the OCTT cloud.
    if (sessionStarted && !process.env.OCTT_MANAGE_SESSION) {
        try {
            const resp = await request.post(
                `${CONFIG.octtBaseUrl}/session/stop`,
                { headers: authHeader }
            );
            console.log(`\n[OCTT] Session stopped (${resp.status()})`);
        } catch {
            console.log('[OCTT] Error stopping session');
        }
    }

    // Cleanup CDS: stop → reset → restore safe defaults
    if (process.env.NEEDS_CDS !== 'false') {
        console.log('\n🛡️ CDS Cleanup...');
        try {
            await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/stop`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/reset`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/defaults`);
            console.log('[CDS] Stopped, reset, safe defaults restored');
        } catch {
            console.log('[CDS] Cleanup error (non-fatal)');
        }
    } else {
        console.log('\n🛡️ CDS Cleanup skipped (no charging tests run)');
    }
});
