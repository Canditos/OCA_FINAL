# OCPP Certification Pipeline Dashboard

Unified dashboard integrating **OCTT cloud** (test execution), **Keysight CDS SL1040A** (EV simulator hardware), and **Jira** (issue tracking) for automated OCPP 1.6 certification testing.  
25 test suites, 113 test cases, phased reboot/normal execution, SSE real-time updates.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Dashboard (Express)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │CDS Routes│ │OCTT Routes│ │Jira Routes│ │Pipeline │ │
│  │+ Relay   │ │          │ │          │ │Runner   │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ │
│       │            │           │            │        │
│  ┌────┴────────────┴───────────┴────────────┴──────┐ │
│  │         Connectors (TCP / REST / REST)           │ │
│  │  CDS SLEP ───── OCTT API ───── Jira API v3     │ │
│  └────┬────────────────┬─────────────────┬─────────┘ │
└───────┼────────────────┼─────────────────┼───────────┘
        │                │                 │
   ┌────┴────┐     ┌─────┴─────┐     ┌─────┴─────┐
   │Keysight │     │OCTT Cloud │     │Jira Cloud │
   │SL1040A  │     │(OCA SaaS) │     │(Atlassian)│
   │TCP:51001│     │HTTPS API  │     │REST API v3│
   └─────────┘     └───────────┘     └───────────┘
```

## Prerequisites

### Required
| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | 18+ | Runtime |
| **Python** | 3.8+ | SUT API relay agent |
| **Keysight CDS** | SL1040A | EV simulator hardware |
| **OCTT account** | OCA cloud | Test execution platform |
| **Jira account** | Cloud | Issue tracking (optional) |

### Hardware
- Keysight SL1040A CDS reachable via TCP port 51001
- SUT (System Under Test) connected to OCTT cloud WebSocket

### Windows (PowerShell)
```powershell
# Node.js via winget
winget install OpenJS.NodeJS.LTS

# Python dependencies for SUT relay
pip install websockets aiohttp
```

### Linux / macOS
```bash
# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Python dependencies
pip install websockets aiohttp
```

## Installation (Fresh Machine)

```bash
# 1. Clone the repository
git clone https://github.com/Canditos/OCA_FINAL.git
cd OCA_FINAL

# 2. Install Node dependencies
npm install

# 3. Install Playwright browsers (Chromium)
npx playwright install chromium

# 4. Copy and edit configuration
cp dashboard-config.example.json dashboard-config.json
```

### Configuration (`dashboard-config.json`)

```json
{
    "octtBaseUrl": "https://your-org.octt.openchargealliance.org",
    "octtToken": "your-octt-api-token",
    "octtOcppVersion": "ocpp1.6",
    "octtRole": "CS",
    "cdsIp": "192.168.100.10",
    "cdsPort": 51001,
    "jiraBaseUrl": "https://your-domain.atlassian.net",
    "jiraEmail": "your-email@example.com",
    "jiraApiToken": "your-jira-api-token",
    "jiraProjectKey": "CERT"
}
```

| Field | Description |
|---|---|
| `octtBaseUrl` | OCTT instance URL (e.g., `siemens-a6ca4...`.octt.openchargealliance.org) |
| `octtToken` | OCTT API token (obtained from OCTT web UI → Settings → API Tokens) |
| `cdsIp` | Keysight CDS IP address |
| `cdsPort` | CDS SLEP TCP port (default: 51001) |
| `jiraBaseUrl` | Jira Cloud URL (optional) |
| `jiraApiToken` | Jira API token from https://id.atlassian.com/manage-profile/security/api-tokens |

Config is encrypted at rest via AES-256-GCM (key from `ENCRYPTION_KEY` env var or hostname).

## Running

### One-Command Start (Windows)

```powershell
# PowerShell
.\start.ps1

# Command Prompt
start.cmd
```

### Manual Start

```bash
npx tsx src/apps/certification-dashboard/server.ts
```

Dashboard opens at **http://localhost:3101**

### SUT API Relay Agent (when machine has no public IP)

```bash
python src/apps/sut-api-relay/sut_api_relay.py \
  --octt-host=<YOUR_INSTANCE>.octt.openchargealliance.org \
  --octt-token=<API_TOKEN>
