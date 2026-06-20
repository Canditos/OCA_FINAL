// ══════════════════════════════════════════════════════════════
// OCPP Certification Pipeline — Dashboard Frontend
// ══════════════════════════════════════════════════════════════
//
// Extracted from index.html for maintainability.
// Uses WebSocket for bidirectional communication with the server.
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// SECTION: Global State & Constants
// ══════════════════════════════════════════════════════════════

/** Base API path (empty because the dashboard is served from the same origin) */
const API = '';

/** Shorthand for document.getElementById */
const $ = id => document.getElementById(id);

/** WebSocket connection */
let ws = null;

/** Test suite catalog loaded from /api/testcases */
let testSuites = {};

/** Test case descriptions loaded from /api/testcases/details */
let tcDescriptions = {};

/** Global counter for sequential test case numbering in the modal */
let tcIdx = 0;

/** CDS fix modal — resolve callback and selected tests backup */
let _cdsFixResolve = null;
let _cdsFixSelected = [];

/** History cache */
let historyCache = [];
let triageCache = { totalRuns: 0, byEquipment: {}, byFirmware: {} };

/** Number of log entries currently in the DOM (capped at 500) */
let logCount = 0;

/** ID of the test case currently being uploaded to Jira */
let jiraUploadTc = '';

/** Run ID to associate with Jira upload (set after pipeline completion) */
let jiraUploadBatchRunId = null;

/** Chart instances for history details */
let pieChart = null;
let barChart = null;

/** CDS charts state */
const CHART_MAX_POINTS = 60;
const chartData = { voltage: [], current: [], soc: [], cp: [], power: [] };
const chartStats = {
  voltage: { min: Infinity, max: -Infinity },
  current: { min: Infinity, max: -Infinity },
  soc: { min: Infinity, max: -Infinity },
  power: { min: Infinity, max: -Infinity },
};
let chartsInterval = null;
let chartsPaused = false;
let chartsIntervalMs = 2000;
let sessionStartTime = null;
let accumulatedEnergy = 0; // Wh
let lastPowerTimestamp = null;

/**
 * Keywords used to infer whether a test case modifies the CDS charging state.
 */
const chargingKeywords = ['charging', 'plugin', 'plug in', 'transaction', 'start session', 'stop transaction', 'unlock', 'reset', 'fault', 'reservation', 'meter', 'smart charging', 'composite schedule', 'stacking', 'offline', 'connection loss'];

// ══════════════════════════════════════════════════════════════
// SECTION: Theme Management
// ══════════════════════════════════════════════════════════════

/**
 * Toggles the color theme between Light and Dark mode.
 */
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeUI(isLight);
}

/**
 * Updates the theme toggle button text and icon.
 */
function updateThemeUI(isLight) {
  const icon = $('theme-icon');
  const text = $('theme-text');
  if (icon && text) {
    icon.textContent = isLight ? '🌙' : '☀️';
    text.textContent = isLight ? 'Dark' : 'Light';
  }
}

/**
 * Initializes the theme based on localStorage.
 */
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const isLight = savedTheme === 'light';
  if (isLight) {
    document.documentElement.classList.add('light-theme');
  } else {
    document.documentElement.classList.remove('light-theme');
  }
  updateThemeUI(isLight);
}

// ══════════════════════════════════════════════════════════════
// SECTION: WebSocket Communication (replaces SSE)
// ══════════════════════════════════════════════════════════════

/**
 * Opens (or reopens) the WebSocket connection.
 * Automatically reconnects after 3 seconds if the connection drops.
 */
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    addLog({ timestamp: new Date().toISOString(), level: 'info', message: 'WebSocket connected', service: 'ws' });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('WebSocket message parse error:', e);
    }
  };

  ws.onclose = () => {
    addLog({ timestamp: new Date().toISOString(), level: 'warn', message: 'WebSocket disconnected, reconnecting...', service: 'ws' });
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

/**
 * Handles incoming WebSocket messages.
 */
function handleWsMessage(msg) {
  switch (msg.type) {
    case 'log':
      addLog(msg.data);
      break;
    case 'status':
      if (msg.data.service) {
        updSvc(msg.data.service, { status: msg.data.status, info: msg.data.info });
      } else {
        if (msg.data.cds) updSvc('cds', msg.data.cds);
        if (msg.data.octt) updSvc('octt', msg.data.octt);
        if (msg.data.jira) updSvc('jira', msg.data.jira);
      }
      break;
    case 'pipeline':
      updBanner(msg.data);
      if (msg.data.runId) { jiraUploadBatchRunId = msg.data.runId; }
      if (msg.data.results) {
        renderResults(msg.data.results);
        renderResultsTable({ results: msg.data.results });
      }
      if (msg.data.state === 'done' || msg.data.state === 'error' || msg.data.state === 'cancelled') {
        fetchResults();
        updBtns(false);
        if (msg.data.results && msg.data.results.length > 0) {
          setTimeout(() => openJiraUploadModal(msg.data.results), 2000);
        }
      }
      break;
    case 'connected':
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `Connected (client ${msg.data.clientId})`, service: 'ws' });
      break;
    default:
      console.log('Unknown WS message type:', msg.type);
  }
}

/**
 * Sends a command to the server via WebSocket.
 * @param {string} command - Command name
 * @param {object} payload - Command payload
 */
function sendWsCommand(command, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command, ...payload }));
  } else {
    console.warn('WebSocket not connected, cannot send command:', command);
  }
}

// ══════════════════════════════════════════════════════════════
// SECTION: Service Status Updates
// ══════════════════════════════════════════════════════════════

/**
 * Updates a service indicator dot and detail text.
 */
function updSvc(key, status) {
  const ind = $('ind-' + key);
  const detail = $('detail-' + key);
  const dot = $('h-dot-' + key);
  
  if (ind) ind.className = 'svc-dot ' + (status.status || '');
  if (detail) detail.textContent = status.info;
  if (dot) dot.className = 'dot ' + (status.status === 'connected' || status.status === 'running' ? 'on' : status.status === 'error' ? 'err' : 'off');
}

/**
 * Updates the pipeline status banner.
 */
function updBanner(pipeline) {
  const banner = $('banner'), msg = $('banner-msg'), spinner = $('spinner');
  banner.classList.add('active');
  const isRunning = ['starting', 'preparing', 'testing', 'cleaning', 'running'].includes(pipeline.state);
  banner.className = 'banner active ' + (isRunning ? 'running' : pipeline.state === 'done' ? 'done' : 'error');
  msg.textContent = pipeline.message || pipeline.state;
  spinner.style.display = isRunning ? 'block' : 'none';
  if (pipeline.state === 'done' || pipeline.state === 'error') setTimeout(() => banner.classList.remove('active'), 10000);
}

/**
 * Toggles the Run/Stop buttons.
 */
function updBtns(running) {
  $('btn-run').disabled = running;
  $('btn-stop').disabled = !running;
}

// ══════════════════════════════════════════════════════════════
// SECTION: Log Rendering
// ══════════════════════════════════════════════════════════════

/**
 * Appends a log entry to the log panel.
 */
function addLog(entry) {
  const panel = $('logs');
  const row = document.createElement('div');
  row.className = 'log-entry';
  const time = new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false });
  row.innerHTML = `<span class="log-time">${time}</span><span class="log-lvl ${entry.level}">${entry.level}</span><span class="log-svc">[${entry.service}]</span><span class="log-msg">${entry.message}</span>`;
  panel.appendChild(row);
  logCount++;
  if (logCount > 500) { panel.removeChild(panel.firstChild); logCount--; }
  panel.scrollTop = panel.scrollHeight;
}

// ══════════════════════════════════════════════════════════════
// SECTION: Timeout Configuration
// ══════════════════════════════════════════════════════════════

/**
 * Loads pipeline timeout configuration from server and populates UI
 */
async function loadTimeoutConfig() {
  try {
    const r = await fetch(API + '/api/pipeline-config');
    const j = await r.json();
    $('inp-timeout-default-max').value = j.timeouts.default.maxTimeoutPeriod;
    $('inp-timeout-default-long').value = j.timeouts.default.longOperationTimeout;
    $('inp-timeout-reboot-max').value = j.timeouts.reboot.maxTimeoutPeriod;
    $('inp-timeout-reboot-long').value = j.timeouts.reboot.longOperationTimeout;
  } catch (e) {
    console.error('Failed to load timeout config:', e);
  }
}

/**
 * Saves timeout configuration to server
 */
