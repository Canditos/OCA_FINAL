// ══════════════════════════════════════════════════════════════
// OCTT API Client — adapted from octt-api-main/src/
// Unified client combining all modules into a single class
// ══════════════════════════════════════════════════════════════

import { HttpClient } from "./http-client.js";
import type {
    OcttApiOptions,
    GetConfigurationsResponse,
    GetConfigurationResponse,
    MessageResponse,
    ResponseMessageResponse,
    GetReportsResponse,
    GetReportsFilter,
    DownloadReportsFilter,
    GetCommentResponse,
    SutConnectionStatus,
    GetTestCasesResponse,
    ExecuteTestCaseResponse,
    GetOcppVersionsResponse,
} from "./types.js";

/**
 * High-level client for the OCTT (OCPP Compliance Testing Tool) REST API.
 *
 * All methods are async and return typed responses. The client automatically
 * handles Bearer token authentication and constructs versioned API paths
 * based on the OCPP version and role (CS/CSMS) provided at construction.
 */
export class OcttClient {
    private readonly client: HttpClient;
    private readonly versionedPath: string;

    /**
     * Creates a new OCTT API client.
     *
     * @param options - Connection and versioning options
     */
    constructor(private readonly options: OcttApiOptions) {
        const baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.client = new HttpClient(`${baseUrl}/api/v1`, options.token);
        // API paths are prefixed with /{ocppVersion}/{role} (e.g., /ocpp1.6/CS)
        this.versionedPath = `/${options.ocppVersion}/${options.role}`;
    }

    // ── Configurations ──

    /**
     * Lists all configuration profiles available on the OCTT server.
     * @returns Array of configuration name strings
     */
    async listConfigurations(): Promise<GetConfigurationsResponse> {
        return this.client.request("GET", `${this.versionedPath}/configurations`);
    }

    /**
     * Retrieves a single configuration profile by name, including its
     * full parameter dictionary (timeouts, SUT endpoint, certificates, etc.).
     *
     * @param name - Configuration profile name (e.g., "AUT_SID_SAT")
     */
    async getConfiguration(name: string): Promise<GetConfigurationResponse> {
        return this.client.request("GET", `${this.versionedPath}/configurations/${encodeURIComponent(name)}`);
    }

    /**
     * Creates or overwrites a configuration profile.
     *
     * @param name - Configuration profile name
     * @param data - Complete configuration parameter dictionary
     */
    async saveConfiguration(name: string, data: Record<string, unknown>): Promise<MessageResponse> {
        return this.client.request("PUT", `${this.versionedPath}/configurations/${encodeURIComponent(name)}`, {
            body: data,
        });
    }

    /**
     * Deletes a configuration profile from the OCTT server.
     *
     * @param name - Configuration profile name
     */
    async deleteConfiguration(name: string): Promise<MessageResponse> {
        return this.client.request("DELETE", `${this.versionedPath}/configurations/${encodeURIComponent(name)}`);
    }

    // ── Sessions ──

    /**
     * Starts a test session for the given configuration profile.
     * The SUT (System Under Test) must be connected before calling this.
     *
     * @param configurationName - Profile to load for the session
     */
    async startSession(configurationName: string): Promise<MessageResponse> {
        return this.client.request("POST", `${this.versionedPath}/session/start/${encodeURIComponent(configurationName)}`);
    }

    /**
     * Stops the currently active test session and releases the SUT.
     */
    async stopSession(): Promise<MessageResponse> {
        return this.client.request("POST", "/session/stop");
    }

    // ── Test Execution ──

    /**
     * Lists all test cases available for a given configuration,
     * grouped by functional block.
     *
     * @param configurationName - Profile whose test cases should be listed
     */
    async listTestCases(configurationName: string): Promise<GetTestCasesResponse> {
        return this.client.request("GET", `${this.versionedPath}/testcases/${encodeURIComponent(configurationName)}`);
    }

