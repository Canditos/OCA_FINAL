// ══════════════════════════════════════════════════════════════
// Execution Summarizer — Generates daily/session summaries
// ══════════════════════════════════════════════════════════════

import type { ReportEntry } from "../connectors/octt/types.js";

/**
 * Structured summary of a certification test execution batch.
 */
export interface ExecutionSummary {
    /** ISO timestamp when the summary was generated */
    timestamp: string;
    /** OCTT configuration profile used */
    configuration: string;
    /** OCPP version under test */
    ocppVersion: string;
    /** Total number of test cases executed */
    totalTests: number;
    passed: number;
    failed: number;
    inconclusive: number;
    errors: number;
    /** Formatted pass rate percentage */
    passRate: string;
    duration: {
        /** Total execution time in milliseconds */
        totalMs: number;
        /** Human-readable duration string */
        formatted: string;
    };
    /** Non-passing tests with their profile */
    failedTests: { name: string; verdict: string; profile: string }[];
    /** Failures in certification-blocking profiles */
    certificationBlockers: string[];
}

/**
 * Certification profiles that are considered blocking.
 * A failure in any of these profiles prevents certification approval.
 */
const BLOCKING_PROFILES = ["Core", "Advanced Security", "Smart Charging"];

/**
 * Produces a structured summary from a batch of OCTT test reports.
 *
 * @param reports - Array of OCTT report entries
 * @returns Execution summary with statistics and blocker list
 */
export function summarize(reports: ReportEntry[]): ExecutionSummary {
    if (reports.length === 0) {
        return {
            timestamp: new Date().toISOString(),
            configuration: "N/A",
            ocppVersion: "N/A",
            totalTests: 0,
            passed: 0,
            failed: 0,
            inconclusive: 0,
            errors: 0,
            passRate: "0%",
            duration: { totalMs: 0, formatted: "0s" },
            failedTests: [],
            certificationBlockers: [],
        };
    }

    const passed = reports.filter((r) => r.verdict.toLowerCase() === "pass").length;
    const failed = reports.filter((r) => r.verdict.toLowerCase() === "fail").length;
    const inconclusive = reports.filter((r) => r.verdict.toLowerCase() === "inconc").length;
    const errors = reports.filter((r) => r.verdict.toLowerCase() === "error").length;
    const totalMs = reports.reduce((sum, r) => sum + r.duration, 0);

    const failedTests = reports
        .filter((r) => r.verdict.toLowerCase() !== "pass")
        .map((r) => ({
            name: r.testCaseName,
            verdict: r.verdict,
            profile: r.category.replace(/[\[\]]/g, ""),
        }));

    // Identify failures in certification-critical profiles
    const certificationBlockers = failedTests
        .filter((t) => BLOCKING_PROFILES.some((profile) => t.profile.includes(profile)))
        .map((t) => `${t.name} (${t.verdict}) — blocks [${t.profile}]`);

    return {
        timestamp: new Date().toISOString(),
        configuration: reports[0].configuration,
        ocppVersion: reports[0].ocppVersion,
        totalTests: reports.length,
        passed,
        failed,
        inconclusive,
        errors,
        passRate: `${((passed / reports.length) * 100).toFixed(1)}%`,
        duration: {
            totalMs,
            formatted: formatDuration(totalMs),
        },
        failedTests,
        certificationBlockers,
    };
}

/**
 * Formats a summary into a human-readable markdown report.
 *
 * @param summary - Execution summary data
 * @returns Markdown string suitable for Slack, email, or wiki
 */
export function formatSummaryMarkdown(summary: ExecutionSummary): string {
    const lines = [
        `# Execution Summary — ${summary.timestamp}`,
        ``,
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Configuration | ${summary.configuration} |`,
        `| OCPP Version | ${summary.ocppVersion} |`,
        `| Total Tests | ${summary.totalTests} |`,
        `| ✅ Passed | ${summary.passed} |`,
        `| ❌ Failed | ${summary.failed} |`,
        `| ⚠️ Inconclusive | ${summary.inconclusive} |`,
        `| 🔴 Errors | ${summary.errors} |`,
        `| Pass Rate | **${summary.passRate}** |`,
        `| Duration | ${summary.duration.formatted} |`,
    ];

    if (summary.certificationBlockers.length > 0) {
        lines.push(``, `## 🚨 Certification Blockers`);
        summary.certificationBlockers.forEach((blocker) => lines.push(`- ${blocker}`));
    }

    if (summary.failedTests.length > 0) {
        lines.push(``, `## Failed Tests`);
        lines.push(`| Test Case | Verdict | Profile |`);
        lines.push(`|-----------|---------|---------|`);
        summary.failedTests.forEach((t) =>
            lines.push(`| ${t.name} | ${t.verdict} | ${t.profile} |`)
        );
    }

    return lines.join("\n");
}

/**
 * Converts a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "2h 15m 30s")
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}
