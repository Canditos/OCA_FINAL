// ══════════════════════════════════════════════════════════════
// Structured Logging Middleware — JSON format for monitoring
// ══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";

export interface LogEntry {
    timestamp: string;
    level: "info" | "warn" | "error" | "debug";
    type: "http" | "app" | "pipeline" | "service";
    method?: string;
    path?: string;
    status?: number;
    duration?: number;
    ip?: string;
    userAgent?: string;
    message?: string;
    error?: string;
    meta?: Record<string, unknown>;
}

const LOG_JSON = process.env.LOG_FORMAT === "json";

/**
 * Formats and outputs a structured log entry
 */
export function structuredLog(entry: LogEntry): void {
    if (LOG_JSON) {
        console.log(JSON.stringify(entry));
    } else {
        // Human-readable format for development
        const { timestamp, level, type, method, path, status, duration, message } = entry;
        const parts = [
            `[${timestamp}]`,
            `[${level.toUpperCase()}]`,
            `[${type}]`,
        ];
        if (method && path) parts.push(`${method} ${path}`);
        if (status) parts.push(`${status}`);
        if (duration !== undefined) parts.push(`${duration}ms`);
        if (message) parts.push(message);
        console.log(parts.join(" "));
    }
}

/**
 * HTTP request logging middleware
 * Logs request start and completion with timing
 */
export function httpLogger(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const { method, originalUrl, ip } = req;

    // Skip health check endpoints from verbose logging
    if (originalUrl.startsWith("/api/health")) {
        return next();
    }

    res.on("finish", () => {
        const duration = Date.now() - start;
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
            type: "http",
            method,
            path: originalUrl,
            status: res.statusCode,
            duration,
            ip: ip || req.socket.remoteAddress,
            userAgent: req.get("user-agent"),
        };
        structuredLog(entry);
    });

    next();
}

/**
 * Application-level structured logger
 */
export const appLogger = {
    info: (message: string, meta?: Record<string, unknown>) => {
        structuredLog({ timestamp: new Date().toISOString(), level: "info", type: "app", message, meta });
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
        structuredLog({ timestamp: new Date().toISOString(), level: "warn", type: "app", message, meta });
    },
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => {
        structuredLog({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "app",
            message,
            error: error?.message,
            meta: { ...meta, stack: error?.stack },
        });
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
        if (process.env.DEBUG) {
            structuredLog({ timestamp: new Date().toISOString(), level: "debug", type: "app", message, meta });
        }
    },
    pipeline: (message: string, meta?: Record<string, unknown>) => {
        structuredLog({ timestamp: new Date().toISOString(), level: "info", type: "pipeline", message, meta });
    },
    service: (service: string, message: string, meta?: Record<string, unknown>) => {
        structuredLog({ timestamp: new Date().toISOString(), level: "info", type: "service", message, meta: { service, ...meta } });
    },
};

export default httpLogger;
