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
let activeOrchestratedTestId: string | null = null;

const gentleStopTests = new Set(['TC_005_1_CS', 'TC_005_2_CS', 'TC_005_3_CS']);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function applyGentleEvStop(axios: any, baseUrl: string): Promise<void> {
    // Ramp EV demand down before disconnect to reduce abrupt contactor transitions.
    await axios.post(`${baseUrl}/configure-ev`, {
        EVMaximumCurrentLimit: 0,
        EVMinimumCurrentLimit: 0,
        EVTargetCurrent: 0,
        EVChargingCurrent: 0
    }).catch(() => {});

    await wait(1200);
}

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
    
    if (action === "display" || action === "prompt") {
        const msg = (payload?.message || body?.message || payload || "").toString();
        const pinMatch = msg.match(/\b(2222222?|666666|111111|333333|444444)\b/);
        if (pinMatch && !msg.includes("ABCDEF12")) {
            log("info", `[SUT Bridge] Detected PIN ${pinMatch[1]} in OCTT prompt. Triggering automation...`, "sut");
            import("../services/sut-automation.service.js").then(({ authenticateViaKeypad }) => {
                authenticateViaKeypad(pinMatch[1], "3").catch(err => {
                    log("error", `[SUT Bridge] Keypad automation failed: ${err.message}`, "sut");
                });
            });
        }
    }

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

