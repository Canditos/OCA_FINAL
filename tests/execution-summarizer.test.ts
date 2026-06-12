import { describe, it, expect } from "vitest";
import { summarize, formatSummaryMarkdown } from "../src/domain/execution-summarizer.js";
import type { ReportEntry } from "../src/connectors/octt/types.js";

function makeReport(overrides: Partial<ReportEntry> = {}): ReportEntry {
    return {
        category: "Core",
        config_version: "1.0",
        configuration: "test-config",
        description: "Test description",
        duration: 5000,
        logfile: "log.txt",
        ocppVersion: "ocpp2.0.1",
        pics_mode: false,
        startTime: { date: { day: 1, month: 1, year: 2025 }, time: { hour: 10, minute: 0, nano: 0, second: 0 } },
        sut: "CS",
        testCaseName: "TC_Test_01_CS",
        timeStr: "2025-01-01 10:00:00",
        verdict: "pass",
        ...overrides,
    };
}

describe("Execution Summarizer", () => {
    it("should correctly count verdicts", () => {
        const reports = [
            makeReport({ verdict: "pass" }),
            makeReport({ verdict: "pass" }),
            makeReport({ verdict: "fail", testCaseName: "TC_Fail_01" }),
            makeReport({ verdict: "error", testCaseName: "TC_Error_01" }),
            makeReport({ verdict: "inconc", testCaseName: "TC_Inconc_01" }),
        ];

        const summary = summarize(reports);
        expect(summary.totalTests).toBe(5);
        expect(summary.passed).toBe(2);
        expect(summary.failed).toBe(1);
        expect(summary.errors).toBe(1);
        expect(summary.inconclusive).toBe(1);
        expect(summary.passRate).toBe("40.0%");
    });

    it("should detect certification blockers from Core profile failures", () => {
        const reports = [
            makeReport({ verdict: "fail", testCaseName: "TC_Core_Fail", category: "Core" }),
            makeReport({ verdict: "pass" }),
        ];

        const summary = summarize(reports);
        expect(summary.certificationBlockers.length).toBe(1);
        expect(summary.certificationBlockers[0]).toContain("TC_Core_Fail");
    });

    it("should handle empty report array", () => {
        const summary = summarize([]);
        expect(summary.totalTests).toBe(0);
        expect(summary.passRate).toBe("0%");
    });

    it("should produce valid markdown", () => {
        const reports = [
            makeReport({ verdict: "pass" }),
            makeReport({ verdict: "fail", testCaseName: "TC_Fail_01", category: "Core" }),
        ];

        const summary = summarize(reports);
        const md = formatSummaryMarkdown(summary);

        expect(md).toContain("# Execution Summary");
        expect(md).toContain("Certification Blockers");
        expect(md).toContain("TC_Fail_01");
    });
});
