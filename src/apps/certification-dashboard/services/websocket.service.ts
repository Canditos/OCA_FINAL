// ══════════════════════════════════════════════════════════════
// WebSocket Service — Bidirectional real-time communication
// ══════════════════════════════════════════════════════════════
// 
// Replaces SSE with WebSocket for bidirectional communication.
// Supports:
//   - Server → Client: logs, status updates, pipeline events
//   - Client → Server: commands (future: interactive control)
// ══════════════════════════════════════════════════════════════

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

interface WsClient {
    id: number;
    ws: WebSocket;
    isAlive: boolean;
}

let wsIdCounter = 0;
const clients = new Map<number, WsClient>();
let wss: WebSocketServer | null = null;

/** Command handler type for bidirectional communication */
type CommandHandler = (clientId: number, payload: Record<string, unknown>) => void | Promise<void>;
const commandHandlers = new Map<string, CommandHandler>();

/**
 * Initialize WebSocket server on the given HTTP server
 */
export function initWebSocket(server: Server): void {
    wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (ws: WebSocket) => {
        const id = ++wsIdCounter;
        const client: WsClient = { id, ws, isAlive: true };
        clients.set(id, client);

        // Send welcome message
        ws.send(JSON.stringify({ type: "connected", data: { clientId: id } }));

        // Handle incoming messages (commands from client)
        ws.on("message", async (data: Buffer) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.command && commandHandlers.has(msg.command)) {
                    const handler = commandHandlers.get(msg.command)!;
                    await handler(id, msg);
                }
            } catch (e) {
                console.error("[WS] Message parse error:", e);
            }
        });

        // Handle pong for keepalive
        ws.on("pong", () => {
            client.isAlive = true;
        });

        // Clean up on close
        ws.on("close", () => {
            clients.delete(id);
        });

        ws.on("error", (err: Error) => {
            console.error(`[WS] Client ${id} error:`, err.message);
            clients.delete(id);
        });
    });

    // Keepalive ping every 30 seconds
    setInterval(() => {
        for (const [id, client] of clients) {
            if (!client.isAlive) {
                client.ws.terminate();
                clients.delete(id);
                continue;
            }
            client.isAlive = false;
            client.ws.ping();
        }
    }, 30000);

    console.log("[WS] WebSocket server initialized on /ws");
}

/**
 * Register a command handler for bidirectional communication
 */
export function registerCommand(command: string, handler: CommandHandler): void {
    commandHandlers.set(command, handler);
}

/**
 * Broadcast a message to all connected clients
 */
export function wsBroadcast(type: string, data: unknown): void {
    const payload = JSON.stringify({ type, data });
    for (const [, client] of clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(payload);
        }
    }
}

/**
 * Send a message to a specific client
 */
export function wsSend(clientId: number, type: string, data: unknown): void {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type, data }));
    }
}

/**
 * Get count of active WebSocket connections
 */
export function wsClientCount(): number {
    return clients.size;
}

/**
 * Close all WebSocket connections (for shutdown)
 */
export function wsShutdown(): void {
    for (const [, client] of clients) {
        client.ws.close();
    }
    clients.clear();
    if (wss) {
        wss.close();
        wss = null;
    }
}
