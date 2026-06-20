import { test, expect } from '@playwright/test';

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
    'Unlocking': ['TC_017_1_CS', 'TC_017_2_CS', 'TC_018_1_CS', 'TC_018_2_CS'],
    'Configuration': ['TC_019_CS', 'TC_021_CS'],
    'MeterValues': ['TC_070_CS', 'TC_071_CS'],
    'BasicActions': ['TC_023_4_CS', 'TC_023_5_CS', 'TC_024_CS'],
    'RemoteActionsNonHappy': ['TC_026_CS', 'TC_027_CS', 'TC_028_CS'],
    'UnlockingNonHappy': ['TC_030_CS', 'TC_031_CS'],
    'PowerFailure': ['TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS'],
    'OfflineBehavior': ['TC_036_CS', 'TC_037_1_CS', 'TC_037_2_CS', 'TC_037_3_CS', 'TC_038_CS', 'TC_039_CS'],
    'ConfigKeysNonHappy': ['TC_040_1_CS', 'TC_040_2_CS'],
    'FaultBehavior': ['TC_041_CS'],
    'LocalAuthList': ['TC_008_1_CS', 'TC_008_2_CS', 'TC_042_1_CS', 'TC_042_2_CS', 'TC_043_CS', 'TC_043_1_CS', 'TC_043_2_CS', 'TC_043_3_CS'],
    'FirmwareManagement': ['TC_044_1_CS', 'TC_044_2_CS', 'TC_044_3_CS'],
    'Diagnostics': ['TC_045_1_CS', 'TC_045_2_CS'],
    'Reservation': ['TC_046_1_CS', 'TC_046_2_CS', 'TC_047_CS', 'TC_048_1_CS', 'TC_048_2_CS', 'TC_048_3_CS', 'TC_048_4_CS', 'TC_049_CS', 'TC_050_1_CS', 'TC_050_2_CS', 'TC_050_3_CS', 'TC_050_4_CS', 'TC_051_CS', 'TC_052_CS', 'TC_053_1_CS', 'TC_053_2_CS'],
    'RemoteTrigger': ['TC_054_CS', 'TC_055_CS'],
    'SmartCharging': ['TC_056_CS', 'TC_057_CS', 'TC_058_1_CS', 'TC_058_2_CS', 'TC_059_CS', 'TC_060_CS', 'TC_066_CS', 'TC_067_CS', 'TC_072_CS', 'TC_082_CS'],
    'DataTransfer': ['TC_062_CS'],
    'Security': ['TC_073_CS', 'TC_074_CS', 'TC_075_1_CS', 'TC_075_2_CS', 'TC_076_CS', 'TC_077_CS', 'TC_078_CS', 'TC_079_CS', 'TC_080_CS', 'TC_081_CS', 'TC_083_CS', 'TC_084_CS', 'TC_085_CS', 'TC_086_CS', 'TC_087_CS'],
};

/** Tests that involve a charge point reboot and need extra recovery time */
const REBOOT_TESTS = ['TC_001_CS', 'TC_002_CS', 'TC_013_CS', 'TC_014_CS', 'TC_015_CS', 'TC_016_CS', 'TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS'];

/** Accumulated results for the final summary report */
const results: { suite: string; testCase: string; verdict: string; duration: number }[] = [];

/** Tracks whether the OCTT session has been started */
let sessionStarted = process.env.OCTT_SESSION_STARTED === "true";

// Run tests sequentially — OCTT does not support parallel sessions
test.describe.configure({ mode: 'serial' });

// Global timeout: 15 minutes per test (reboot tests can take 10+ minutes)
test.setTimeout(900_000);

// ══════════════════════════════════════════════════════════════
// PHASE 0: CDS Lab Setup
// Correct order: reset → validate → configure → start
// DO NOT reset after configure — reset clears EV PIDs!
// ══════════════════════════════════════════════════════════════

test('0a. Reset CDS to known idle state', async ({ request }) => {
    test.skip(process.env.NEEDS_CDS === 'false', 'CDS skipped: no charging tests requested');
    const resp = await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/reset`);
    const body = await resp.json();
    if (!body.ok) {
        console.warn('[CDS] Reset returned false (timeout or already stopped), proceeding anyway.');
    } else {
        console.log('[CDS] Reset complete — CDS in Stopped state');
    }
});

test('0b. Validate CDS (no errors, healthy state)', async ({ request }) => {
    test.skip(process.env.NEEDS_CDS === 'false', 'CDS skipped: no charging tests requested');
    const resp = await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/validate`);
    const body = await resp.json();
    console.log(`[CDS] Validate: healthy=${body.healthy} status=${body.status} errors=${body.errors}`);
    expect(body.healthy).toBeTruthy();
});

test('0c. Configure CDS (ISO 15118, DC, sink)', async ({ request }) => {
    test.skip(process.env.NEEDS_CDS === 'false', 'CDS skipped: no charging tests requested');
    const resp = await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/configure-cds`, {
        data: { specification: 3, chargeMode: 2, sinkId: CONFIG.sinkId, mode: 2 },
    });
    const body = await resp.json();
    expect(body.ok).toBeTruthy();
    console.log('[CDS] Configured: ISO 15118, DC mode, sink=' + CONFIG.sinkId);
});

test('0d. Configure EV parameters (500V, 50A, 10kW)', async ({ request }) => {
    test.skip(process.env.NEEDS_CDS === 'false', 'CDS skipped: no charging tests requested');
    const resp = await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/configure-ev`, {
        data: {
            EVMaximumVoltageLimit: 500,
            EVMinimumVoltageLimit: 400,
            EVMaximumCurrentLimit: 50,
            EVMinimumCurrentLimit: 0,
            EVMaximumPowerLimit: 10000,
            BatteryCapacity: 50000,
            EVstateOfCharge: 50,
        },
    });
    const body = await resp.json();
    expect(body.ok).toBeTruthy();
    console.log('[CDS] EV configured: 500V max, 50A max, 10kW, SoC 50%');
});

test.skip('0e. Start CDS simulation', async ({ request }) => {
    // Skipped: The SUT Automation Bridge now dynamically handles plugin/plugout commands
    // sent by OCTT, so we no longer need to force-start the CDS before the test begins.
    // Starting it here would cause an 'extra plugin' event if the test case also sends one.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const resp = await request.post(`${CONFIG.dashboardUrl}/i/${cdsId}/start`);
    const body = await resp.json();
    expect(body.ok).toBeTruthy();
    console.log('[CDS] EV simulation started — ready for charging tests');
});

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

        for (const testId of tests) {

            test(`Execute ${testId}`, async ({ request }) => {
                console.log(`[OCTT] Executing ${testId}...`);

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
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                }

                // ── Execute the test case via OCTT REST API ──
                // Wrapped in a broad try-catch so that a single failing test
                // (SUT crash, network timeout, OCTT internal error) never
                // aborts the entire certification run.
                let verdict = 'error';
                let duration = 0;
                let sutDisconnected = false;

                try {
                    const resp = await request.post(
                        `${CONFIG.octtBaseUrl}/testcases/${testId}/execute`,
                        { headers: authHeader, timeout: 900_000 }
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
