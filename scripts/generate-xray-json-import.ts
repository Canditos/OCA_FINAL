import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ══════════════════════════════════════════════════════════════
// Xray JSON Import Generator
// ══════════════════════════════════════════════════════════════
//
// Reads the individual step CSV files from scripts/test-steps/
// and generates a single Xray-compatible JSON file for import.
//
// Usage:
//   npx tsx scripts/generate-xray-json-import.ts <PROJECT_KEY> [EXECUTION_NAME]
//
// Example:
//   npx tsx scripts/generate-xray-json-import.ts PIP "OCPP 1.6 - Full Certification"
//
// Output:
//   scripts/output/xray-import/xray-testexecution-import.json
//
// Then import via:
//   curl -X POST -H "Content-Type: application/json" \
//     -u email:token \
//     "https://your-domain.atlassian.net/rest/raven/1.0/import/test" \
//     -d @scripts/output/xray-import/xray-testexecution-import.json
// ══════════════════════════════════════════════════════════════

const PROJECT_KEY = (process.argv[2] || 'PIP').toUpperCase();
const executionName = process.argv[3] || `OCPP 1.6 Certification - ${new Date().toISOString().split('T')[0]}`;

const STEPS_DIR = path.join(__dirname, 'test-steps');
const OUT_DIR = path.join(process.cwd(), 'scripts', 'output', 'xray-import');

interface Step {
  step: number;
  action: string;
  result: string;
}

interface TestCase {
  testId: string;
  title: string;
  suite: string;
  steps: Step[];
}

// ── Parse step CSV files ──

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function readStepCsv(filePath: string): Step[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().length > 0);

  if (lines.length < 2) return [];

  const steps: Step[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length >= 5) {
      steps.push({
        step: parseInt(cols[0], 10) || i,
        action: cols[1] || '',
        result: cols[4] || '',
      });
    }
  }
  return steps;
}

function getTitleFromCsv(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  if (lines.length < 2) return '';
  const cols1 = parseCsvLine(lines[1]);
  return cols1[1] || '';
}

// ── Suite extraction from filename ──
// We need to map testId → suite. There are many ways, but the
// _steps_summary.csv has the mapping, and the testcases route
// also defines it. We embed it here as the source of truth.

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

// Build reverse lookup: testId → suite
const testSuiteMap: Record<string, string> = {};
for (const [suite, tests] of Object.entries(testSuites)) {
  for (const testId of tests) {
    testSuiteMap[testId] = suite;
  }
}

