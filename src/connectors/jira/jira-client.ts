// ══════════════════════════════════════════════════════════════
// Jira Client — REST API v3 for Atlassian Cloud
// ══════════════════════════════════════════════════════════════
//
// Wrapper around Jira Cloud's REST API v3 for issue management.
// Supports searching (JQL), CRUD operations, comments, transitions,
// and file attachments. Uses Basic Auth (email + API token).
//
// Reference: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
// ══════════════════════════════════════════════════════════════

import axios, { type AxiosInstance } from "axios";

/**
 * Connection credentials and project context for Jira Cloud.
 */
export interface JiraConfig {
    /** Jira Cloud base URL (e.g., https://yourdomain.atlassian.net) */
    baseUrl: string;
    /** Atlassian account email address */
    email: string;
    /** Atlassian API token (not password) */
    apiToken: string;
    /** Project key where issues will be created */
    projectKey: string;
}

/**
 * Represents a Jira issue returned by the API.
 */
export interface JiraIssue {
    /** Internal numeric issue ID */
    id: string;
    /** Human-readable issue key (e.g., "CERT-42") */
    key: string;
    /** Full field map (varies by expand parameters) */
    fields: Record<string, unknown>;
}

/**
 * Paginated search result from a JQL query.
 */
export interface JiraSearchResult {
    issues: JiraIssue[];
    total: number;
    maxResults: number;
    startAt: number;
}

/**
 * Input shape for creating a new Jira issue.
 */
export interface CreateIssueInput {
    summary: string;
    description: string;
    issueType: string;
    priority?: string;
    labels?: string[];
    components?: string[];
    assigneeId?: string;
    customFields?: Record<string, unknown>;
}

/**
 * Describes an available workflow transition for an issue.
 */
export interface TransitionInfo {
    id: string;
    name: string;
    to: { name: string; id: string };
}

/**
 * Client for Jira Cloud REST API v3.
 *
 * Authentication: HTTP Basic Auth using email + API token.
 * Content format: Atlassian Document Format (ADF) for descriptions/comments.
 */
export class JiraClient {
    private readonly axios: AxiosInstance;
    private readonly projectKey: string;

    /**
     * Creates a Jira client configured for a specific project.
     *
     * @param config - Jira connection and project settings
     */
    constructor(config: JiraConfig) {
        this.projectKey = config.projectKey;
        const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");

        this.axios = axios.create({
            baseURL: `${config.baseUrl.replace(/\/+$/, "")}/rest/api/3`,
            headers: {
                Authorization: `Basic ${auth}`,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
        });
    }

    // ── Search ──

    /**
     * Executes a JQL query and returns matching issues.
     *
     * @param jql        - JQL query string
     * @param fields     - Fields to return (default: common set)
     * @param maxResults - Page size (default: 50)
     */
    async search(jql: string, fields = ["summary", "status", "priority", "labels", "assignee", "created", "updated"], maxResults = 50): Promise<JiraSearchResult> {
        const response = await this.axios.post("/search/jql", {
            jql,
            fields,
            maxResults,
        });
        return response.data;
    }

    /**
     * Searches for an existing open issue matching a test case ID
     * and failure category label. Used by the deduplication engine
     * to avoid creating duplicate bugs.
     *
     * @param testcaseId      - Test case identifier (e.g., "TC_001_CS")
     * @param failureCategory - Label used to categorize the failure type
     * @returns The most recently created matching issue, or null
     */
    async findExistingIssue(testcaseId: string, failureCategory: string): Promise<JiraIssue | null> {
        const jql = `project = "${this.projectKey}" AND summary ~ "${testcaseId}" AND labels = "${failureCategory}" AND status != "Done" ORDER BY created DESC`;
        const result = await this.search(jql, undefined, 1);
        return result.issues.length > 0 ? result.issues[0] : null;
    }

    // ── CRUD ──

    /**
     * Retrieves a single issue by key.
     *
     * @param issueKey - Issue key (e.g., "CERT-42")
     */
    async getIssue(issueKey: string): Promise<JiraIssue> {
        const response = await this.axios.get(`/issue/${issueKey}`);
        return response.data;
    }

    /**
     * Creates a new issue in the configured project.
     * Description is formatted as Atlassian Document Format (ADF).
     *
     * @param input - Issue creation payload
     * @returns Created issue with assigned key
     */
    async createIssue(input: CreateIssueInput): Promise<JiraIssue> {
        const fields: Record<string, unknown> = {
            project: { key: this.projectKey },
            summary: input.summary,
            description: {
                type: "doc",
                version: 1,
                content: [
                    {
                        type: "paragraph",
                        content: [{ type: "text", text: input.description }],
                    },
                ],
            },
            issuetype: { name: input.issueType },
        };

        if (input.priority) fields.priority = { name: input.priority };
        if (input.labels) fields.labels = input.labels;
        if (input.components) fields.components = input.components.map((name) => ({ name }));
        if (input.assigneeId) fields.assignee = { accountId: input.assigneeId };
        if (input.customFields) Object.assign(fields, input.customFields);

        const response = await this.axios.post("/issue", { fields });
        return response.data;
    }

    /**
     * Updates fields on an existing issue.
     *
     * @param issueKey - Issue to update
     * @param fields   - Partial field map
     */
    async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
        await this.axios.put(`/issue/${issueKey}`, { fields });
    }

    // ── Comments ──

    /**
     * Adds a comment to an issue.
     *
     * @param issueKey - Target issue
     * @param body     - Plain text comment body (converted to ADF)
     */
    async addComment(issueKey: string, body: string): Promise<void> {
        await this.axios.post(`/issue/${issueKey}/comment`, {
            body: {
                type: "doc",
                version: 1,
                content: [
                    {
                        type: "paragraph",
                        content: [{ type: "text", text: body }],
                    },
                ],
            },
        });
    }

