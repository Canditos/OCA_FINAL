import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ══════════════════════════════════════════════════════════════
// OCPP 1.6 Test Plan Generator for Jira/Xray
// ══════════════════════════════════════════════════════════════
//
// This script generates importable CSV files for Jira test management.
// Supports two formats:
//   1. Xray CSV   → For teams using Xray Test Management plugin
//   2. Generic    → Simple Jira CSV with labels for any workflow
//
// Usage:
//   npx tsx scripts/generate-jira-test-plan.ts
//
// Output:
//   test-plans/xray-import.csv
//   test-plans/jira-generic.csv
//   test-plans/test-plan-summary.json
// ══════════════════════════════════════════════════════════════

// ── Test Catalog (mirrors server.ts) ──

const testSuites: Record<string, string[]> = {
    MAINTENANCE: [
        'tc_bi_restore_configuration',
        'tc_bi_stop_transactions',
        'tc_bi_clear_cache',
        'tc_bi_clear_local_auth_list',
        'tc_bi_restore_availability',
        'tc_bi_reset_hard',
    ],
    Authorization: ['TC_023_4_CS', 'TC_023_5_CS', 'TC_024_CS', 'TC_061_1_CS', 'TC_061_2_CS'],
    DataTransfer: ['TC_062_CS'],
    FirmwareManagement: ['TC_044_1_CS', 'TC_044_2_CS', 'TC_044_3_CS', 'TC_045_1_CS', 'TC_045_2_CS'],
    LocalAuthList: [
        'TC_008_1_CS', 'TC_008_2_CS', 'TC_042_1_CS', 'TC_042_2_CS',
        'TC_043_1_CS', 'TC_043_2_CS', 'TC_043_3_CS', 'TC_043_CS',
    ],
    MeterValues: ['TC_070_CS', 'TC_071_CS'],
    Provisioning: [
        'TC_001_CS', 'TC_002_CS', 'TC_013_CS', 'TC_014_CS', 'TC_015_CS', 'TC_016_CS',
        'TC_019_CS', 'TC_021_CS', 'TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS',
        'TC_040_1_CS', 'TC_040_2_CS', 'TC_041_CS',
    ],
    RemoteControl: [
        'TC_010_CS', 'TC_011_1_CS', 'TC_011_2_CS', 'TC_012_CS',
        'TC_017_1_CS', 'TC_017_2_CS', 'TC_018_1_CS', 'TC_018_2_CS',
        'TC_026_CS', 'TC_027_CS', 'TC_028_CS', 'TC_030_CS', 'TC_031_CS',
    ],
    RemoteTrigger: ['TC_054_CS', 'TC_055_CS'],
    Reservation: [
        'TC_046_1_CS', 'TC_046_2_CS', 'TC_047_CS',
        'TC_048_1_CS', 'TC_048_2_CS', 'TC_048_3_CS', 'TC_048_4_CS',
        'TC_049_CS', 'TC_050_1_CS', 'TC_050_2_CS', 'TC_050_3_CS', 'TC_050_4_CS',
        'TC_051_CS', 'TC_052_CS', 'TC_053_1_CS', 'TC_053_2_CS',
    ],
    Security: [
        'TC_073_CS', 'TC_074_CS', 'TC_075_1_CS', 'TC_075_2_CS', 'TC_076_CS',
        'TC_077_CS', 'TC_078_CS', 'TC_079_CS', 'TC_080_CS', 'TC_081_CS',
        'TC_083_CS', 'TC_084_CS', 'TC_085_CS', 'TC_086_CS', 'TC_087_CS',
    ],
    SmartCharging: [
        'TC_056_CS', 'TC_057_CS', 'TC_058_1_CS', 'TC_058_2_CS',
        'TC_059_CS', 'TC_060_CS', 'TC_066_CS', 'TC_067_CS', 'TC_072_CS', 'TC_082_CS',
    ],
    Transactions: [
        'TC_003_CS', 'TC_004_1_CS', 'TC_004_2_CS', 'TC_005_1_CS', 'TC_005_2_CS', 'TC_005_3_CS',
        'TC_007_1_CS', 'TC_007_2_CS', 'TC_036_CS', 'TC_037_1_CS', 'TC_037_2_CS', 'TC_037_3_CS',
        'TC_038_CS', 'TC_039_CS', 'TC_068_CS', 'TC_069_CS',
    ],
};