const testDescriptions: Record<string, string> = {
  'TC_001_CS': 'Cold Boot Charge Point',
  'TC_002_CS': 'Cold Boot Charge Point - Pending',
  'TC_003_CS': 'Regular Charging Session - Plugin First',
  'TC_004_1_CS': 'Regular Charging Session - Identification First',
  'TC_004_2_CS': 'Regular Charging Session - Identification First - ConnectionTimeOut',
  'TC_005_1_CS': 'EV Side Disconnected - StopTxnOnEVSideDisconnect=true - UnlockConnectorOnEVSideDisconnect=true',
  'TC_005_2_CS': 'EV Side Disconnected - StopTxnOnEVSideDisconnect=true - UnlockConnectorOnEVSideDisconnect=false',
  'TC_005_3_CS': 'EV Side Disconnected - StopTxnOnEVSideDisconnect=false - UnlockConnectorOnEVSideDisconnect=false',
  'TC_007_1_CS': 'Regular Start - Cached Id',
  'TC_007_2_CS': 'Remote Start - Cached Id',
  'TC_008_1_CS': 'Local Auth List - Regular Start',
  'TC_008_2_CS': 'Local Auth List - Remote Start',
  'TC_010_CS': 'Remote Start - Cable Plugged First',
  'TC_011_1_CS': 'Remote Start - Remote Start First',
  'TC_011_2_CS': 'Remote Start - Time Out',
  'TC_012_CS': 'Remote Stop Charging Session',
  'TC_013_CS': 'Hard Reset Without Transaction',
  'TC_014_CS': 'Soft Reset Without Transaction',
  'TC_015_CS': 'Hard Reset With Transaction',
  'TC_016_CS': 'Soft Reset With Transaction',
  'TC_017_1_CS': 'Unlock - No Session (Not Fixed Cable)',
  'TC_017_2_CS': 'Unlock - No Session (Fixed Cable)',
  'TC_018_1_CS': 'Unlock - With Session (Not Fixed Cable)',
  'TC_018_2_CS': 'Unlock - With Session (Fixed Cable)',
  'TC_019_CS': 'Retrieve Configuration',
  'TC_021_CS': 'Change/Set Configuration',
  'TC_023_4_CS': 'Start Local - Authorize Invalid',
  'TC_023_5_CS': 'Start Remote - Authorize Invalid',
  'TC_024_CS': 'Start - Lock Failure',
  'TC_026_CS': 'Remote Start - Rejected',
  'TC_027_CS': 'Remote Start - ConnectorId=0',
  'TC_028_CS': 'Remote Stop - Rejected',
  'TC_030_CS': 'Unlock - Unlock Failure',
  'TC_031_CS': 'Unlock - Unknown Connector',
  'TC_032_1_CS': 'Power Failure - Stop Before Down',
  'TC_032_2_CS': 'Power Failure - Stop After Down',
  'TC_034_CS': 'Power Failure - Unavailable Status',
  'TC_036_CS': 'Connection Loss During Transaction',
  'TC_037_1_CS': 'Offline Start - Valid IdTag',
  'TC_037_2_CS': 'Offline Start - Invalid IdTag (StopOnInvalid=false)',
  'TC_037_3_CS': 'Offline Start - Invalid IdTag (StopOnInvalid=true)',
  'TC_038_CS': 'Offline Stop Transaction',
  'TC_039_CS': 'Offline Transaction',
  'TC_040_1_CS': 'Config Key - NotSupported',
  'TC_040_2_CS': 'Config Key - Invalid Value',
  'TC_041_CS': 'Fault Behavior',
  'TC_042_1_CS': 'Get Local List Version (Not Supported)',
  'TC_042_2_CS': 'Get Local List Version (Empty)',
  'TC_043_CS': 'Send Local Authorization List',
  'TC_043_1_CS': 'Send Local List - NotSupported',
  'TC_043_2_CS': 'Send Local List - VersionMismatch',
  'TC_043_3_CS': 'Send Local List - Failed',
  'TC_044_1_CS': 'Firmware Update - Download and Install',
  'TC_044_2_CS': 'Firmware Update - Download Failed',
  'TC_044_3_CS': 'Firmware Update - Installation Failed',
  'TC_045_1_CS': 'Get Diagnostics',
  'TC_045_2_CS': 'Get Diagnostics - Upload Failed',
  'TC_046_1_CS': 'Reserve Connector - Local Start',
  'TC_046_2_CS': 'Reserve Connector - Remote Start',
  'TC_047_CS': 'Reserve Connector - Expire',
  'TC_048_1_CS': 'Reserve Connector - Faulted',
  'TC_048_2_CS': 'Reserve Connector - Occupied',
  'TC_048_3_CS': 'Reserve Connector - Unavailable',
  'TC_048_4_CS': 'Reserve Connector - Rejected',
  'TC_049_CS': 'Reserve ChargePoint - Transaction',
  'TC_050_1_CS': 'Reserve ChargePoint - Faulted',
  'TC_050_2_CS': 'Reserve ChargePoint - Occupied',
  'TC_050_3_CS': 'Reserve ChargePoint - Unavailable',
  'TC_050_4_CS': 'Reserve ChargePoint - Rejected',
  'TC_051_CS': 'Cancel Reservation',
  'TC_052_CS': 'Cancel Reservation - Rejected',
  'TC_053_1_CS': 'Reserved - parentIdTag Local',
  'TC_053_2_CS': 'Reserved - parentIdTag Remote',
  'TC_054_CS': 'Trigger Message',
  'TC_055_CS': 'Trigger Message - Rejected',
  'TC_056_CS': 'Smart Charging - TxDefaultProfile',
  'TC_057_CS': 'Smart Charging - TxProfile',
  'TC_058_1_CS': 'Smart Charging - No Transaction',
  'TC_058_2_CS': 'Smart Charging - Wrong TransactionId',
  'TC_059_CS': 'Remote Start with ChargingProfile',
  'TC_060_CS': 'Remote Start with ChargingProfile - Rejected',
  'TC_061_1_CS': 'Clear Cache - Local',
  'TC_061_2_CS': 'Clear Cache - Remote',
  'TC_062_CS': 'Data Transfer to Charge Point',
  'TC_066_CS': 'Get Composite Schedule',
  'TC_067_CS': 'Clear Charging Profile',
  'TC_068_CS': 'Stop transaction - Same idTag',
  'TC_069_CS': 'Stop transaction - Same ParentIdTag',
  'TC_070_CS': 'Sampled Meter Values',
  'TC_071_CS': 'Clock-aligned Meter Values',
  'TC_072_CS': 'Stacking Charging Profiles',
  'TC_073_CS': 'Update BasicAuth Password',
  'TC_074_CS': 'Update ChargePoint Certificate',
  'TC_075_1_CS': 'Install ManufacturerRootCertificate',
  'TC_075_2_CS': 'Install CentralSystemRootCertificate',
  'TC_076_CS': 'Delete Certificate',
  'TC_077_CS': 'Invalid ChargePointCertificate',
  'TC_078_CS': 'Invalid CentralSystemCertificate',
  'TC_079_CS': 'Get Security Log',
  'TC_080_CS': 'Secure Firmware Update',
  'TC_081_CS': 'Secure Firmware Update - Invalid Sig',
  'TC_082_CS': 'Smart Charging - TxDefault Ongoing Tx',
  'TC_083_CS': 'Upgrade Security Profile',
  'TC_084_CS': 'Downgrade Security Profile - Rejected',
  'TC_085_CS': 'Basic Authentication',
  'TC_086_CS': 'TLS - Server Certificate',
  'TC_087_CS': 'TLS - Client Certificate',
  'tc_bi_restore_configuration': 'Maintenance — restore configuration',
  'tc_bi_stop_transactions': 'Maintenance — stop all transactions',
  'tc_bi_clear_cache': 'Maintenance — clear cache',
  'tc_bi_clear_local_auth_list': 'Maintenance — clear local auth list',
  'tc_bi_restore_availability': 'Maintenance — restore availability',
  'tc_bi_reset_hard': 'Maintenance — hard reset',
};

