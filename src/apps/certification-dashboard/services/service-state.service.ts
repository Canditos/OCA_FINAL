// ══════════════════════════════════════════════════════════════
// Service State — Tracks CDS, Relay, OCTT, Jira connection status
// ══════════════════════════════════════════════════════════════

import { broadcast } from "./sse.service.js";
import { wsBroadcast } from "./websocket.service.js";

export interface ServiceState {
    status: "disconnected" | "connecting" | "connected" | "running" | "error";
    label: string;
    info: string;
}

const states = new Map<string, ServiceState>([
    ["cds",  { status: "disconnected", label: "CDS",  info: "Keysight SL1040A" }],
    ["octt", { status: "disconnected", label: "OCTT", info: "Compliance Testing Tool" }],
    ["jira", { status: "disconnected", label: "Jira", info: "Issue Tracking" }],
    ["relay", { status: "disconnected", label: "Relay", info: "CDS TCP Proxy" }],
]);

export function setService(service: string, status: ServiceState["status"], info?: string): void {
    const s = states.get(service);
    if (!s) return;
    s.status = status;
    if (info) s.info = info;
    // Broadcast to both SSE and WebSocket
    const payload = { service, status, info: s.info };
    broadcast("status", payload);
    wsBroadcast("status", payload);
}

export function getService(service: string): ServiceState | undefined {
    return states.get(service);
}

export function getAllServices(): Record<string, ServiceState> {
    return Object.fromEntries(states);
}
