// ══════════════════════════════════════════════════════════════
// Tests for Pipeline Service — State Management Only
// ══════════════════════════════════════════════════════════════
//
// Note: runPlaywright involves child_process spawn and OCTT API calls
// which are tested via integration tests. These unit tests cover
// state management only.
//

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    isPlaywrightRunning,
    getLastResults,
    stopPlaywright,
} from "../../src/apps/certification-dashboard/services/pipeline.service.js";

vi.mock("../../src/apps/certification-dashboard/services/sse.service.js", () => ({
    broadcast: vi.fn(),
}));

vi.mock("../../src/apps/certification-dashboard/routes/logs.routes.js", () => ({
    log: vi.fn(),
}));

describe("Pipeline Service State", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stopPlaywright();
    });

    it("should report not running initially", () => {
        expect(isPlaywrightRunning()).toBe(false);
    });

    it("should return empty results initially", () => {
        expect(getLastResults()).toEqual([]);
    });

    it("should not crash when stopping if not running", () => {
        expect(() => stopPlaywright()).not.toThrow();
        expect(isPlaywrightRunning()).toBe(false);
    });
});