// OCPP 1.6 Feature mapping per suite
const SUITE_FEATURE: Record<string, string> = {
  'ColdBoot': 'CORE',
  'StartSession': 'CORE',
  'StopSession': 'CORE',
  'Cache': 'CORE',
  'RemoteActions': 'CORE',
  'Resetting': 'CORE',
  'Unlocking': 'CORE',
  'Configuration': 'CORE',
  'MeterValues': 'CORE',
  'BasicActions': 'CORE',
  'RemoteActionsNonHappy': 'CORE',
  'UnlockingNonHappy': 'CORE',
  'PowerFailure': 'CORE',
  'OfflineBehavior': 'CORE',
  'ConfigKeysNonHappy': 'CORE',
  'FaultBehavior': 'CORE',
  'RemoteTrigger': 'CORE',
  'DataTransfer': 'DATA_TRANSFER',
  'LocalAuthList': 'LOCAL_AUTH_LIST',
  'FirmwareManagement': 'FIRMWARE_MANAGEMENT',
  'Diagnostics': 'DIAGNOSTICS',
  'Reservation': 'RESERVATION',
  'SmartCharging': 'SMART_CHARGING',
  'Security': 'SECURITY',
  'MAINTENANCE': 'CORE',
};

// Tests that need CDS EV simulator
const CDS_SUITES = new Set(['StartSession', 'StopSession', 'Cache', 'RemoteActions', 'Unlocking', 'SmartCharging', 'Reservation', 'LocalAuthList', 'OfflineBehavior', 'MeterValues']);
const REBOOT_TESTS = new Set(['TC_001_CS', 'TC_002_CS', 'TC_013_CS', 'TC_014_CS', 'TC_015_CS', 'TC_016_CS', 'TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS']);

function getLabels(testId: string, suite: string): string[] {
  const feature = SUITE_FEATURE[suite] || 'CORE';
  const labels = ['OCPP', 'ocpp1.6', feature, suite.toLowerCase()];
  if (CDS_SUITES.has(suite)) labels.push('needs-cds');
  else labels.push('no-cds');
  if (REBOOT_TESTS.has(testId)) labels.push('reboot');
  return labels;
}

