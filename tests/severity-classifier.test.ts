import { describe, it, expect } from "vitest";
import { classifySeverity } from "../src/domain/severity-classifier.js";
import type { ReportEntry } from "../src/connectors/octt/types.js";

function makeReport(overrides: Partial<ReportEntry> = {}): ReportEntry {
    return {
        category: "Core",
        config_version: "1.0",
        configuration: "test-config",
        description: "Test case description",
        duration: 5000,
        logfile: "log_001.txt",
        ocppVersion: "ocpp2.0.1",
        pics_mode: false,
        startTime: { date: { day: 1, month: 1, year: 2025 }, time: { hour: 10, minute: 0, nano: 0, second: 0 } },
        sut: "CS",
        testCaseName: "TC_A_Security_01_CS",
        timeStr: "2025-01-01 10:00:00",
        verdict: "fail",
        ...overrides,
    };
}

describe("Severity Classifier", () => {
    it("should assign Highest priority to core profile + error verdict + critical block", () => {
        const report = makeReport({
            category: "Core",
            verdict: "error",
            testCaseName: "TC_A_Security_01_CS",
        });
        const result = classifySeverity(report);
        expect(result.priority).toBe("Highest");
        expect(result.score).toBeGreaterThanOrEqual(70);
        expect(result.factors.length).toBeGreaterThan(0);
    });

    it("should assign Medium priority to non-core profile + fail verdict", () => {
        const report = makeReport({
            category: "LocalAuth",
            verdict: "fail",
            testCaseName: "TC_Z_LocalAuth_01_CS",
        });
        const result = classifySeverity(report);
        expect(result.priority).toBe("Medium");
    });

    it("should assign Low priority to non-core + inconclusive", () => {
        const report = makeReport({
            category: "Display",
            verdict: "inconc",
            testCaseName: "TC_Z_Display_01_CS",
        });
        const result = classifySeverity(report);
        expect(["Low", "Lowest"]).toContain(result.priority);
    });

    it("should boost score for consistent failures in verdict history", () => {
        const report = makeReport({ category: "Core", verdict: "fail" });
        const history = ["fail", "fail", "fail", "fail", "pass"];
        const result = classifySeverity(report, history);

        const resultNoHistory = classifySeverity(report);
        expect(result.score).toBeGreaterThan(resultNoHistory.score);
    });

    it("should reduce score for intermittent failures", () => {
        const report = makeReport({ category: "Core", verdict: "fail" });
        const history = ["pass", "pass", "pass", "pass", "fail"];
        const result = classifySeverity(report, history);

        const resultNoHistory = classifySeverity(report);
        expect(result.score).toBeLessThan(resultNoHistory.score);
    });
});
