import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Step {
  step: number;
  action: string;
  direction: string;
  ocppMessage: string;
  expectedResult: string;
}

interface TestCaseSteps {
  testId: string;
  title: string;
  suite: string;
  steps: Step[];
}

const OUT_DIR = path.join(__dirname, 'test-steps');

// ==============================
// MAINTENANCE
// ==============================
const maintenance: TestCaseSteps[] = [
  {
    testId: 'tc_bi_restore_configuration', title: 'Maintenance — restore configuration', suite: 'MAINTENANCE',
    steps: [
      { step: 1, action: 'OCTT built-in: restore all configuration keys to factory defaults', direction: 'OCTT → SUT', ocppMessage: 'ChangeConfiguration (bulk restore)', expectedResult: 'Configuration restored to default values' },
      { step: 2, action: 'Verify configuration is restored by reading back key values', direction: 'CSMS → SUT', ocppMessage: 'GetConfiguration', expectedResult: 'Configuration values match factory defaults' },
    ]
  },
  {
    testId: 'tc_bi_stop_transactions', title: 'Maintenance — stop all transactions', suite: 'MAINTENANCE',
    steps: [
      { step: 1, action: 'OCTT built-in: stop all active transactions on the SUT', direction: 'CSMS → SUT', ocppMessage: 'RemoteStopTransaction (for each active tx)', expectedResult: 'All active transactions stopped' },
      { step: 2, action: 'Verify no active transactions remain', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(Available)', expectedResult: 'All connectors return to Available state' },
    ]
  },
  {
    testId: 'tc_bi_clear_cache', title: 'Maintenance — clear cache', suite: 'MAINTENANCE',
    steps: [
      { step: 1, action: 'OCTT built-in: clear the authorization cache on the SUT', direction: 'CSMS → SUT', ocppMessage: 'ClearCache', expectedResult: 'Authorization cache cleared' },
    ]
  },
  {
    testId: 'tc_bi_clear_local_auth_list', title: 'Maintenance — clear local auth list', suite: 'MAINTENANCE',
    steps: [
      { step: 1, action: 'OCTT built-in: clear the local authorization list on the SUT', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(Full, version=0, empty list)', expectedResult: 'Local authorization list cleared' },
    ]
  },
  {
    testId: 'tc_bi_restore_availability', title: 'Maintenance — restore availability', suite: 'MAINTENANCE',
    steps: [
      { step: 1, action: 'OCTT built-in: restore all connectors to Available state', direction: 'CSMS → SUT', ocppMessage: 'ChangeAvailability(Available) for each connector', expectedResult: 'All connectors return to Available state' },
      { step: 2, action: 'Verify connector status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(Available)', expectedResult: 'Status confirmed as Available for each connector' },
    ]
  },
  {
    testId: 'tc_bi_reset_hard', title: 'Maintenance — hard reset', suite: 'MAINTENANCE',
    steps: [
      { step: 1, action: 'OCTT built-in: perform a hard reset on the SUT', direction: 'CSMS → SUT', ocppMessage: 'Reset(Hard)', expectedResult: 'SUT reboots and reconnects' },
      { step: 2, action: 'Wait for SUT to reconnect and register', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'SUT boots and sends BootNotification' },
    ]
  },
];

// ==============================
// ColdBoot
// ==============================
const coldBoot: TestCaseSteps[] = [
  {
    testId: 'TC_001_CS', title: 'Cold Boot Charge Point', suite: 'ColdBoot',
    steps: [
      { step: 1, action: 'Power on / restart the Charge Point', direction: 'Manual', ocppMessage: '-', expectedResult: 'SUT powers on and establishes WebSocket connection to CSMS' },
      { step: 2, action: 'SUT sends BootNotification to register with the Central System', direction: 'SUT → CSMS', ocppMessage: 'BootNotification(chargePointVendor, chargePointModel)', expectedResult: 'BootNotification request sent' },
      { step: 3, action: 'CSMS rejects the first boot with a wait time', direction: 'CSMS → SUT', ocppMessage: 'BootNotification(Rejected, waitTime=60)', expectedResult: 'SUT receives Rejected status with waitTime=60s' },
      { step: 4, action: 'SUT waits for the specified wait time', direction: 'SUT (internal)', ocppMessage: '— wait 60s —', expectedResult: 'SUT waits before retrying' },
      { step: 5, action: 'SUT retries BootNotification after wait time expires', direction: 'SUT → CSMS', ocppMessage: 'BootNotification(chargePointVendor, chargePointModel)', expectedResult: 'BootNotification retry sent' },
      { step: 6, action: 'CSMS accepts the boot and SUT registration completes', direction: 'CSMS → SUT', ocppMessage: 'BootNotification(Accepted, currentTime, interval)', expectedResult: 'Boot accepted; SUT receives current time and heartbeat interval' },
      { step: 7, action: 'SUT reports status for each connector', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available, NoError)', expectedResult: 'All connectors reported as Available' },
    ]
  },
  {
    testId: 'TC_002_CS', title: 'Cold Boot Charge Point - Pending', suite: 'ColdBoot',
    steps: [
      { step: 1, action: 'Power on / restart the Charge Point', direction: 'Manual', ocppMessage: '-', expectedResult: 'SUT powers on and establishes WebSocket connection to CSMS' },
      { step: 2, action: 'SUT sends BootNotification', direction: 'SUT → CSMS', ocppMessage: 'BootNotification(chargePointVendor, chargePointModel)', expectedResult: 'BootNotification request sent' },
      { step: 3, action: 'CSMS rejects with long wait time to keep SUT in pending state', direction: 'CSMS → SUT', ocppMessage: 'BootNotification(Rejected, waitTime=3600)', expectedResult: 'SUT enters pending state with waitTime=3600s' },
      { step: 4, action: 'CSMS sends GetConfiguration while SUT is in pending state', direction: 'CSMS → SUT', ocppMessage: 'GetConfiguration(key=SupportedFeatureProfiles)', expectedResult: 'SUT responds despite being in pending state' },
      { step: 5, action: 'SUT responds to configuration request', direction: 'SUT → CSMS', ocppMessage: 'GetConfiguration.Response(unknownKey=[], configurationKey=[...])', expectedResult: 'SUT returns configuration values while pending' },
      { step: 6, action: 'CSMS sends ChangeConfiguration while SUT is in pending state', direction: 'CSMS → SUT', ocppMessage: 'ChangeConfiguration(key=MeterValueSampleInterval, value=300)', expectedResult: 'SUT accepts configuration change while pending' },
      { step: 7, action: 'SUT responds to configuration change', direction: 'SUT → CSMS', ocppMessage: 'ChangeConfiguration.Response(status=Accepted)', expectedResult: 'SUT accepts ChangeConfiguration in pending state' },
    ]
  },
];

// ==============================
// StartSession
// ==============================
const startSession: TestCaseSteps[] = [
  {
    testId: 'TC_003_CS', title: 'Regular Charging Session - Plugin First', suite: 'StartSession',
    steps: [
      { step: 1, action: 'Ensure SUT is registered and connectors are Available', direction: 'Pre-condition', ocppMessage: 'StatusNotification(Available)', expectedResult: 'SUT is ready for charging session' },
      { step: 2, action: 'EV driver plugs cable into the connector', direction: 'EV', ocppMessage: '-', expectedResult: 'Connector mechanically plugged in' },
      { step: 3, action: 'SUT detects plug event and updates connector status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Preparing)', expectedResult: 'Status transitions to Preparing' },
      { step: 4, action: 'EV driver presents RFID/IdTag for authorization', direction: 'EV', ocppMessage: '-', expectedResult: 'IdTag presented to SUT' },
      { step: 5, action: 'SUT sends Authorize request to CSMS', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag)', expectedResult: 'Authorize request sent with the presented IdTag' },
      { step: 6, action: 'CSMS authorizes the IdTag', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted, parentIdTag)', expectedResult: 'IdTag authorized; SUT may proceed' },
      { step: 7, action: 'SUT locks the connector (if applicable) and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'StartTransaction request sent with initial meter value' },
      { step: 8, action: 'CSMS accepts the transaction', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction started; SUT receives transactionId' },
      { step: 9, action: 'SUT updates connector status to Charging', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Charging)', expectedResult: 'Connector status set to Charging' },
      { step: 10, action: 'Energy transfer begins (EV simulated charging)', direction: 'SUT', ocppMessage: '-', expectedResult: 'Charging in progress' },
    ]
  },
  {
    testId: 'TC_004_1_CS', title: 'Regular Charging Session - Identification First', suite: 'StartSession',
    steps: [
      { step: 1, action: 'Ensure SUT is registered and connectors are Available', direction: 'Pre-condition', ocppMessage: 'StatusNotification(Available)', expectedResult: 'SUT is ready' },
      { step: 2, action: 'EV driver presents RFID/IdTag for authorization first (before plugging)', direction: 'EV', ocppMessage: '-', expectedResult: 'IdTag presented to SUT' },
      { step: 3, action: 'SUT sends Authorize request', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag)', expectedResult: 'Authorize request sent' },
      { step: 4, action: 'CSMS authorizes the IdTag', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted)', expectedResult: 'IdTag authorized' },
      { step: 5, action: 'EV driver plugs cable into the connector', direction: 'EV', ocppMessage: '-', expectedResult: 'Connector plugged in after authorization' },
      { step: 6, action: 'SUT detects plug event and updates status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Preparing)', expectedResult: 'Status transitions to Preparing' },
      { step: 7, action: 'SUT locks connector and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'StartTransaction request sent' },
      { step: 8, action: 'CSMS accepts the transaction', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction started' },
      { step: 9, action: 'SUT updates connector status to Charging', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Charging)', expectedResult: 'Connector status set to Charging' },
    ]
  },
  {
    testId: 'TC_004_2_CS', title: 'Regular Charging Session - Identification First - ConnectionTimeOut', suite: 'StartSession',
    steps: [
      { step: 1, action: 'EV driver presents IdTag (identification first)', direction: 'EV', ocppMessage: '-', expectedResult: 'IdTag presented' },
      { step: 2, action: 'SUT sends Authorize', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag)', expectedResult: 'Authorize request sent' },
      { step: 3, action: 'CSMS authorizes the IdTag', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted)', expectedResult: 'IdTag authorized' },
      { step: 4, action: 'EV driver does NOT plug the cable within ConnectionTimeOut period', direction: 'EV (timeout)', ocppMessage: '— wait for ConnectionTimeOut —', expectedResult: 'ConnectionTimeOut expires' },
      { step: 5, action: 'SUT aborts the pending session and returns connector to Available', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connector returns to Available after timeout' },
    ]
  },
];

// ==============================
// StopSession
// ==============================
const stopSession: TestCaseSteps[] = [
  {
    testId: 'TC_005_1_CS', title: 'EV Side Disconnected - StopTxnOnEVSideDisconnect=true - UnlockConnectorOnEVSideDisconnect=true', suite: 'StopSession',
    steps: [
      { step: 1, action: 'Start a regular charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction is active on connector' },
      { step: 2, action: 'EV driver disconnects the cable from the EV side', direction: 'EV', ocppMessage: '-', expectedResult: 'Cable disconnected at EV side' },
      { step: 3, action: 'SUT detects EV disconnection and stops the transaction', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=EVDisconnected, meterStop)', expectedResult: 'Transaction stopped with reason EVDisconnected' },
      { step: 4, action: 'CSMS confirms the stop', direction: 'CSMS → SUT', ocppMessage: 'StopTransaction.Response(idTagInfo=Accepted)', expectedResult: 'Stop acknowledged' },
      { step: 5, action: 'SUT unlocks the connector (UnlockConnectorOnEVSideDisconnect=true)', direction: 'SUT', ocppMessage: '— connector unlocks —', expectedResult: 'Connector unlocked' },
      { step: 6, action: 'SUT updates connector status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connector returns to Available' },
    ]
  },
  {
    testId: 'TC_005_2_CS', title: 'EV Side Disconnected - StopTxnOnEVSideDisconnect=true - UnlockConnectorOnEVSideDisconnect=false', suite: 'StopSession',
    steps: [
      { step: 1, action: 'Start a regular charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'EV driver disconnects the cable from the EV side', direction: 'EV', ocppMessage: '-', expectedResult: 'Cable disconnected at EV side' },
      { step: 3, action: 'SUT detects EV disconnection and stops the transaction', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=EVDisconnected, meterStop)', expectedResult: 'Transaction stopped' },
      { step: 4, action: 'CSMS confirms the stop', direction: 'CSMS → SUT', ocppMessage: 'StopTransaction.Response(idTagInfo=Accepted)', expectedResult: 'Stop acknowledged' },
      { step: 5, action: 'SUT does NOT unlock the connector (UnlockConnectorOnEVSideDisconnect=false)', direction: 'SUT', ocppMessage: '— connector stays locked —', expectedResult: 'Connector remains locked' },
      { step: 6, action: 'SUT updates connector status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connector Available but still locked' },
    ]
  },
  {
    testId: 'TC_005_3_CS', title: 'EV Side Disconnected - StopTxnOnEVSideDisconnect=false - UnlockConnectorOnEVSideDisconnect=false', suite: 'StopSession',
    steps: [
      { step: 1, action: 'Start a regular charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'EV driver disconnects the cable from the EV side', direction: 'EV', ocppMessage: '-', expectedResult: 'Cable disconnected at EV side' },
      { step: 3, action: 'SUT detects EV disconnection but does NOT stop transaction', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, SuspendedEV)', expectedResult: 'Transaction continues; status set to SuspendedEV' },
      { step: 4, action: 'SUT keeps connector locked (no unlock)', direction: 'SUT', ocppMessage: '— connector stays locked —', expectedResult: 'Connector remains locked, transaction still active' },
    ]
  },
  {
    testId: 'TC_068_CS', title: 'Stop transaction - Same idTag', suite: 'StopSession',
    steps: [
      { step: 1, action: 'Start a charging session with a specific idTag', direction: 'Pre-condition', ocppMessage: 'Authorize(idTag) + StartTransaction(idTag)', expectedResult: 'Transaction active with given idTag' },
      { step: 2, action: 'EV driver presents the SAME idTag to stop the transaction', direction: 'EV', ocppMessage: '-', expectedResult: 'Same idTag presented' },
      { step: 3, action: 'SUT sends Authorize with the same idTag', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag)', expectedResult: 'Authorize request sent' },
      { step: 4, action: 'CSMS authorizes', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted)', expectedResult: 'Authorized' },
      { step: 5, action: 'SUT stops the transaction because idTag matches', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, idTag, meterStop)', expectedResult: 'Transaction stopped using same idTag' },
      { step: 6, action: 'CSMS confirms', direction: 'CSMS → SUT', ocppMessage: 'StopTransaction.Response(idTagInfo=Accepted)', expectedResult: 'Stop acknowledged' },
    ]
  },
  {
    testId: 'TC_069_CS', title: 'Stop transaction - Same ParentIdTag', suite: 'StopSession',
    steps: [
      { step: 1, action: 'Start a charging session with idTag that has a parentIdTag', direction: 'Pre-condition', ocppMessage: 'Authorize(idTag1, parentIdTag) + StartTransaction', expectedResult: 'Transaction active with parentIdTag linked' },
      { step: 2, action: 'EV driver presents a DIFFERENT idTag (idTag2) that shares the same parentIdTag', direction: 'EV', ocppMessage: '-', expectedResult: 'Different idTag with same parentIdTag presented' },
      { step: 3, action: 'SUT sends Authorize with idTag2', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag2)', expectedResult: 'Authorize request sent' },
      { step: 4, action: 'CSMS authorizes (parentIdTag links to active transaction)', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted, parentIdTag)', expectedResult: 'Authorized with parentIdTag' },
      { step: 5, action: 'SUT stops the transaction because parentIdTag matches', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, idTag2, meterStop)', expectedResult: 'Transaction stopped using different idTag with same parentIdTag' },
    ]
  },
];

// ==============================
// Cache
// ==============================
const cache: TestCaseSteps[] = [
  {
    testId: 'TC_007_1_CS', title: 'Regular Start - Cached Id', suite: 'Cache',
    steps: [
      { step: 1, action: 'Perform a successful charging session to populate the authorization cache', direction: 'Pre-condition', ocppMessage: 'Authorize + StartTransaction + StopTransaction', expectedResult: 'IdTag is now cached on SUT' },
      { step: 2, action: 'EV driver presents the same cached IdTag at another connector', direction: 'EV', ocppMessage: '-', expectedResult: 'Cached IdTag presented' },
      { step: 3, action: 'SUT uses cached authorization (no Authorize request sent to CSMS)', direction: 'SUT (internal)', ocppMessage: '— cache lookup —', expectedResult: 'SUT authorizes locally from cache' },
      { step: 4, action: 'SUT starts transaction using the cached IdTag', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'StartTransaction sent without prior Authorize' },
      { step: 5, action: 'CSMS accepts the transaction', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction started from cached authorization' },
    ]
  },
  {
    testId: 'TC_007_2_CS', title: 'Remote Start - Cached Id', suite: 'Cache',
    steps: [
      { step: 1, action: 'Populate the authorization cache on SUT (prior successful auth)', direction: 'Pre-condition', ocppMessage: 'Authorize(accepted)', expectedResult: 'IdTag is cached' },
      { step: 2, action: 'CSMS sends RemoteStartTransaction with a cached IdTag', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start request sent with cached IdTag' },
      { step: 3, action: 'SUT uses cached authorization (no Authorize to CSMS)', direction: 'SUT (internal)', ocppMessage: '— cache lookup —', expectedResult: 'SUT authorizes locally' },
      { step: 4, action: 'SUT locks connector and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'Transaction started' },
      { step: 5, action: 'CSMS accepts', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction active' },
    ]
  },
  {
    testId: 'TC_061_1_CS', title: 'Clear Cache - Local', suite: 'Cache',
    steps: [
      { step: 1, action: 'Populate the authorization cache with an authorized IdTag', direction: 'Pre-condition', ocppMessage: 'Authorize(accepted)', expectedResult: 'IdTag cached' },
      { step: 2, action: 'CSMS sends ClearCache request', direction: 'CSMS → SUT', ocppMessage: 'ClearCache', expectedResult: 'ClearCache request sent' },
      { step: 3, action: 'SUT clears its authorization cache', direction: 'SUT → CSMS', ocppMessage: 'ClearCache.Response(status=Accepted)', expectedResult: 'Cache cleared' },
      { step: 4, action: 'EV driver presents the previously cached IdTag (local start)', direction: 'EV', ocppMessage: '-', expectedResult: 'Previously cached IdTag presented' },
      { step: 5, action: 'SUT does NOT find IdTag in cache, sends Authorize to CSMS', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag)', expectedResult: 'Authorize sent because cache was cleared' },
      { step: 6, action: 'CSMS authorizes', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted)', expectedResult: 'Authorized via CSMS (not cache)' },
    ]
  },
  {
    testId: 'TC_061_2_CS', title: 'Clear Cache - Remote', suite: 'Cache',
    steps: [
      { step: 1, action: 'Populate the authorization cache with an authorized IdTag', direction: 'Pre-condition', ocppMessage: 'Authorize(accepted)', expectedResult: 'IdTag cached' },
      { step: 2, action: 'CSMS sends ClearCache', direction: 'CSMS → SUT', ocppMessage: 'ClearCache', expectedResult: 'ClearCache sent' },
      { step: 3, action: 'SUT clears cache', direction: 'SUT → CSMS', ocppMessage: 'ClearCache.Response(status=Accepted)', expectedResult: 'Cache cleared' },
      { step: 4, action: 'CSMS sends RemoteStartTransaction with the previously cached IdTag', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start with previously cached IdTag' },
      { step: 5, action: 'SUT does NOT find IdTag in cache, sends Authorize', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag)', expectedResult: 'Authorize sent because cache was cleared' },
      { step: 6, action: 'CSMS authorizes and transaction proceeds', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted)', expectedResult: 'Authorized and transaction started' },
    ]
  },
];

// ==============================
// RemoteActions
// ==============================
const remoteActions: TestCaseSteps[] = [
  {
    testId: 'TC_010_CS', title: 'Remote Start - Cable Plugged First', suite: 'RemoteActions',
    steps: [
      { step: 1, action: 'Check configuration: AuthorizeRemoteTxRequests', direction: 'CSMS → SUT', ocppMessage: 'GetConfiguration(key=AuthorizeRemoteTxRequests)', expectedResult: 'Configuration value retrieved' },
      { step: 2, action: 'EV driver plugs cable into the connector', direction: 'EV', ocppMessage: '-', expectedResult: 'Cable plugged in' },
      { step: 3, action: 'SUT reports Preparing status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Preparing)', expectedResult: 'Status set to Preparing' },
      { step: 4, action: 'CSMS sends RemoteStartTransaction', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start request sent' },
      { step: 5, action: 'SUT authorizes the IdTag', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag)', expectedResult: 'Authorize sent if AuthorizeRemoteTxRequests=true' },
      { step: 6, action: 'CSMS authorizes', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted)', expectedResult: 'IdTag authorized' },
      { step: 7, action: 'SUT locks connector and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'Transaction started' },
      { step: 8, action: 'CSMS accepts', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction active' },
    ]
  },
  {
    testId: 'TC_011_1_CS', title: 'Remote Start - Remote Start First', suite: 'RemoteActions',
    steps: [
      { step: 1, action: 'CSMS sends RemoteStartTransaction before cable is plugged', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start request sent before plugin' },
      { step: 2, action: 'SUT may send Authorize or wait for cable', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag) [optional]', expectedResult: 'SUT handles remote start request' },
      { step: 3, action: 'EV driver plugs cable into the connector', direction: 'EV', ocppMessage: '-', expectedResult: 'Cable plugged in after remote start' },
      { step: 4, action: 'SUT detects plug and sets Preparing status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Preparing)', expectedResult: 'Status set to Preparing' },
      { step: 5, action: 'SUT locks connector and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'Transaction started' },
      { step: 6, action: 'CSMS accepts', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction active' },
    ]
  },
  {
    testId: 'TC_011_2_CS', title: 'Remote Start - Time Out', suite: 'RemoteActions',
    steps: [
      { step: 1, action: 'CSMS sends RemoteStartTransaction', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start sent' },
      { step: 2, action: 'EV driver does NOT plug the cable within the connection timeout', direction: 'EV (timeout)', ocppMessage: '— wait for ConnectionTimeOut —', expectedResult: 'ConnectionTimeOut expires' },
      { step: 3, action: 'SUT aborts the pending start and returns connector to Available', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connector returns to Available after timeout' },
    ]
  },
  {
    testId: 'TC_012_CS', title: 'Remote Stop Charging Session', suite: 'RemoteActions',
    steps: [
      { step: 1, action: 'Start a regular charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active with known transactionId' },
      { step: 2, action: 'CSMS sends RemoteStopTransaction', direction: 'CSMS → SUT', ocppMessage: 'RemoteStopTransaction(transactionId)', expectedResult: 'Remote stop request sent' },
      { step: 3, action: 'SUT stops the energy transfer and unlocks connector', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=Remote, meterStop)', expectedResult: 'Transaction stopped with reason Remote' },
      { step: 4, action: 'CSMS confirms', direction: 'CSMS → SUT', ocppMessage: 'StopTransaction.Response(idTagInfo=Accepted)', expectedResult: 'Stop acknowledged' },
      { step: 5, action: 'SUT updates connector status to Available', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connector available' },
    ]
  },
];

// ==============================
// Resetting
// ==============================
const resetting: TestCaseSteps[] = [
  {
    testId: 'TC_013_CS', title: 'Hard Reset Without Transaction', suite: 'Resetting',
    steps: [
      { step: 1, action: 'Set connector to Inoperative via ChangeAvailability', direction: 'CSMS → SUT', ocppMessage: 'ChangeAvailability(connectorId, Inoperative)', expectedResult: 'Connector set to Inoperative' },
      { step: 2, action: 'SUT confirms the availability change', direction: 'SUT → CSMS', ocppMessage: 'ChangeAvailability.Response(status=Accepted/Scheduled)', expectedResult: 'Change accepted' },
      { step: 3, action: 'SUT reports Inoperative status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Inoperative)', expectedResult: 'Status Inoperative' },
      { step: 4, action: 'CSMS sends Reset(Hard)', direction: 'CSMS → SUT', ocppMessage: 'Reset(Hard)', expectedResult: 'Hard reset request sent' },
      { step: 5, action: 'SUT acknowledges reset', direction: 'SUT → CSMS', ocppMessage: 'Reset.Response(status=Accepted)', expectedResult: 'Reset accepted' },
      { step: 6, action: 'SUT reboots', direction: 'SUT (reboot)', ocppMessage: '— SUT powers off and on —', expectedResult: 'SUT reboots' },
      { step: 7, action: 'SUT reconnects and sends BootNotification', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'SUT registers after reboot' },
      { step: 8, action: 'CSMS accepts boot', direction: 'CSMS → SUT', ocppMessage: 'BootNotification(Accepted)', expectedResult: 'Boot accepted' },
      { step: 9, action: 'SUT reports connector status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connectors available after reboot' },
    ]
  },
  {
    testId: 'TC_014_CS', title: 'Soft Reset Without Transaction', suite: 'Resetting',
    steps: [
      { step: 1, action: 'Set connector to Inoperative', direction: 'CSMS → SUT', ocppMessage: 'ChangeAvailability(connectorId, Inoperative)', expectedResult: 'Connector Inoperative' },
      { step: 2, action: 'SUT confirms', direction: 'SUT → CSMS', ocppMessage: 'ChangeAvailability.Response(Accepted)', expectedResult: 'Change accepted' },
      { step: 3, action: 'SUT reports Inoperative', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(Inoperative)', expectedResult: 'Status Inoperative' },
      { step: 4, action: 'CSMS sends Reset(Soft)', direction: 'CSMS → SUT', ocppMessage: 'Reset(Soft)', expectedResult: 'Soft reset request sent' },
      { step: 5, action: 'SUT acknowledges', direction: 'SUT → CSMS', ocppMessage: 'Reset.Response(status=Accepted)', expectedResult: 'Reset accepted' },
      { step: 6, action: 'SUT performs soft reboot', direction: 'SUT (reboot)', ocppMessage: '— SUT reboots —', expectedResult: 'SUT reboots' },
      { step: 7, action: 'SUT reconnects and sends BootNotification', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'SUT re-registers after soft reset' },
    ]
  },
  {
    testId: 'TC_015_CS', title: 'Hard Reset With Transaction', suite: 'Resetting',
    steps: [
      { step: 1, action: 'Start a regular charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'CSMS sends Reset(Hard)', direction: 'CSMS → SUT', ocppMessage: 'Reset(Hard)', expectedResult: 'Hard reset sent during transaction' },
      { step: 3, action: 'SUT acknowledges reset', direction: 'SUT → CSMS', ocppMessage: 'Reset.Response(status=Accepted)', expectedResult: 'Reset accepted' },
      { step: 4, action: 'SUT stops the active transaction due to reset', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=HardReset, meterStop)', expectedResult: 'Transaction stopped with reason HardReset' },
      { step: 5, action: 'SUT reboots', direction: 'SUT (reboot)', ocppMessage: '— SUT reboots —', expectedResult: 'SUT reboots' },
      { step: 6, action: 'SUT reconnects and sends BootNotification', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'Boot after hard reset' },
      { step: 7, action: 'CSMS accepts', direction: 'CSMS → SUT', ocppMessage: 'BootNotification(Accepted)', expectedResult: 'Boot accepted' },
    ]
  },
  {
    testId: 'TC_016_CS', title: 'Soft Reset With Transaction', suite: 'Resetting',
    steps: [
      { step: 1, action: 'Start a charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'CSMS sends Reset(Soft)', direction: 'CSMS → SUT', ocppMessage: 'Reset(Soft)', expectedResult: 'Soft reset sent during transaction' },
      { step: 3, action: 'SUT acknowledges', direction: 'SUT → CSMS', ocppMessage: 'Reset.Response(status=Accepted)', expectedResult: 'Reset accepted' },
      { step: 4, action: 'SUT stops the active transaction', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=SoftReset, meterStop)', expectedResult: 'Transaction stopped with reason SoftReset' },
      { step: 5, action: 'SUT reboots', direction: 'SUT (reboot)', ocppMessage: '— SUT reboots —', expectedResult: 'SUT performs soft reset' },
      { step: 6, action: 'SUT reconnects and sends BootNotification', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'Boot after soft reset' },
    ]
  },
];

// ==============================
// Unlocking
// ==============================
const unlocking: TestCaseSteps[] = [
  {
    testId: 'TC_017_1_CS', title: 'Unlock - No Session (Not Fixed Cable)', suite: 'Unlocking',
    steps: [
      { step: 1, action: 'Ensure no transaction active and cable is NOT fixed (detachable)', direction: 'Pre-condition', ocppMessage: '-', expectedResult: 'No session, non-fixed cable' },
      { step: 2, action: 'CSMS sends UnlockConnector', direction: 'CSMS → SUT', ocppMessage: 'UnlockConnector(connectorId)', expectedResult: 'Unlock request sent' },
      { step: 3, action: 'SUT unlocks the connector (mechanical lock release)', direction: 'SUT', ocppMessage: '-', expectedResult: 'Connector unlocked' },
      { step: 4, action: 'SUT responds with Unlocked status', direction: 'SUT → CSMS', ocppMessage: 'UnlockConnector.Response(status=Unlocked)', expectedResult: 'Unlock successful' },
    ]
  },
  {
    testId: 'TC_017_2_CS', title: 'Unlock - No Session (Fixed Cable)', suite: 'Unlocking',
    steps: [
      { step: 1, action: 'Ensure no transaction active and cable IS fixed (permanently attached)', direction: 'Pre-condition', ocppMessage: '-', expectedResult: 'No session, fixed cable' },
      { step: 2, action: 'CSMS sends UnlockConnector', direction: 'CSMS → SUT', ocppMessage: 'UnlockConnector(connectorId)', expectedResult: 'Unlock request sent' },
      { step: 3, action: 'SUT responds that unlock is not supported on fixed cable', direction: 'SUT → CSMS', ocppMessage: 'UnlockConnector.Response(status=NotSupported)', expectedResult: 'Unlock NotSupported for fixed cable' },
    ]
  },
  {
    testId: 'TC_018_1_CS', title: 'Unlock - With Session (Not Fixed Cable)', suite: 'Unlocking',
    steps: [
      { step: 1, action: 'Start a charging session with non-fixed cable', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active, non-fixed cable' },
      { step: 2, action: 'CSMS sends UnlockConnector', direction: 'CSMS → SUT', ocppMessage: 'UnlockConnector(connectorId)', expectedResult: 'Unlock request sent during active transaction' },
      { step: 3, action: 'SUT stops the transaction first', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=UnlockCommand, meterStop)', expectedResult: 'Transaction stopped due to unlock command' },
      { step: 4, action: 'SUT unlocks the connector', direction: 'SUT', ocppMessage: '-', expectedResult: 'Connector unlocked' },
      { step: 5, action: 'SUT responds with Unlocked status', direction: 'SUT → CSMS', ocppMessage: 'UnlockConnector.Response(status=Unlocked)', expectedResult: 'Unlock successful after stopping transaction' },
    ]
  },
  {
    testId: 'TC_018_2_CS', title: 'Unlock - With Session (Fixed Cable)', suite: 'Unlocking',
    steps: [
      { step: 1, action: 'Start a charging session with fixed cable', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active, fixed cable' },
      { step: 2, action: 'CSMS sends UnlockConnector', direction: 'CSMS → SUT', ocppMessage: 'UnlockConnector(connectorId)', expectedResult: 'Unlock request sent during active transaction' },
      { step: 3, action: 'SUT responds NotSupported (fixed cable cannot unlock)', direction: 'SUT → CSMS', ocppMessage: 'UnlockConnector.Response(status=NotSupported)', expectedResult: 'Unlock NotSupported (fixed cable)' },
    ]
  },
];

// ==============================
// Configuration
// ==============================
const configuration: TestCaseSteps[] = [
  {
    testId: 'TC_019_CS', title: 'Retrieve Configuration', suite: 'Configuration',
    steps: [
      { step: 1, action: 'CSMS sends GetConfiguration for specific key', direction: 'CSMS → SUT', ocppMessage: 'GetConfiguration(key=SupportedFeatureProfiles)', expectedResult: 'Request for specific configuration key' },
      { step: 2, action: 'SUT returns the requested configuration key value', direction: 'SUT → CSMS', ocppMessage: 'GetConfiguration.Response(configurationKey=[{key,value,readonly}])', expectedResult: 'Configuration key value returned' },
      { step: 3, action: 'CSMS sends GetConfiguration with empty key list (all keys)', direction: 'CSMS → SUT', ocppMessage: 'GetConfiguration(key=[])', expectedResult: 'Request for all configuration keys' },
      { step: 4, action: 'SUT returns all supported configuration keys', direction: 'SUT → CSMS', ocppMessage: 'GetConfiguration.Response(configurationKey=[...])', expectedResult: 'All configuration keys returned' },
    ]
  },
  {
    testId: 'TC_021_CS', title: 'Change/Set Configuration', suite: 'Configuration',
    steps: [
      { step: 1, action: 'CSMS sends ChangeConfiguration to set a writable key', direction: 'CSMS → SUT', ocppMessage: 'ChangeConfiguration(key=MeterValueSampleInterval, value=300)', expectedResult: 'Configuration change request sent' },
      { step: 2, action: 'SUT accepts the configuration change', direction: 'SUT → CSMS', ocppMessage: 'ChangeConfiguration.Response(status=Accepted)', expectedResult: 'Configuration change accepted' },
      { step: 3, action: 'Verify the new value by reading it back', direction: 'CSMS → SUT', ocppMessage: 'GetConfiguration(key=MeterValueSampleInterval)', expectedResult: 'Request to verify change' },
      { step: 4, action: 'SUT returns the updated value', direction: 'SUT → CSMS', ocppMessage: 'GetConfiguration.Response(configurationKey=[{value=300}])', expectedResult: 'Changed value confirmed: MeterValueSampleInterval=300' },
    ]
  },
];

// ==============================
// MeterValues
// ==============================
const meterValues: TestCaseSteps[] = [
  {
    testId: 'TC_070_CS', title: 'Sampled Meter Values', suite: 'MeterValues',
    steps: [
      { step: 1, action: 'Configure MeterValueSampleInterval (e.g. 60s)', direction: 'Pre-condition', ocppMessage: 'ChangeConfiguration(MeterValueSampleInterval, 60)', expectedResult: 'Sampling interval configured' },
      { step: 2, action: 'Start a charging session', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 3, action: 'SUT sends sampled meter values at configured interval during charging', direction: 'SUT → CSMS', ocppMessage: 'MeterValues(connectorId, transactionId, context=Sample.Periodic, measurand[]=Energy.Active.Import.Register)', expectedResult: 'Sampled meter values received periodically' },
      { step: 4, action: 'Verify meter values contain valid measurands (energy, power, etc.)', direction: 'CSMS (verify)', ocppMessage: '— verify —', expectedResult: 'Meter values contain valid measurands with correct units and values' },
    ]
  },
  {
    testId: 'TC_071_CS', title: 'Clock-aligned Meter Values', suite: 'MeterValues',
    steps: [
      { step: 1, action: 'Configure ClockAlignedDataInterval (e.g. 900s)', direction: 'Pre-condition', ocppMessage: 'ChangeConfiguration(ClockAlignedDataInterval, 900)', expectedResult: 'Clock-aligned interval configured' },
      { step: 2, action: 'Start a charging session', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 3, action: 'SUT sends clock-aligned meter values at each 15-min boundary', direction: 'SUT → CSMS', ocppMessage: 'MeterValues(connectorId, transactionId, context=Sample.Clock, measurand[]=Energy.Active.Import.Register)', expectedResult: 'Clock-aligned meter values received at expected intervals' },
      { step: 4, action: 'Verify meter values align to clock boundaries', direction: 'CSMS (verify)', ocppMessage: '— verify —', expectedResult: 'Timestamps are aligned to 15-min clock boundaries' },
    ]
  },
];

// ==============================
// BasicActions
// ==============================
const basicActions: TestCaseSteps[] = [
  {
    testId: 'TC_023_4_CS', title: 'Start Local - Authorize Invalid', suite: 'BasicActions',
    steps: [
      { step: 1, action: 'EV driver plugs cable and presents an invalid/unknown IdTag', direction: 'EV', ocppMessage: '-', expectedResult: 'Invalid IdTag presented' },
      { step: 2, action: 'SUT sends Authorize with the invalid IdTag', direction: 'SUT → CSMS', ocppMessage: 'Authorize(invalidIdTag)', expectedResult: 'Authorize sent with invalid IdTag' },
      { step: 3, action: 'CSMS rejects the authorization', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Invalid)', expectedResult: 'Authorization rejected' },
      { step: 4, action: 'SUT informs user and does NOT start transaction', direction: 'SUT', ocppMessage: '-', expectedResult: 'Transaction NOT started; user notified of invalid IdTag' },
    ]
  },
  {
    testId: 'TC_023_5_CS', title: 'Start Remote - Authorize Invalid', suite: 'BasicActions',
    steps: [
      { step: 1, action: 'CSMS sends RemoteStartTransaction with an invalid IdTag', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, invalidIdTag)', expectedResult: 'Remote start with invalid IdTag' },
      { step: 2, action: 'SUT sends Authorize with the invalid IdTag', direction: 'SUT → CSMS', ocppMessage: 'Authorize(invalidIdTag)', expectedResult: 'Authorize sent with invalid IdTag' },
      { step: 3, action: 'CSMS rejects authorization', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Invalid)', expectedResult: 'Authorization rejected' },
      { step: 4, action: 'SUT does NOT start transaction', direction: 'SUT', ocppMessage: '-', expectedResult: 'No transaction started; connector remains Available' },
    ]
  },
  {
    testId: 'TC_024_CS', title: 'Start - Lock Failure', suite: 'BasicActions',
    steps: [
      { step: 1, action: 'EV driver plugs cable and presents valid IdTag', direction: 'EV', ocppMessage: '-', expectedResult: 'Valid IdTag presented' },
      { step: 2, action: 'SUT sends Authorize (valid IdTag)', direction: 'SUT → CSMS', ocppMessage: 'Authorize(validIdTag)', expectedResult: 'Authorize sent' },
      { step: 3, action: 'CSMS authorizes', direction: 'CSMS → SUT', ocppMessage: 'Authorize(Accepted)', expectedResult: 'IdTag authorized' },
      { step: 4, action: 'SUT attempts to lock connector but lock mechanism fails', direction: 'SUT (hardware)', ocppMessage: '-', expectedResult: 'Connector lock failure' },
      { step: 5, action: 'SUT reports lock failure and sets connector to Faulted', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Faulted, errorCode=ConnectorLockFailure)', expectedResult: 'Connector status set to Faulted with ConnectorLockFailure' },
    ]
  },
];

// ==============================
// RemoteActionsNonHappy
// ==============================
const remoteActionsNonHappy: TestCaseSteps[] = [
  {
    testId: 'TC_026_CS', title: 'Remote Start - Rejected', suite: 'RemoteActionsNonHappy',
    steps: [
      { step: 1, action: 'Start a charging session (connector already occupied)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Connector occupied with active transaction' },
      { step: 2, action: 'CSMS sends RemoteStartTransaction to the same (already occupied) connector', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start request on occupied connector' },
      { step: 3, action: 'SUT rejects the remote start because connector is occupied', direction: 'SUT → CSMS', ocppMessage: 'RemoteStartTransaction.Response(status=Rejected)', expectedResult: 'Remote start rejected (connector occupied)' },
    ]
  },
  {
    testId: 'TC_027_CS', title: 'Remote Start - ConnectorId=0', suite: 'RemoteActionsNonHappy',
    steps: [
      { step: 1, action: 'CSMS sends RemoteStartTransaction with connectorId=0 (reserved)', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId=0, idTag)', expectedResult: 'Remote start with connectorId=0 sent' },
      { step: 2, action: 'SUT responds with Rejected (connectorId=0 is not valid for start)', direction: 'SUT → CSMS', ocppMessage: 'RemoteStartTransaction.Response(status=Rejected)', expectedResult: 'Remote start rejected for connectorId=0' },
    ]
  },
  {
    testId: 'TC_028_CS', title: 'Remote Stop - Rejected', suite: 'RemoteActionsNonHappy',
    steps: [
      { step: 1, action: 'CSMS sends RemoteStopTransaction with an unknown/non-existent transactionId', direction: 'CSMS → SUT', ocppMessage: 'RemoteStopTransaction(transactionId=0)', expectedResult: 'Remote stop with unknown transactionId' },
      { step: 2, action: 'SUT rejects because transactionId does not exist', direction: 'SUT → CSMS', ocppMessage: 'RemoteStopTransaction.Response(status=Rejected)', expectedResult: 'Remote stop rejected (unknown transaction)' },
    ]
  },
];

// ==============================
// UnlockingNonHappy
// ==============================
const unlockingNonHappy: TestCaseSteps[] = [
  {
    testId: 'TC_030_CS', title: 'Unlock - Unlock Failure', suite: 'UnlockingNonHappy',
    steps: [
      { step: 1, action: 'CSMS sends UnlockConnector', direction: 'CSMS → SUT', ocppMessage: 'UnlockConnector(connectorId)', expectedResult: 'Unlock request sent' },
      { step: 2, action: 'SUT attempts to unlock but lock mechanism fails', direction: 'SUT (hardware)', ocppMessage: '— lock failure —', expectedResult: 'Unlock mechanism fails' },
      { step: 3, action: 'SUT responds with UnlockFailed status', direction: 'SUT → CSMS', ocppMessage: 'UnlockConnector.Response(status=UnlockFailed)', expectedResult: 'Unlock failed reported' },
    ]
  },
  {
    testId: 'TC_031_CS', title: 'Unlock - Unknown Connector', suite: 'UnlockingNonHappy',
    steps: [
      { step: 1, action: 'CSMS sends UnlockConnector with non-existent connectorId', direction: 'CSMS → SUT', ocppMessage: 'UnlockConnector(connectorId=999)', expectedResult: 'Unlock request for unknown connector' },
      { step: 2, action: 'SUT rejects because connectorId does not exist', direction: 'SUT → CSMS', ocppMessage: 'UnlockConnector.Response(status=NotSupported)', expectedResult: 'Unlock rejected (unknown connector)' },
    ]
  },
];

// ==============================
// PowerFailure
// ==============================
const powerFailure: TestCaseSteps[] = [
  {
    testId: 'TC_032_1_CS', title: 'Power Failure - Stop Before Down', suite: 'PowerFailure',
    steps: [
      { step: 1, action: 'Start a charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'Simulate power failure with backup power available', direction: 'SUT (power)', ocppMessage: '— power loss —', expectedResult: 'SUT detects impending power loss, backup power active' },
      { step: 3, action: 'SUT stops transaction before going down (backup power allows orderly shutdown)', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=PowerLoss, meterStop)', expectedResult: 'Transaction stopped with reason PowerLoss before shutdown' },
      { step: 4, action: 'SUT powers off', direction: 'SUT (power off)', ocppMessage: '— SUT off —', expectedResult: 'SUT shuts down' },
      { step: 5, action: 'Power restored: SUT boots and reconnects', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'SUT reboots after power restoration' },
    ]
  },
  {
    testId: 'TC_032_2_CS', title: 'Power Failure - Stop After Down', suite: 'PowerFailure',
    steps: [
      { step: 1, action: 'Start a charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'Simulate sudden power failure WITHOUT backup power', direction: 'SUT (power)', ocppMessage: '— sudden power loss —', expectedResult: 'SUT loses power immediately' },
      { step: 3, action: 'SUT goes off without sending StopTransaction', direction: 'SUT (power off)', ocppMessage: '— SUT off —', expectedResult: 'SUT shuts down abruptly' },
      { step: 4, action: 'Power restored: SUT boots and reconnects', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'SUT reboots after power restoration' },
      { step: 5, action: 'SUT sends StopTransaction for the interrupted transaction (from non-volatile memory)', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=PowerLoss, meterStop)', expectedResult: 'Transaction stopped after reboot with reason PowerLoss' },
    ]
  },
  {
    testId: 'TC_034_CS', title: 'Power Failure - Unavailable Status', suite: 'PowerFailure',
    steps: [
      { step: 1, action: 'Set connector to Unavailable via ChangeAvailability', direction: 'CSMS → SUT', ocppMessage: 'ChangeAvailability(connectorId, Inoperative)', expectedResult: 'Connector set Inoperative' },
      { step: 2, action: 'SUT confirms', direction: 'SUT → CSMS', ocppMessage: 'ChangeAvailability.Response(Accepted)', expectedResult: 'Change accepted' },
      { step: 3, action: 'SUT reports Unavailable', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Unavailable)', expectedResult: 'Status Unavailable' },
      { step: 4, action: 'Simulate power cycle (power off then on)', direction: 'SUT (power)', ocppMessage: '— power cycle —', expectedResult: 'SUT powers off and on' },
      { step: 5, action: 'SUT boots and sends BootNotification', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'SUT reconnects after power cycle' },
      { step: 6, action: 'Verify connector status persists as Unavailable after reboot', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Unavailable)', expectedResult: 'Unavailable status persists across power cycle' },
    ]
  },
];

// ==============================
// OfflineBehavior
// ==============================
const offlineBehavior: TestCaseSteps[] = [
  {
    testId: 'TC_036_CS', title: 'Connection Loss During Transaction', suite: 'OfflineBehavior',
    steps: [
      { step: 1, action: 'Start a charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'Simulate network connection loss (CSMS disconnects)', direction: 'Network', ocppMessage: '— WebSocket disconnect —', expectedResult: 'SUT loses connection to CSMS' },
      { step: 3, action: 'SUT continues charging and queues meter values locally', direction: 'SUT (offline)', ocppMessage: '— local queuing —', expectedResult: 'Meter values queued during offline period' },
      { step: 4, action: 'Restore network connection', direction: 'Network', ocppMessage: '— WebSocket reconnect —', expectedResult: 'SUT reconnects to CSMS' },
      { step: 5, action: 'SUT sends queued meter values to CSMS', direction: 'SUT → CSMS', ocppMessage: 'MeterValues(connectorId, transactionId, ...)', expectedResult: 'Queued meter values sent after reconnection' },
    ]
  },
  {
    testId: 'TC_037_1_CS', title: 'Offline Start - Valid IdTag', suite: 'OfflineBehavior',
    steps: [
      { step: 1, action: 'Ensure SUT is offline (no connection to CSMS)', direction: 'Network', ocppMessage: '— offline —', expectedResult: 'SUT not connected' },
      { step: 2, action: 'EV driver plugs cable and presents a valid known IdTag', direction: 'EV', ocppMessage: '-', expectedResult: 'Valid IdTag presented while offline' },
      { step: 3, action: 'SUT starts transaction locally (offline authorization)', direction: 'SUT (offline)', ocppMessage: '— local start —', expectedResult: 'Transaction started while offline' },
      { step: 4, action: 'Restore network connection', direction: 'Network', ocppMessage: '— reconnect —', expectedResult: 'SUT reconnects to CSMS' },
      { step: 5, action: 'SUT sends StartTransaction to CSMS (for the offline-started transaction)', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart, offline=true)', expectedResult: 'StartTransaction communicated after reconnection' },
      { step: 6, action: 'CSMS accepts the transaction', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction accepted retrospectively' },
    ]
  },
  {
    testId: 'TC_037_2_CS', title: 'Offline Start - Invalid IdTag (StopOnInvalid=false)', suite: 'OfflineBehavior',
    steps: [
      { step: 1, action: 'Configure StopTransactionOnInvalidId=false', direction: 'Pre-condition', ocppMessage: 'ChangeConfiguration(StopTransactionOnInvalidId, false)', expectedResult: 'StopOnInvalidId set to false' },
      { step: 2, action: 'Ensure SUT is offline', direction: 'Network', ocppMessage: '— offline —', expectedResult: 'SUT offline' },
      { step: 3, action: 'EV driver presents an invalid/unknown IdTag while offline', direction: 'EV', ocppMessage: '-', expectedResult: 'Invalid IdTag presented offline' },
      { step: 4, action: 'SUT starts transaction despite invalid IdTag (StopOnInvalidId=false)', direction: 'SUT (offline)', ocppMessage: '— local start —', expectedResult: 'Transaction started with invalid IdTag offline' },
      { step: 5, action: 'Restore connection and SUT sends StartTransaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, invalidIdTag, ...)', expectedResult: 'Transaction started offline with invalid IdTag reported' },
    ]
  },
  {
    testId: 'TC_037_3_CS', title: 'Offline Start - Invalid IdTag (StopOnInvalid=true)', suite: 'OfflineBehavior',
    steps: [
      { step: 1, action: 'Configure StopTransactionOnInvalidId=true', direction: 'Pre-condition', ocppMessage: 'ChangeConfiguration(StopTransactionOnInvalidId, true)', expectedResult: 'StopOnInvalidId set to true' },
      { step: 2, action: 'Ensure SUT is offline', direction: 'Network', ocppMessage: '— offline —', expectedResult: 'SUT offline' },
      { step: 3, action: 'EV driver presents an invalid/unknown IdTag while offline', direction: 'EV', ocppMessage: '-', expectedResult: 'Invalid IdTag presented offline' },
      { step: 4, action: 'SUT may start transaction but will stop it when reconnecting (invalid IdTag)', direction: 'SUT', ocppMessage: '— —', expectedResult: 'SUT behavior depends on implementation' },
      { step: 5, action: 'Restore connection', direction: 'Network', ocppMessage: '— reconnect —', expectedResult: 'SUT reconnects' },
      { step: 6, action: 'SUT stops the transaction due to invalid IdTag (StopOnInvalidId=true)', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=DeAuthorized, meterStop)', expectedResult: 'Transaction stopped with reason DeAuthorized' },
    ]
  },
  {
    testId: 'TC_038_CS', title: 'Offline Stop Transaction', suite: 'OfflineBehavior',
    steps: [
      { step: 1, action: 'Start a charging session (transaction active, online)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'Simulate network connection loss', direction: 'Network', ocppMessage: '— offline —', expectedResult: 'SUT loses connection' },
      { step: 3, action: 'EV driver stops charging (unplug or local stop) while offline', direction: 'EV', ocppMessage: '-', expectedResult: 'Charging stopped locally while offline' },
      { step: 4, action: 'SUT stops transaction locally (queues StopTransaction)', direction: 'SUT (offline)', ocppMessage: '— local stop —', expectedResult: 'StopTransaction queued locally' },
      { step: 5, action: 'Restore network connection', direction: 'Network', ocppMessage: '— reconnect —', expectedResult: 'SUT reconnects to CSMS' },
      { step: 6, action: 'SUT sends StopTransaction to CSMS', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=Local, meterStop)', expectedResult: 'StopTransaction sent after reconnection with reason Local' },
    ]
  },
  {
    testId: 'TC_039_CS', title: 'Offline Transaction', suite: 'OfflineBehavior',
    steps: [
      { step: 1, action: 'Ensure SUT is offline', direction: 'Network', ocppMessage: '— offline —', expectedResult: 'SUT offline' },
      { step: 2, action: 'Start and stop a transaction entirely while offline', direction: 'EV', ocppMessage: '-', expectedResult: 'Full offline transaction lifecycle' },
      { step: 3, action: 'Restore network connection', direction: 'Network', ocppMessage: '— reconnect —', expectedResult: 'SUT reconnects' },
      { step: 4, action: 'SUT sends StartTransaction (offline started)', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, ...)', expectedResult: 'Start communicated after reconnect' },
      { step: 5, action: 'CSMS accepts', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction accepted' },
      { step: 6, action: 'SUT sends StopTransaction (offline stopped)', direction: 'SUT → CSMS', ocppMessage: 'StopTransaction(transactionId, reason=Local, meterStop)', expectedResult: 'Stop communicated after reconnect' },
    ]
  },
];

// ==============================
// ConfigKeysNonHappy
// ==============================
const configKeysNonHappy: TestCaseSteps[] = [
  {
    testId: 'TC_040_1_CS', title: 'Config Key - NotSupported', suite: 'ConfigKeysNonHappy',
    steps: [
      { step: 1, action: 'CSMS sends ChangeConfiguration with an unknown/unsupported key', direction: 'CSMS → SUT', ocppMessage: 'ChangeConfiguration(key=Testing, value=1)', expectedResult: 'ChangeConfiguration with unsupported key' },
      { step: 2, action: 'SUT rejects with NotSupported status', direction: 'SUT → CSMS', ocppMessage: 'ChangeConfiguration.Response(status=NotSupported)', expectedResult: 'Configuration change rejected - key not supported' },
    ]
  },
  {
    testId: 'TC_040_2_CS', title: 'Config Key - Invalid Value', suite: 'ConfigKeysNonHappy',
    steps: [
      { step: 1, action: 'CSMS sends ChangeConfiguration with an invalid value (e.g. negative)', direction: 'CSMS → SUT', ocppMessage: 'ChangeConfiguration(key=MeterValueSampleInterval, value=-1)', expectedResult: 'ChangeConfiguration with invalid value' },
      { step: 2, action: 'SUT rejects with Rejected status', direction: 'SUT → CSMS', ocppMessage: 'ChangeConfiguration.Response(status=Rejected)', expectedResult: 'Configuration change rejected - invalid value' },
    ]
  },
];

// ==============================
// FaultBehavior
// ==============================
const faultBehavior: TestCaseSteps[] = [
  {
    testId: 'TC_041_CS', title: 'Fault Behavior', suite: 'FaultBehavior',
    steps: [
      { step: 1, action: 'Induce a fault condition on the SUT connector', direction: 'SUT (hardware)', ocppMessage: '— fault —', expectedResult: 'Fault condition detected' },
      { step: 2, action: 'SUT reports Faulted status', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Faulted, errorCode=...)', expectedResult: 'Connector status set to Faulted with appropriate error code' },
      { step: 3, action: 'Attempt to start a transaction on the faulted connector', direction: 'EV', ocppMessage: '-', expectedResult: 'Attempt to start on faulted connector' },
      { step: 4, action: 'SUT refuses to start transaction while connector is Faulted', direction: 'SUT', ocppMessage: '-', expectedResult: 'No transaction started on faulted connector' },
    ]
  },
];

// ==============================
// LocalAuthList
// ==============================
const localAuthList: TestCaseSteps[] = [
  {
    testId: 'TC_008_1_CS', title: 'Local Auth List - Regular Start', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends SendLocalList with authorized IdTags', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=1, updateType=Full, localAuthorizationList=[{idTag}])', expectedResult: 'Local authorization list sent' },
      { step: 2, action: 'SUT confirms receipt of local list', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(status=Accepted)', expectedResult: 'Local list accepted' },
      { step: 3, action: 'EV driver plugs cable and presents IdTag from local list', direction: 'EV', ocppMessage: '-', expectedResult: 'IdTag from local list presented' },
      { step: 4, action: 'SUT authorizes locally (no Authorize request to CSMS)', direction: 'SUT (local)', ocppMessage: '— local auth —', expectedResult: 'SUT finds IdTag in local list' },
      { step: 5, action: 'SUT starts transaction using locally authorized IdTag', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'Transaction started with locally authorized IdTag' },
      { step: 6, action: 'CSMS accepts and transaction proceeds', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction active' },
    ]
  },
  {
    testId: 'TC_008_2_CS', title: 'Local Auth List - Remote Start', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends SendLocalList with authorized IdTags', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=1, updateType=Full, localAuthorizationList=[{idTag}])', expectedResult: 'Local list sent' },
      { step: 2, action: 'SUT confirms', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(Accepted)', expectedResult: 'Local list accepted' },
      { step: 3, action: 'CSMS sends RemoteStartTransaction with IdTag from local list', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start with locally authorized IdTag' },
      { step: 4, action: 'SUT authorizes locally and locks connector', direction: 'SUT (local)', ocppMessage: '— local auth —', expectedResult: 'SUT finds IdTag in local list, proceeds' },
      { step: 5, action: 'SUT starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, meterStart)', expectedResult: 'Transaction started via remote start with local list' },
    ]
  },
  {
    testId: 'TC_042_1_CS', title: 'Get Local List Version (Not Supported)', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends GetLocalListVersion when SUT does not support local auth lists', direction: 'CSMS → SUT', ocppMessage: 'GetLocalListVersion', expectedResult: 'Request for local list version' },
      { step: 2, action: 'SUT returns NotSupported or listVersion=-1', direction: 'SUT → CSMS', ocppMessage: 'GetLocalListVersion.Response(listVersion=-1)  OR  CallError(NotSupported)', expectedResult: 'Local list version not supported' },
    ]
  },
  {
    testId: 'TC_042_2_CS', title: 'Get Local List Version (Empty)', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends a local auth list (version 1) to SUT', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=1, updateType=Full, localAuthorizationList=[])', expectedResult: 'Empty local list sent with version 1' },
      { step: 2, action: 'SUT confirms', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(Accepted)', expectedResult: 'Local list accepted (empty)' },
      { step: 3, action: 'CSMS sends GetLocalListVersion', direction: 'CSMS → SUT', ocppMessage: 'GetLocalListVersion', expectedResult: 'Request version' },
      { step: 4, action: 'SUT returns version 0 (empty list)', direction: 'SUT → CSMS', ocppMessage: 'GetLocalListVersion.Response(listVersion=0)', expectedResult: 'Local list version 0 (empty)' },
    ]
  },
  {
    testId: 'TC_043_CS', title: 'Send Local Authorization List', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends a Full update of local auth list (version 1)', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=1, updateType=Full, localAuthorizationList=[idTag1, idTag2])', expectedResult: 'Full local list sent with version 1' },
      { step: 2, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(Accepted)', expectedResult: 'Full list accepted' },
      { step: 3, action: 'CSMS sends a Differential update (version 2, adds idTag3, removes idTag1)', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=2, updateType=Differential, localAuthorizationList=[idTag3])', expectedResult: 'Differential update sent' },
      { step: 4, action: 'SUT accepts differential update', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(Accepted)', expectedResult: 'Differential update accepted' },
      { step: 5, action: 'Verify version incremented', direction: 'CSMS → SUT', ocppMessage: 'GetLocalListVersion', expectedResult: 'Version check' },
      { step: 6, action: 'SUT returns version 2', direction: 'SUT → CSMS', ocppMessage: 'GetLocalListVersion.Response(listVersion=2)', expectedResult: 'Local list version 2' },
    ]
  },
  {
    testId: 'TC_043_1_CS', title: 'Send Local List - NotSupported', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends SendLocalList to SUT that does not support local auth lists', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=1, updateType=Full, localAuthorizationList=[...])', expectedResult: 'SendLocalList request' },
      { step: 2, action: 'SUT returns NotSupported', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(status=NotSupported)', expectedResult: 'Local list not supported' },
    ]
  },
  {
    testId: 'TC_043_2_CS', title: 'Send Local List - VersionMismatch', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends SendLocalList with an old/stale version number', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=0, updateType=Full, ...) when current is version 5', expectedResult: 'SendLocalList with old version' },
      { step: 2, action: 'SUT returns VersionMismatch', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(status=VersionMismatch)', expectedResult: 'Version mismatch detected and reported' },
    ]
  },
  {
    testId: 'TC_043_3_CS', title: 'Send Local List - Failed', suite: 'LocalAuthList',
    steps: [
      { step: 1, action: 'CSMS sends SendLocalList but SUT fails to store it', direction: 'CSMS → SUT', ocppMessage: 'SendLocalList(listVersion=1, updateType=Full, ...)', expectedResult: 'SendLocalList request' },
      { step: 2, action: 'SUT returns Failed (e.g. out of memory, internal error)', direction: 'SUT → CSMS', ocppMessage: 'SendLocalList.Response(status=Failed)', expectedResult: 'Local list storage failed' },
    ]
  },
];

// ==============================
// FirmwareManagement
// ==============================
const firmwareManagement: TestCaseSteps[] = [
  {
    testId: 'TC_044_1_CS', title: 'Firmware Update - Download and Install', suite: 'FirmwareManagement',
    steps: [
      { step: 1, action: 'CSMS sends UpdateFirmware with download location and install time', direction: 'CSMS → SUT', ocppMessage: 'UpdateFirmware(location=ftp://..., retrieveDate=..., retries=3)', expectedResult: 'Firmware update request sent' },
      { step: 2, action: 'SUT starts downloading firmware and reports Downloading status', direction: 'SUT → CSMS', ocppMessage: 'FirmwareStatusNotification(status=Downloading)', expectedResult: 'Firmware download in progress' },
      { step: 3, action: 'SUT completes download and reports Downloaded', direction: 'SUT → CSMS', ocppMessage: 'FirmwareStatusNotification(status=Downloaded)', expectedResult: 'Firmware download completed' },
      { step: 4, action: 'SUT starts installing firmware and reports Installing', direction: 'SUT → CSMS', ocppMessage: 'FirmwareStatusNotification(status=Installing)', expectedResult: 'Firmware install in progress' },
      { step: 5, action: 'SUT completes installation and may reboot, then reports Installed', direction: 'SUT → CSMS', ocppMessage: 'FirmwareStatusNotification(status=Installed)', expectedResult: 'Firmware installation completed successfully' },
    ]
  },
  {
    testId: 'TC_044_2_CS', title: 'Firmware Update - Download Failed', suite: 'FirmwareManagement',
    steps: [
      { step: 1, action: 'CSMS sends UpdateFirmware with invalid download location', direction: 'CSMS → SUT', ocppMessage: 'UpdateFirmware(location=ftp://invalid-uri, ...)', expectedResult: 'Firmware update with bad URI' },
      { step: 2, action: 'SUT attempts to download but fails', direction: 'SUT', ocppMessage: '— download fails —', expectedResult: 'Firmware download fails' },
      { step: 3, action: 'SUT reports DownloadFailed', direction: 'SUT → CSMS', ocppMessage: 'FirmwareStatusNotification(status=DownloadFailed)', expectedResult: 'Download failed reported' },
    ]
  },
  {
    testId: 'TC_044_3_CS', title: 'Firmware Update - Installation Failed', suite: 'FirmwareManagement',
    steps: [
      { step: 1, action: 'CSMS sends UpdateFirmware with valid download location', direction: 'CSMS → SUT', ocppMessage: 'UpdateFirmware(location=ftp://..., ...)', expectedResult: 'Firmware update sent' },
      { step: 2, action: 'SUT downloads firmware successfully', direction: 'SUT → CSMS', ocppMessage: 'FirmwareStatusNotification(Downloaded)', expectedResult: 'Download completed' },
      { step: 3, action: 'SUT attempts to install but installation fails', direction: 'SUT', ocppMessage: '— install fails —', expectedResult: 'Firmware installation fails' },
      { step: 4, action: 'SUT reports InstallationFailed', direction: 'SUT → CSMS', ocppMessage: 'FirmwareStatusNotification(status=InstallationFailed)', expectedResult: 'Installation failed reported' },
    ]
  },
];

// ==============================
// Diagnostics
// ==============================
const diagnostics: TestCaseSteps[] = [
  {
    testId: 'TC_045_1_CS', title: 'Get Diagnostics', suite: 'Diagnostics',
    steps: [
      { step: 1, action: 'CSMS sends GetDiagnostics with upload location', direction: 'CSMS → SUT', ocppMessage: 'GetDiagnostics(location=ftp://..., retries=3, retryInterval=300)', expectedResult: 'Get diagnostics request sent' },
      { step: 2, action: 'SUT starts uploading diagnostics and reports Uploading', direction: 'SUT → CSMS', ocppMessage: 'DiagnosticsStatusNotification(status=Uploading)', expectedResult: 'Diagnostics upload started' },
      { step: 3, action: 'SUT completes upload and reports Uploaded', direction: 'SUT → CSMS', ocppMessage: 'DiagnosticsStatusNotification(status=Uploaded)', expectedResult: 'Diagnostics upload completed successfully' },
    ]
  },
  {
    testId: 'TC_045_2_CS', title: 'Get Diagnostics - Upload Failed', suite: 'Diagnostics',
    steps: [
      { step: 1, action: 'CSMS sends GetDiagnostics with invalid upload location', direction: 'CSMS → SUT', ocppMessage: 'GetDiagnostics(location=ftp://invalid-uri, ...)', expectedResult: 'Get diagnostics with bad URI' },
      { step: 2, action: 'SUT attempts to upload but fails', direction: 'SUT', ocppMessage: '— upload fails —', expectedResult: 'Diagnostics upload fails' },
      { step: 3, action: 'SUT reports UploadFailed', direction: 'SUT → CSMS', ocppMessage: 'DiagnosticsStatusNotification(status=UploadFailed)', expectedResult: 'Upload failed reported' },
    ]
  },
];

// ==============================
// Reservation
// ==============================
const reservation: TestCaseSteps[] = [
  {
    testId: 'TC_046_1_CS', title: 'Reserve Connector - Local Start', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow to reserve a specific connector', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, expiryDate=..., idTag)', expectedResult: 'Reservation request sent' },
      { step: 2, action: 'SUT accepts reservation', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Accepted)', expectedResult: 'Connector reserved' },
      { step: 3, action: 'SUT reports connector as Reserved', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Reserved)', expectedResult: 'Status Reserved' },
      { step: 4, action: 'EV driver plugs cable and presents reserved IdTag', direction: 'EV', ocppMessage: '-', expectedResult: 'Reserved IdTag presented' },
      { step: 5, action: 'SUT authorizes (IdTag matches reservation) and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'Authorize(idTag) + StartTransaction(connectorId, idTag, reservationId=1, meterStart)', expectedResult: 'Transaction started with reservationId' },
      { step: 6, action: 'CSMS accepts', direction: 'CSMS → SUT', ocppMessage: 'StartTransaction(Accepted, transactionId)', expectedResult: 'Transaction active on reserved connector' },
    ]
  },
  {
    testId: 'TC_046_2_CS', title: 'Reserve Connector - Remote Start', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, ...)', expectedResult: 'Reservation sent' },
      { step: 2, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(Accepted)', expectedResult: 'Reserved' },
      { step: 3, action: 'CSMS sends RemoteStartTransaction with reserved IdTag', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag)', expectedResult: 'Remote start on reserved connector' },
      { step: 4, action: 'SUT authorizes and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, idTag, reservationId=1, meterStart)', expectedResult: 'Transaction started via remote start on reserved connector' },
    ]
  },
  {
    testId: 'TC_047_CS', title: 'Reserve Connector - Expire', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow with a short expiry time', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, expiryDate=now+30s, idTag)', expectedResult: 'Reservation with short expiry' },
      { step: 2, action: 'SUT accepts and sets connector Reserved', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(Accepted)', expectedResult: 'Connector Reserved' },
      { step: 3, action: 'Wait for expiry time to pass', direction: 'Time', ocppMessage: '— wait —', expectedResult: 'Reservation expires' },
      { step: 4, action: 'SUT returns connector to Available after expiry', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connector returns to Available after reservation expiry' },
    ]
  },
  {
    testId: 'TC_048_1_CS', title: 'Reserve Connector - Faulted', suite: 'Reservation',
    steps: [
      { step: 1, action: 'Set connector to Faulted state', direction: 'Pre-condition', ocppMessage: 'StatusNotification(Faulted)', expectedResult: 'Connector in Faulted state' },
      { step: 2, action: 'CSMS sends ReserveNow for the faulted connector', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, ...)', expectedResult: 'Reserve request on faulted connector' },
      { step: 3, action: 'SUT rejects reservation with status Faulted', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Faulted)', expectedResult: 'Reservation rejected (connector faulted)' },
    ]
  },
  {
    testId: 'TC_048_2_CS', title: 'Reserve Connector - Occupied', suite: 'Reservation',
    steps: [
      { step: 1, action: 'Start a transaction on a connector (Occupied)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Connector occupied' },
      { step: 2, action: 'CSMS sends ReserveNow for the occupied connector', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, ...)', expectedResult: 'Reserve request on occupied connector' },
      { step: 3, action: 'SUT rejects reservation with status Occupied', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Occupied)', expectedResult: 'Reservation rejected (connector occupied)' },
    ]
  },
  {
    testId: 'TC_048_3_CS', title: 'Reserve Connector - Unavailable', suite: 'Reservation',
    steps: [
      { step: 1, action: 'Set connector to Unavailable/Inoperative', direction: 'Pre-condition', ocppMessage: 'ChangeAvailability(Inoperative)', expectedResult: 'Connector Unavailable' },
      { step: 2, action: 'CSMS sends ReserveNow for the unavailable connector', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, ...)', expectedResult: 'Reserve request on unavailable connector' },
      { step: 3, action: 'SUT rejects with status Unavailable', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Unavailable)', expectedResult: 'Reservation rejected (connector unavailable)' },
    ]
  },
  {
    testId: 'TC_048_4_CS', title: 'Reserve Connector - Rejected', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow when reservation is not supported', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, ...)', expectedResult: 'Reserve request when unsupported' },
      { step: 2, action: 'SUT rejects with status Rejected', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Rejected)', expectedResult: 'Reservation rejected (not supported)' },
    ]
  },
  {
    testId: 'TC_049_CS', title: 'Reserve ChargePoint - Transaction', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow with connectorId=0 (any available connector)', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId=0, reservationId=1, ...)', expectedResult: 'Reserve any connector' },
      { step: 2, action: 'SUT reserves any available connector', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(Accepted)', expectedResult: 'A connector reserved' },
      { step: 3, action: 'Start a transaction on the reserved connector', direction: 'EV', ocppMessage: 'Authorize + StartTransaction', expectedResult: 'Transaction started on reserved connector' },
    ]
  },
  {
    testId: 'TC_050_1_CS', title: 'Reserve ChargePoint - Faulted', suite: 'Reservation',
    steps: [
      { step: 1, action: 'Set all connectors to Faulted', direction: 'Pre-condition', ocppMessage: 'StatusNotification(Faulted)', expectedResult: 'All connectors faulted' },
      { step: 2, action: 'CSMS sends ReserveNow with connectorId=0', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId=0, ...)', expectedResult: 'Reserve any on faulted CP' },
      { step: 3, action: 'SUT rejects with status Faulted (no available connector)', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Faulted)', expectedResult: 'Reservation rejected (all faulted)' },
    ]
  },
  {
    testId: 'TC_050_2_CS', title: 'Reserve ChargePoint - Occupied', suite: 'Reservation',
    steps: [
      { step: 1, action: 'All connectors occupied with active transactions', direction: 'Pre-condition', ocppMessage: 'StartTransaction (on all)', expectedResult: 'All connectors occupied' },
      { step: 2, action: 'CSMS sends ReserveNow with connectorId=0', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId=0, ...)', expectedResult: 'Reserve any on occupied CP' },
      { step: 3, action: 'SUT rejects with status Occupied', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Occupied)', expectedResult: 'Reservation rejected (all occupied)' },
    ]
  },
  {
    testId: 'TC_050_3_CS', title: 'Reserve ChargePoint - Unavailable', suite: 'Reservation',
    steps: [
      { step: 1, action: 'Set all connectors to Unavailable', direction: 'Pre-condition', ocppMessage: 'ChangeAvailability(Inoperative)', expectedResult: 'All connectors unavailable' },
      { step: 2, action: 'CSMS sends ReserveNow with connectorId=0', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId=0, ...)', expectedResult: 'Reserve any on unavailable CP' },
      { step: 3, action: 'SUT rejects with status Unavailable', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Unavailable)', expectedResult: 'Reservation rejected (all unavailable)' },
    ]
  },
  {
    testId: 'TC_050_4_CS', title: 'Reserve ChargePoint - Rejected', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow with connectorId=0 when not supported', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId=0, ...)', expectedResult: 'Reserve any when unsupported' },
      { step: 2, action: 'SUT rejects with status Rejected', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(status=Rejected)', expectedResult: 'Reservation rejected (not supported)' },
    ]
  },
  {
    testId: 'TC_051_CS', title: 'Cancel Reservation', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow to reserve a connector', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, ...)', expectedResult: 'Connector reserved' },
      { step: 2, action: 'SUT confirms reservation', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(Accepted)', expectedResult: 'Reservation active' },
      { step: 3, action: 'CSMS sends CancelReservation with the reservationId', direction: 'CSMS → SUT', ocppMessage: 'CancelReservation(reservationId=1)', expectedResult: 'Cancel reservation request' },
      { step: 4, action: 'SUT cancels the reservation', direction: 'SUT → CSMS', ocppMessage: 'CancelReservation.Response(status=Accepted)', expectedResult: 'Reservation cancelled' },
      { step: 5, action: 'SUT returns connector to Available', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'Connector available after cancellation' },
    ]
  },
  {
    testId: 'TC_052_CS', title: 'Cancel Reservation - Rejected', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends CancelReservation with unknown/non-existent reservationId', direction: 'CSMS → SUT', ocppMessage: 'CancelReservation(reservationId=999)', expectedResult: 'Cancel unknown reservation' },
      { step: 2, action: 'SUT rejects with status Rejected', direction: 'SUT → CSMS', ocppMessage: 'CancelReservation.Response(status=Rejected)', expectedResult: 'Cancellation rejected (unknown reservation)' },
    ]
  },
  {
    testId: 'TC_053_1_CS', title: 'Reserved - parentIdTag Local', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow with parentIdTag specified', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, idTag=parent, ...)', expectedResult: 'Reservation with parentIdTag' },
      { step: 2, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(Accepted)', expectedResult: 'Reserved for parentIdTag' },
      { step: 3, action: 'EV driver presents a child IdTag (parentId matches reservation)', direction: 'EV', ocppMessage: '-', expectedResult: 'Child IdTag presented' },
      { step: 4, action: 'SUT authorizes child IdTag (parentId matches reservation)', direction: 'SUT → CSMS', ocppMessage: 'Authorize(childIdTag) + StartTransaction(...)', expectedResult: 'Transaction started using parentIdTag reservation' },
    ]
  },
  {
    testId: 'TC_053_2_CS', title: 'Reserved - parentIdTag Remote', suite: 'Reservation',
    steps: [
      { step: 1, action: 'CSMS sends ReserveNow with parentIdTag', direction: 'CSMS → SUT', ocppMessage: 'ReserveNow(connectorId, reservationId=1, idTag=parent, ...)', expectedResult: 'Reservation with parentIdTag' },
      { step: 2, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'ReserveNow.Response(Accepted)', expectedResult: 'Reserved' },
      { step: 3, action: 'CSMS sends RemoteStartTransaction with child IdTag', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, childIdTag)', expectedResult: 'Remote start with child IdTag' },
      { step: 4, action: 'SUT matches child IdTag to parentIdTag reservation and starts transaction', direction: 'SUT → CSMS', ocppMessage: 'StartTransaction(connectorId, childIdTag, reservationId=1, ...)', expectedResult: 'Transaction started via remote start using parentIdTag reservation' },
    ]
  },
];

// ==============================
// RemoteTrigger
// ==============================
const remoteTrigger: TestCaseSteps[] = [
  {
    testId: 'TC_054_CS', title: 'Trigger Message', suite: 'RemoteTrigger',
    steps: [
      { step: 1, action: 'CSMS sends TriggerMessage for MeterValues', direction: 'CSMS → SUT', ocppMessage: 'TriggerMessage(requestedMessage=MeterValues, connectorId=1)', expectedResult: 'Trigger for MeterValues' },
      { step: 2, action: 'SUT acknowledges trigger and sends requested message', direction: 'SUT → CSMS', ocppMessage: 'TriggerMessage.Response(status=Accepted)', expectedResult: 'Trigger accepted' },
      { step: 3, action: 'SUT sends the triggered MeterValues', direction: 'SUT → CSMS', ocppMessage: 'MeterValues(connectorId, ...)', expectedResult: 'MeterValues sent in response to trigger' },
      { step: 4, action: 'CSMS sends TriggerMessage for Heartbeat', direction: 'CSMS → SUT', ocppMessage: 'TriggerMessage(requestedMessage=Heartbeat)', expectedResult: 'Trigger for Heartbeat' },
      { step: 5, action: 'SUT acknowledges and sends Heartbeat', direction: 'SUT → CSMS', ocppMessage: 'Heartbeat', expectedResult: 'Heartbeat sent' },
      { step: 6, action: 'CSMS sends TriggerMessage for StatusNotification', direction: 'CSMS → SUT', ocppMessage: 'TriggerMessage(requestedMessage=StatusNotification, connectorId=1)', expectedResult: 'Trigger for StatusNotification' },
      { step: 7, action: 'SUT sends StatusNotification', direction: 'SUT → CSMS', ocppMessage: 'StatusNotification(connectorId, Available)', expectedResult: 'StatusNotification sent' },
      { step: 8, action: 'CSMS sends TriggerMessage for DiagnosticsStatusNotification', direction: 'CSMS → SUT', ocppMessage: 'TriggerMessage(requestedMessage=DiagnosticsStatusNotification)', expectedResult: 'Trigger for DiagnosticsStatusNotification' },
      { step: 9, action: 'SUT sends DiagnosticsStatusNotification', direction: 'SUT → CSMS', ocppMessage: 'DiagnosticsStatusNotification(status=Idle)', expectedResult: 'DiagnosticsStatusNotification sent' },
    ]
  },
  {
    testId: 'TC_055_CS', title: 'Trigger Message - Rejected', suite: 'RemoteTrigger',
    steps: [
      { step: 1, action: 'CSMS sends TriggerMessage with invalid connectorId', direction: 'CSMS → SUT', ocppMessage: 'TriggerMessage(requestedMessage=MeterValues, connectorId=999)', expectedResult: 'Trigger with invalid connectorId' },
      { step: 2, action: 'SUT rejects with status Rejected', direction: 'SUT → CSMS', ocppMessage: 'TriggerMessage.Response(status=Rejected)', expectedResult: 'Trigger rejected (invalid connector)' },
    ]
  },
];

// ==============================
// SmartCharging
// ==============================
const smartCharging: TestCaseSteps[] = [
  {
    testId: 'TC_056_CS', title: 'Smart Charging - TxDefaultProfile', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'CSMS sends SetChargingProfile with TxDefaultProfile', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(connectorId=0, chargingProfile={purpose=TxDefaultProfile, stackLevel=1, chargingProfileRate[...]})', expectedResult: 'TxDefaultProfile sent' },
      { step: 2, action: 'SUT accepts the charging profile', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(status=Accepted)', expectedResult: 'Profile accepted' },
      { step: 3, action: 'CSMS requests composite schedule for a connector', direction: 'CSMS → SUT', ocppMessage: 'GetCompositeSchedule(connectorId=1, duration=3600)', expectedResult: 'Get composite schedule request' },
      { step: 4, action: 'SUT returns the composite schedule based on TxDefaultProfile', direction: 'SUT → CSMS', ocppMessage: 'GetCompositeSchedule.Response(status=Accepted, schedule=[...])', expectedResult: 'Composite schedule returned matching TxDefaultProfile' },
    ]
  },
  {
    testId: 'TC_057_CS', title: 'Smart Charging - TxProfile', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'Start a charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active with transactionId' },
      { step: 2, action: 'CSMS sends SetChargingProfile with TxProfile for the active transaction', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(connectorId=1, chargingProfile={purpose=TxProfile, transactionId=..., stackLevel=1, ...})', expectedResult: 'TxProfile sent for active transaction' },
      { step: 3, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(Accepted)', expectedResult: 'TxProfile accepted' },
      { step: 4, action: 'CSMS requests composite schedule', direction: 'CSMS → SUT', ocppMessage: 'GetCompositeSchedule(connectorId=1, duration=3600)', expectedResult: 'Get composite schedule' },
      { step: 5, action: 'SUT returns composite schedule reflecting TxProfile', direction: 'SUT → CSMS', ocppMessage: 'GetCompositeSchedule.Response(Accepted, schedule=[...])', expectedResult: 'Composite schedule matches TxProfile' },
    ]
  },
  {
    testId: 'TC_058_1_CS', title: 'Smart Charging - No Transaction', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'Ensure no transaction is active', direction: 'Pre-condition', ocppMessage: '-', expectedResult: 'No active transaction' },
      { step: 2, action: 'CSMS sends SetChargingProfile with TxProfile purpose (but no transaction)', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(chargingProfile={purpose=TxProfile, ...})', expectedResult: 'TxProfile sent without transaction' },
      { step: 3, action: 'SUT rejects because no transaction exists for TxProfile', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(status=Rejected)', expectedResult: 'Profile rejected (no transaction)' },
    ]
  },
  {
    testId: 'TC_058_2_CS', title: 'Smart Charging - Wrong TransactionId', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'Start a transaction', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active with transactionId=1' },
      { step: 2, action: 'CSMS sends SetChargingProfile with wrong/non-existent transactionId', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(chargingProfile={purpose=TxProfile, transactionId=999, ...})', expectedResult: 'TxProfile with wrong transactionId' },
      { step: 3, action: 'SUT rejects because transactionId does not match', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(status=Rejected)', expectedResult: 'Profile rejected (wrong transactionId)' },
    ]
  },
  {
    testId: 'TC_059_CS', title: 'Remote Start with ChargingProfile', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'CSMS sends RemoteStartTransaction with TxProfile included', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag, chargingProfile={purpose=TxProfile, stackLevel=1, ...})', expectedResult: 'Remote start with charging profile' },
      { step: 2, action: 'SUT authorizes and starts transaction with the provided profile', direction: 'SUT → CSMS', ocppMessage: 'Authorize + StartTransaction', expectedResult: 'Transaction started with TxProfile' },
      { step: 3, action: 'CSMS requests composite schedule to verify profile applied', direction: 'CSMS → SUT', ocppMessage: 'GetCompositeSchedule(connectorId=1, duration=3600)', expectedResult: 'Get composite schedule' },
      { step: 4, action: 'SUT returns composite schedule reflecting the TxProfile', direction: 'SUT → CSMS', ocppMessage: 'GetCompositeSchedule.Response(Accepted, schedule=[...])', expectedResult: 'Composite schedule matches TxProfile from remote start' },
    ]
  },
  {
    testId: 'TC_060_CS', title: 'Remote Start with ChargingProfile - Rejected', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'CSMS sends RemoteStartTransaction with wrong ChargingProfilePurpose (e.g. TxDefaultProfile instead of TxProfile)', direction: 'CSMS → SUT', ocppMessage: 'RemoteStartTransaction(connectorId, idTag, chargingProfile={purpose=TxDefaultProfile, ...})', expectedResult: 'Remote start with wrong profile purpose' },
      { step: 2, action: 'SUT rejects the remote start because TxDefaultProfile not allowed in RemoteStart', direction: 'SUT → CSMS', ocppMessage: 'RemoteStartTransaction.Response(status=Rejected)', expectedResult: 'Remote start rejected (wrong profile purpose)' },
    ]
  },
  {
    testId: 'TC_066_CS', title: 'Get Composite Schedule', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'Set up multiple charging profiles at different stack levels', direction: 'Pre-condition', ocppMessage: 'SetChargingProfile (multiple)', expectedResult: 'Multiple profiles active at different stack levels' },
      { step: 2, action: 'CSMS sends GetCompositeSchedule for a connector', direction: 'CSMS → SUT', ocppMessage: 'GetCompositeSchedule(connectorId=1, duration=86400)', expectedResult: 'Get composite schedule request' },
      { step: 3, action: 'SUT returns the composite schedule combining all profiles', direction: 'SUT → CSMS', ocppMessage: 'GetCompositeSchedule.Response(status=Accepted, schedule=[...])', expectedResult: 'Composite schedule reflects the merged profiles (stacked)' },
    ]
  },
  {
    testId: 'TC_067_CS', title: 'Clear Charging Profile', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'CSMS sends SetChargingProfile with TxDefaultProfile', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(chargingProfile={purpose=TxDefaultProfile, ...})', expectedResult: 'Profile set' },
      { step: 2, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(Accepted)', expectedResult: 'Profile accepted' },
      { step: 3, action: 'CSMS sends ClearChargingProfile (clear by id)', direction: 'CSMS → SUT', ocppMessage: 'ClearChargingProfile(id=1)', expectedResult: 'Clear profile by id' },
      { step: 4, action: 'SUT clears the profile', direction: 'SUT → CSMS', ocppMessage: 'ClearChargingProfile.Response(status=Accepted)', expectedResult: 'Profile cleared' },
      { step: 5, action: 'Verify profile cleared: GetCompositeSchedule should show no schedule', direction: 'CSMS → SUT', ocppMessage: 'GetCompositeSchedule(connectorId=1, duration=3600)', expectedResult: 'Composite schedule empty after clearing' },
      { step: 6, action: 'Repeat with ClearChargingProfile(chargingProfilePurpose=TxDefault, stackLevel=1)', direction: 'CSMS → SUT', ocppMessage: 'ClearChargingProfile(chargingProfilePurpose=TxDefaultProfile, stackLevel=1)', expectedResult: 'Clear profile by purpose and stack level' },
      { step: 7, action: 'SUT clears and confirms', direction: 'SUT → CSMS', ocppMessage: 'ClearChargingProfile.Response(Accepted)', expectedResult: 'Profile cleared' },
    ]
  },
  {
    testId: 'TC_072_CS', title: 'Stacking Charging Profiles', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'CSMS sends first TxDefaultProfile at stackLevel=1', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(chargingProfile={purpose=TxDefaultProfile, stackLevel=1, ...})', expectedResult: 'First profile set at stackLevel 1' },
      { step: 2, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(Accepted)', expectedResult: 'Profile 1 accepted' },
      { step: 3, action: 'CSMS sends second TxDefaultProfile at stackLevel=2', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(chargingProfile={purpose=TxDefaultProfile, stackLevel=2, ...})', expectedResult: 'Second profile set at stackLevel 2' },
      { step: 4, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(Accepted)', expectedResult: 'Profile 2 accepted' },
      { step: 5, action: 'CSMS requests composite schedule', direction: 'CSMS → SUT', ocppMessage: 'GetCompositeSchedule(connectorId=1, duration=3600)', expectedResult: 'Get composite schedule with stacked profiles' },
      { step: 6, action: 'SUT returns composite schedule applying both profiles (stackLevel 2 overrides stackLevel 1)', direction: 'SUT → CSMS', ocppMessage: 'GetCompositeSchedule.Response(Accepted, schedule=[...])', expectedResult: 'Composite schedule reflects stacking: higher stackLevel takes precedence' },
    ]
  },
  {
    testId: 'TC_082_CS', title: 'Smart Charging - TxDefault Ongoing Tx', suite: 'SmartCharging',
    steps: [
      { step: 1, action: 'Start a charging session (transaction active)', direction: 'Pre-condition', ocppMessage: 'StartTransaction', expectedResult: 'Transaction active' },
      { step: 2, action: 'CSMS sends SetChargingProfile with TxDefaultProfile while transaction is ongoing', direction: 'CSMS → SUT', ocppMessage: 'SetChargingProfile(chargingProfile={purpose=TxDefaultProfile, stackLevel=1, ...})', expectedResult: 'TxDefaultProfile set during active transaction' },
      { step: 3, action: 'SUT applies the profile to the ongoing transaction', direction: 'SUT → CSMS', ocppMessage: 'SetChargingProfile.Response(Accepted)', expectedResult: 'Profile accepted and applied to ongoing transaction' },
      { step: 4, action: 'Verify composite schedule reflects the new profile', direction: 'CSMS → SUT', ocppMessage: 'GetCompositeSchedule(connectorId=1, duration=3600)', expectedResult: 'Composite schedule includes TxDefaultProfile applied during transaction' },
    ]
  },
];

// ==============================
// DataTransfer
// ==============================
const dataTransfer: TestCaseSteps[] = [
  {
    testId: 'TC_062_CS', title: 'Data Transfer to Charge Point', suite: 'DataTransfer',
    steps: [
      { step: 1, action: 'CSMS sends DataTransfer with an unknown vendorId', direction: 'CSMS → SUT', ocppMessage: 'DataTransfer(vendorId=UnknownVendor, messageId=test, data=hello)', expectedResult: 'Data transfer request with unknown vendor' },
      { step: 2, action: 'SUT responds with UnknownVendorId or Rejected', direction: 'SUT → CSMS', ocppMessage: 'DataTransfer.Response(status=UnknownVendorId)', expectedResult: 'Data transfer rejected (unknown vendor)' },
    ]
  },
];

// ==============================
// Security
// ==============================
const security: TestCaseSteps[] = [
  {
    testId: 'TC_073_CS', title: 'Update BasicAuth Password', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends ChangeConfiguration to update AuthorizationKey', direction: 'CSMS → SUT', ocppMessage: 'ChangeConfiguration(key=AuthorizationKey, value=newPassword)', expectedResult: 'Authorization key change request sent' },
      { step: 2, action: 'SUT accepts the new password', direction: 'SUT → CSMS', ocppMessage: 'ChangeConfiguration.Response(status=Accepted)', expectedResult: 'Password accepted' },
      { step: 3, action: 'CSMS disconnects SUT', direction: 'Network', ocppMessage: '— disconnect —', expectedResult: 'SUT disconnected' },
      { step: 4, action: 'SUT reconnects using HTTP Basic Authentication with the new password', direction: 'SUT → CSMS', ocppMessage: 'BootNotification (with new Authorization header)', expectedResult: 'SUT reconnects successfully with new password' },
    ]
  },
  {
    testId: 'TC_074_CS', title: 'Update ChargePoint Certificate', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends ExtendedTriggerMessage to trigger certificate signing', direction: 'CSMS → SUT', ocppMessage: 'ExtendedTriggerMessage(requestedMessage=SignChargePointCertificate)', expectedResult: 'Trigger certificate signing' },
      { step: 2, action: 'SUT sends SignCertificate request', direction: 'SUT → CSMS', ocppMessage: 'SignCertificate(certificateRequest=CSR)', expectedResult: 'Certificate signing request sent' },
      { step: 3, action: 'CSMS sends CertificateSigned with the signed certificate', direction: 'CSMS → SUT', ocppMessage: 'CertificateSigned(certificateChain=signedCert)', expectedResult: 'Signed certificate sent to SUT' },
      { step: 4, action: 'SUT accepts and installs the certificate', direction: 'SUT → CSMS', ocppMessage: 'CertificateSigned.Response(status=Accepted)', expectedResult: 'Certificate installed successfully' },
    ]
  },
  {
    testId: 'TC_075_1_CS', title: 'Install ManufacturerRootCertificate', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends InstallCertificate for ManufacturerRootCertificate', direction: 'CSMS → SUT', ocppMessage: 'InstallCertificate(certificateType=ManufacturerRootCertificate, certificate=PEM)', expectedResult: 'Install manufacturer root cert request' },
      { step: 2, action: 'SUT installs the certificate', direction: 'SUT → CSMS', ocppMessage: 'InstallCertificate.Response(status=Accepted)', expectedResult: 'Certificate installed' },
      { step: 3, action: 'CSMS sends GetInstalledCertificateIds to verify', direction: 'CSMS → SUT', ocppMessage: 'GetInstalledCertificateIds(certificateType=ManufacturerRootCertificate)', expectedResult: 'Verify installed certs' },
      { step: 4, action: 'SUT returns list including the newly installed certificate', direction: 'SUT → CSMS', ocppMessage: 'GetInstalledCertificateIds.Response(status=Accepted, certificateHashDataChain=[...])', expectedResult: 'Manufacturer root certificate confirmed installed' },
    ]
  },
  {
    testId: 'TC_075_2_CS', title: 'Install CentralSystemRootCertificate', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends InstallCertificate for CentralSystemRootCertificate', direction: 'CSMS → SUT', ocppMessage: 'InstallCertificate(certificateType=CentralSystemRootCertificate, certificate=PEM)', expectedResult: 'Install CSMS root cert request' },
      { step: 2, action: 'SUT installs the certificate', direction: 'SUT → CSMS', ocppMessage: 'InstallCertificate.Response(status=Accepted)', expectedResult: 'Certificate installed' },
      { step: 3, action: 'Verify installation via GetInstalledCertificateIds', direction: 'CSMS → SUT', ocppMessage: 'GetInstalledCertificateIds(certificateType=CentralSystemRootCertificate)', expectedResult: 'CentralSystem root certificate confirmed installed' },
    ]
  },
  {
    testId: 'TC_076_CS', title: 'Delete Certificate', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends GetInstalledCertificateIds to list all certs', direction: 'CSMS → SUT', ocppMessage: 'GetInstalledCertificateIds(certificateType=CentralSystemRootCertificate)', expectedResult: 'List installed certificates' },
      { step: 2, action: 'SUT returns list of installed certificate hashes', direction: 'SUT → CSMS', ocppMessage: 'GetInstalledCertificateIds.Response(status=Accepted, certificateHashDataChain=[...])', expectedResult: 'Installed certificates listed' },
      { step: 3, action: 'CSMS sends DeleteCertificate with a certificate hash', direction: 'CSMS → SUT', ocppMessage: 'DeleteCertificate(certificateHashData={hashAlgorithm=SHA256, ...})', expectedResult: 'Delete certificate request' },
      { step: 4, action: 'SUT deletes the certificate', direction: 'SUT → CSMS', ocppMessage: 'DeleteCertificate.Response(status=Accepted)', expectedResult: 'Certificate deleted' },
      { step: 5, action: 'Verify deletion: GetInstalledCertificateIds no longer shows the deleted cert', direction: 'CSMS → SUT', ocppMessage: 'GetInstalledCertificateIds(...)', expectedResult: 'Deleted certificate no longer in list' },
    ]
  },
  {
    testId: 'TC_077_CS', title: 'Invalid ChargePointCertificate', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends ExtendedTriggerMessage(SignChargePointCertificate)', direction: 'CSMS → SUT', ocppMessage: 'ExtendedTriggerMessage(requestedMessage=SignChargePointCertificate)', expectedResult: 'Trigger certificate signing' },
      { step: 2, action: 'SUT sends SignCertificate with CSR', direction: 'SUT → CSMS', ocppMessage: 'SignCertificate(certificateRequest=CSR)', expectedResult: 'CSR sent' },
      { step: 3, action: 'CSMS sends CertificateSigned with an INVALID certificate', direction: 'CSMS → SUT', ocppMessage: 'CertificateSigned(certificateChain=invalidCert)', expectedResult: 'Invalid certificate sent' },
      { step: 4, action: 'SUT rejects the invalid certificate', direction: 'SUT → CSMS', ocppMessage: 'CertificateSigned.Response(status=Rejected)', expectedResult: 'Invalid certificate rejected' },
      { step: 5, action: 'SUT may send SecurityEventNotification for the certificate failure', direction: 'SUT → CSMS', ocppMessage: 'SecurityEventNotification(type=InvalidChargePointCertificate, ...)', expectedResult: 'Security event notification sent' },
    ]
  },
  {
    testId: 'TC_078_CS', title: 'Invalid CentralSystemCertificate', suite: 'Security',
    steps: [
      { step: 1, action: 'SUT connects to CSMS but detects an invalid server certificate', direction: 'SUT', ocppMessage: '— TLS handshake with invalid server cert —', expectedResult: 'SUT detects invalid CSMS certificate' },
      { step: 2, action: 'SUT sends SecurityEventNotification', direction: 'SUT → CSMS', ocppMessage: 'SecurityEventNotification(type=InvalidCentralSystemCertificate, ...)', expectedResult: 'Security event for invalid CSMS cert' },
    ]
  },
  {
    testId: 'TC_079_CS', title: 'Get Security Log', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends GetLog for SecurityLog', direction: 'CSMS → SUT', ocppMessage: 'GetLog(logType=SecurityLog, location=ftp://..., retries=3)', expectedResult: 'Get security log request' },
      { step: 2, action: 'SUT starts uploading security log', direction: 'SUT → CSMS', ocppMessage: 'LogStatusNotification(status=Uploading)', expectedResult: 'Log upload started' },
      { step: 3, action: 'SUT completes log upload', direction: 'SUT → CSMS', ocppMessage: 'LogStatusNotification(status=Uploaded)', expectedResult: 'Security log uploaded successfully' },
    ]
  },
  {
    testId: 'TC_080_CS', title: 'Secure Firmware Update', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends SignedUpdateFirmware with valid signature', direction: 'CSMS → SUT', ocppMessage: 'SignedUpdateFirmware(location=ftp://..., retrieveDate=..., signature=valid)', expectedResult: 'Secure firmware update request sent' },
      { step: 2, action: 'SUT validates signature and starts download', direction: 'SUT → CSMS', ocppMessage: 'SignedUpdateFirmware.Response(status=Accepted)', expectedResult: 'Update accepted, signature valid' },
      { step: 3, action: 'SUT sends SignedFirmwareStatusNotification as download progresses', direction: 'SUT → CSMS', ocppMessage: 'SignedFirmwareStatusNotification(status=Downloading)', expectedResult: 'Firmware download in progress' },
      { step: 4, action: 'SUT completes download', direction: 'SUT → CSMS', ocppMessage: 'SignedFirmwareStatusNotification(status=Downloaded)', expectedResult: 'Download completed' },
      { step: 5, action: 'SUT installs firmware', direction: 'SUT → CSMS', ocppMessage: 'SignedFirmwareStatusNotification(status=Installing)', expectedResult: 'Installation in progress' },
      { step: 6, action: 'SUT completes installation', direction: 'SUT → CSMS', ocppMessage: 'SignedFirmwareStatusNotification(status=Installed)', expectedResult: 'Secure firmware update completed' },
    ]
  },
  {
    testId: 'TC_081_CS', title: 'Secure Firmware Update - Invalid Sig', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends SignedUpdateFirmware with INVALID signature', direction: 'CSMS → SUT', ocppMessage: 'SignedUpdateFirmware(location=ftp://..., retrieveDate=..., signature=invalid)', expectedResult: 'Secure update with invalid signature' },
      { step: 2, action: 'SUT validates signature and rejects it', direction: 'SUT → CSMS', ocppMessage: 'SignedUpdateFirmware.Response(status=Rejected)', expectedResult: 'Update rejected (invalid signature)' },
      { step: 3, action: 'SUT sends SecurityEventNotification about the invalid signature', direction: 'SUT → CSMS', ocppMessage: 'SecurityEventNotification(type=InvalidFirmwareSignature, ...)', expectedResult: 'Security event for invalid firmware signature' },
    ]
  },
  {
    testId: 'TC_083_CS', title: 'Upgrade Security Profile', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends ChangeConfiguration to upgrade SecurityProfile', direction: 'CSMS → SUT', ocppMessage: 'ChangeConfiguration(key=SecurityProfile, value=2)', expectedResult: 'Upgrade security profile to 2' },
      { step: 2, action: 'SUT accepts', direction: 'SUT → CSMS', ocppMessage: 'ChangeConfiguration.Response(Accepted)', expectedResult: 'Security profile accepted' },
      { step: 3, action: 'CSMS sends Reset(Hard) to apply the new security settings', direction: 'CSMS → SUT', ocppMessage: 'Reset(Hard)', expectedResult: 'Hard reset to apply security upgrade' },
      { step: 4, action: 'SUT reboots', direction: 'SUT (reboot)', ocppMessage: '— reboot —', expectedResult: 'SUT reboots' },
      { step: 5, action: 'SUT reconnects using the higher security profile (TLS)', direction: 'SUT → CSMS', ocppMessage: 'BootNotification (over TLS)', expectedResult: 'SUT reconnects with upgraded security' },
    ]
  },
  {
    testId: 'TC_084_CS', title: 'Downgrade Security Profile - Rejected', suite: 'Security',
    steps: [
      { step: 1, action: 'CSMS sends ChangeConfiguration to downgrade SecurityProfile', direction: 'CSMS → SUT', ocppMessage: 'ChangeConfiguration(key=SecurityProfile, value=0)', expectedResult: 'Attempt to downgrade security profile' },
      { step: 2, action: 'SUT rejects the downgrade', direction: 'SUT → CSMS', ocppMessage: 'ChangeConfiguration.Response(status=Rejected)', expectedResult: 'Security downgrade rejected' },
    ]
  },
  {
    testId: 'TC_085_CS', title: 'Basic Authentication', suite: 'Security',
    steps: [
      { step: 1, action: 'SUT establishes WebSocket connection with HTTP Basic Authentication header', direction: 'SUT → CSMS', ocppMessage: '— WebSocket upgrade with Authorization: Basic ... —', expectedResult: 'SUT connects using Basic Authentication' },
      { step: 2, action: 'CSMS validates the Basic Auth credentials', direction: 'CSMS', ocppMessage: '— validate —', expectedResult: 'Basic Authentication credentials accepted' },
      { step: 3, action: 'SUT sends BootNotification to complete registration', direction: 'SUT → CSMS', ocppMessage: 'BootNotification', expectedResult: 'SUT registered successfully using Basic Auth' },
    ]
  },
  {
    testId: 'TC_086_CS', title: 'TLS - Server Certificate', suite: 'Security',
    steps: [
      { step: 1, action: 'SUT establishes TLS-secured WebSocket connection with valid server certificate', direction: 'SUT → CSMS', ocppMessage: '— TLS 1.2+ handshake —', expectedResult: 'TLS connection established' },
      { step: 2, action: 'SUT verifies the CSMS server certificate is valid and trusted', direction: 'SUT', ocppMessage: '— certificate verification —', expectedResult: 'Server certificate verified' },
      { step: 3, action: 'SUT sends BootNotification over the secure connection', direction: 'SUT → CSMS', ocppMessage: 'BootNotification (over TLS)', expectedResult: 'BootNotification sent over TLS' },
      { step: 4, action: 'CSMS accepts boot', direction: 'CSMS → SUT', ocppMessage: 'BootNotification(Accepted) (over TLS)', expectedResult: 'SUT registered successfully over TLS' },
    ]
  },
  {
    testId: 'TC_087_CS', title: 'TLS - Client Certificate', suite: 'Security',
    steps: [
      { step: 1, action: 'SUT establishes TLS-secured WebSocket with client certificate authentication', direction: 'SUT → CSMS', ocppMessage: '— TLS handshake with client cert —', expectedResult: 'TLS connection with client certificate established' },
      { step: 2, action: 'CSMS verifies the SUT client certificate', direction: 'CSMS', ocppMessage: '— client cert verification —', expectedResult: 'Client certificate verified by CSMS' },
      { step: 3, action: 'SUT sends BootNotification over the mutually-authenticated TLS connection', direction: 'SUT → CSMS', ocppMessage: 'BootNotification (over mTLS)', expectedResult: 'BootNotification sent over mTLS' },
      { step: 4, action: 'CSMS accepts boot', direction: 'CSMS → SUT', ocppMessage: 'BootNotification(Accepted) (over mTLS)', expectedResult: 'SUT registered successfully over mTLS' },
    ]
  },
];

// ==============================
// Generator
// ==============================
function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function generateCSV(steps: Step[]): string {
  const header = 'Step,Action,OCPP Message Direction,OCPP Message / Event,Expected Result';
  const rows = steps.map(s =>
    `${s.step},${csvEscape(s.action)},${csvEscape(s.direction)},${csvEscape(s.ocppMessage)},${csvEscape(s.expectedResult)}`
  );
  return header + '\n' + rows.join('\n');
}

function generateSummaryCSV(all: TestCaseSteps[]): string {
  const header = 'Test Case ID,Title,Suite,Number of Steps';
  const rows = all.map(tc =>
    `${tc.testId},${csvEscape(tc.title)},${tc.suite},${tc.steps.length}`
  );
  return header + '\n' + rows.join('\n');
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const all: TestCaseSteps[] = [
    ...maintenance,
    ...coldBoot,
    ...startSession,
    ...stopSession,
    ...cache,
    ...remoteActions,
    ...resetting,
    ...unlocking,
    ...configuration,
    ...meterValues,
    ...basicActions,
    ...remoteActionsNonHappy,
    ...unlockingNonHappy,
    ...powerFailure,
    ...offlineBehavior,
    ...configKeysNonHappy,
    ...faultBehavior,
    ...localAuthList,
    ...firmwareManagement,
    ...diagnostics,
    ...reservation,
    ...remoteTrigger,
    ...smartCharging,
    ...dataTransfer,
    ...security,
  ];

  console.log(`Generating ${all.length} individual CSV files...`);

  for (const tc of all) {
    const csv = generateCSV(tc.steps);
    const filePath = path.join(OUT_DIR, `${tc.testId}.steps.csv`);
    fs.writeFileSync(filePath, csv, 'utf-8');
  }

  // Write summary
  const summary = generateSummaryCSV(all);
  const summaryPath = path.join(OUT_DIR, '_steps_summary.csv');
  fs.writeFileSync(summaryPath, summary, 'utf-8');

  // Verify
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.steps.csv'));
  const totalSteps = all.reduce((sum, tc) => sum + tc.steps.length, 0);

  console.log(`\nDone! Generated ${files.length} step CSV files in: ${OUT_DIR}`);
  console.log(`Total test cases: ${all.length}`);
  console.log(`Total steps: ${totalSteps}`);
  console.log(`Suites covered: ${new Set(all.map(tc => tc.suite)).size}`);
  console.log(`\nFiles: ${files.join(', ')}`);
  console.log(`\nSummary: ${summaryPath}`);
}

main().catch(console.error);