function getDescription(testId: string, suite: string, stepCount: number): string {
  const desc = testDescriptions[testId] || testId;
  const cdsInfo = CDS_SUITES.has(suite) ? 'Requires CDS EV simulator (Keysight).' : 'No CDS required — protocol-only test.';
  const rebootInfo = REBOOT_TESTS.has(testId) ? ' Reboot test — requires extended timeouts (max_timeout_period=600, long_operation_timeout=650).' : '';
  return `${desc}\n\nSuite: ${suite}\n${cdsInfo}${rebootInfo}\n\nOCPP Version: 1.6\nRole: Charging Station (CS)\nTotal Steps: ${stepCount}`;
}

// ── Main ──

async function main() {
  if (!fs.existsSync(STEPS_DIR)) {
    console.error(`Error: Steps directory not found: ${STEPS_DIR}`);
    console.error('Run generate-test-step-csvs.ts first to create the step CSV files.');
    process.exit(1);
  }

  // Read all step CSV files
  const files = fs.readdirSync(STEPS_DIR).filter(f => f.endsWith('.steps.csv') && !f.startsWith('_'));

  if (files.length === 0) {
    console.error('No step CSV files found. Run generate-test-step-csvs.ts first.');
    process.exit(1);
  }

  console.log(`Reading ${files.length} step CSV files from ${STEPS_DIR}...`);

  // Build test cases
  const tests: any[] = [];
  const executionLabels = new Set<string>();

  for (const file of files.sort()) {
    const filePath = path.join(STEPS_DIR, file);
    const testId = file.replace('.steps.csv', '');
    const suite = testSuiteMap[testId] || 'Uncategorized';
    const steps = readStepCsv(filePath);
    const title = testDescriptions[testId] || testId;

    if (steps.length === 0) {
      console.warn(`  ⚠ ${testId}: no steps found, skipping`);
      continue;
    }

    const labels = getLabels(testId, suite);
    labels.forEach(l => executionLabels.add(l));

    // Build Xray Test object with Manual Test steps
    const xrayTest: any = {
      fields: {
        project: { key: PROJECT_KEY },
        summary: `[OCPP 1.6] ${testId} — ${title}`,
        description: getDescription(testId, suite, steps.length),
        issuetype: { name: 'Test' },
        labels,
      },
      testType: 'Manual',
      steps: steps.map(s => ({
        action: s.action,
        data: '',
        result: s.result,
      })),
    };

    tests.push(xrayTest);
  }

  // Build the complete Xray import payload
  const importPayload: any = {
    testExecution: {
      fields: {
        project: { key: PROJECT_KEY },
        summary: executionName,
        description: `OCPP 1.6 Certification Test Execution\n\nGenerated: ${new Date().toISOString()}\nTotal Tests: ${tests.length}\n\nSuites covered:\n${Object.keys(testSuites).map(s => `  - ${s} (${testSuites[s].length} tests)`).join('\n')}`,
        issuetype: { name: 'Test Execution' },
        labels: ['OCPP', 'ocpp1.6', 'certification', 'automated'],
      },
    },
    tests,
  };

  // Write output
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const outPath = path.join(OUT_DIR, 'xray-testexecution-import.json');
  fs.writeFileSync(outPath, JSON.stringify(importPayload, null, 2), 'utf-8');

  // Summary
  const totalSteps = tests.reduce((sum, t) => sum + (t.steps?.length || 0), 0);
  const suites = new Set(tests.map(t => testSuiteMap[t.fields.summary.split(' — ')[0].replace('[OCPP 1.6] ', '')] || 'Uncategorized'));

  console.log('\n══════════════════════════════════════════');
  console.log('   Xray JSON Import Generated');
  console.log('══════════════════════════════════════════\n');
  console.log(`Project Key      : ${PROJECT_KEY}`);
  console.log(`Execution Name   : ${executionName}`);
  console.log(`Test Cases       : ${tests.length}`);
  console.log(`Manual Steps     : ${totalSteps}`);
  console.log(`Suites           : ${suites.size}`);
  console.log(`\nOutput:`);
  console.log(`  ${outPath}`);
  console.log(`\nImport command:`);
  console.log(`  curl -X POST \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -u email:api-token \\`);
  console.log(`    "https://your-domain.atlassian.net/rest/raven/1.0/import/test" \\`);
  console.log(`    -d @${outPath}`);
  console.log('\n══════════════════════════════════════════');
}

main().catch(console.error);
