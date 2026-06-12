// ══════════════════════════════════════════════════════════════
// Rate Limiting Middleware — Configurable per-IP throttling
// ══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

interface RateLimitConfig {
    windowMs: number;      // Time window in milliseconds
    maxRequests: number;   // Max requests per window
    skipPaths: string[];   // Paths to skip (e.g., health checks)
}

// Default config (can be overridden via environment)
const config: RateLimitConfig = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX ?? "100", 10),
    skipPaths: (process.env.RATE_LIMIT_SKIP_PATHS ?? "/api/health,/api/events").split(","),
};

const store = new Map<string, RateLimitEntry>();

/**
 * Configurable in-memory rate limiter.
 * Limits each IP to configurable requests per time window.
 * 
 * Environment variables:
 *   RATE_LIMIT_WINDOW_MS - Time window (default: 60000 = 1 minute)
 *   RATE_LIMIT_MAX - Max requests per window (default: 100)
 *   RATE_LIMIT_SKIP_PATHS - Comma-separated paths to skip
 * 
 * For production, replace with Redis or external service.
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    // Skip rate limiting for certain paths
    if (config.skipPaths.some(p => req.path.startsWith(p))) {
        next();
        return;
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    const entry = store.get(ip);
    if (!entry || now > entry.resetTime) {
        // New window
        store.set(ip, { count: 1, resetTime: now + config.windowMs });
        res.setHeader("X-RateLimit-Limit", config.maxRequests);
        res.setHeader("X-RateLimit-Remaining", config.maxRequests - 1);
        res.setHeader("X-RateLimit-Reset", Math.ceil((now + config.windowMs) / 1000));
        next();
        return;
    }

    const remaining = Math.max(0, config.maxRequests - entry.count - 1);
    res.setHeader("X-RateLimit-Limit", config.maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetTime / 1000));

    if (entry.count >= config.maxRequests) {
        res.status(429).json({
            ok: false,
            error: "Rate limit exceeded. Please try again later.",
            retryAfter: Math.ceil((entry.resetTime - now) / 1000),
        });
        return;
    }

    entry.count++;
    next();
}

/**
 * Get current rate limit configuration
 */
export function getRateLimitConfig(): RateLimitConfig {
    return { ...config };
}

/**
 * Get rate limit stats (for monitoring)
 */
export function getRateLimitStats(): { activeClients: number; config: RateLimitConfig } {
    return {
        activeClients: store.size,
        config: { ...config },
    };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store) {
        if (now > entry.resetTime) {
            store.delete(ip);
        }
    }
}, 300_000);
