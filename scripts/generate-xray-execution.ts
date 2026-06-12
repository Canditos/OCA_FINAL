import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ══════════════════════════════════════════════════════════════
// Xray Test Execution Generator
// ══════════════════════════════════════════════════════════════
//
// Generates a Test Execution ready for Xray import.
// Unlike a Test Plan (which creates test definitions),
// a Test Execution is where you RUN tests and record results.
//
// Usage:
//   npx tsx scripts/generate-xray-execution.ts [EXECUTION_NAME]
//
// Example:
//   npx tsx scripts/generate-xray-execution.ts "OCPP 1.6 - Sprint 23"
//
// Output:
//   test-execution/xray-execution.csv     → Import into Xray Test Execution
//   test-execution/xray-execution.json    → API payload for automation
//   test-execution/import-instructions.md → Step-by-step guide
// ══════════════════════════════════════════════════════════════

const executionName = process.argv[2] || `OCPP 1.6 Certification - ${new Date().toISOString().split('T')[0]}`;

// ── Test Catalog ──

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

const MAINTENANCE_DESCRIPTIONS: Record<string, string> = {
    'tc_bi_restore_configuration': 'Restore all configuration keys to their default values',
    'tc_bi_stop_transactions': 'Stop all active transactions before proceeding',
    'tc_bi_clear_cache': 'Clear the local authorization cache',
    'tc_bi_clear_local_auth_list': 'Clear the local authorization list',
    'tc_bi_restore_availability': 'Restore all connectors to Available state',
    'tc_bi_reset_hard': 'Perform a hard reset of the charge point',
};

const CDS_REQUIRED_SUITES = ['Transactions', 'RemoteControl', 'SmartCharging', 'Reservation', 'MeterValues'];
const REBOOT_TESTS = ['TC_001_CS', 'TC_002_CS', 'TC_013_CS', 'TC_014_CS', 'TC_015_CS', 'TC_016_CS', 'TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS'];

function needsCds(suite: string): boolean {
    return CDS_REQUIRED_SUITES.includes(suite);
}

function isRebootTest(testId: string): boolean {
    return REBOOT_TESTS.includes(testId);
}

