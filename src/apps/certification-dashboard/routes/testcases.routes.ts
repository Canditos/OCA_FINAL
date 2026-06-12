// ══════════════════════════════════════════════════════════════
// Test Cases Routes — Serve test suite catalog to the frontend
// ══════════════════════════════════════════════════════════════

import { Router } from "express";

const router = Router();

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

router.get("/", (_req, res) => {
    res.json(testSuites);
});

router.get("/details", (_req, res) => {
    res.json(testDescriptions);
});

/**
 * Returns all test cases as an array of { id, description, suite } objects.
 * Used by the defect creation route to enrich defect descriptions.
 */
export function getAllTestCases(): Array<{ id: string; description: string; suite: string }> {
    const result: Array<{ id: string; description: string; suite: string }> = [];
    for (const [suite, tests] of Object.entries(testSuites)) {
        for (const id of tests) {
            result.push({ id, description: testDescriptions[id] || "", suite });
        }
    }
    return result;
}

export default router;
