// ══════════════════════════════════════════════════════════════
// Severity Classifier — Maps OCTT results to Jira priority
// ══════════════════════════════════════════════════════════════
//
// Scores each test failure on a 0-100 scale using four factors:
//   1. Certification profile impact (core vs optional)
//   2. Verdict type (error > fail > inconclusive)
//   3. Functional block criticality
//   4. Repeatability (if historical data is available)
//
// The score is then mapped to a Jira priority level.
// ══════════════════════════════════════════════════════════════

import type { ReportEntry } from "../connectors/octt/types.js";

/** Jira priority levels ordered from highest to lowest urgency */
export type JiraPriority = "Highest" | "High" | "Medium" | "Low" | "Lowest";

/**
 * Result of severity classification including the mapped priority,
 * numeric score, and contributing factor descriptions.
 */
export interface SeverityResult {
    priority: JiraPriority;
    score: number;
    factors: string[];
}

/** Core certification profiles — failures here block certification */
const CORE_PROFILES = ["Core", "Advanced Security", "Smart Charging"];

/** Certification-critical functional blocks */
const CRITICAL_BLOCKS = [
    "A_Security",
    "B_Provisioning",
    "C_Authorization",
    "E_Transactions",
];

/**
 * Classifies the severity of a test failure based on multiple factors:
 * - Certification impact (core profile vs optional)
 * - Functional block criticality
 * - Verdict type (error vs inconclusive vs fail)
 * - Repeatability (based on verdict history, if available)
 *
 * @param report         - OCTT report entry for the failed test
 * @param verdictHistory - Optional array of previous verdicts for repeatability scoring
 * @returns Severity result with Jira priority mapping
 */
export function classifySeverity(
    report: ReportEntry,
    verdictHistory?: string[]
): SeverityResult {
    let score = 0;
    const factors: string[] = [];

    // Factor 1: Certification profile impact
    const profile = report.category.replace(/[\[\]]/g, "");
    if (CORE_PROFILES.includes(profile)) {
        score += 40;
        factors.push(`Core certification profile: ${profile}`);
    } else {
        score += 10;
        factors.push(`Non-core profile: ${profile}`);
    }

    // Factor 2: Verdict type
    const verdict = report.verdict.toLowerCase();
    if (verdict === "error") {
        score += 30;
        factors.push("Verdict: error (infrastructure/setup issue)");
    } else if (verdict === "fail") {
        score += 25;
        factors.push("Verdict: fail (protocol non-compliance)");
    } else if (verdict === "inconc") {
        score += 15;
        factors.push("Verdict: inconclusive (indeterminate result)");
    }

    // Factor 3: Functional block criticality
    const isCriticalBlock = CRITICAL_BLOCKS.some((block) =>
        report.testCaseName.includes(block) || report.description?.includes(block)
    );
    if (isCriticalBlock) {
        score += 20;
        factors.push("Critical functional block");
    }

    // Factor 4: Repeatability (if history available)
    if (verdictHistory && verdictHistory.length > 0) {
        const failCount = verdictHistory.filter((v) => v !== "pass").length;
        const ratio = failCount / verdictHistory.length;
        if (ratio >= 0.8) {
            score += 10;
            factors.push(`Consistent failure (${failCount}/${verdictHistory.length} runs failed)`);
        } else if (ratio <= 0.2) {
            score -= 5;
            factors.push(`Intermittent failure (${failCount}/${verdictHistory.length} runs failed)`);
        }
    }

    // Map score to Jira priority
    let priority: JiraPriority;
    if (score >= 70) priority = "Highest";
    else if (score >= 55) priority = "High";
    else if (score >= 35) priority = "Medium";
    else if (score >= 20) priority = "Low";
    else priority = "Lowest";

    return { priority, score, factors };
}