router.use(async (req, res, next) => {
    if (req.url.includes("orchestrate")) return next();
    
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
        } else if (req.url.includes("api")) {
            const msg = (req.body?.message || "").toString();
            const cdsBaseUrl = `http://127.0.0.1:${port}/api/i/${cdsId}`;
            const useGentleStop = !!activeOrchestratedTestId && gentleStopTests.has(activeOrchestratedTestId);
            if (msg.includes("make the EV stop charging")) {
                log("info", "[SUT Bridge] Translating 'make EV stop charging' to EV Current = 0...", "sut");
                await applyGentleEvStop(axios, cdsBaseUrl);
            } else if (msg.includes("unplug your cable") || msg.includes("plugout")) {
                if (useGentleStop) {
                    log("info", `[SUT Bridge] Gentle stop active for ${activeOrchestratedTestId}: setting 0A before CDS Stop...`, "sut");
                    await applyGentleEvStop(axios, cdsBaseUrl);
                }
                log("info", "[SUT Bridge] Translating API 'unplug your cable' to CDS Stop...", "sut");
                setCdsLogicalPluggedIn(false);
                await axios.post(`${cdsBaseUrl}/stop`).catch(() => {});
            } else if (msg.includes("plug in your cable") || msg.includes("plugin")) {
                log("info", "[SUT Bridge] Translating API 'plug in your cable' to CDS Start...", "sut");
                setCdsLogicalPluggedIn(true);
                await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/start`).catch(() => {});
            }
            return res.json({ action: "continue", status: "API prompt processed" });
        } else if (req.url.includes("plugout") || req.url.includes("unplug")) {
            const cdsBaseUrl = `http://127.0.0.1:${port}/api/i/${cdsId}`;
            const useGentleStop = !!activeOrchestratedTestId && gentleStopTests.has(activeOrchestratedTestId);
            if (useGentleStop) {
                log("info", `[SUT Bridge] Gentle stop active for ${activeOrchestratedTestId}: setting 0A before CDS Stop...`, "sut");
                await applyGentleEvStop(axios, cdsBaseUrl);
            }
            log("info", "[SUT Bridge] Translating 'plugout' to CDS Stop...", "sut");
            setCdsLogicalPluggedIn(false);
            await axios.post(`${cdsBaseUrl}/stop`);
        } else if (req.url.includes("end")) {
            log("info", `[SUT Bridge] Received 'end' command. Simulating EV stopping charging (0A)...`, "sut");
            await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/configure-ev`, {
                EVMaximumCurrentLimit: 0,
                EVMinimumCurrentLimit: 0,
                EVTargetCurrent: 0,
                EVChargingCurrent: 0
            }).catch(() => {});
        } else if (req.url.includes("authorize") || req.url.includes("rfid") || req.url.includes("pin")) {
            const urlObj = new URL(req.url, 'http://localhost');
            
            // Extract ID from query, body, or OCTT params array
            let id = urlObj.searchParams.get("id") || (req.query?.id as string) || (req.body?.id as string);
            if (!id && req.body?.params && Array.isArray(req.body.params)) {
                const idParam = req.body.params.find((p: any) => p.key === 'id');
                if (idParam) id = idParam.value;
            }
            id = id || "111111";

            let connectorId = urlObj.searchParams.get("connector_id") || (req.query?.connector_id as string) || (req.body?.connector_id as string);
            if (!connectorId && req.body?.params && Array.isArray(req.body.params)) {
                const connParam = req.body.params.find((p: any) => p.key === 'connector_id');
                if (connParam) connectorId = connParam.value;
            }
            connectorId = connectorId || "2";
            
            log("info", `[SUT Bridge] Triggering automatic Keypad Authentication for connector ${connectorId} with PIN/ID ${id}...`, "sut");
            const { authenticateViaKeypad } = await import("../services/sut-automation.service.js");
            
            // Run asynchronously so we don't block the HTTP response
            authenticateViaKeypad(id, connectorId).catch(err => {
                 log("error", `[SUT Bridge] Keypad automation failed: ${err.message}`, "sut");
            });

            // OCTT sends a prompt to authorize with 111111 after the 70 seconds wait,
            // so we do not need to do it automatically with a setTimeout.

            return res.json({ ok: true, status: "Keypad automation started" });
        } else if (req.url.includes("reboot")) {
            const sshUser = process.env.SUT_SSH_USER || "root";
            const sshIp = process.env.SUT_SSH_IP || "10.20.17.14";
            const sshKey = process.env.SUT_SSH_KEY || "d:/OCA_FINAL_CANDITOS/.ssh/key";
            
            log("warn", "=========================================================================", "sut");
            log("warn", `🔄 [SUT Bridge] Recebido comando de Reboot. A reiniciar o posto via SSH (${sshUser}@${sshIp})...`, "sut");
            log("warn", "=========================================================================", "sut");
            
            const { exec } = await import("child_process");
            // Executa o reboot via SSH em background
            const cmd = `ssh -i "${sshKey}" -o StrictHostKeyChecking=no ${sshUser}@${sshIp} "reboot"`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    log("error", `[SUT Bridge] Falha ao enviar comando SSH de reboot: ${error.message} - ${stderr}`, "sut");
                } else {
                    log("info", `[SUT Bridge] Reboot via SSH enviado com sucesso!`, "sut");
                }
            });
            // Retornamos logo OK para não bloquear a OCTT, que ficará à espera que o posto volte online
            return res.json({ ok: true, status: "Rebooting via SSH" });
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

// --- Automated Orchestration ---
let pluginIntervalId: NodeJS.Timeout | null = null;

router.post("/orchestrate-test", async (req, res) => {
    try {
        const { testId } = req.body;
        if (!testId) return res.status(400).json({ ok: false, error: "Missing testId" });
        activeOrchestratedTestId = testId;
        
        log("info", `[SUT Bridge] Orchestrating test environment for: ${testId}`, "sut");

        // Clear any previous running loops
        if (pluginIntervalId) {
            clearInterval(pluginIntervalId);
            pluginIntervalId = null;
        }

        const { effectiveConfig } = await import("../config/dashboard.config.js");
        const axios = (await import("axios")).default;
        const port = process.env.CERT_DASHBOARD_PORT ?? "3101";
        const cdsId = `cds-${effectiveConfig.cds.ip.replace(/\./g, "-")}-${effectiveConfig.cds.port}`;
        
        // 1. Reset and configure CDS before each test to guarantee a clean state.
        // Exception: StopSession tests (TC_068_CS, TC_069_CS, TC_005_x_CS) must NOT reset the CDS
        // here because the reset causes a delayed connector bounce (~15s after CDS Start) that
        // disrupts the RemoteStart→Authorize→StartTransaction sequence, producing INCONC.
        // These tests rely on the connector being in a stable Preparing state after RemoteStart.
        // TC_068_CS still needs reset (first in sequence, CDS may be in unknown state).
        // TC_069_CS and TC_005_x come right after a completed charging test — CDS already clean.
        const noResetTests = ['TC_069_CS', 'TC_005_1_CS', 'TC_005_2_CS', 'TC_005_3_CS'];
        const noCdsSetupTests = ['TC_034_CS'];
        const skipReset = noResetTests.includes(testId);
        const skipCdsSetup = noCdsSetupTests.includes(testId);
        log("info", `[SUT Bridge] Performing CDS setup for ${testId}${skipCdsSetup ? ' (skipped)' : skipReset ? ' (no reset)' : ''}...`, "sut");

        if (!skipCdsSetup) {
            if (!skipReset) {
                await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/reset`).catch(() => {});
                await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/validate`).catch(() => {});
            }

            await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/configure-cds`, {
                specification: 3, chargeMode: 2, sinkId: effectiveConfig.cds.sink, mode: 2
            }).catch(() => {});

            await axios.post(`http://127.0.0.1:${port}/api/i/${cdsId}/configure-ev`, {
                EVMaximumVoltageLimit: 500, EVMinimumVoltageLimit: 200,
                EVMaximumCurrentLimit: 160, EVMinimumCurrentLimit: 0,
                EVMaximumPowerLimit: 80000, BatteryCapacity: 50000,
                EVstateOfCharge: 50,
            }).catch(() => {});
        }

        // 2. Setup async automated actions
        // Re-plugin loop for tests with reboots that require a connected state
        if (['TC_015_CS', 'TC_016_CS', 'TC_032_1_CS', 'TC_032_2_CS'].includes(testId)) {
            log("info", `[SUT Bridge] Starting background auto-plugin loop for ${testId}`, "sut");
            // Instead of scheduling for T=200s, we just run a steady loop for a few minutes
            let elapsed = 0;
            pluginIntervalId = setInterval(() => {
                elapsed += 10000;
                if (elapsed >= 450000) {
                    if (pluginIntervalId) clearInterval(pluginIntervalId);
                    return;
                }
                if (elapsed >= 200000) {
                    axios.post(`http://127.0.0.1:${port}/api/sut/plugin?connector_id=3`).catch(() => {});
                }
            }, 10000);
        }

        // Offline tests auth injection
        const offlineTests = ['TC_036_CS', 'TC_037_1_CS', 'TC_037_2_CS', 'TC_037_3_CS', 'TC_038_CS', 'TC_039_CS'];
        if (offlineTests.includes(testId)) {
            log("info", `[SUT Bridge] Scheduled automatic local auth for offline test ${testId} in 85s`, "sut");
            setTimeout(() => {
                axios.post(`http://127.0.0.1:${port}/api/sut/authorize?id=111111&connector_id=3`).catch(() => {});
            }, 85000);
        }

        // Reservation specifics
        if (testId === 'TC_046_1_CS') {
            log("info", `[SUT Bridge] Scheduled reservation automations for ${testId}`, "sut");
            setTimeout(() => {
                axios.post(`http://127.0.0.1:${port}/api/sut/authorize?id=222222&connector_id=3`).catch(() => {});
            }, 3000);
            setTimeout(() => {
                axios.post(`http://127.0.0.1:${port}/api/sut/authorize?id=111111&connector_id=3`).catch(() => {});
            }, 74000);
        }

        res.json({ ok: true });
    } catch (e: any) {
        log("error", `[SUT Bridge] Failed to orchestrate test: ${e.message}`, "sut");
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