function csvEscape(str: string): string {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ── CSV Generator ──
// Format compatible with Xray "Import Results" from CSV

function generateExecutionCsv(): string {
    const lines: string[] = [
        'Test Key,Status,Comment',  // Xray CSV header
    ];

    for (const [suite, tests] of Object.entries(testSuites)) {
        for (const testId of tests) {
            const summary = `[OCPP 1.6] ${testId} — ${testDescriptions[testId] || MAINTENANCE_DESCRIPTIONS[testId] || testId}`;
            // Status starts as TODO (not executed yet)
            // After running, update to PASS, FAIL, or EXECUTING
            lines.push([
                csvEscape(summary),   // Xray matches by Test Summary if Test Key is empty
                'TODO',               // Initial status
                '',                   // Comment
            ].join(','));
        }
    }

    return lines.join('\n');
}

// ── JSON Generator ──
// Payload for Xray REST API: POST /rest/raven/1.0/api/testexec

function generateExecutionJson(): object {
    const tests: Array<{
        testKey: string;
        status: string;
        comment: string;
    }> = [];

    for (const [suite, testIds] of Object.entries(testSuites)) {
        for (const testId of testIds) {
            const summary = `[OCPP 1.6] ${testId} — ${testDescriptions[testId] || MAINTENANCE_DESCRIPTIONS[testId] || testId}`;
            tests.push({
                testKey: summary,  // Will be resolved by Xray
                status: 'TODO',
                comment: `Suite: ${suite} | ${needsCds(suite) ? 'Needs CDS' : 'No CDS'}`,
            });
        }
    }

    return {
        info: {
            summary: executionName,
            description: `OCPP 1.6 Certification Test Execution\nGenerated: ${new Date().toISOString()}\nTotal Tests: ${tests.length}`,
            version: '1.0',
            user: 'Certification Pipeline',
            startDate: new Date().toISOString().split('T')[0],
        },
        tests,
    };
}

// ── Instructions ──

function generateInstructions(): string {
    const totalTests = Object.values(testSuites).reduce((sum, arr) => sum + arr.length, 0);

    return `# Xray Test Execution Import Guide

## Files Generated

| File | Purpose |
|------|---------|
| \`xray-execution.csv\` | Import test results into an existing Xray Test Execution |
| \`xray-execution.json\` | API payload for creating a Test Execution via REST |

## Execution Name
\`\`\`
${executionName}
\`\`\`

## Total Tests: ${totalTests}

---

## Method 1: Manual Import (Recommended)

### Step 1: Create a Test Execution in Jira
1. Go to your Jira project
2. Click **Create** → Select issue type **"Test Execution"**
3. Set Summary to: \`${executionName}\`
4. Save

### Step 2: Add Tests to the Execution
1. Open the Test Execution issue
2. Click **Add Tests**
3. Search and select all OCPP 1.6 tests (or add by filter)

### Step 3: Import Results from CSV
1. In the Test Execution, click **More** → **Import Results**
2. Select **CSV** format
3. Upload \`xray-execution.csv\`
4. Map columns:
   - \`Test Key\` → Test (by Summary)
   - \`Status\` → Status
   - \`Comment\` → Comment
5. Click **Import**

### Step 4: Update Results After Running
After running tests via the dashboard:
1. Edit the CSV and change TODO → PASS/FAIL/EXECUTING
2. Re-import to update the Test Execution

---

## Method 2: API Automation

### Create Test Execution via REST

\`\`\`bash
curl -X POST \\
  -H "Content-Type: application/json" \\
  -u your-email:your-api-token \\
  "https://your-domain.atlassian.net/rest/raven/1.0/api/testexec" \\
  -d @test-execution/xray-execution.json
\`\`\`

### Update Test Results

\`\`\`bash
# Update a single test result
curl -X PUT \\
  -H "Content-Type: application/json" \\
  -u your-email:your-api-token \\
  "https://your-domain.atlassian.net/rest/raven/1.0/api/testexec/TEST-123/test" \\
  -d '{
    "testKey": "TEST-456",
    "status": "PASS",
    "comment": "Executed via Certification Dashboard",
    "evidences": []
  }'
\`\`\`

---

## Status Values

| Status | Meaning |
|--------|---------|
| \`TODO\` | Not executed yet |
| \`EXECUTING\` | Currently running |
| \`PASS\` | Test passed |
| \`FAIL\` | Test failed |
| \`ABORTED\` | Test was stopped |
| \`BLOCKED\` | Cannot run (e.g., CDS offline) |

---

## Dashboard Integration

To automatically update Xray from the dashboard:
1. Configure Jira credentials in dashboard config
2. After each test run, the dashboard will POST results to Xray API
3. Test Execution will be updated in real-time

---

*Generated by PIP-OCTT Certification Pipeline*
`;
}

// ── Main ──

const outDir = resolve(process.cwd(), 'scripts/output/test-execution');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const csv = generateExecutionCsv();
const json = generateExecutionJson();
const instructions = generateInstructions();

writeFileSync(resolve(outDir, 'xray-execution.csv'), csv, 'utf-8');
writeFileSync(resolve(outDir, 'xray-execution.json'), JSON.stringify(json, null, 2), 'utf-8');
writeFileSync(resolve(outDir, 'import-instructions.md'), instructions, 'utf-8');

const totalTests = Object.values(testSuites).reduce((sum, arr) => sum + arr.length, 0);

console.log('\n══════════════════════════════════════════');
console.log('   Xray Test Execution Generated');
console.log('══════════════════════════════════════════\n');
console.log(`Execution Name   : ${executionName}`);
console.log(`Total Tests      : ${totalTests}`);
console.log(`Initial Status   : TODO (all tests)`);
console.log('\nFiles generated:');
console.log(`  scripts/output/test-execution/xray-execution.csv       (CSV import)`);
console.log(`  scripts/output/test-execution/xray-execution.json      (API payload)`);
console.log(`  scripts/output/test-execution/import-instructions.md   (How-to guide)`);
console.log('\nNext Steps:');
console.log('  1. Create a Test Execution issue in Jira/Xray');
console.log('  2. Import xray-execution.csv to add all tests');
console.log('  3. Run tests via dashboard');
console.log('  4. Update CSV with PASS/FAIL and re-import');
console.log('\n══════════════════════════════════════════');