async function saveTimeouts() {
  const el = $('timeout-status');
  el.style.display = 'block';
  el.style.color = 'var(--text-dim)';
  el.textContent = 'Saving...';
  
  try {
    // Save default timeouts
    await fetch(API + '/api/pipeline-config/timeouts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'default',
        maxTimeoutPeriod: parseInt($('inp-timeout-default-max').value),
        longOperationTimeout: parseInt($('inp-timeout-default-long').value),
        maxTimeDeviation: 4
      })
    });
    
    // Save reboot timeouts
    await fetch(API + '/api/pipeline-config/timeouts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'reboot',
        maxTimeoutPeriod: parseInt($('inp-timeout-reboot-max').value),
        longOperationTimeout: parseInt($('inp-timeout-reboot-long').value),
        maxTimeDeviation: 4
      })
    });
    
    el.style.color = 'var(--pass)';
    el.textContent = '✓ Timeouts saved';
    addLog({ timestamp: new Date().toISOString(), level: 'success', message: 'Timeout configuration saved', service: 'ui' });
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = '✗ ' + e.message;
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Failed to save timeouts: ' + e.message, service: 'ui' });
  }
}

// ══════════════════════════════════════════════════════════════
// SECTION: Service Checks & Configuration
// ══════════════════════════════════════════════════════════════

/**
 * Checks all three external services (CDS, OCTT, Jira) in parallel.
 */
async function checkServices() {
  addLog({ timestamp: new Date().toISOString(), level: 'info', message: 'Checking services...', service: 'ui' });
  try { await fetch(API + '/api/cds/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: $('inp-cds').value, port: parseInt($('inp-cds-port').value) }) }); } catch (e) { }
  try { await fetch(API + '/api/octt/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: $('inp-octt-url').value, token: $('inp-octt-token').value }) }); } catch (e) { }
  try { await fetch(API + '/api/jira/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { }
}

/**
 * Verifies the OCTT configuration name exists.
 */
async function checkOcttConfig() {
  const el = $('octt-cfg-r'); el.style.display = 'block'; el.style.color = 'var(--text-dim)'; el.textContent = 'Checking...';
  try {
    const r = await fetch(API + '/api/octt/check-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configurationName: $('inp-config').value, baseUrl: $('inp-octt-url').value, token: $('inp-octt-token').value }) });
    const j = await r.json();
    if (!j.ok) { el.style.color = 'var(--danger)'; el.textContent = j.error; return; }
    el.style.color = j.exists ? 'var(--pass)' : 'var(--danger)';
    el.innerHTML = `Config: ${j.exists ? '&#10003; exists' : '&#10007; NOT FOUND'} | Tests: ${j.testcasesCount} | Session: ${j.sessionStatus}`;
    addLog({ timestamp: new Date().toISOString(), level: j.exists ? 'success' : 'warn', message: `Config "${$('inp-config').value}": ${j.exists ? j.testcasesCount + ' tests, session: ' + j.sessionStatus : 'NOT FOUND'}`, service: 'ui' });
  } catch (e) { el.style.color = 'var(--danger)'; el.textContent = e.message; }
}

/**
 * Applies the selected charge profile to the CDS hardware.
 */
async function configureCds() {
  try {
    const r = await fetch(API + '/api/cds/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: $('sel-profile').value, ip: $('inp-cds').value, port: parseInt($('inp-cds-port').value) }) });
    const j = await r.json();
    addLog({ timestamp: new Date().toISOString(), level: j.ok ? 'success' : 'error', message: 'CDS: ' + (j.ok ? j.profile : j.error), service: 'ui' });
  } catch (e) { addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'CDS error: ' + e.message, service: 'ui' }); }
}

// ══════════════════════════════════════════════════════════════
// SECTION: CDS Fix Modal
// ══════════════════════════════════════════════════════════════

async function checkCdsWithRetry(ip, port, cdsTestCount, selected) {
  try {
    const r = await fetch(API + '/api/cds/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, port }) });
    const j = await r.json();
    if (j.ok) {
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: 'CDS OK: ' + (j.flags || []).join(', '), service: 'ui' });
      return 'ok';
    }
    return openCdsFixModal(j.error || 'No response', cdsTestCount);
  } catch (e) {
    return openCdsFixModal(e.message || 'Network error', cdsTestCount);
  }
}

function openCdsFixModal(errorMsg, cdsTestCount) {
  $('cds-fix-ip').value = $('inp-cds').value;
  $('cds-fix-sink').value = $('inp-sink').value;
  $('cds-fix-profile').value = $('sel-profile').value;
  $('cds-fix-error').textContent = errorMsg;
  $('cds-fix-count').textContent = cdsTestCount;
  $('cds-fix-status').textContent = 'Unreachable';
  $('cds-fix-status').style.color = 'var(--danger)';
  $('cds-fix-result').style.display = 'none';
  $('btn-cds-fix-retry').disabled = false;
  $('cds-fix-modal-bg').style.display = 'flex';
  return new Promise(resolve => { _cdsFixResolve = resolve; });
}

function closeCdsFixModal(action) {
  $('cds-fix-modal-bg').style.display = 'none';
  if (_cdsFixResolve) { _cdsFixResolve(action); _cdsFixResolve = null; }
}

async function retryCdsCheck() {
  const ip = $('cds-fix-ip').value.trim();
  const port = parseInt($('inp-cds-port').value) || 51001;
  const el = $('cds-fix-result');
  el.style.display = 'block';
  el.style.color = 'var(--text-dim)';
  el.textContent = 'Connecting to ' + ip + ':' + port + '...';
  $('cds-fix-status').textContent = 'Connecting...';
  $('cds-fix-status').style.color = 'var(--text-dim)';
  $('btn-cds-fix-retry').disabled = true;
  try {
    const r = await fetch(API + '/api/cds/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, port }) });
    const j = await r.json();
    if (j.ok) {
      el.style.color = 'var(--pass)';
      el.textContent = 'Connected! Status: ' + (j.flags || []).join(', ');
      $('cds-fix-status').textContent = 'Connected';
      $('cds-fix-status').style.color = 'var(--pass)';
      $('inp-cds').value = ip;
      $('inp-cds-port').value = port;
      $('inp-sink').value = $('cds-fix-sink').value;
      $('sel-profile').value = $('cds-fix-profile').value;
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `CDS reconnected at ${ip}:${port}`, service: 'ui' });
      setTimeout(() => closeCdsFixModal('ok'), 800);
    } else {
      el.style.color = 'var(--danger)';
      el.textContent = 'Still unreachable: ' + (j.error || 'No response');
      $('cds-fix-status').textContent = 'Failed';
      $('cds-fix-status').style.color = 'var(--danger)';
      $('cds-fix-error').textContent = j.error || 'No response';
      $('btn-cds-fix-retry').disabled = false;
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = 'Error: ' + e.message;
    $('cds-fix-status').textContent = 'Error';
    $('cds-fix-status').style.color = 'var(--danger)';
    $('btn-cds-fix-retry').disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// SECTION: Pipeline Control (Playwright)
// ══════════════════════════════════════════════════════════════

function needsCds(testId) {
  const chargingTests = /^TC_(003|004|005|007|010|011|012|017|018|026|027|028|030|031|036|037|038|039|046|047|048|049|050|051|052|053|056|057|058|059|060|066|067|068|069|070|071|072|082)_/;
  return chargingTests.test(testId);
}

function needsCdsReset(tc) {
  const desc = (tcDescriptions[tc] || '').toLowerCase();
  return chargingKeywords.some(kw => desc.includes(kw));
}

async function runPlaywright() {
  const selected = getSelected();
  if (selected.length === 0) { addLog({ timestamp: new Date().toISOString(), level: 'warn', message: 'No tests selected!', service: 'ui' }); return; }

  const cdsRequired = selected.some(needsCds);
  const cdsOnlyCount = selected.filter(needsCds).length;
  const noCdsCount = selected.length - cdsOnlyCount;

  if (cdsRequired) {
    addLog({ timestamp: new Date().toISOString(), level: 'info', message: `Pre-flight: checking CDS (${cdsOnlyCount} tests need it)...`, service: 'ui' });
    const cdsOk = await checkCdsWithRetry($('inp-cds').value, parseInt($('inp-cds-port').value), cdsOnlyCount, selected);
    if (cdsOk === 'cancel') return;
    if (cdsOk === 'skip') {
      const nonCds = selected.filter(t => !needsCds(t));
      if (nonCds.length === 0) { addLog({ timestamp: new Date().toISOString(), level: 'warn', message: 'All selected tests require CDS — nothing to run.', service: 'ui' }); return; }
      addLog({ timestamp: new Date().toISOString(), level: 'warn', message: `Skipping ${cdsOnlyCount} CDS tests. Running ${nonCds.length} remaining.`, service: 'ui' });
      selected.length = 0; selected.push(...nonCds);
    }
  } else {
    addLog({ timestamp: new Date().toISOString(), level: 'info', message: `Pre-flight: skipping CDS check (${noCdsCount}/${selected.length} tests do not need CDS)`, service: 'ui' });
  }

  addLog({ timestamp: new Date().toISOString(), level: 'info', message: 'Pre-flight: checking OCTT config...', service: 'ui' });
  try {
    const octtCheck = await fetch(API + '/api/octt/check-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configurationName: $('inp-config').value }) });
    const octtStatus = await octtCheck.json();
    if (!octtStatus.ok || !octtStatus.exists) {
      addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'OCTT config "' + $('inp-config').value + '" not found or unreachable.', service: 'ui' });
      $('banner').classList.add('active', 'error');
      $('banner-msg').textContent = 'OCTT config missing — check settings';
      return;
    }
    addLog({ timestamp: new Date().toISOString(), level: 'success', message: 'OCTT OK: config exists (' + octtStatus.configurations.length + ' total)', service: 'ui' });
  } catch (e) {
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'OCTT check failed: ' + e.message, service: 'ui' });
    return;
  }

  try { await fetch(API + '/api/results/reset', { method: 'POST' }); } catch (e) { }
  resetResults();
  updBtns(true);
  $('banner').classList.add('active', 'running');
  $('banner-msg').textContent = `Running ${selected.length} tests...`;
  $('spinner').style.display = 'block';
  $('rtbody').innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);text-align:center;padding:16px">Running...</td></tr>';
  $('logs').innerHTML = ''; logCount = 0;
  try {
    await fetch(API + '/api/pipeline/run-playwright', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testcaseNames: selected, configurationName: $('inp-config').value }) });
  } catch (e) {
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Start failed: ' + e.message, service: 'ui' });
    updBtns(false);
  }
}

