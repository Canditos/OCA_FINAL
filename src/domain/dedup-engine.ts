// ══════════════════════════════════════════════════════════════
// Dedup Engine — Detects if a failure already has an open Jira issue
// ══════════════════════════════════════════════════════════════
//
// Prevents duplicate bug creation by fingerprinting test failures
// and checking Jira for existing open issues. Supports three actions:
//   - create  → no existing issue found
//   - comment → open issue exists (append new occurrence)
//   - reopen  → closed issue exists (regression detected)
// ══════════════════════════════════════════════════════════════

import type { ReportEntry } from "../connectors/octt/types.js";
import type { JiraClient, JiraIssue } from "../connectors/jira/index.js";

/** Action decided by the deduplication engine */
export type DedupAction = "create" | "comment" | "reopen";

/**
 * Result of a deduplication check for a single test failure.
 */
export interface DedupResult {
    /** Recommended action */
    action: DedupAction;
    /** Existing issue reference (null when action is "create") */
    existingIssue: JiraIssue | null;
    /** Unique fingerprint derived from the report */
    fingerprint: string;
    /** Human-readable explanation for the decision */
    reason: string;
}

/**
 * Generates a dedup fingerprint from a test result.
 * Two failures match if they have the same testcase + verdict + category.
 *
 * @param report - OCTT report entry
 * @returns Fingerprint string
 */
export function generateFingerprint(report: ReportEntry): string {
    return `${report.testCaseName}::${report.verdict}::${report.category}::${report.configuration}`;
}

/**
 * Determines if a new Jira issue should be created, or if an existing one
 * should be commented on or reopened.
 *
 * Logic:
 *   1. Search Jira for open issues with the same test case ID and failure label
 *   2. If none found → create new issue
 *   3. If found and closed → reopen (regression)
 *   4. If found and open → comment (additional occurrence)
 *
 * @param report - OCTT test failure report
 * @param jira   - Initialized Jira client
 * @returns Dedup result with recommended action
 */
export async function dedup(
    report: ReportEntry,
    jira: JiraClient
): Promise<DedupResult> {
    const fingerprint = generateFingerprint(report);

    // Search for existing open issue with same test case
    const existing = await jira.findExistingIssue(
        report.testCaseName,
        classifyFailureCategory(report.verdict)
    );

    if (!existing) {
        return {
            action: "create",
            existingIssue: null,
            fingerprint,
            reason: "No existing issue found for this test case",
        };
    }

    // Check if the existing issue is closed/done
    const status = (existing.fields.status as { name: string })?.name?.toLowerCase();

    if (status === "done" || status === "closed" || status === "resolved") {
        return {
            action: "reopen",
            existingIssue: existing,
            fingerprint,
            reason: `Issue ${existing.key} was ${status} but failure reappeared (regression)`,
        };
    }

    return {
        action: "comment",
        existingIssue: existing,
        fingerprint,
        reason: `Issue ${existing.key} already open — adding new occurrence`,
    };
}

/**
 * Maps an OCTT verdict to a Jira label used for categorization.
 *
 * @param verdict - OCTT verdict string
 * @returns Jira label string
 */
function classifyFailureCategory(verdict: string): string {
    switch (verdict.toLowerCase()) {
        case "error": return "test-error";
        case "inconc": return "inconclusive";
        case "fail": return "test-fail";
        default: return "unknown";
    }
}