    /**
     * Executes a single test case by name.
     * The session must already be started.
     *
     * @param testcaseName - Test case ID (e.g., "TC_001_CS")
     */
    async executeTestCase(testcaseName: string): Promise<ExecuteTestCaseResponse> {
        return this.client.request("POST", `/testcases/${encodeURIComponent(testcaseName)}/execute`);
    }

    /**
     * Aborts the currently running test case, if any.
     */
    async stopTestCase(): Promise<MessageResponse> {
        return this.client.request("GET", "/testcases/stop");
    }

    // ── Reports ──

    /**
     * Retrieves test reports with optional filtering by configuration
     * or test case name.
     *
     * @param params - Optional query parameters
     */
    async getReports(params?: { configuration_name?: string; testcase_name?: string }): Promise<GetReportsResponse> {
        return this.client.request("GET", `${this.versionedPath}/reports`, {
            params: params as Record<string, string>,
        });
    }

    /**
     * Retrieves test reports using a POST body filter (supports arrays
     * and date ranges that are awkward in query strings).
     *
     * @param filter - Structured filter object
     */
    async getReportsFiltered(filter: GetReportsFilter): Promise<GetReportsResponse> {
        return this.client.request("POST", `${this.versionedPath}/reports`, { body: filter });
    }

    /**
     * Downloads reports in the requested format (CSV, XLS, ZIP).
     *
     * @param params - Format and optional filters
     * @returns Raw binary Buffer of the downloaded file
     */
    async downloadReports(params: { format: string; configuration_name?: string; logfile_name?: string }): Promise<Buffer> {
        const queryParams: Record<string, string> = { format: params.format };
        if (params.logfile_name) queryParams.logfile_name = params.logfile_name;
        if (params.configuration_name) queryParams.configuration_name = params.configuration_name;

        return this.client.request("GET", `${this.versionedPath}/reports/download`, {
            params: queryParams,
            responseType: "arraybuffer",
        });
    }

    /**
     * Downloads reports using a POST body filter.
     *
     * @param filter - Structured filter including format
     * @returns Raw binary Buffer of the downloaded file
     */
    async downloadReportsFiltered(filter: DownloadReportsFilter): Promise<Buffer> {
        return this.client.request("POST", `${this.versionedPath}/reports/download`, {
            body: filter,
            responseType: "arraybuffer",
        });
    }

    // ── Comments ──

    /**
     * Retrieves the comment attached to a specific report logfile.
     *
     * @param configurationName - Configuration profile name
     * @param logfileName       - Logfile identifier
     */
    async getComment(configurationName: string, logfileName: string): Promise<GetCommentResponse> {
        return this.client.request("GET", `${this.versionedPath}/reports/${encodeURIComponent(configurationName)}/comment`, {
            params: { logfile_name: logfileName },
        });
    }

    /**
     * Adds or updates a comment on a report logfile.
     *
     * @param configurationName - Configuration profile name
     * @param logfileName       - Logfile identifier
     * @param comment           - Comment text
     */
    async addComment(configurationName: string, logfileName: string, comment: string): Promise<ResponseMessageResponse> {
        const params = new URLSearchParams();
        params.append("comment", comment);

        return this.client.request("PUT", `${this.versionedPath}/reports/${encodeURIComponent(configurationName)}/comment`, {
            body: params.toString(),
            contentType: "application/x-www-form-urlencoded",
            params: { logfile_name: logfileName },
        });
    }

    // ── SUT Status ──

    /**
     * Returns the current SUT connection status, session state,
     * and selected configuration profile.
     */
    async getSutStatus(): Promise<SutConnectionStatus> {
        return this.client.request("GET", "/sut_connection_status");
    }

    // ── OCPP Versions ──

    /**
     * Lists OCPP versions supported by this OCTT instance.
     */
    async listOcppVersions(): Promise<GetOcppVersionsResponse> {
        return this.client.request("GET", "/ocpp_versions");
    }
}