async function stopPlaywright() {
  try { await fetch(API + '/api/pipeline/stop-playwright', { method: 'POST' }); } catch (e) { }
}

async function fetchResults() {
  try {
    const r = await fetch(API + '/api/results');
    const j = await r.json();
    renderResultsTable(j);
  } catch (e) { }
}

// ══════════════════════════════════════════════════════════════
// SECTION: Results Rendering
// ══════════════════════════════════════════════════════════════

function resetResults() {
  $('r-p').textContent = '0'; $('r-f').textContent = '0'; $('r-i').textContent = '0'; $('r-e').textContent = '0';
  $('pb-p').style.width = '0%'; $('pb-f').style.width = '0%'; $('pb-i').style.width = '0%'; $('pb-e').style.width = '0%';
  $('r-rate').textContent = '—';
  $('rtbody').innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);text-align:center;padding:16px">No results yet</td></tr>';
}

function renderResults(results) {
  if (!results.length) return;
  const passed = results.filter(r => r.verdict === 'pass').length;
  const failed = results.filter(r => r.verdict === 'fail').length;
  const inconc = results.filter(r => r.verdict === 'inconc').length;
  const errors = results.filter(r => r.verdict === 'error').length;
  const total = results.length;
  $('r-p').textContent = passed;
  $('r-f').textContent = failed;
  $('r-i').textContent = inconc;
  $('r-e').textContent = errors;
  $('pb-p').style.width = total ? (passed / total * 100) + '%' : '0%';
  $('pb-f').style.width = total ? (failed / total * 100) + '%' : '0%';
  $('pb-i').style.width = total ? (inconc / total * 100) + '%' : '0%';
  $('pb-e').style.width = total ? (errors / total * 100) + '%' : '0%';
  $('r-rate').textContent = total ? Math.round(passed / total * 100) + '%' : '—';
}