```

## CDS Lifecycle

The CDS (Charge Discovery System) emulates an electric vehicle on the charging connector. The correct lifecycle is critical:

```
┌──────────────────────────────────────────────────────┐
│                CORRECT CDS LIFECYCLE                 │
│                                                      │
│  BEFORE ALL TESTS (one time):                        │
│    1. RESET       → CDS enters Stopped state         │
│    2. VALIDATE    → Confirm no errors, healthy        │
│    3. CONFIGURE   → Set specification, charge mode   │
│    4. CONFIGURE EV → Voltage, current, power, SoC    │
│    5. START       → Begin EV simulation              │
│                                                      │
│  DURING TESTS:                                       │
│    → DO NOT reset (resets clear EV parameters!)      │
│    → CDS stays running across all charging tests     │
│                                                      │
│  AFTER ALL TESTS:                                    │
│    1. STOP        → End simulation                   │
│    2. RESET       → Return to idle                   │
│    3. DEFAULTS    → Restore safe default parameters  │
└──────────────────────────────────────────────────────┘
```

### Relay API Endpoints (CDS Control)

| Endpoint | Method | Description |
|---|---|---|
| `/api/relay/i/{cdsId}/reset` | POST | Full reset cycle (Stop → Initializing → Stopped) |
| `/api/relay/i/{cdsId}/validate` | POST | Read Status + Errors + Warnings → health check |
| `/api/relay/i/{cdsId}/configure-cds` | POST | Set specification, chargeMode, sinkId |
| `/api/relay/i/{cdsId}/configure-ev` | POST | Set EV parameters (voltage, current, power, SoC) |
| `/api/relay/i/{cdsId}/start` | POST | Start EV simulation |
| `/api/relay/i/{cdsId}/stop` | POST | Stop EV simulation |
| `/api/relay/i/{cdsId}/defaults` | POST | Restore safe EV defaults (500V, 50A, 10kW) |
| `/api/relay/check` | POST | Health check all pooled CDS connections |
| `/api/relay/status` | POST | SUT API relay agent status |

`cdsId` format: `cds-{ip-with-hyphens}-{port}` (e.g., `cds-192-168-100-10-51001`)

### CDS Connection Pool

The relay maintains a **persistent TCP connection pool** (`activeCdsConnections` Map) to the CDS hardware. Connections are kept alive for the server lifetime — no TCP open/close per operation. This prevents race conditions and connection thrashing.

## Running Tests

### Unit Tests (Vitest)
```bash
npx vitest run
```

### Pipeline Tests (Playwright)

> **CRITICAL:** Must run with `--workers=1` (serial). CDS hardware and OCTT session do not support parallel execution.

```bash
# Full pipeline
npx playwright test --workers=1

# Specific suite
npx playwright test --grep "SmartCharging" --workers=1

# Specific test case
npx playwright test --grep "TC_062_CS" --workers=1

# Skip CDS tests
npx playwright test --grep -v "0a|0b|0c|0d|0e" --workers=1
```

Environment variables for standalone execution:
```bash
OCTT_BASE_URL=https://your-org.octt.openchargealliance.org \
OCTT_TOKEN=your-token \
OCTT_CONFIG=AUT_SID_SAT \
CDS_IP=192.168.100.10 \
npx playwright test --workers=1
```

## Test Structure

```
tests/
  certification_pipeline.spec.ts  — 441 lines, main pipeline
  services/
    service-state.service.test.ts — 5 tests
    config/                       — 12 tests
    pipeline/                     — 7 tests
    jira/                         — 3 tests
    cds/                          — 2 tests

25 suites, 113 test cases (107 CS + 6 maintenance)
  MAINTENANCE (6)        ColdBoot (2)         Configuration (5)
  MeterValues (5)        BasicActions (11)    RemoteActions (6)
  RemoteActionsNonHappy (2) Cache (5)         Resetting (4)
  Unlocking (4)          UnlockingNonHappy (1) SmartCharging (10)
  Reservation (11)       LocalAuthList (2)    OfflineBehavior (5)
  PowerFailure (2)       ConfigKeysNonHappy (5) FaultBehavior (3)
  FirmwareManagement (4)  Diagnostics (2)     RemoteTrigger (2)
  DataTransfer (1)       Security (12)
