// ══════════════════════════════════════════════════════════════
// Tests for SSE Service
// ══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import { addClient, removeClient, broadcast, clientCount } from "../../src/apps/certification-dashboard/services/sse.service.js";

// Mock Response object
function createMockRes() {
    const chunks: string[] = [];
    return {
        write: (chunk: string) => chunks.push(chunk),
        getChunks: () => chunks,
    } as any;
}

describe("SSE Service", () => {
    beforeEach(() => {
        // Reset clients
        const count = clientCount();
        for (let i = 1; i <= count + 10; i++) {
            try { removeClient(i); } catch { /* ignore */ }
        }
    });

    it("should add a client", () => {
        const res = createMockRes();
        const id = addClient(res);
        expect(id).toBeGreaterThan(0);
        expect(clientCount()).toBe(1);
    });

    it("should remove a client", () => {
        const res = createMockRes();
        const id = addClient(res);
        removeClient(id);
        expect(clientCount()).toBe(0);
    });

    it("should broadcast to all clients", () => {
        const res1 = createMockRes();
        const res2 = createMockRes();
        addClient(res1);
        addClient(res2);

        broadcast("test", { message: "hello" });

        expect(res1.getChunks()).toHaveLength(1);
        expect(res2.getChunks()).toHaveLength(1);
        expect(res1.getChunks()[0]).toContain("hello");
    });

    it("should not broadcast to removed clients", () => {
        const res1 = createMockRes();
        const res2 = createMockRes();
        const id1 = addClient(res1);
        addClient(res2);

        removeClient(id1);
        broadcast("test", { message: "hello" });

        expect(res1.getChunks()).toHaveLength(0);
        expect(res2.getChunks()).toHaveLength(1);
    });
});
