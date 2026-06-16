import WebSocket from "ws";
import axios from "axios";
import { effectiveConfig } from "../config/dashboard.config.js";
import { log } from "../routes/logs.routes.js";
import { setService } from "./service-state.service.js";

let ws: WebSocket | null = null;
let isRunning = false;
let reconnectTimer: NodeJS.Timeout | null = null;

export function isSutRelayRunning() {
    return isRunning;
}

export function startSutRelay() {
    if (ws || reconnectTimer) return;
    
    if (!effectiveConfig.octt.baseUrl || !effectiveConfig.octt.token) {
        log("warn", "Cannot start SUT Relay: OCTT Base URL or Token missing", "sut-relay");
        setService("sut-relay", "error", "OCTT credentials missing");
        return;
    }

    const host = effectiveConfig.octt.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const uri = `wss://${host}/ws_api`;
    log("info", `Connecting SUT API Relay to ${uri}`, "sut-relay");
    
    try {
        ws = new WebSocket(uri, {
            headers: {
                Authorization: `Bearer ${effectiveConfig.octt.token}`
            }
        });

        ws.on("open", () => {
            isRunning = true;
            log("info", "Connected to OCTT WebSocket for SUT Relay", "sut-relay");
            setService("sut-relay", "connected", "Connected to OCTT");
        });

        ws.on("message", async (data: Buffer) => {
            try {
                const msg = JSON.parse(data.toString());
                if (!msg.url || !msg.operation) return;

                const reqUrl = msg.url.endsWith('/') ? msg.url.slice(0, -1) : msg.url;
                const op = msg.operation.startsWith('/') ? msg.operation : `/${msg.operation}`;
                const targetUrl = `${reqUrl}${op}`;
                
                log("info", `SUT Relay: ${msg.operation} -> ${targetUrl}`, "sut-relay");
                
                let success = false;
                try {
                    const resp = await axios({
                        method: msg.method || "POST",
                        url: targetUrl,
                        data: msg.body,
                        timeout: 30000,
                        validateStatus: () => true
                    });
                    success = [200, 201, 204].includes(resp.status);
                    log("info", `SUT Relay Response: ${resp.status} -> ${success ? "OK" : "NOK"}`, "sut-relay");
                } catch (err: any) {
                    log("error", `SUT Relay failed to forward: ${err.message}`, "sut-relay");
                    success = false;
                }

                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        id: msg.id,
                        status: success ? "OK" : "NOK"
                    }));
                }
            } catch (e: any) {
                log("error", `SUT Relay message error: ${e.message}`, "sut-relay");
            }
        });

        ws.on("close", () => {
            isRunning = false;
            ws = null;
            log("warn", "SUT Relay WebSocket closed, reconnecting in 5s...", "sut-relay");
            setService("sut-relay", "disconnected", "WebSocket closed");
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                startSutRelay();
            }, 5000);
        });

        ws.on("error", (err: Error) => {
            log("error", `SUT Relay WebSocket error: ${err.message}`, "sut-relay");
            setService("sut-relay", "error", err.message);
        });
    } catch (err: any) {
        log("error", `Failed to initialize SUT Relay: ${err.message}`, "sut-relay");
        setService("sut-relay", "error", err.message);
    }
}

export function stopSutRelay() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    isRunning = false;
}
