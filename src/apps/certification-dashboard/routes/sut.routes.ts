// ══════════════════════════════════════════════════════════════
// SUT Routes — System Under Test API (OCTT callbacks)
// ══════════════════════════════════════════════════════════════
//
// OCTT sends plugin/plugout callbacks to this endpoint.
// The dashboard receives them and can trigger CDS actions.
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import { log } from "./logs.routes.js";
import { broadcast } from "../services/sse.service.js";
import { annotateLatestRun, setCdsLogicalPluggedIn } from "../services/pipeline.service.js";

const router = Router();

// Store the last SUT event for status display
let lastSutEvent: { action: string; timestamp: string; data: any } | null = null;

function normalizeSutPayload(input: any): { action: string; body: any; payload: any } {
    if (typeof input === "string") {
        try {
            return normalizeSutPayload(JSON.parse(input));
        } catch (e: any) {
            log("debug", `SUT payload JSON parse fallback: ${e.message}`, "sut");
            return { action: input, body: { raw: input }, payload: {} };
        }
    }

    // OCPP CALL frame format: [2, uniqueId, "BootNotification", { ...payload }]
    if (Array.isArray(input) && input.length >= 4 && typeof input[2] === "string") {
        const action = String(input[2]);
        const payload = input[3] && typeof input[3] === "object" ? input[3] : {};
        return {
            action,
            payload,
            body: {
                ocppFrame: input,
                action,
                payload,
            },
        };
    }

    const action = String(input?.action || input?.message || input?.ocppAction || input?.event || "unknown");
    const payload = input?.payload && typeof input.payload === "object"
        ? input.payload
        : (input?.data && typeof input.data === "object" ? input.data : input);

    return {
        action,
        body: input,
        payload,
    };
}