function renderResultsTable(data) {
  renderResults(data.results);
  const tbody = $('rtbody');
  if (!data.results.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);text-align:center;padding:16px">No results</td></tr>'; return; }
  tbody.innerHTML = data.results.map((result, index) => {
    const verdict = result.verdict.toLowerCase();
    const isFailure = verdict === 'fail' || verdict === 'inconc' || verdict === 'error';
    const logBtn = `<button class="sm" onclick="viewLog('${result.testCase}')" title="View Log">Log</button>`;
    const dlBtn = `<button class="sm" onclick="downloadLog('${result.testCase}')" title="Download Report">DL</button>`;
    const jiraBtn = isFailure ? `<button class="sm" onclick="openJiraModal('${result.testCase}','${verdict}')" title="Upload to Jira" style="border-color:var(--accent2);color:var(--accent2)">Jira</button>` : '';
    const defectBtn = isFailure ? `<button class="sm" onclick="createDefect('${result.testCase}','${verdict}')" title="Create Defect in Jira" style="border-color:var(--danger);color:var(--danger)">&#128295; Defect</button>` : '';
    return `<tr><td style="color:var(--text-dim)">${index + 1}</td><td style="color:var(--text-bright)">${result.testCase}</td><td><span class="vb ${verdict}">${result.verdict}</span></td><td style="color:var(--text-dim)">${result.duration || 0}s</td><td style="text-align:right;white-space:nowrap">${logBtn} ${dlBtn} ${jiraBtn} ${defectBtn}</td></tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// SECTION: Report Actions (View, Download, Jira)
// ══════════════════════════════════════════════════════════════

function viewLog(testCaseId) {
  addLog({ timestamp: new Date().toISOString(), level: 'info', message: `Loading log for ${testCaseId}...`, service: 'ui' });
  fetch(API + '/api/reports/view-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testcaseName: testCaseId }) }).then(r => r.json()).then(j => {
    if (j.ok) {
      const isLight = document.documentElement.classList.contains('light-theme');
      const bg = isLight ? '#f6f8fa' : '#0a0e14';
      const fg = isLight ? '#24292f' : '#c0ccd8';
      const border = isLight ? '#d0d7de' : '#1e2733';
      const thBg = isLight ? '#eaeef2' : '#131820';
      const thFg = isLight ? '#57606a' : '#5c6778';
      const w = window.open('', '_blank', 'width=900,height=600');
      w.document.write(`<html><head><title>Log: ${testCaseId}</title><style>body{font-family:monospace;font-size:12px;background:${bg};color:${fg};padding:20px;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid ${border};padding:4px 8px;text-align:left}th{background:${thBg};color:${thFg}}</style></head><body><h2>${testCaseId}</h2><pre>${j.content}</pre></body></html>`);
      w.document.close();
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `Log opened for ${testCaseId}`, service: 'ui' });
    } else {
      addLog({ timestamp: new Date().toISOString(), level: 'error', message: `Log failed: ${j.error}`, service: 'ui' });
    }
  }).catch(e => addLog({ timestamp: new Date().toISOString(), level: 'error', message: `Log error: ${e.message}`, service: 'ui' }));
}

function downloadLog(testCaseId) {
  addLog({ timestamp: new Date().toISOString(), level: 'info', message: `Downloading report for ${testCaseId}...`, service: 'ui' });
  fetch(API + '/api/reports/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testcaseName: testCaseId, format: 'CSV' }) }).then(r => r.json()).then(j => {
    if (j.ok) {
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `Report saved: ${j.filename} (${j.size} bytes)`, service: 'ui' });
      const a = document.createElement('a'); a.href = `${API}/reports/${j.filename}`; a.download = j.filename; a.click();
    } else {
      addLog({ timestamp: new Date().toISOString(), level: 'error', message: `Download failed: ${j.error}`, service: 'ui' });
    }
  }).catch(e => addLog({ timestamp: new Date().toISOString(), level: 'error', message: `Download error: ${e.message}`, service: 'ui' }));
}

function openJiraModal(testCaseId, verdict) {
  jiraUploadTc = testCaseId;
  $('jira-upload-tc').textContent = testCaseId;
  $('jira-upload-status').style.display = 'none';
  $('jira-modal-bg').style.display = 'flex';
}

function closeJiraModal() { $('jira-modal-bg').style.display = 'none'; }

function showJiraSuccessModal(message, detail) {
  $('jira-success-msg').innerHTML = message;
  $('jira-success-detail').innerHTML = detail || '';
  $('jira-success-modal-bg').style.display = 'flex';
}

function closeJiraSuccessModal() {
  $('jira-success-modal-bg').style.display = 'none';
  $('jira-modal-bg').style.display = 'none';
  $('jira-upload-modal-bg').style.display = 'none';
}

async function uploadToJira() {
  const el = $('jira-upload-status');
  el.style.display = 'block';
  el.style.color = 'var(--text-dim)';
  el.textContent = 'Uploading...';
  $('btn-jira-upload').disabled = true;
  try {
    const r = await fetch(API + '/api/jira/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        testcase: jiraUploadTc,
        testplan: $('inp-testplan').value,
        testexecution: $('inp-testexec').value,
        ocppVersion: $('inp-ocpp-ver').value,
        chargerNumber: $('inp-charger').value,
        comment: $('inp-jira-comment').value
      })
    });
    const j = await r.json();
    if (j.ok) {
      el.style.color = 'var(--pass)';
      el.textContent = `Uploaded to ${j.issueKey}: ${j.message}`;
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `Jira upload: ${j.issueKey}`, service: 'ui' });
      showJiraSuccessModal(`Uploaded to ${j.issueKey}`, j.message);
    } else {
      el.style.color = 'var(--danger)';
      el.textContent = `Error: ${j.error}`;
      addLog({ timestamp: new Date().toISOString(), level: 'error', message: `Jira upload failed: ${j.error}`, service: 'ui' });
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = `Error: ${e.message}`;
  }
  $('btn-jira-upload').disabled = false;
}

// ══════════════════════════════════════════════════════════════
// SECTION: Test Case Selector Modal
// ══════════════════════════════════════════════════════════════

function openModal() { $('modal-bg').style.display = 'flex'; }
function closeModal() { $('modal-bg').style.display = 'none'; }

function loadTC() {
  Promise.all([
    fetch(API + '/api/testcases').then(r => r.json()),
    fetch(API + '/api/testcases/details').then(r => r.json())
  ]).then(([suites, descs]) => { testSuites = suites; tcDescriptions = descs; renderModal(); }).catch(() => { });
}

function renderModal() {
  const body = $('m-body');
  let html = '';
  tcIdx = 0;
  for (const [suite, tests] of Object.entries(testSuites)) {
    html += `<div style="margin-bottom:14px">`;
    html += `<div class="suite-hdr" onclick="togSuite(this)"><span class="suite-arrow">&#9660;</span><span class="suite-name">${suite}</span><span class="suite-count">${tests.length}</span><button class="sm" onclick="event.stopPropagation();togSuiteAll('${suite}')" style="padding:2px 8px">Toggle</button></div>`;
    html += `<div class="suite-tests">`;
    for (const tc of tests) {
      tcIdx++;
      const desc = tcDescriptions[tc] || '';
      const needsReset = needsCdsReset(tc);
      const resetIcon = needsReset ? '<span style="color:var(--warn);font-size:8px;margin-left:4px" title="Needs CDS reset">&#9888;</span>' : '';
      html += `<label class="tc-row"><input type="checkbox" class="tc-check" value="${tc}" data-needs-reset="${needsReset}" checked><span class="tc-num">${String(tcIdx).padStart(3, '0')}</span><span class="tc-name">${tc}${resetIcon}</span><span style="color:var(--text-dim);font-size:9px;margin-left:6px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc}</span></label>`;
    }
    html += `</div></div>`;
  }
  body.innerHTML = html;
  updCount();
}

function togSuite(el) {
  const testsContainer = el.nextElementSibling;
  const arrow = el.querySelector('.suite-arrow');
  const isOpen = testsContainer.style.display !== 'none';
  testsContainer.style.display = isOpen ? 'none' : 'block';
  arrow.innerHTML = isOpen ? '&#9654;' : '&#9660;';
}

function togSuiteAll(suiteName) {
  for (const div of document.querySelectorAll('#m-body > div')) {
    const nameEl = div.querySelector('.suite-name');
    if (nameEl && nameEl.textContent === suiteName) {
      const checkboxes = div.querySelectorAll('.tc-check');
      const allChecked = Array.from(checkboxes).every(x => x.checked);
      checkboxes.forEach(x => x.checked = !allChecked);
      break;
    }
  }
  updCount();
}

function selAll() { document.querySelectorAll('.tc-check').forEach(c => c.checked = true); updCount(); }
function selNone() { document.querySelectorAll('.tc-check').forEach(c => c.checked = false); updCount(); }
function selMaint() { document.querySelectorAll('.tc-check').forEach(c => { c.checked = c.value.startsWith('tc_bi_'); }); updCount(); }
function selReboot() {
  const rebootTests = ['TC_001_CS', 'TC_002_CS', 'TC_013_CS', 'TC_014_CS', 'TC_015_CS', 'TC_016_CS', 'TC_032_1_CS', 'TC_032_2_CS', 'TC_034_CS'];
  document.querySelectorAll('.tc-check').forEach(c => { c.checked = rebootTests.some(t => c.value.toLowerCase().trim().includes(t.toLowerCase().trim())); });
  updCount();
}

function selPics() {
  const picsTests = [
    "TC_001_CS", "TC_002_CS", "TC_003_CS", "TC_004_1_CS", "TC_004_2_CS",
    "TC_005_2_CS", "TC_007_1_CS", "TC_008_1_CS", "TC_010_CS", "TC_011_1_CS",
    "TC_011_2_CS", "TC_012_CS", "TC_013_CS", "TC_014_CS", "TC_015_CS",
    "TC_016_CS", "TC_017_2_CS", "TC_018_2_CS", "TC_019_CS", "TC_021_CS",
    "TC_023_4_CS", "TC_026_CS", "TC_028_CS", "TC_031_CS", "TC_032_2_CS",
    "TC_034_CS", "TC_036_CS", "TC_037_1_CS", "TC_037_2_CS", "TC_037_3_CS",
    "TC_038_CS", "TC_039_CS", "TC_040_1_CS", "TC_040_2_CS", "TC_042_2_CS",
    "TC_043_CS", "TC_043_2_CS", "TC_045_1_CS", "TC_045_2_CS", "TC_046_1_CS",
    "TC_046_2_CS", "TC_047_CS", "TC_048_2_CS", "TC_048_3_CS", "TC_049_CS",
    "TC_050_2_CS", "TC_050_3_CS", "TC_051_CS", "TC_052_CS", "TC_053_1_CS",
    "TC_054_CS", "TC_055_CS", "TC_056_CS", "TC_057_CS", "TC_058_1_CS",
    "TC_058_2_CS", "TC_059_CS", "TC_060_CS", "TC_061_1_CS", "TC_062_CS",
    "TC_066_CS", "TC_067_CS", "TC_068_CS", "TC_069_CS", "TC_070_CS",
    "TC_071_CS", "TC_072_CS", "TC_073_CS", "TC_075_1_CS", "TC_075_2_CS",
    "TC_076_CS", "TC_078_CS", "TC_079_CS", "TC_080_CS", "TC_081_CS",
    "TC_082_CS", "TC_083_CS", "TC_084_CS", "TC_085_CS", "TC_086_CS"
  ];
  document.querySelectorAll('.tc-check').forEach(c => { c.checked = picsTests.some(t => c.value.toLowerCase().trim().includes(t.toLowerCase().trim())); });
  updCount();
}

function selNoCds() {
  document.querySelectorAll('.tc-check').forEach(c => { c.checked = !needsCds(c.value); });
  updCount();
}

function selCore() {
  const coreSuites = ['Authorization', 'DataTransfer', 'FirmwareManagement', 'LocalAuthList', 'MeterValues', 'Provisioning', 'RemoteControl', 'RemoteTrigger', 'Reservation', 'Transactions'];
  document.querySelectorAll('#m-body > div').forEach(div => {
    const nameEl = div.querySelector('.suite-name');
    if (nameEl && coreSuites.includes(nameEl.textContent)) {
      div.querySelectorAll('.tc-check').forEach(c => c.checked = true);
    } else {
      div.querySelectorAll('.tc-check').forEach(c => c.checked = false);
    }
  });
  updCount();
}

function updCount() {
  const total = document.querySelectorAll('.tc-check').length;
  const selected = document.querySelectorAll('.tc-check:checked').length;
  $('m-count').textContent = `${selected} / ${total}`;
  $('tc-sum').textContent = `${selected} / ${total}`;
}

document.addEventListener('change', e => { if (e.target.classList.contains('tc-check')) updCount(); });

function getSelected() {
  return Array.from(document.querySelectorAll('.tc-check:checked')).map(c => c.value);
}

// ══════════════════════════════════════════════════════════════
// SECTION: Initialization & Reboot Helpers
// ══════════════════════════════════════════════════════════════

async function init() {
  setInterval(() => $('h-time').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }), 1000);
  connectWebSocket();
  loadTC();
  try {
    const r = await fetch(API + '/api/config');
    const j = await r.json();
    if (j.octtBaseUrl) $('inp-octt-url').value = j.octtBaseUrl;
    if (j.octtToken) $('inp-octt-token').value = j.octtToken;
    if (j.cdsIp) $('inp-cds').value = j.cdsIp;
    if (j.cdsPort) $('inp-cds-port').value = j.cdsPort;
    if (j.cdsSink) $('inp-sink').value = j.cdsSink;
    if (j.octtOcppVersion) $('sel-ver').value = j.octtOcppVersion;
    addLog({ timestamp: new Date().toISOString(), level: 'info', message: 'Config loaded from server', service: 'ui' });
  } catch { }
  loadTimeoutConfig();
  checkRelayStatus();
  checkServices();
}