const testDescriptions: Record<string, string> = {
    'TC_023_4_CS': 'Start local Charging Session - Authorize invalid',
    'TC_023_5_CS': 'Start remote Charging Session - Authorize invalid',
    'TC_024_CS': 'Start Charging Session - Lock Failure',
    'TC_061_1_CS': 'Clear Authorization Data in Authorization Cache - Local',
    'TC_061_2_CS': 'Clear Authorization Data in Authorization Cache - Remote',
    'TC_062_CS': 'Data Transfer to a Charge Point',
    'TC_044_1_CS': 'Firmware Update - Download and Install',
    'TC_044_2_CS': 'Firmware Update - Download Failed',
    'TC_044_3_CS': 'Firmware Update - Installation Failed',
    'TC_045_1_CS': 'Get Diagnostics',
    'TC_045_2_CS': 'Get Diagnostics - Upload Failed',
    'TC_008_1_CS': 'Regular Start Charging Session - Id in Local Authorization List',
    'TC_008_2_CS': 'Remote Start Charging Session - Id in Local Authorization List',
    'TC_042_1_CS': 'Get Local List Version (not supported)',
    'TC_042_2_CS': 'Get Local List Version (empty)',
    'TC_043_1_CS': 'Send Local Authorization List - NotSupported',
    'TC_043_2_CS': 'Send Local Authorization List - VersionMismatch',
    'TC_043_3_CS': 'Send Local Authorization List - Failed',
    'TC_043_CS': 'Send Local Authorization List',
    'TC_070_CS': 'Sampled Meter Values',
    'TC_071_CS': 'Clock-aligned Meter Values',
    'TC_001_CS': 'Cold Boot Charge Point',
    'TC_002_CS': 'Cold Boot Charge Point - Pending',
    'TC_013_CS': 'Hard Reset Without transaction',
    'TC_014_CS': 'Soft Reset Without Transaction',
    'TC_015_CS': 'Hard Reset With Transaction',
    'TC_016_CS': 'Soft Reset With Transaction',
    'TC_019_CS': 'Retrieve configuration',
    'TC_021_CS': 'Change/set Configuration',
    'TC_032_1_CS': 'Power failure boot charging point - stop transactions before going down',
    'TC_032_2_CS': 'Power failure boot charging point - stop transactions',
    'TC_034_CS': 'Power Failure with Unavailable Status',
    'TC_040_1_CS': 'Configuration key - NotSupported',
    'TC_040_2_CS': 'Configuration key - Invalid value',
    'TC_041_CS': 'Fault Behavior',
    'TC_010_CS': 'Remote Start Charging Session - Cable Plugged in First',
    'TC_011_1_CS': 'Remote Start Charging Session - Remote Start First',
    'TC_011_2_CS': 'Remote Start Charging Session - Time Out',
    'TC_012_CS': 'Remote Stop Charging Session',
    'TC_017_1_CS': 'Unlock connector - no charging session (Not fixed cable)',
    'TC_017_2_CS': 'Unlock connector - no charging session (Fixed cable)',
    'TC_018_1_CS': 'Unlock Connector - With Charging Session (Not fixed cable)',
    'TC_018_2_CS': 'Unlock Connector - With Charging Session (Fixed cable)',
    'TC_026_CS': 'Remote Start Charging Session - Rejected',
    'TC_027_CS': 'Remote start transaction - connector id shall not be 0',
    'TC_028_CS': 'Remote Stop Transaction - Rejected',
    'TC_030_CS': 'Unlock Connector - Unlock Failure',
    'TC_031_CS': 'Unlock Connector - Unknown Connector',
    'TC_054_CS': 'Trigger Message',
    'TC_055_CS': 'Trigger Message - Rejected',
    'TC_046_1_CS': 'Reservation of a Connector - Local start transaction',
    'TC_046_2_CS': 'Reservation of a Connector - Remote start transaction',
    'TC_047_CS': 'Reservation of a Connector - Expire',
    'TC_048_1_CS': 'Reservation of a Connector - Faulted',
    'TC_048_2_CS': 'Reservation of a Connector - Occupied',
    'TC_048_3_CS': 'Reservation of a Connector - Unavailable',
    'TC_048_4_CS': 'Reservation of a Connector - Rejected',
    'TC_049_CS': 'Reservation of a Charge Point - Transaction',
    'TC_050_1_CS': 'Reservation of a Charge Point - Faulted',
    'TC_050_2_CS': 'Reservation of a Charge Point - Occupied',
    'TC_050_3_CS': 'Reservation of a Charge Point - Unavailable',
    'TC_050_4_CS': 'Reservation of a Charge Point - Rejected',
    'TC_051_CS': 'Cancel Reservation',
    'TC_052_CS': 'Cancel Reservation - Rejected',
    'TC_053_1_CS': 'Use a reserved Connector with parentIdTag - Local',
    'TC_053_2_CS': 'Use a reserved Connector with parentIdTag - Remote',
    'TC_073_CS': 'Update Charge Point Password for HTTP Basic Authentication',
    'TC_074_CS': 'Update Charge Point Certificate by request of Central System',
    'TC_075_1_CS': 'Install a certificate on the Charge Point - ManufacturerRootCertificate',
    'TC_075_2_CS': 'Install a certificate on the Charge Point - CentralSystemRootCertificate',
    'TC_076_CS': 'Delete a specific certificate from the Charge Point',
    'TC_077_CS': 'Invalid ChargePointCertificate Security Event',
    'TC_078_CS': 'Invalid CentralSystemCertificate Security Event',
    'TC_079_CS': 'Get Security Log',
    'TC_080_CS': 'Secure Firmware Update',
    'TC_081_CS': 'Secure Firmware Update - Invalid Signature',
    'TC_083_CS': 'Upgrade security profile',
    'TC_084_CS': 'Downgrade security profile - Rejected',
    'TC_085_CS': 'Basic Authentication - Valid username/password combination',
    'TC_086_CS': 'TLS - server-side certificate - Valid certificate',
    'TC_087_CS': 'TLS - Client-side certificate - valid certificate',
    'TC_056_CS': 'Central Smart Charging - TxDefaultProfile',
    'TC_057_CS': 'Central Smart Charging - TxProfile',
    'TC_058_1_CS': 'Central Smart Charging - No ongoing transaction',
    'TC_058_2_CS': 'Central Smart Charging - Wrong transactionId',
    'TC_059_CS': 'Remote Start Transaction with Charging Profile',
    'TC_060_CS': 'Remote Start Transaction with Charging Profile - Rejected',
    'TC_066_CS': 'Get Composite Schedule',
    'TC_067_CS': 'Clear Charging Profile',
    'TC_072_CS': 'Stacking Charging Profiles',
    'TC_082_CS': 'Central Smart Charging - TxDefaultProfile - with ongoing transaction',
    'TC_003_CS': 'Regular Charging Session - Plugin First',
    'TC_004_1_CS': 'Regular Charging Session - Identification First',
    'TC_004_2_CS': 'Regular Charging Session - Identification First - ConnectionTimeOut',
    'TC_005_1_CS': 'EV Side Disconnected - StopTransactionOnEVSideDisconnect=true - UnlockConnector=true',
    'TC_005_2_CS': 'EV Side Disconnected - StopTransactionOnEVSideDisconnect=true - UnlockConnector=false',
    'TC_005_3_CS': 'EV Side Disconnected - StopTransactionOnEVSideDisconnect=false - UnlockConnector=false',
    'TC_007_1_CS': 'Regular Start Charging Session - Cached Id',
    'TC_007_2_CS': 'Remote Start Charging Session - Cached Id',
    'TC_036_CS': 'Connection Loss During Transaction',
    'TC_037_1_CS': 'Offline Start Transaction - Valid IdTag',
    'TC_037_2_CS': 'Offline Start Transaction - Invalid IdTag - StopTransactionOnInvalidId=false',
    'TC_037_3_CS': 'Offline Start Transaction - Invalid IdTag - StopTransactionOnInvalidId=true',
    'TC_038_CS': 'Offline Stop Transaction',
    'TC_039_CS': 'Offline Transaction',
    'TC_068_CS': 'Stop transaction - IdTag in StopTransaction matches IdTag in StartTransaction',
    'TC_069_CS': 'Stop transaction - ParentIdTag in StopTransaction matches ParentIdTag in StartTransaction',
};

