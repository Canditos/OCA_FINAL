#!/usr/bin/env python3

"""
Copyright (c) 2010 - 2026 Open Charge Alliance. All rights reserved.
"""

import asyncio
import websockets
import aiohttp
import json
import logging
import argparse
from urllib.parse import urljoin, urlparse
from dataclasses import dataclass
from typing import Optional

parser = argparse.ArgumentParser()
parser.add_argument("--octt-host", type=str, required=True)
parser.add_argument("--octt-token", type=str, required=True)
args = parser.parse_args()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@dataclass
class APIRequest:
    id: str
    operation: str
    url: str
    method: str = "POST"
    body: Optional[dict] = None

async def relay_loop():
    uri = f"wss://{args.octt_host}/ws_api"
    headers = {"Authorization": f"Bearer {args.octt_token}"}
    
    logger.info(f"Connecting to {uri}")
    
    async with websockets.connect(uri, additional_headers=headers) as ws:
        logger.info("Connected to OCTT WebSocket")
        
        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    
                    req = APIRequest(
                        id=data["id"],
                        operation=data["operation"],
                        url=data["url"],
                        method=data.get("method", "POST"),
                        body=data.get("body")
                    )
                    
                    logger.info(f"Relaying: {req.operation} -> {req.url}")
                    
                    # Forward to local endpoint
                    async with session.request(
                        method=req.method,
                        url=urljoin(req.url, req.operation),
                        json=req.body,
                        timeout=aiohttp.ClientTimeout(total=30)
                    ) as resp:
                        success = resp.status in [200, 201, 204]
                        
                        # Send response back to OCTT
                        response = {
                            "id": req.id,
                            "status": "OK" if success else "NOK"
                        }
                        await ws.send(json.dumps(response))
                        
                        logger.info(f"Response: {resp.status} -> {response['status']}")
                        
                except websockets.exceptions.ConnectionClosed:
                    logger.error("WebSocket connection closed")
                    break
                except Exception as e:
                    logger.error(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(relay_loop())
