// ══════════════════════════════════════════════════════════════
// Error Handling Middleware
// ══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";
import { log } from "../routes/logs.routes.js";

/**
 * Global error handler that catches any uncaught exceptions in routes
 * and prevents the server from crashing. Logs the error and returns
 * a standardized JSON response.
 */
export function errorHandler(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
): void {
    const statusCode = (err as any).statusCode || 500;
    const message = err.message || "Internal Server Error";

    log("error", `Unhandled error: ${message}`, "server");
    console.error("[Error]", err.stack || err);

    // Don't leak stack traces in production
    const isDev = process.env.NODE_ENV === "development";
    res.status(statusCode).json({
        ok: false,
        error: message,
        ...(isDev ? { stack: err.stack } : {}),
    });
}

/**
 * Async handler wrapper that catches errors in async route handlers
 * and forwards them to the global error handler.
 * 
 * Usage: router.get("/", asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response): void {
    log("warn", `Route not found: ${req.method} ${req.path}`, "server");
    res.status(404).json({ ok: false, error: `Route ${req.method} ${req.path} not found` });
}
