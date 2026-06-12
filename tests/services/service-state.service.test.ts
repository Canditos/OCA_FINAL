// ══════════════════════════════════════════════════════════════
// Tests for Service State Service
// ══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    setService,
    getService,
    getAllServices,
} from "../../src/apps/certification-dashboard/services/service-state.service.js";
import * as sse from "../../src/apps/certification-dashboard/services/sse.service.js";

// Mock SSE to avoid side effects
vi.mock("../../src/apps/certification-dashboard/services/sse.service.js", () => ({
    broadcast: vi.fn(),
}));

describe("Service State", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset to default states
        setService("cds", "disconnected", "Keysight SL1040A");
        setService("relay", "disconnected", "CDS TCP Proxy");
        setService("octt", "disconnected", "Compliance Testing Tool");
        setService("jira", "disconnected", "Issue Tracking");
        vi.clearAllMocks(); // Clear broadcasts from setup
    });

    it("should return default service states", () => {
        const cds = getService("cds");
        expect(cds).toBeDefined();
        expect(cds?.status).toBe("disconnected");
        expect(cds?.label).toBe("CDS");
    });

    it("should update service status", () => {
        setService("cds", "connected", "192.168.100.10:51001");
        const cds = getService("cds");
        expect(cds?.status).toBe("connected");
        expect(cds?.info).toBe("192.168.100.10:51001");
    });

    it("should broadcast on status change", () => {
        setService("octt", "running", "Session started");
        expect(sse.broadcast).toHaveBeenCalledWith("status", {
            service: "octt",
            status: "running",
            info: "Session started",
        });
    });

    it("should return all services", () => {
        const all = getAllServices();
        expect(Object.keys(all)).toEqual(["cds", "octt", "jira", "relay"]);
    });

    it("should ignore unknown services", () => {
        setService("unknown", "connected");
        expect(getService("unknown")).toBeUndefined();
        expect(sse.broadcast).not.toHaveBeenCalled();
    });
});
