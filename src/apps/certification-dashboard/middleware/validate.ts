// ══════════════════════════════════════════════════════════════
// Validation Middleware — Zod-based request validation
// ══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { ZodError } from "zod";

/**
 * Creates a middleware that validates req.body against a Zod schema.
 * Returns 400 with detailed field errors on failure.
 * 
 * Usage:
 *   router.post("/endpoint", validate(mySchema), handler);
 */
export function validate(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (err) {
            if (err instanceof ZodError) {
                // Log only field names and errors, not values (may contain secrets)
                console.log(`[validate] ${req.path}: ${err.errors.map(e => e.path.join(".") || "root").join(", ")}`);
                res.status(400).json({
                    ok: false,
                    error: "Validation failed",
                    fields: err.errors.map(e => ({
                        path: e.path.join("."),
                        message: e.message,
                    })),
                });
                return;
            }
            next(err);
        }
    };
}

/**
 * Middleware that sanitizes req.body by stripping properties
 * not in the Zod schema (no 400 error, just drops unknown fields).
 */
export function sanitize(schema: ZodSchema) {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            req.body = schema.parse(req.body);
        } catch {
            // On parse failure, attempt partial parse
            const result = schema.safeParse(req.body);
            if (result.success) {
                req.body = result.data;
            }
        }
        next();
    };
}