function getNestedString(obj: any, path: string): string | undefined {
    const value = path.split(".").reduce<any>((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function pickFirstString(obj: any, paths: string[]): string | undefined {
    for (const path of paths) {
        const value = getNestedString(obj, path);
        if (value) return value;
    }
    return undefined;
}

function collectStringValues(input: any, out: string[] = []): string[] {
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (trimmed) out.push(trimmed);
        return out;
    }
    if (!input || typeof input !== "object") return out;

    if (Array.isArray(input)) {
        for (const item of input) collectStringValues(item, out);
        return out;
    }

    for (const value of Object.values(input)) {
        collectStringValues(value, out);
    }
    return out;
}

function looksLikeFirmwareVersion(value: string): boolean {
    return /\b\d+\.\d+(?:\.\d+)?(?:[-._][A-Za-z0-9]+)?\b/.test(value);
}

function looksLikeBootNotification(action: string, body: any): boolean {
    if (/boot\s*notification/i.test(action)) return true;
    return !!pickFirstString(body, [
        "chargePointVendor",
        "chargePointModel",
        "payload.chargePointVendor",
        "payload.chargePointModel",
        "bootNotification.chargePointVendor",
        "bootNotification.chargePointModel",
        "data.chargePointVendor",
        "data.chargePointModel",
    ]);
}

function extractBootMetadata(body: any): { sut?: string; firmwareVersion?: string } {
    const vendor = pickFirstString(body, [
        "chargePointVendor",
        "payload.chargePointVendor",
        "bootNotification.chargePointVendor",
        "data.chargePointVendor",
    ]);
    const model = pickFirstString(body, [
        "chargePointModel",
        "payload.chargePointModel",
        "bootNotification.chargePointModel",
        "data.chargePointModel",
    ]);
    const serial = pickFirstString(body, [
        "chargePointSerialNumber",
        "chargeBoxSerialNumber",
        "payload.chargePointSerialNumber",
        "payload.chargeBoxSerialNumber",
        "bootNotification.chargePointSerialNumber",
        "bootNotification.chargeBoxSerialNumber",
        "data.chargePointSerialNumber",
        "data.chargeBoxSerialNumber",
    ]);
    const firmwareCandidates = [
        pickFirstString(body, [
        "firmwareVersion",
        "firmware",
        "fwVersion",
        "payload.firmwareVersion",
        "payload.firmware",
        "payload.fwVersion",
        "bootNotification.firmwareVersion",
        "bootNotification.firmware",
        "data.firmwareVersion",
        "data.firmware",
        ]) || "",
        ...collectStringValues(body),
    ].filter(Boolean);

    const firmwareVersion = firmwareCandidates.find(v => /\b9\.05(?:\.|\b)/.test(v))
        || firmwareCandidates.find(v => looksLikeFirmwareVersion(v))
        || firmwareCandidates.find(v => /fw|firmware/i.test(v));

    // For triage, prefer the model as equipment identifier; serial stays as fallback.
    const sut = model || serial || [vendor, model].filter(Boolean).join(" ") || vendor;

    return {
        sut: sut || undefined,
        firmwareVersion: firmwareVersion || undefined,
    };
}

router.post("/", (req, res) => {
    const normalized = normalizeSutPayload(req.body);
    const { action, body, payload } = normalized;
    const timestamp = new Date().toISOString();

    lastSutEvent = { action, timestamp, data: body };

    log("info", `SUT callback: ${action}`, "sut");
    if (looksLikeBootNotification(action, payload || body)) {
        const metadata = extractBootMetadata(payload || body);
        if (metadata.sut || metadata.firmwareVersion) {
            annotateLatestRun({ ...metadata, source: "sut-bootnotification" });
            log("info", `BootNotification metadata: SUT=${metadata.sut || "unknown"} FW=${metadata.firmwareVersion || "unknown"}`, "sut");
        }
    }
    broadcast("sut", { action, timestamp, data: body });

    res.json({ ok: true });
});

router.get("/status", (_req, res) => {
    res.json({ ok: true, lastEvent: lastSutEvent });
});

router.use(async (req, res) => {
    log("info", `[SUT Bridge 3101] Received ${req.method} ${req.url}`, "sut");
    try {
        const { effectiveConfig } = await import("../config/dashboard.config.js");
        const axios = (await import("axios")).default;
        const port = process.env.CERT_DASHBOARD_PORT ?? "3101";
        const cdsId = `cds-${effectiveConfig.cds.ip.replace(/\./g, "-")}-${effectiveConfig.cds.port}`;
        
        if (req.url.includes("plugin")) {
            log("info", "[SUT Bridge] Translating 'plugin' to CDS Start...", "sut");
            setCdsLogicalPluggedIn(true);
            await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/start`);
        } else if (req.url.includes("plugout") || req.url.includes("unplug")) {
            log("info", "[SUT Bridge] Translating 'plugout' to CDS Stop...", "sut");
            setCdsLogicalPluggedIn(false);
            await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/stop`);
        } else if (req.url.includes("authorize") || req.url.includes("rfid") || req.url.includes("pin")) {
            const urlObj = new URL(req.url, 'http://localhost');
            const id = urlObj.searchParams.get("id") || (req.query?.id as string) || "111111";
            const connectorId = urlObj.searchParams.get("connector_id") || (req.query?.connector_id as string) || "3";
            
            if (id === "ABCDEF12") {
                log("warn", "==========================================================", "sut");
                log("warn", `🚨 [TESTE CACHE] PASSA O CARTÃO FÍSICO ${id} NO POSTO AGORA!`, "sut");
                log("warn", "==========================================================", "sut");
                return res.json({ ok: true, status: "Waiting for manual swipe" });
            }

            log("info", `[SUT Bridge] Triggering automatic Keypad Authentication for connector ${connectorId} with PIN ${id}...`, "sut");
            const { authenticateViaKeypad } = await import("../services/sut-automation.service.js");
            // Run asynchronously so we don't block the HTTP response
            authenticateViaKeypad(id, connectorId).catch(err => {
                 log("error", `[SUT Bridge] Keypad automation failed: ${err.message}`, "sut");
            });
        } else if (req.url.includes("reboot")) {
            log("warn", "=========================================================================", "sut");
            log("warn", "🚨 AÇÃO MANUAL NECESSÁRIA: Por favor, reinicie o posto FISICAMENTE AGORA!", "sut");
            log("warn", "=========================================================================", "sut");
            // We return OK so OCTT dismisses the prompt and starts waiting for StatusNotification.
            // The human operator must manually reboot the charger.
        } else {
            log("warn", `[SUT Bridge] Unsupported operation: ${req.url}. Returning 501 so OCTT prompts the user.`, "sut");
            return res.status(501).json({ ok: false, error: "Not Implemented" });
        }
    } catch (e: any) {
        log("error", `[SUT Bridge] Failed to control CDS: ${e.message}`, "sut");
        return res.status(500).json({ ok: false, error: e.message });
    }
    res.json({ ok: true, status: "Accepted by SUT Bridge" });
});

export default router;
