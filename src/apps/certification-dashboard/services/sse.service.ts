// ══════════════════════════════════════════════════════════════
// SSE Service — Real-time log and status broadcasting
// ══════════════════════════════════════════════════════════════

import { type Response } from "express";

interface SseClient {
    id: number;
    res: Response;
}

let sseIdCounter = 0;
const clients = new Map<number, SseClient>();

/** Add a new SSE client */
export function addClient(res: Response): number {
    const id = ++sseIdCounter;
    clients.set(id, { id, res });
    return id;
}

/** Remove an SSE client */
export function removeClient(id: number): void {
    clients.delete(id);
}

/** Broadcast an event to all connected clients */
export function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, client] of clients) {
        client.res.write(payload);
    }
}

/** Get count of active connections */
export function clientCount(): number {
    return clients.size;
}
