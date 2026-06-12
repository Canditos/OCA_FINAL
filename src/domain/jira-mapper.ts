// ══════════════════════════════════════════════════════════════
// Jira Mapper — Transforms OCTT results into Jira issue payloads
// ══════════════════════════════════════════════════════════════

import type { ReportEntry } from "../connectors/octt/types.js";
import type { CreateIssueInput } from "../connectors/jira/index.js";
import { classifySeverity } from "./severity-classifier.js";

/**
 * Maps an OCTT test failure report to a Jira issue creation payload.
 *
 * The generated issue includes:
 *   - Summary with verdict and test case ID
 *   - Markdown description with test metadata and severity analysis
 *   - Labels for filtering (ocpp version, profile, verdict, SUT)
 *   - Priority derived from severity classification
 *
 * @param report         - OCTT report entry for the failed test
 * @param verdictHistory - Optional historical verdicts for repeatability scoring
 * @returns Jira issue creation payload
 */
export function mapToJiraIssue(
    report: ReportEntry,
    verdictHistory?: string[]
): CreateIssueInput {
    const severity = classifySeverity(report, verdictHistory);
    const profile = report.category.replace(/[\[\]]/g, "");

    const summary = `[${report.verdict.toUpperCase()}] ${report.testCaseName} — ${profile}`;

    const description = [
        `## Test Case: ${report.testCaseName}`,
        `**Description:** ${report.description}`,
        `**Verdict:** ${report.verdict.toUpperCase()}`,
        `**Duration:** ${(report.duration / 1000).toFixed(1)}s`,
        `**Configuration:** ${report.configuration}`,
        `**Profile:** ${profile}`,
        `**OCPP Version:** ${report.ocppVersion}`,
        `**SUT:** ${report.sut}`,
        `**Timestamp:** ${report.timeStr}`,
        `**Log File:** ${report.logfile}`,
        ``,
        `### Severity Analysis`,
        `**Priority:** ${severity.priority} (score: ${severity.score})`,
        `**Factors:**`,
        ...severity.factors.map((factor) => `- ${factor}`),
    ].join("\n");

    const labels = [
        `ocpp-${report.ocppVersion}`,
        `profile-${profile.toLowerCase().replace(/\s+/g, "-")}`,
        `verdict-${report.verdict.toLowerCase()}`,
        `sut-${report.sut.toLowerCase()}`,
        "auto-created",
    ];

    return {
        summary,
        description,
        issueType: "Bug",
        priority: severity.priority,
        labels,
    };
}

/**
 * Generates a comment body for an existing issue when a test failure recurs.
 *
 * @param report - OCTT report entry for the recurring failure
 * @returns Markdown-formatted comment string
 */
export function mapToJiraComment(report: ReportEntry): string {
    return [
        `## Failure Recurrence — ${report.timeStr}`,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        `| Verdict | ${report.verdict.toUpperCase()} |`,
        `| Duration | ${(report.duration / 1000).toFixed(1)}s |`,
        `| Configuration | ${report.configuration} |`,
        `| Log File | ${report.logfile} |`,
        ``,
        `This test case has failed again. See log file for details.`,
    ].join("\n");
}
