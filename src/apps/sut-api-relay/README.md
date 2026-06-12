# SUT API Relay Agent

Forwards OCTT WebSocket API calls to local SUT endpoints.

## Usage

```bash
python sut_api_relay.py --octt-host=<INSTANCE>.octt.openchargealliance.org --octt-token=<API_TOKEN>
```

## Requirements

```bash
pip install websockets aiohttp
```

## How it works

1. Connects to OCTT WebSocket (`wss://<host>/ws_api`)
2. Listens for API requests from OCTT
3. Forwards them to the configured SUT URL (e.g., `http://localhost:3101/api/sut`)
4. Returns success/failure back to OCTT