// Test cases that require the CDS (EV simulator) hardware
const CDS_REQUIRED_SUITES = [
    'Transactions',
    'RemoteControl',
    'SmartCharging',
    'Reservation',
    'MeterValues',
];

// Test cases that involve rebooting the charge point
const REBOOT_TESTS = [
    'TC_001_CS', 'TC_002_CS', 'TC_013_CS', 'TC_014_CS',
    'TC_015_CS', 'TC_016_CS', 'TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS',
];

// Maintenance tests don't follow the TC_XXX naming pattern
const MAINTENANCE_DESCRIPTIONS: Record<string, string> = {
    'tc_bi_restore_configuration': 'Restore all configuration keys to their default values',
    'tc_bi_stop_transactions': 'Stop all active transactions before proceeding',
    'tc_bi_clear_cache': 'Clear the local authorization cache',
    'tc_bi_clear_local_auth_list': 'Clear the local authorization list',
    'tc_bi_restore_availability': 'Restore all connectors to Available state',
    'tc_bi_reset_hard': 'Perform a hard reset of the charge point',
};

// ── Helper functions ──

function needsCds(suite: string): boolean {
    return CDS_REQUIRED_SUITES.includes(suite);
}

function isRebootTest(testId: string): boolean {
    return REBOOT_TESTS.includes(testId);
}

