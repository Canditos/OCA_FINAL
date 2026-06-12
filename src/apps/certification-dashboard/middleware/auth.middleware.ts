// ══════════════════════════════════════════════════════════════
// Auth Middleware — API Key + Basic Auth for dashboard security
// ══════════════════════════════════════════════════════════════
//
// If no dashboardApiKey is configured, auth is DISABLED (pass-through).
// When configured, requires either:
//   - Header: Authorization: Bearer <apiKey>
//   - Header: Authorization: Basic <base64(admin:<apiKey>)>
//   - Query:  ?apiKey=<apiKey> (for SSE EventSource)
// ══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";
import { effectiveConfig } from "../config/dashboard.config.js";

let cachedKey: string | null = null;

function getApiKey(): string | null {
    if (cachedKey !== null) return cachedKey;
    cachedKey = effectiveConfig.dashboardApiKey || process.env.DASHBOARD_API_KEY || "";
    if (!cachedKey) cachedKey = null;
    return cachedKey;
}

export function clearAuthCache(): void {
    cachedKey = null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const apiKey = getApiKey();
    if (!apiKey) {
        next(); // Auth disabled
        return;
    }

    // Query param (for SSE EventSource which cannot set headers)
    if (req.query.apiKey === apiKey) {
        next();
        return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }

    // Bearer token
    if (authHeader.startsWith("Bearer ")) {
        if (authHeader.slice(7) === apiKey) {
            next();
            return;
        }
    }

    // Basic Auth
    if (authHeader.startsWith("Basic ")) {
        try {
            const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
            const [user, pass] = decoded.split(":");
            if (pass === apiKey) {
                next();
                return;
            }
        } catch {
            // fall through to 401
        }
    }

    res.status(401).json({ error: "Invalid credentials" });
}
