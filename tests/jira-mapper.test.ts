import { describe, it, expect } from "vitest";
import { mapToJiraIssue, mapToJiraComment } from "../src/domain/jira-mapper.js";
import type { ReportEntry } from "../src/connectors/octt/types.js";

function makeReport(overrides: Partial<ReportEntry> = {}): ReportEntry {
    return {
        category: "Core",
        config_version: "1.0",
        configuration: "test-config",
        description: "Test case A_Security_01 checks...",
        duration: 12000,
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

describe("Jira Mapper", () => {
    it("should create a valid Jira issue from a failing report", () => {
        const report = makeReport();
        const issue = mapToJiraIssue(report);

        expect(issue.summary).toContain("[FAIL]");
        expect(issue.summary).toContain("TC_A_Security_01_CS");
        expect(issue.issueType).toBe("Bug");
        expect(issue.priority).toBeDefined();
        expect(issue.labels).toContain("auto-created");
        expect(issue.labels).toContain("verdict-fail");
        expect(issue.description).toContain("ocpp2.0.1");
    });

    it("should include severity analysis in description", () => {
        const report = makeReport({ verdict: "error", category: "Core" });
        const issue = mapToJiraIssue(report);

        expect(issue.description).toContain("Severity Analysis");
        expect(issue.description).toContain("Priority:");
    });

    it("should generate recurrence comment with relevant details", () => {
        const report = makeReport();
        const comment = mapToJiraComment(report);

        expect(comment).toContain("Failure Recurrence");
        expect(comment).toContain("test-config");
        expect(comment).toContain("FAIL");
    });

    it("should generate correct labels for OCPP version and profile", () => {
        const report = makeReport({ ocppVersion: "ocpp1.6", category: "Smart Charging" });
        const issue = mapToJiraIssue(report);

        expect(issue.labels).toContain("ocpp-ocpp1.6");
        expect(issue.labels).toContain("profile-smart-charging");
    });
});