function getLabels(suite: string, testId: string): string {
    const labels: string[] = ['ocpp1.6', 'certification'];
    labels.push(suite.toLowerCase());
    labels.push(needsCds(suite) ? 'needs-cds' : 'no-cds');
    if (isRebootTest(testId)) labels.push('reboot');
    return labels.join(' ');
}

function getDescription(suite: string, testId: string): string {
    const desc = testDescriptions[testId] || MAINTENANCE_DESCRIPTIONS[testId] || 'No description available';
    const cdsInfo = needsCds(suite) ? 'Requires CDS EV simulator.' : 'No CDS required — protocol-only test.';
    const rebootInfo = isRebootTest(testId) ? ' Reboot test — extended timeouts (600s/650s) required.' : '';
    return `${desc}.\n\nSuite: ${suite}\n${cdsInfo}${rebootInfo}\n\nOCPP Version: 1.6\nRole: Charging Station (CS)`;
}

// ── CSV Escaping ──

function csvEscape(str: string): string {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ── Generators ──

function generateXrayCsv(): string {
    const lines: string[] = [
        'Test Key,Test Repository Path,Test Name,Test Type,Test Description,Test Labels',
    ];

    for (const [suite, tests] of Object.entries(testSuites)) {
        for (const testId of tests) {
            const summary = `[OCPP 1.6] ${testId} — ${testDescriptions[testId] || MAINTENANCE_DESCRIPTIONS[testId] || testId}`;
            const repoPath = `OCPP-1.6/${suite}`;
            const labels = getLabels(suite, testId);
            const description = getDescription(suite, testId);
            lines.push([
                '',                          // Test Key (empty = new test)
                csvEscape(repoPath),         // Repository Path
                csvEscape(summary),          // Test Name
                'Manual',                    // Test Type
                csvEscape(description),      // Test Description
                csvEscape(labels),           // Test Labels
            ].join(','));
        }
    }

    return lines.join('\n');
}

function generateGenericCsv(): string {
    const lines: string[] = [
        'Issue Type,Summary,Description,Labels,Priority',
    ];

    for (const [suite, tests] of Object.entries(testSuites)) {
        for (const testId of tests) {
            const summary = `[OCPP 1.6] ${testId} — ${testDescriptions[testId] || MAINTENANCE_DESCRIPTIONS[testId] || testId}`;
            const labels = getLabels(suite, testId);
            const description = getDescription(suite, testId);
            const priority = isRebootTest(testId) ? 'High' : 'Medium';
            lines.push([
                'Test',                      // Issue Type
                csvEscape(summary),          // Summary
                csvEscape(description),      // Description
                csvEscape(labels),           // Labels
                priority,                    // Priority
            ].join(','));
        }
    }

    return lines.join('\n');
}

function generateJson(): object {
    const tests: Array<{
        id: string;
        suite: string;
        description: string;
        labels: string[];
        needsCds: boolean;
        isReboot: boolean;
    }> = [];

    for (const [suite, testIds] of Object.entries(testSuites)) {
        for (const testId of testIds) {
            tests.push({
                id: testId,
                suite,
                description: testDescriptions[testId] || MAINTENANCE_DESCRIPTIONS[testId] || testId,
                labels: getLabels(suite, testId).split(' '),
                needsCds: needsCds(suite),
                isReboot: isRebootTest(testId),
            });
        }
    }

    return {
        meta: {
            ocppVersion: '1.6',
            role: 'CS',
            configuration: 'AUT_SID_SAT',
            totalTests: tests.length,
            generatedAt: new Date().toISOString(),
        },
        suites: Object.keys(testSuites),
        tests,
    };
}

// ── Main ──

const outDir = resolve(process.cwd(), 'scripts/output/test-plans');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Generate files
const xrayCsv = generateXrayCsv();
const genericCsv = generateGenericCsv();
const jsonData = generateJson();

writeFileSync(resolve(outDir, 'xray-import.csv'), xrayCsv, 'utf-8');
writeFileSync(resolve(outDir, 'jira-generic.csv'), genericCsv, 'utf-8');
writeFileSync(resolve(outDir, 'test-plan.json'), JSON.stringify(jsonData, null, 2), 'utf-8');

// Summary
const totalTests = Object.values(testSuites).reduce((sum, arr) => sum + arr.length, 0);
const cdsTests = Object.entries(testSuites).filter(([s]) => needsCds(s)).reduce((sum, [, arr]) => sum + arr.length, 0);
const noCdsTests = totalTests - cdsTests;
const rebootCount = REBOOT_TESTS.length;

console.log('\n══════════════════════════════════════════');
console.log('   OCPP 1.6 Test Plan Generated');
console.log('══════════════════════════════════════════\n');
console.log(`Total test cases : ${totalTests}`);
console.log(`Need CDS hardware: ${cdsTests}`);
console.log(`Protocol-only    : ${noCdsTests}`);
console.log(`Reboot tests     : ${rebootCount}`);
console.log(`Suites           : ${Object.keys(testSuites).length}`);
console.log('\nFiles generated:');
console.log(`  scripts/output/test-plans/xray-import.csv    (Xray Test Management)`);
console.log(`  scripts/output/test-plans/jira-generic.csv   (Generic Jira import)`);
console.log(`  scripts/output/test-plans/test-plan.json     (JSON reference)`);
console.log('\n══════════════════════════════════════════');