async function checkRelayStatus() {
  try {
    const r = await fetch(API + '/api/relay/status', { method: 'POST' });
    const j = await r.json();
    const dot = $('relay-dot');
    const txt = $('relay-status');
    if (j.running) { dot.className = 'dot on'; txt.textContent = 'Running'; txt.style.color = 'var(--pass)'; }
    else { dot.className = 'dot off'; txt.textContent = 'Stopped'; txt.style.color = 'var(--text-dim)'; }
  } catch { }
}

async function saveConfig() {
  const url = $('inp-octt-url').value.trim();
  const token = $('inp-octt-token').value.trim();
  const cfg = {
    octtBaseUrl: url,
    octtToken: token,
    octtOcppVersion: $('sel-ver').value,
    cdsIp: $('inp-cds').value.trim(),
    cdsPort: parseInt($('inp-cds-port').value) || 51001,
    cdsSink: parseInt($('inp-sink').value) || 12,
  };

  const el = $('octt-cfg-r');
  el.style.display = 'block';
  if (!url) { el.style.color = 'var(--danger)'; el.textContent = 'Error: API URL is required'; return; }
  if (!url.match(/^https?:\/\/.+/)) { el.style.color = 'var(--danger)'; el.textContent = 'Error: URL must start with http:// or https://'; return; }
  if (!token) { el.style.color = 'var(--danger)'; el.textContent = 'Error: Token is required'; return; }
  if (token.includes('http') || token.includes('octt.openchargealliance.org')) { el.style.color = 'var(--danger)'; el.textContent = 'Error: Token contains URL — paste only the token!'; return; }
  if (token.length < 20) { el.style.color = 'var(--warn)'; el.textContent = 'Warning: Token looks too short'; }

  try {
    const r = await fetch(API + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
    const j = await r.json();
    if (j.ok) {
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: 'Config saved to dashboard-config.json', service: 'ui' });
      el.style.color = 'var(--pass)';
      el.textContent = 'Saved! Checking services...';
      setTimeout(() => el.style.display = 'none', 3000);
      setTimeout(checkRelayStatus, 1500);
      setTimeout(checkServices, 2000);
    } else {
      el.style.color = 'var(--danger)';
      // Show field-level validation errors if available
      const errorMsg = j.fields && j.fields.length 
        ? j.fields.map(f => `${f.path}: ${f.message}`).join('; ')
        : j.error;
      el.textContent = 'Save failed: ' + errorMsg;
      addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Save failed: ' + errorMsg, service: 'ui' });
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = 'Save error: ' + e.message;
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Save error: ' + e.message, service: 'ui' });
  }
}

async function prepareReboot() {
  const el = $('reboot-status');
  el.style.display = 'block';
  el.style.color = 'var(--warn)';
  el.textContent = 'Applying reboot timeouts (600/650)...';
  try {
    const r = await fetch(API + '/api/octt/prepare-reboot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configurationName: $('inp-config').value }) });
    const j = await r.json();
    if (j.ok) {
      el.style.color = 'var(--pass)';
      el.textContent = 'Reboot timeouts applied!';
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: 'Reboot timeouts applied', service: 'ui' });
    } else {
      el.style.color = 'var(--danger)';
      el.textContent = 'Error: ' + j.error;
      addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Reboot prep failed: ' + j.error, service: 'ui' });
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = 'Error: ' + e.message;
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Reboot prep error: ' + e.message, service: 'ui' });
  }
}

async function restoreDefaults() {
  const el = $('reboot-status');
  el.style.display = 'block';
  el.style.color = 'var(--warn)';
  el.textContent = 'Restoring default timeouts (70/450)...';
  try {
    const r = await fetch(API + '/api/octt/restore-defaults', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configurationName: $('inp-config').value }) });
    const j = await r.json();
    if (j.ok) {
      el.style.color = 'var(--pass)';
      el.textContent = 'Default timeouts restored!';
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: 'Default timeouts restored', service: 'ui' });
    } else {
      el.style.color = 'var(--danger)';
      el.textContent = 'Error: ' + j.error;
      addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Restore failed: ' + j.error, service: 'ui' });
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = 'Error: ' + e.message;
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Restore error: ' + e.message, service: 'ui' });
  }
}

// ══════════════════════════════════════════════════════════════
// SECTION: CDS Live Charts
// ══════════════════════════════════════════════════════════════

function openCdsCharts() {
  $('charts-modal-bg').style.display = 'flex';
  chartsPaused = false;
  sessionStartTime = Date.now();
  accumulatedEnergy = 0;
  lastPowerTimestamp = null;
  // Reset stats
  Object.keys(chartStats).forEach(k => { chartStats[k].min = Infinity; chartStats[k].max = -Infinity; });
  $('btn-charts-toggle').innerHTML = '&#9208; Pause';
  $('charts-status').textContent = 'Polling...';
  $('charts-status').style.color = 'var(--accent)';
  $('session-start-time').textContent = new Date().toLocaleTimeString('en-GB');
  $('charts-interval').value = chartsIntervalMs;
  $('charts-interval-label').textContent = (chartsIntervalMs / 1000).toFixed(1) + 's';
  updateSessionDuration();
  pollMeasurements();
  chartsInterval = setInterval(pollMeasurements, chartsIntervalMs);
  setInterval(updateSessionDuration, 1000);
}

function closeCdsCharts() {
  $('charts-modal-bg').style.display = 'none';
  if (chartsInterval) { clearInterval(chartsInterval); chartsInterval = null; }
}

function toggleCharts() {
  chartsPaused = !chartsPaused;
  $('btn-charts-toggle').innerHTML = chartsPaused ? '&#9654; Resume' : '&#9208; Pause';
  $('charts-status').textContent = chartsPaused ? 'Paused' : 'Polling...';
  $('charts-status').style.color = chartsPaused ? 'var(--warn)' : 'var(--accent)';
}

function updateChartsInterval(ms) {
  chartsIntervalMs = parseInt(ms);
  $('charts-interval-label').textContent = (chartsIntervalMs / 1000).toFixed(1) + 's';
  if (chartsInterval) {
    clearInterval(chartsInterval);
    chartsInterval = setInterval(pollMeasurements, chartsIntervalMs);
  }
}