    // ── Transitions ──

    /**
     * Lists available workflow transitions for an issue.
     *
     * @param issueKey - Target issue
     * @returns Array of transition metadata
     */
    async getTransitions(issueKey: string): Promise<TransitionInfo[]> {
        const response = await this.axios.get(`/issue/${issueKey}/transitions`);
        return response.data.transitions;
    }

    /**
     * Performs a workflow transition by transition ID.
     *
     * @param issueKey     - Target issue
     * @param transitionId - Transition ID from getTransitions()
     * @param comment      - Optional comment to add during transition
     */
    async transitionIssue(issueKey: string, transitionId: string, comment?: string): Promise<void> {
        const body: Record<string, unknown> = {
            transition: { id: transitionId },
        };

        if (comment) {
            body.update = {
                comment: [
                    {
                        add: {
                            body: {
                                type: "doc",
                                version: 1,
                                content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }],
                            },
                        },
                    },
                ],
            };
        }

        await this.axios.post(`/issue/${issueKey}/transitions`, body);
    }

    /**
     * Performs a workflow transition by human-readable name (case-insensitive).
     * Useful when the transition ID is not known in advance.
     *
     * @param issueKey       - Target issue
     * @param transitionName - Human-readable transition name (e.g., "Reopen")
     * @param comment        - Optional comment
     * @returns true if the transition was found and applied
     */
    async transitionByName(issueKey: string, transitionName: string, comment?: string): Promise<boolean> {
        const transitions = await this.getTransitions(issueKey);
        const target = transitions.find((t) => t.name.toLowerCase() === transitionName.toLowerCase());
        if (!target) return false;
        await this.transitionIssue(issueKey, target.id, comment);
        return true;
    }

    // ── Attachments ──

    /**
     * Attaches a file to an issue.
     *
     * @param issueKey - Target issue
     * @param filename - Display filename
     * @param content  - Raw file content as Buffer
     */
    async addAttachment(issueKey: string, filename: string, content: Buffer): Promise<void> {
        const FormData = (await import("form-data")).default;
        const form = new FormData();
        form.append("file", content, { filename });

        await this.axios.post(`/issue/${issueKey}/attachments`, form, {
            headers: {
                ...form.getHeaders(),
                "X-Atlassian-Token": "no-check",
            },
        });
    }

    // ── Custom Fields ──

    /**
     * Lists all custom fields available in the Jira instance.
     * Filters to show only fields that are relevant (SUT, Firmware, etc.)
     */
    async getCustomFields(): Promise<Array<{ id: string; name: string; schema: unknown }>> {
        const response = await this.axios.get("/field");
        return response.data
            .filter((f: any) => f.custom)
            .map((f: any) => ({ id: f.id, name: f.name, schema: f.schema }));
    }

    /**
     * Gets all unique values for a custom field by searching issues.
     * Useful for populating dropdowns with existing SUTs or firmware versions.
     *
     * @param fieldName - Human-readable field name (e.g., "SUT")
     * @returns Array of unique string values
     */
    async getCustomFieldValues(fieldName: string): Promise<string[]> {
        const jql = `project = "${this.projectKey}" AND "${fieldName}" IS NOT EMPTY ORDER BY created DESC`;
        const result = await this.search(jql, ["customfield_"], 100);
        
        const values = new Set<string>();
        for (const issue of result.issues) {
            for (const [key, value] of Object.entries(issue.fields)) {
                if (key.startsWith("customfield_") && value) {
                    if (typeof value === "string") {
                        values.add(value);
                    } else if (typeof value === "object" && value !== null) {
                        // Handle select/multi-select fields
                        if (Array.isArray(value)) {
                            value.forEach((v: any) => {
                                if (typeof v === "string") values.add(v);
                                else if (v?.value) values.add(v.value);
                                else if (v?.name) values.add(v.name);
                            });
                        } else {
                            if ((value as any).value) values.add((value as any).value);
                            else if ((value as any).name) values.add((value as any).name);
                        }
                    }
                }
            }
        }
        return Array.from(values).sort();
    }

    /**
     * Searches for existing Test Execution issues to extract metadata.
     * Returns unique SUTs and firmware versions from previous executions.
     */
    async getExecutionMetadata(): Promise<{ suts: string[]; firmwares: string[]; testPlans: string[] }> {
        const jql = `project = "${this.projectKey}" AND labels = "test-execution" ORDER BY created DESC`;
        const result = await this.search(jql, ["summary", "description", "labels"], 50);
        
        const suts = new Set<string>();
        const firmwares = new Set<string>();
        const testPlans = new Set<string>();

        for (const issue of result.issues) {
            // Extract SUT and firmware from summary: "[OCPP 1.6] Test Execution — SUT | FW version | pass%"
            const summary = issue.fields.summary as string || "";
            const match = summary.match(/—\s*(.+?)\s*\|\s*FW\s*(.+?)\s*\|/);
            if (match) {
                suts.add(match[1].trim());
                firmwares.add(match[2].trim());
            }
            
            // Extract test plan from description
            const desc = issue.fields.description as any;
            if (desc && typeof desc === "object") {
                const text = JSON.stringify(desc);
                const planMatch = text.match(/Test Plan[\s|:]+([^|]+)/);
                if (planMatch) testPlans.add(planMatch[1].trim());
            }
        }

        return {
            suts: Array.from(suts).sort(),
            firmwares: Array.from(firmwares).sort(),
            testPlans: Array.from(testPlans).sort(),
        };
    }
}
