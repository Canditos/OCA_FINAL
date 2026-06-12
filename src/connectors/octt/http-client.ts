// ══════════════════════════════════════════════════════════════
// OCTT HTTP Client — adapted from octt-api-main/src/client.ts
// Low-level Axios wrapper with unified error handling.
// ══════════════════════════════════════════════════════════════

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, type Method } from "axios";

/**
 * Structured error thrown by the OCTT HTTP client.
 * Includes the HTTP status code, a machine-readable error code,
 * and the request URL for debugging.
 */
export class OcttApiError extends Error {
    public readonly statusCode?: number;
    public readonly errorCode: string;
    public readonly requestUrl?: string;

    constructor(message: string, options: { statusCode?: number; errorCode: string; requestUrl?: string; cause?: Error }) {
        super(message);
        this.name = "OcttApiError";
        this.statusCode = options.statusCode;
        this.errorCode = options.errorCode;
        this.requestUrl = options.requestUrl;
    }
}

/**
 * Options for a single HTTP request.
 */
export interface RequestOptions {
    /** Request body (serialized based on type) */
    body?: unknown;
    /** Explicit Content-Type header (auto-detected if omitted) */
    contentType?: string;
    /** URL query parameters */
    params?: Record<string, string>;
    /** Expected response data format */
    responseType?: "json" | "arraybuffer" | "stream";
}

/**
 * Thin wrapper around Axios that centralizes auth headers, request
 * serialization, and error translation into {@link OcttApiError}.
 */
export class HttpClient {
    private readonly axios: AxiosInstance;

    /**
     * Creates an HTTP client bound to a base URL and Bearer token.
     *
     * @param baseURL - API base URL (e.g., "https://host/api/v1")
     * @param token   - Bearer token for Authorization header
     */
    constructor(baseURL: string, token: string) {
        this.axios = axios.create({
            baseURL,
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
    }

    /**
     * Performs an HTTP request and returns the typed response data.
     *
     * @param method  - HTTP method (GET, POST, PUT, DELETE)
     * @param path    - API path (appended to baseURL)
     * @param options - Request body, query params, and response type
     * @returns Deserialized response body
     * @throws {@link OcttApiError} on network or HTTP errors
     */
    async request<T = unknown>(
        method: Method,
        path: string,
        options: RequestOptions = {}
    ): Promise<T> {
        const { body, contentType, params, responseType = "json" } = options;

        const config: AxiosRequestConfig = {
            method,
            url: path,
            params,
            responseType,
        };

        // Adjust Accept header for binary downloads
        if (responseType === "arraybuffer" || responseType === "stream") {
            config.headers = { ...config.headers, Accept: "application/octet-stream" };
        }

        // Serialize body and set Content-Type based on payload type
        if (body !== undefined && body !== null) {
            if (typeof body === "string" || Buffer.isBuffer(body)) {
                config.data = body;
                config.headers = { ...config.headers, "Content-Type": contentType ?? "application/octet-stream" };
            } else {
                config.data = body;
                config.headers = { ...config.headers, "Content-Type": contentType ?? "application/json" };
            }
        }

        try {
            const response = await this.axios.request<T>(config);
            return response.data;
        } catch (error) {
            if (error instanceof AxiosError) {
                const url = `${config.url}`;

                // Translate common Node.js network errors into user-friendly messages
                if (error.code === "ENOTFOUND") {
                    throw new OcttApiError(
                        `Server not reachable: hostname could not be resolved`,
                        { errorCode: "ENOTFOUND", requestUrl: url, cause: error }
                    );
                }

                if (error.code === "ECONNREFUSED") {
                    throw new OcttApiError(
                        `Connection refused by server`,
                        { errorCode: "ECONNREFUSED", requestUrl: url, cause: error }
                    );
                }

                if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
                    throw new OcttApiError(
                        `Request timed out`,
                        { errorCode: error.code, requestUrl: url, cause: error }
                    );
                }

                // HTTP error responses (4xx, 5xx)
                if (error.response) {
                    const status = error.response.status;
                    const data = error.response.data;
                    const detail = typeof data === "object" && data !== null && "message" in data
                        ? (data as { message: string }).message
                        : JSON.stringify(data);

                    throw new OcttApiError(
                        `Request failed with status ${status}: ${detail}`,
                        { statusCode: status, errorCode: `HTTP_${status}`, requestUrl: url, cause: error }
                    );
                }

                // Catch-all for other Axios errors
                throw new OcttApiError(
                    `Request failed: ${error.message}`,
                    { errorCode: error.code ?? "UNKNOWN", requestUrl: url, cause: error }
                );
            }
            // Non-Axios errors are re-thrown as-is
            throw error;
        }
    }
}