function updateSessionDuration() {
  if (!sessionStartTime) return;
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const el = $('session-duration');
  if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clearCharts() {
  Object.keys(chartData).forEach(k => chartData[k] = []);
  Object.keys(chartStats).forEach(k => { chartStats[k].min = Infinity; chartStats[k].max = -Infinity; });
  ['voltage', 'current', 'soc', 'cp', 'power'].forEach(k => drawChart(k, chartData[k]));
  $('charts-points').textContent = '0';
  accumulatedEnergy = 0;
  sessionStartTime = Date.now();
  lastPowerTimestamp = null;
  $('val-energy').textContent = '0.000 kWh';
  $('session-start-time').textContent = new Date().toLocaleTimeString('en-GB');
  // Reset min/max displays
  ['voltage', 'current', 'soc', 'power'].forEach(k => {
    const minEl = $(`min-${k}`);
    const maxEl = $(`max-${k}`);
    if (minEl) minEl.textContent = '--';
    if (maxEl) maxEl.textContent = '--';
  });
}

async function pollMeasurements() {
  if (chartsPaused) return;
  try {
    const r = await fetch(API + '/api/cds/measurements');
    const j = await r.json();
    if (!j.ok) {
      $('charts-status').textContent = 'CDS error: ' + j.error;
      $('charts-status').style.color = 'var(--danger)';
      $('charts-cds-status').textContent = 'Error';
      return;
    }
    
    const now = Date.now();
    const voltage = j.voltage;
    const current = j.current;
    const power = (voltage !== null && current !== null) ? (voltage * current) / 1000 : null; // kW
    
    // Update displays
    $('val-voltage').textContent = voltage !== null ? voltage.toFixed(1) + ' V' : '-- V';
    $('val-current').textContent = current !== null ? current.toFixed(1) + ' A' : '-- A';
    $('val-power').textContent = power !== null ? power.toFixed(2) + ' kW' : '-- kW';
    $('val-soc').textContent = j.soc !== null ? j.soc.toFixed(1) + ' %' : '-- %';
    
    const cpLabels = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2', 7: 'D1', 8: 'D2', 9: 'E', 10: 'F', 11: 'Error' };
    $('val-cp').textContent = j.cpStateRaw !== null ? (cpLabels[Math.round(j.cpStateRaw)] || 'State ' + Math.round(j.cpStateRaw)) : '--';
    $('charts-cds-status').textContent = (j.statusFlags || []).join(', ') || 'Idle';
    $('charts-status').textContent = 'Live';
    $('charts-status').style.color = 'var(--pass)';
    
    // Update chart data
    if (voltage !== null) chartData.voltage.push(voltage);
    if (current !== null) chartData.current.push(current);
    if (j.soc !== null) chartData.soc.push(j.soc);
    if (j.cpStateRaw !== null) chartData.cp.push(j.cpStateRaw);
    if (power !== null) chartData.power.push(power);
    
    // Update min/max stats
    if (voltage !== null) {
      if (voltage < chartStats.voltage.min) chartStats.voltage.min = voltage;
      if (voltage > chartStats.voltage.max) chartStats.voltage.max = voltage;
    }
    if (current !== null) {
      if (current < chartStats.current.min) chartStats.current.min = current;
      if (current > chartStats.current.max) chartStats.current.max = current;
    }
    if (j.soc !== null) {
      if (j.soc < chartStats.soc.min) chartStats.soc.min = j.soc;
      if (j.soc > chartStats.soc.max) chartStats.soc.max = j.soc;
    }
    if (power !== null) {
      if (power < chartStats.power.min) chartStats.power.min = power;
      if (power > chartStats.power.max) chartStats.power.max = power;
    }
    
    // Update min/max displays
    ['voltage', 'current', 'soc', 'power'].forEach(k => {
      const stats = chartStats[k];
      const minEl = $(`min-${k}`);
      const maxEl = $(`max-${k}`);
      const unit = k === 'voltage' ? 'V' : k === 'current' ? 'A' : k === 'soc' ? '%' : 'kW';
      if (minEl && stats.min !== Infinity) minEl.textContent = stats.min.toFixed(1) + unit;
      if (maxEl && stats.max !== -Infinity) maxEl.textContent = stats.max.toFixed(1) + unit;
    });
    
    // Accumulate energy (Wh)
    if (power !== null && lastPowerTimestamp !== null) {
      const deltaHours = (now - lastPowerTimestamp) / 3600000;
      accumulatedEnergy += power * deltaHours; // kWh
      $('val-energy').textContent = accumulatedEnergy.toFixed(3) + ' kWh';
      
      // Average power
      const totalHours = (now - sessionStartTime) / 3600000;
      if (totalHours > 0) {
        const avgPower = accumulatedEnergy / totalHours;
        $('avg-power').textContent = avgPower.toFixed(2) + ' kW';
      }
    }
    lastPowerTimestamp = now;
    
    // Trim arrays
    Object.keys(chartData).forEach(k => { if (chartData[k].length > CHART_MAX_POINTS) chartData[k].shift(); });
    
    // Draw charts
    ['voltage', 'current', 'soc', 'cp', 'power'].forEach(k => drawChart(k, chartData[k]));
    $('charts-points').textContent = String(chartData.voltage.length);
  } catch (e) {
    $('charts-status').textContent = 'Network error';
    $('charts-status').style.color = 'var(--danger)';
  }
}

function drawChart(key, data) {
  const canvas = $(`chart-${key}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  
  // Get theme colors
  const style = getComputedStyle(document.body);
  const borderColor = style.getPropertyValue('--border').trim();
  const textDim = style.getPropertyValue('--text-dim').trim();
  
  // Draw grid lines
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  
  if (data.length < 2) return;
  
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  
  // Theme-aware colors
  const isLight = document.documentElement.classList.contains('light-theme');
  const colors = {
    voltage: isLight ? '#0969da' : '#39bae6',
    current: isLight ? '#1a7f37' : '#aad94c',
    soc: isLight ? '#9a6700' : '#ffb454',
    cp: isLight ? '#8250df' : '#d957ff',
    power: isLight ? '#cf222e' : '#f85149',
  };
  
  ctx.strokeStyle = colors[key] || '#39bae6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 10) - 5;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  
  // Fill area under curve
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = (colors[key] || '#39bae6') + '20';
  ctx.fill();
  
  // Draw current value marker
  if (data.length > 0) {
    const lastVal = data[data.length - 1];
    const lastY = h - ((lastVal - min) / range) * (h - 10) - 5;
    ctx.fillStyle = colors[key] || '#39bae6';
    ctx.beginPath();
    ctx.arc(w - 2, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function cdsControl(action) {
  const ip = $('inp-cds').value || '192.168.100.10';
  const port = $('inp-cds-port').value || '51001';
  const cdsId = `cds-${ip.replace(/\./g, '-')}-${port}`;
  
  $('charts-status').textContent = `Sending ${action}...`;
  $('charts-status').style.color = 'var(--warn)';
  
  try {
    const r = await fetch(API + `/api/i/${cdsId}/${action}`, { method: 'POST' });
    const j = await r.json();
    if (j.ok) {
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `CDS ${action} successful`, service: 'cds' });
      $('charts-status').textContent = `${action.charAt(0).toUpperCase() + action.slice(1)} OK`;
      $('charts-status').style.color = 'var(--pass)';
    } else {
      throw new Error(j.error || 'Unknown error');
    }
  } catch (e) {
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: `CDS ${action} failed: ${e.message}`, service: 'cds' });
    $('charts-status').textContent = `${action} failed`;
    $('charts-status').style.color = 'var(--danger)';
  }
}

function exportChartsCsv() {
  if (chartData.voltage.length === 0) {
    alert('No data to export');
    return;
  }
  
  const headers = ['Index', 'Voltage (V)', 'Current (A)', 'Power (kW)', 'SoC (%)', 'CP State'];
  const rows = [headers.join(',')];
  
  const maxLen = Math.max(
    chartData.voltage.length,
    chartData.current.length,
    chartData.power.length,
    chartData.soc.length,
    chartData.cp.length
  );
  
  for (let i = 0; i < maxLen; i++) {
    const row = [
      i + 1,
      chartData.voltage[i]?.toFixed(2) ?? '',
      chartData.current[i]?.toFixed(2) ?? '',
      chartData.power[i]?.toFixed(3) ?? '',
      chartData.soc[i]?.toFixed(1) ?? '',
      chartData.cp[i]?.toFixed(0) ?? '',
    ];
    rows.push(row.join(','));
  }
  
  // Add summary
  rows.push('');
  rows.push('Session Summary');
  rows.push(`Start Time,${$('session-start-time').textContent}`);
  rows.push(`Duration,${$('session-duration').textContent}`);
  rows.push(`Total Energy,${$('val-energy').textContent}`);
  rows.push(`Average Power,${$('avg-power').textContent}`);
  rows.push(`Voltage Min/Max,${$('min-voltage').textContent} / ${$('max-voltage').textContent}`);
  rows.push(`Current Min/Max,${$('min-current').textContent} / ${$('max-current').textContent}`);
  rows.push(`Power Min/Max,${$('min-power').textContent} / ${$('max-power').textContent}`);
  
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cds-measurements-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  addLog({ timestamp: new Date().toISOString(), level: 'success', message: `Exported ${maxLen} data points to CSV`, service: 'cds' });
}

// ══════════════════════════════════════════════════════════════
// SECTION: Jira Upload Modal
// ══════════════════════════════════════════════════════════════

async function openJiraUploadModal(results) {
  const modal = $('jira-upload-modal-bg');
  modal.style.display = 'flex';

  $('jira-upload-status').textContent = 'Loading Jira metadata...';
  $('jira-upload-status').style.color = 'var(--warn)';

  const passed = results.filter(r => r.verdict === 'pass').length;
  const failed = results.filter(r => r.verdict === 'fail').length;
  const inconc = results.filter(r => r.verdict === 'inconc').length;
  const errors = results.filter(r => r.verdict === 'error').length;
  const total = results.length;
  const passRate = total ? Math.round(passed / total * 100) : 0;

  $('jira-upload-summary').innerHTML = [
    `<b>Execution Summary</b>`,
    `Total: ${total} | Pass: ${passed} | Fail: ${failed} | Inconc: ${inconc} | Error: ${errors}`,
    `Pass Rate: ${passRate}%`,
    ``,
    `<b>Non-passing tests:</b>`,
    ...results.filter(r => r.verdict !== 'pass').map(r => `  - ${r.testCase}: ${r.verdict} (${r.duration}s)`),
    ...(results.filter(r => r.verdict !== 'pass').length === 0 ? ['  All tests passed!'] : [])
  ].join('<br>');

  try {
    const r = await fetch(API + '/api/jira/metadata');
    const j = await r.json();
    if (j.ok && j.metadata) {
      populateJiraSelect('sel-jira-sut', j.metadata.suts, 'Select SUT...', true);
      populateJiraSelect('sel-jira-fw', j.metadata.firmwares, 'Select Firmware...', true);
      populateJiraSelect('sel-jira-plan', j.metadata.testPlans, 'Select Test Plan...', false);
      setupJiraTestPlanExecutionDropdown();
      $('jira-upload-status').textContent = `${total} tests | ${passRate}% pass`;
      $('jira-upload-status').style.color = passRate >= 80 ? 'var(--pass)' : passRate >= 50 ? 'var(--warn)' : 'var(--danger)';
      $('jira-upload-error').style.display = 'none';
    } else {
      throw new Error(j.error || 'Failed to load metadata');
    }
  } catch (e) {
    console.error('Failed to load Jira metadata:', e);
    $('jira-upload-status').textContent = 'Jira metadata unavailable';
    $('jira-upload-status').style.color = 'var(--danger)';
    $('jira-upload-error').textContent = 'Warning: Could not load SUT/Firmware from Jira. You can still upload but values must match existing Jira fields exactly.';
    $('jira-upload-error').style.display = 'block';
    populateJiraSelect('sel-jira-sut', [], 'Enter SUT manually...', true);
    populateJiraSelect('sel-jira-fw', [], 'Enter Firmware manually...', true);
    populateJiraSelect('sel-jira-plan', [], 'Enter Test Plan manually...', false);
    setupJiraTestPlanExecutionDropdown();
  }

  // Auto-fill test execution key from previously loaded execution
  if (typeof _loadedExecKey !== 'undefined' && _loadedExecKey) {
    $('sel-jira-testexec').value = _loadedExecKey;
  }
}

function populateJiraSelect(id, values, placeholder, required) {
  const sel = $(id);
  sel.innerHTML = '';

  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = required ? placeholder + ' *' : placeholder;
  if (required) emptyOpt.disabled = true;
  sel.appendChild(emptyOpt);

  if (values && values.length > 0) {
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
    sel.disabled = false;
  } else {
    sel.innerHTML = '<option value="">No values found in Jira</option>';
    sel.disabled = true;
    const fallbackId = id + '-fallback';
    let fallback = $(fallbackId);
    if (!fallback) {
      fallback = document.createElement('input');
      fallback.id = fallbackId;
      fallback.type = 'text';
      fallback.placeholder = placeholder;
      fallback.style = 'width:100%;margin-top:4px;';
      sel.parentNode.insertBefore(fallback, sel.nextSibling);
    }
  }
}

function closeJiraUploadModal() {
  $('jira-upload-modal-bg').style.display = 'none';
}

async function uploadExecutionToJira() {
  let sut = $('sel-jira-sut').value.trim();
  let fw = $('sel-jira-fw').value.trim();
  let plan = $('sel-jira-plan').value.trim();
  let env = $('sel-jira-env').value.trim();

  if (!sut) { sut = ($('sel-jira-sut-fallback') || {}).value || ''; }
  if (!fw) { fw = ($('sel-jira-fw-fallback') || {}).value || ''; }
  if (!plan) { plan = ($('sel-jira-plan-fallback') || {}).value || ''; }

  const missing = [];
  if (!sut) missing.push('SUT');
  if (!fw) missing.push('Firmware Version');
  if (missing.length > 0) {
    alert('Required fields missing: ' + missing.join(', '));
    return;
  }

  const btn = $('btn-jira-upload');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  try {
    const r = await fetch(API + '/api/jira/upload-execution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sut, firmwareVersion: fw, testPlan: plan, environment: env })
    });
    const j = await r.json();
    if (j.ok) {
      $('jira-upload-status').textContent = 'Uploaded!';
      $('jira-upload-status').style.color = 'var(--pass)';
      $('jira-upload-summary').innerHTML = [
        `<b>Upload successful!</b>`,
        `Issue: <a href="${j.url}" target="_blank" style="color:var(--accent)">${j.issueKey}</a>`,
        `Total: ${j.summary.total} | Pass: ${j.summary.passed} | Fail: ${j.summary.failed}`,
        `Pass Rate: ${j.summary.passRate}%`
      ].join('<br>');
      btn.textContent = 'Uploaded!';
      btn.style.borderColor = 'var(--pass)';
      btn.style.color = 'var(--pass)';
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `Jira upload: ${j.issueKey} (${j.url})`, service: 'ui' });
      showJiraSuccessModal('Upload successful!', [
        `Issue: <a href="${j.url}" target="_blank" style="color:var(--accent)">${j.issueKey}</a>`,
        `Total: ${j.summary.total} | Pass: ${j.summary.passed} | Fail: ${j.summary.failed}`,
        `Pass Rate: ${j.summary.passRate}%`
      ].join('<br>'));
    } else {
      throw new Error(j.error || 'Unknown error');
    }
  } catch (e) {
    $('jira-upload-status').textContent = 'Upload failed';
    $('jira-upload-status').style.color = 'var(--danger)';
    btn.disabled = false;
    btn.textContent = 'Retry Upload';
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Jira upload failed: ' + e.message, service: 'ui' });
    alert('Upload failed: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// SECTION: Tab Switching & History
// ══════════════════════════════════════════════════════════════

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  $('view-current').style.display = tab === 'current' ? 'flex' : 'none';
  $('view-history').style.display = tab === 'history' ? 'flex' : 'none';
  if (tab === 'history') fetchHistory();
}

function closeRunDetails() {
  $('history-details').classList.remove('visible');
}

async function fetchHistory() {
  try {
    const [historyResp, triageResp] = await Promise.all([
      fetch(API + '/api/results/history'),
      fetch(API + '/api/results/history/triage')
    ]);
    const historyData = await historyResp.json();
    historyCache = Array.isArray(historyData) ? historyData : historyData.history || [];
    triageCache = triageResp.ok ? await triageResp.json() : { totalRuns: historyCache.length, byEquipment: {}, byFirmware: {} };
    populateHistoryFilters(historyCache);
    applyHistoryFilters();
  } catch (e) {
    $('htbody').innerHTML = `<tr><td colspan="10" style="color:var(--text-dim);text-align:center;padding:16px">Error loading history: ${e.message}</td></tr>`;
  }
}

function populateHistoryFilters(history) {
  const unique = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const suts = unique(history.map(h => h.metadata?.sut || ''));
  const fws = unique(history.map(h => h.metadata?.firmwareVersion || ''));

  const sutSel = $('hist-sut-filter');
  const fwSel = $('hist-fw-filter');
  const currentSut = sutSel.value;
  const currentFw = fwSel.value;

  sutSel.innerHTML = '<option value="">All</option>' + suts.map(v => `<option value="${v}">${v}</option>`).join('');
  fwSel.innerHTML = '<option value="">All</option>' + fws.map(v => `<option value="${v}">${v}</option>`).join('');

  if (suts.includes(currentSut)) sutSel.value = currentSut;
  if (fws.includes(currentFw)) fwSel.value = currentFw;
}

function applyHistoryFilters() {
  const sut = $('hist-sut-filter').value;
  const fw = $('hist-fw-filter').value;
  const q = ($('hist-text-filter').value || '').trim().toLowerCase();

  const filtered = historyCache.filter((h) => {
    if (sut && (h.metadata?.sut || '') !== sut) return false;
    if (fw && (h.metadata?.firmwareVersion || '') !== fw) return false;
    if (q) {
      const text = [h.configName || '', h.metadata?.jiraIssueKey || '', h.metadata?.testPlan || '', h.metadata?.sut || '', h.metadata?.firmwareVersion || ''].join(' ').toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  renderHistoryTable(filtered);
  renderHistoryTriage(filtered);
}

function renderHistoryTable(history) {
  if (!history || !history.length) {
    $('htbody').innerHTML = '<tr><td colspan="10" style="color:var(--text-dim);text-align:center;padding:16px">No past runs</td></tr>';
    return;
  }
  $('htbody').innerHTML = history.map((h, i) => {
    const d = new Date(h.timestamp);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const rateColor = h.passRate >= 80 ? 'var(--pass)' : h.passRate >= 50 ? 'var(--warn)' : 'var(--fail)';
    const sut = h.metadata?.sut || '—';
    const fw = h.metadata?.firmwareVersion || '—';
    return `<tr onclick="showRunDetails('${h.id}')">
      <td style="color:var(--text-dim)">${dateStr}</td>
      <td style="color:var(--text-bright)">${sut}</td>
      <td style="color:var(--text-bright)">${fw}</td>
      <td style="color:var(--text-bright)">${h.configName || '—'}</td>
      <td>${h.total}</td>
      <td style="color:var(--pass)">${h.pass}</td>
      <td style="color:var(--fail)">${h.fail}</td>
      <td style="color:var(--inconc)">${h.inconc}</td>
      <td style="color:${rateColor};font-weight:700">${h.passRate}%</td>
      <td style="text-align:right;color:var(--accent)">&#9654; View</td>
    </tr>`;
  }).join('');
}

function renderHistoryTriage(filteredHistory) {
  const getTop = (mapObj) => {
    const entries = Object.entries(mapObj || {});
    if (!entries.length) return null;
    return entries.sort((a, b) => (b[1].runs || 0) - (a[1].runs || 0))[0];
  };

  const topSut = getTop(triageCache.byEquipment);
  const topFw = getTop(triageCache.byFirmware);

  if (topSut) {
    $('triage-top-sut').textContent = topSut[0];
    $('triage-top-sut-sub').textContent = `${topSut[1].runs} runs • ${topSut[1].passRate}% pass rate`;
  } else {
    $('triage-top-sut').textContent = '—';
    $('triage-top-sut-sub').textContent = 'No equipment metadata yet';
  }

  if (topFw) {
    $('triage-top-fw').textContent = topFw[0];
    $('triage-top-fw-sub').textContent = `${topFw[1].runs} runs • ${topFw[1].passRate}% pass rate`;
  } else {
    $('triage-top-fw').textContent = '—';
    $('triage-top-fw-sub').textContent = 'No firmware metadata yet';
  }

  const pass = filteredHistory.reduce((acc, h) => acc + (h.pass || 0), 0);
  const total = filteredHistory.reduce((acc, h) => acc + (h.total || 0), 0);
  const rate = total ? Math.round(pass / total * 100) : 0;
  $('triage-run-count').textContent = String(filteredHistory.length);
  $('triage-run-count-sub').textContent = filteredHistory.length ? `${pass}/${total} passed • ${rate}%` : 'No runs selected';
}

async function clearHistory() {
  if (!confirm('Clear all run history entries?')) return;
  try {
    const r = await fetch(API + '/api/results/history/clear', { method: 'POST' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed to clear history');
    historyCache = [];
    triageCache = { totalRuns: 0, byEquipment: {}, byFirmware: {} };
    $('hist-text-filter').value = '';
    populateHistoryFilters([]);
    applyHistoryFilters();
    closeRunDetails();
    addLog({ timestamp: new Date().toISOString(), level: 'success', message: 'Run history cleared', service: 'ui' });
  } catch (e) {
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: 'Failed to clear history: ' + e.message, service: 'ui' });
  }
}

function showRunDetails(id) {
  const entry = historyCache.find((h) => h.id === id);
  if (!entry) return;
  $('history-details').classList.add('visible');
  const d = new Date(entry.timestamp);
  const meta = [];
  if (entry.metadata?.sut) meta.push(`SUT ${entry.metadata.sut}`);
  if (entry.metadata?.firmwareVersion) meta.push(`FW ${entry.metadata.firmwareVersion}`);
  if (entry.metadata?.jiraIssueKey) meta.push(`Jira ${entry.metadata.jiraIssueKey}`);
  const suffix = meta.length ? ` • ${meta.join(' • ')}` : '';
  $('hd-title').textContent = `Run — ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${entry.configName || '—'})${suffix}`;

  const tbody = entry.results && entry.results.length
    ? entry.results.map((r) => {
        const logBtn = `<button class="sm" onclick="event.stopPropagation();viewLog('${r.testCase}')" title="View Log">Log</button>`;
        const dlBtn = `<button class="sm" onclick="event.stopPropagation();downloadLog('${r.testCase}')" title="Download Report">DL</button>`;
        return `<tr><td style="color:var(--text-bright)">${r.testCase}</td><td><span class="vb ${r.verdict}">${r.verdict}</span></td><td style="color:var(--text-dim)">${r.duration || 0}s</td><td style="text-align:right;white-space:nowrap">${logBtn} ${dlBtn}</td></tr>`;
      }).join('')
    : '<tr><td colspan="4" style="color:var(--text-dim);text-align:center;padding:12px">No detail results</td></tr>';
  $('hd-table-wrap').innerHTML = `<table><thead><tr><th>Test Case</th><th>Verdict</th><th>Duration</th><th style="text-align:right">Actions</th></tr></thead><tbody>${tbody}</tbody></table>`;

  renderCharts(entry);
}

// ══════════════════════════════════════════════════════════════
// SECTION: History Charts
// ══════════════════════════════════════════════════════════════

function destroyCharts() {
  if (pieChart) { pieChart.destroy(); pieChart = null; }
  if (barChart) { barChart.destroy(); barChart = null; }
}

function renderCharts(entry) {
  destroyCharts();

  const style = getComputedStyle(document.body);
  const passColor = style.getPropertyValue('--pass').trim();
  const failColor = style.getPropertyValue('--fail').trim();
  const inconcColor = style.getPropertyValue('--inconc').trim();
  const errorColor = style.getPropertyValue('--error').trim();
  const textColor = style.getPropertyValue('--text').trim();

  const pieCtx = document.getElementById('chart-pie')?.getContext('2d');
  if (pieCtx) {
    pieChart = new Chart(pieCtx, {
      type: 'pie',
      data: {
        labels: ['PASS', 'FAIL', 'INCONC', 'ERROR'],
        datasets: [{
          data: [entry.pass, entry.fail, entry.inconc, entry.error],
          backgroundColor: [passColor, failColor, inconcColor, errorColor],
          borderWidth: 1,
          borderColor: style.getPropertyValue('--bg').trim(),
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor, boxWidth: 10, padding: 8, font: { size: 9 } } },
          tooltip: { enabled: true }
        }
      }
    });
  }

  const sorted = entry.results ? [...entry.results].sort((a, b) => b.duration - a.duration).slice(0, 15) : [];
  if (sorted.length) {
    const barCtx = document.getElementById('chart-bar')?.getContext('2d');
    if (barCtx) {
      barChart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: sorted.map((r) => r.testCase),
          datasets: [{
            label: 'Duration (s)',
            data: sorted.map((r) => r.duration),
            backgroundColor: sorted.map((r) => r.verdict === 'pass' ? passColor : r.verdict === 'fail' ? failColor : r.verdict === 'inconc' ? inconcColor : errorColor),
            borderWidth: 0,
            borderRadius: 3,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x}s: ${sorted[ctx.dataIndex].testCase}` } }
          },
          scales: {
            x: { grid: { color: 'color-mix(in srgb,var(--border) 30%,transparent)' }, ticks: { color: textColor, font: { size: 9 } } },
            y: { grid: { display: false }, ticks: { color: textColor, font: { size: 8 } } }
          }
        }
      });
    }
  }
}

// ══════════════════════════════════════════════════════════════
// SECTION: Create Jira Defect
// ══════════════════════════════════════════════════════════════

async function createDefect(testCase, verdict) {
  if (!confirm(`Create a Jira defect for ${testCase} (${verdict})?`)) return;
  try {
    const r = await fetch(API + '/api/jira/create-defect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCase, verdict })
    });
    const j = await r.json();
    if (j.ok) {
      addLog({ timestamp: new Date().toISOString(), level: 'success', message: `Defect created: ${j.issueKey} (${j.url})`, service: 'ui' });
      alert(j.existing ? `Existing defect found: ${j.issueKey}\n${j.url}` : `Defect created: ${j.issueKey}\n${j.url}`);
    } else {
      throw new Error(j.error || 'Unknown error');
    }
  } catch (e) {
    addLog({ timestamp: new Date().toISOString(), level: 'error', message: `Defect creation failed: ${e.message}`, service: 'ui' });
    alert('Failed to create defect: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// Initialize on page load
// ══════════════════════════════════════════════════════════════

initTheme();
init();
