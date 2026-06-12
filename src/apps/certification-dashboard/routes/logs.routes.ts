// ══════════════════════════════════════════════════════════════
// Logs Routes — REST endpoint for log buffer
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { broadcast } from "../services/sse.service.js";
import { wsBroadcast } from "../services/websocket.service.js";

const router = Router();

const logBuffer: Array<{ timestamp: string; level: string; message: string; service: string }> = [];
const MAX_LOGS = 1000;

export function log(level: string, message: string, service?: string): void {
    const entry = { timestamp: new Date().toISOString(), level, message, service: service ?? "dashboard" };
    console.log(`[${entry.timestamp}] [${entry.service}] ${message}`);
    // Broadcast to both SSE and WebSocket for compatibility
    broadcast("log", entry);
    wsBroadcast("log", entry);
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}

export function getLogs(): typeof logBuffer {
    return logBuffer;
}

router.get("/", (_req, res) => {
    res.json(logBuffer);
});

export default router;