```

## Project Structure

```
OCA_FINAL/
├── src/
│   ├── apps/
│   │   ├── certification-dashboard/
│   │   │   ├── server.ts                       # Express bootstrap (~150 lines)
│   │   │   ├── config/
│   │   │   │   └── dashboard.config.ts          # Config persistence + AES-256-GCM encryption
│   │   │   ├── routes/
│   │   │   │   ├── cds.routes.ts                # CDS check + measurements
│   │   │   │   ├── config.routes.ts             # Config CRUD
│   │   │   │   ├── docs.routes.ts               # API docs
│   │   │   │   ├── jira.routes.ts               # Jira create, upload, defect
│   │   │   │   ├── logs.routes.ts               # Log view + download
│   │   │   │   ├── octt.routes.ts               # OCTT proxy
│   │   │   │   ├── pipeline.routes.ts           # Run/stop pipeline
│   │   │   │   ├── relay.routes.ts              # CDS proxy pool + SUT relay status
│   │   │   │   ├── results.routes.ts            # Results + history
│   │   │   │   ├── status.routes.ts             # Dashboard status
│   │   │   │   └── sut.routes.ts                # SUT WebSocket relay
│   │   │   ├── services/
│   │   │   │   ├── pipeline.service.ts          # Playwright runner + phased pipeline
│   │   │   │   ├── service-state.service.ts     # CDS/Relay/OCTT/Jira state tracking
│   │   │   │   └── sse.service.ts               # Server-Sent Events broadcast
│   │   │   └── public/
│   │   │       ├── index.html                   # Full SPA frontend (1800 lines)
│   │   │       └── app.js                       # Extracted JavaScript
│   │   └── sut-api-relay/
│   │       └── sut_api_relay.py                 # Python SUT API relay agent
│   └── connectors/
│       ├── cds/
│       │   ├── cds-client.ts                    # SLEP TCP client (588 lines)
│       │   ├── types.ts                         # PID catalog, enums, interfaces (230 lines)
│       │   └── index.ts                         # Barrel export
│       ├── jira/
│       │   └── jira-client.ts                   # Jira REST API v3 client
│       ├── octt/
│       │   └── octt-client.ts                   # OCTT REST API client
│       └── orchestrator/
│           └── coordinator.ts                   # Lab preparation coordinator
├── tests/
│   ├── certification_pipeline.spec.ts           # Playwright pipeline
│   └── services/                                 # Unit tests (29 tests)
├── scripts/
│   ├── test-steps/                               # 113 individual step CSV files
│   └── output/
│       └── xray-import/                          # Xray JSON import artifacts
├── dashboard-config.example.json                 # Config template
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── start.ps1                                     # One-click start (PowerShell)
├── start.cmd                                     # One-click start (CMD)
└── README.md
```

## Known Issues

| Issue | Impact | Workaround |
|---|---|---|
| OCTT cloud 10-min proxy timeout | 504 on slow reboot tests | Treated as `inconc` verdict |
| OCTT `downloadReports` with `logfile_name` | Returns 0 bytes | Download full ZIP instead |
| SUT disconnects during long reboot tests | Test fails mid-execution | Treated as `inconc`, session auto-recovered |
| Cannot automate OCTT token acquisition | Initial setup is manual | Token obtained once from web UI |

## Ports

| Service | Port | Protocol |
|---|---|---|
| Dashboard | 3101 | HTTP |
| CDS (Keysight) | 51001 | TCP (SLEP) |
| OCTT | 443 | HTTPS |

## Troubleshooting

### CDS unreachable
```bash
# Check CDS connectivity
Test-NetConnection 192.168.100.10 -Port 51001

# Check relay pool status
curl -X POST http://localhost:3101/api/relay/check
```

### OCTT session won't start
```bash
# Stop any lingering session first
curl -X POST https://<instance>.octt.openchargealliance.org/api/v1/session/stop \
  -H "Authorization: Bearer <token>"

# Then start fresh
curl -X POST https://<instance>.octt.openchargealliance.org/api/v1/ocpp1.6/CS/session/start/AUT_SID_SAT \
  -H "Authorization: Bearer <token>"
```

### Dashboard won't start
```bash
# Check port is free
netstat -ano | findstr :3101

# Check Node version
node --version  # Must be 18+

# Clean install
rm -rf node_modules
npm install
```
