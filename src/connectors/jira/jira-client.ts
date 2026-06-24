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
            timeout: 30000,
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
     * @param testCase        - Test case identifier (e.g., "TC_001_CS")
     * @param verdict - Label used to categorize the failure type
     * @returns The most recently created matching issue, or null
     */
    async findExistingIssue(testCase: string, verdict: string): Promise<JiraIssue | null> {
        // Find existing open Bugs for this test case
        const jql = `project = "${this.projectKey}" AND issuetype = Bug AND statusCategory != Done AND summary ~ "${testCase}"`;
        const result = await this.search(jql, ["summary", "status"], 1);
        return result.issues.length > 0 ? result.issues[0] : null;
    }

    // ── Xray Integration ──

    /**
     * Resolves the custom field IDs for the given field names.
     */
    async getFieldIds(fieldNames: string[]): Promise<Record<string, string>> {
        const fields = await this.getCustomFields();
        const result: Record<string, string> = {};
        for (const name of fieldNames) {
            const field = fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
            if (field) result[name] = field.id;
        }
        return result;
    }

    /**
     * Finds the Jira Test Key for a given OCTT test case name.
     */
    async findTestKey(testCaseName: string): Promise<string | null> {
        const jql = `project = "${this.projectKey}" AND issuetype = Test AND summary ~ "${testCaseName}"`;
        const result = await this.search(jql, ["summary"], 1);
        return result.issues.length > 0 ? result.issues[0].key : null;
    }

    /**
     * Authenticates with Xray Cloud and returns a Bearer token.
     */
    async authenticateXray(clientId: string, clientSecret: string): Promise<string> {
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/authenticate", {
            client_id: clientId,
            client_secret: clientSecret
        });
        return response.data; // token string
    }

    /**
     * Uploads a test execution payload to Xray Cloud.
     */
    async uploadXrayExecution(payload: unknown, token: string): Promise<any> {
        console.log("Xray Payload:", JSON.stringify(payload, null, 2));
        try {
            const response = await axios.post("https://xray.cloud.getxray.app/api/v2/import/execution", payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            });
            return response.data;
        } catch (err: any) {
            if (err.response) {
                console.error("Xray upload detailed error:", JSON.stringify(err.response.data, null, 2));
                throw new Error(`Xray upload failed: ${err.message}. Details: ${JSON.stringify(err.response.data)}`);
            }
            throw err;
        }
    }

    /**
     * Fetches Xray Test Run Custom Fields and their allowed values.
     */
    async getXrayCustomFieldsSpec(clientId: string, clientSecret: string, projectKey: string): Promise<any> {
        const token = await this.authenticateXray(clientId, clientSecret);
        const query = `
          query GetProjectSettings($projectIdOrKey: String!) {
            getProjectSettings(projectIdOrKey: $projectIdOrKey) {
              testRunCustomFieldSettings {
                fields {
                  id
                  name
                  type
                  required
                  values
                }
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
            query,
            variables: { projectIdOrKey: projectKey }
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });
        return response.data?.data?.getProjectSettings?.testRunCustomFieldSettings?.fields || [];
    }

    /**
     * Fetches steps of a given Test case by its numeric ID using Xray GraphQL.
     */
    async getXrayTestSteps(issueId: string, token: string): Promise<any[]> {
        const query = `
          query GetTest($issueId: String!) {
            getTest(issueId: $issueId) {
              steps {
                id
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
            query,
            variables: { issueId }
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });
        return response.data?.data?.getTest?.steps || [];
    }

    /**
     * Fetches Test Executions linked to a Test Plan using Xray Cloud GraphQL.
     */
    async getXrayTestPlanExecutions(issueId: string, token: string): Promise<Array<{ key: string; summary?: string }>> {
        const query = `
          query GetTestPlan($issueId: String!) {
            getTestPlan(issueId: $issueId) {
              testExecutions(limit: 100) {
                results {
                  issueId
                  jira(fields: ["key", "summary"])
                }
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
            query,
            variables: { issueId }
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        if (response.data?.errors?.length) {
            throw new Error(response.data.errors.map((e: any) => e.message).join("; "));
        }

        const results = response.data?.data?.getTestPlan?.testExecutions?.results || [];
        return results
            .map((item: any) => {
                const jira = item?.jira || {};
                return {
                    key: String(jira.key || ""),
                    summary: jira.summary ? String(jira.summary) : undefined,
                };
            })
            .filter((item: { key: string }) => item.key);
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

    async findTestPlanKey(testPlan: string): Promise<string | null> {
        const value = testPlan.trim();
        if (!value) return null;
        if (/^[A-Z][A-Z0-9]+-\d+$/.test(value)) return value;

        const escaped = value.replace(/"/g, '\\"');
        const jql = `project = "${this.projectKey}" AND issuetype = "Test Plan" AND summary ~ "${escaped}" ORDER BY updated DESC`;
        const result = await this.search(jql, ["summary"], 1);
        return result.issues.length > 0 ? result.issues[0].key : null;
    }

    /**
     * Fetches tests belonging to a Test Execution using Xray Cloud GraphQL.
     */
    async getXrayTestExecutionTests(issueId: string, token: string): Promise<Array<{ key: string; testCaseName?: string }>> {
        const query = `
          query GetTestExecution($issueId: String!) {
            getTestExecution(issueId: $issueId) {
              tests(limit: 100) {
                results {
                  jira(fields: ["summary"]) {
                    key
                    summary
                  }
                }
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
            query,
            variables: { issueId }
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });
        const results = response.data?.data?.getTestExecution?.tests?.results || [];
        return results.map((r: any) => ({
            key: r.jira?.key,
            testCaseName: r.jira?.summary
        }));
    }

    async searchTestPlans(): Promise<Array<{ key: string; summary?: string }>> {
        const jql = `project = "${this.projectKey}" AND issuetype = "Test Plan" ORDER BY updated DESC`;
        const result = await this.search(jql, ["summary"], 100);
        return result.issues.map((issue) => ({
            key: issue.key,
            summary: typeof issue.fields.summary === "string" ? issue.fields.summary : undefined,
        }));
    }

    async getXrayExecutionCustomFields(issueId: string, token: string): Promise<Array<{ id: string; values: string[] }>> {
        const query = `
          query GetTestExecution($issueId: String!) {
            getTestExecution(issueId: $issueId) {
              testRuns(limit: 1) {
                results {
                  customFields {
                    id
                    values
                  }
                }
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
            query,
            variables: { issueId }
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });
        const runs = response.data?.data?.getTestExecution?.testRuns?.results || [];
        const firstRun = runs[0];
        return firstRun?.customFields || [];
    }

    async searchTestExecutions(testPlan: string): Promise<Array<{ key: string; summary?: string }>> {
        const escaped = testPlan.trim().replace(/"/g, '\\"');
        if (!escaped) return [];

        const jql = `project = "${this.projectKey}" AND issuetype = "Test Execution" AND text ~ "${escaped}" ORDER BY updated DESC`;
        const result = await this.search(jql, ["summary"], 100);
        return result.issues.map((issue) => ({
            key: issue.key,
            summary: typeof issue.fields.summary === "string" ? issue.fields.summary : undefined,
        }));
    }

    async getXrayTestPlanTracking(issueId: string, token: string): Promise<{ tests: any[], executions: any[] }> {
        const query = `
          query GetTestPlanTracking($issueId: String!, $start: Int!) {
            getTestPlan(issueId: $issueId) {
              tests(limit: 100, start: $start) {
                total
                results {
                  status {
                    name
                    color
                  }
                  jira(fields: ["key", "summary"])
                }
              }
              testExecutions(limit: 100) {
                results {
                  jira(fields: ["key", "summary"])
                  testRuns(limit: 100) {
                    results {
                      status { name color }
                      defects
                      evidence { filename }
                      test {
                        jira(fields: ["key"])
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        let allTests: any[] = [];
        let allExecutions: any[] = [];
        let start = 0;
        let hasMore = true;

        while (hasMore) {
            const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
                query,
                variables: { issueId, start }
            }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            });

            if (response.data?.errors?.length) {
                throw new Error(response.data.errors.map((e: any) => e.message).join("; "));
            }

            const data = response.data?.data?.getTestPlan;
            if (!data) break;

            const fetchedTests = data.tests?.results || [];
            allTests.push(...fetchedTests);
            
            if (start === 0 && data.testExecutions?.results) {
                allExecutions = data.testExecutions.results;
            }

            const total = data.tests?.total || 0;
            if (allTests.length >= total || fetchedTests.length === 0) {
                hasMore = false;
            } else {
                start += 100;
            }
        }

        return { tests: allTests, executions: allExecutions };
    }
}
