import path from "path";
import { JiraClient } from "../../../connectors/jira/index.js";
import { OcttClient } from "../../../connectors/octt/index.js";
import { effectiveConfig } from "../config/dashboard.config.js";
import { log } from "../routes/logs.routes.js";

const DEFAULT_FW_FIELD_ID = "68f2fbd3a6fdbe3e4e952f0b";
const DEFAULT_DUT_FIELD_ID = "68f2fbd3a6fdbe3e4e952f0e";
const DEFAULT_OCPP_FIELD_ID = "68f2fbd3a6fdbe3e4e952f13";

export interface XrayFieldIds {
    fwFieldId: string;
    dutFieldId: string;
    ocppFieldId: string;
}

async function resolveFieldIdsFromXray(client: JiraClient): Promise<Partial<XrayFieldIds> | null> {
    if (!effectiveConfig.xray?.clientId || !effectiveConfig.xray?.clientSecret) return null;
    try {
        const xrayFields = await client.getXrayCustomFieldsSpec(
            effectiveConfig.xray.clientId,
            effectiveConfig.xray.clientSecret,
            effectiveConfig.jira.projectKey
        );
        const fwField = xrayFields.find((f: any) => f.name === "FW Version");
        const dutField = xrayFields.find((f: any) => f.name === "DUT" || f.name === "SUT");
        const ocppField = xrayFields.find((f: any) => f.name === "OCPP backend");
        return {
            fwFieldId: fwField?.id,
            dutFieldId: dutField?.id,
            ocppFieldId: ocppField?.id,
        };
    } catch {
        return null;
    }
}

export async function getXrayFieldIds(): Promise<XrayFieldIds> {
    const fromEnv: Partial<XrayFieldIds> = {
        fwFieldId: process.env.XRAY_FW_FIELD_ID,
        dutFieldId: process.env.XRAY_DUT_FIELD_ID,
        ocppFieldId: process.env.XRAY_OCPP_FIELD_ID,
    };

    let fromXray: Partial<XrayFieldIds> | null = null;
    try {
        const client = new JiraClient(effectiveConfig.jira);
        const result = await Promise.race([
            resolveFieldIdsFromXray(client),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
        ]);
        fromXray = result;
    } catch {
        log("debug", "Could not resolve Xray field IDs from API, using env/fallback", "jira");
    }

    return {
        fwFieldId: fromXray?.fwFieldId || fromEnv.fwFieldId || DEFAULT_FW_FIELD_ID,
        dutFieldId: fromXray?.dutFieldId || fromEnv.dutFieldId || DEFAULT_DUT_FIELD_ID,
        ocppFieldId: fromXray?.ocppFieldId || fromEnv.ocppFieldId || DEFAULT_OCPP_FIELD_ID,
    };
}

export function parseXrayUrl(urlStr: string | undefined): { testExecutionKey?: string; testKey?: string; testPlanId?: string } | null {
    if (!urlStr) return null;
    const trimmed = urlStr.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;
    try {
        const url = new URL(trimmed);
        const result: { testExecutionKey?: string; testKey?: string; testPlanId?: string } = {};
        const searchParams = url.searchParams;
        const testExecutionKey = searchParams.get("testExecutionKey") || searchParams.get("ac.testExecutionKey");
        const testKey = searchParams.get("testKey") || searchParams.get("ac.testKey");
        const testPlanId = searchParams.get("testPlanId") || searchParams.get("ac.testPlanId") || searchParams.get("testPlanKey") || searchParams.get("ac.testPlanKey");
        if (testExecutionKey) result.testExecutionKey = testExecutionKey;
        if (testKey) result.testKey = testKey;
        if (testPlanId) result.testPlanId = testPlanId;
        let hash = url.hash;
        if (hash) {
            hash = hash.replace(/^#!?\/?[!?]?/, "");
            const hashParams = new URLSearchParams(hash);
            const hTestExecutionKey = hashParams.get("testExecutionKey") || hashParams.get("ac.testExecutionKey");
            const hTestKey = hashParams.get("testKey") || hashParams.get("ac.testKey");
            const hTestPlanId = hashParams.get("testPlanId") || hashParams.get("ac.testPlanId") || hashParams.get("testPlanKey") || hashParams.get("ac.testPlanKey");
            if (hTestExecutionKey) result.testExecutionKey = hTestExecutionKey;
            if (hTestKey) result.testKey = hTestKey;
            if (hTestPlanId) result.testPlanId = hTestPlanId;
        }
        return result;
    } catch (e: any) {
        log("debug", `Invalid Xray URL provided: ${urlStr.slice(0, 80)}`, "jira");
        return null;
    }
}

export function buildXrayStepResults(steps: Array<{ id?: string }>, status: string): any[] | undefined {
    if (!steps || steps.length === 0) return undefined;
    return steps.map((_step, idx) => {
        const comment = `Step ${idx + 1} automatically marked as ${status} by the test runner.`;
        return { status, actualResult: comment, comment };
    });
}

export async function validateTestInExecution(
    client: JiraClient,
    testExecutionKey: string,
    testKey: string,
    token: string
): Promise<void> {
    if (!testExecutionKey) return;
    try {
        const execIssue = await client.getIssue(testExecutionKey);
        if (execIssue && execIssue.id) {
            const execTests = await client.getXrayTestExecutionTests(execIssue.id, token);
            const execTestKeys = new Set(execTests.map(t => t.key));
            if (execTestKeys.size > 0 && !execTestKeys.has(testKey)) {
                throw new Error(
                    `Test ${testKey} is not part of execution ${testExecutionKey}. ` +
                    `Only tests already linked to this execution can be updated.`
                );
            }
        }
    } catch (err: any) {
        if (err.message.includes("not part of execution")) throw err;
    }
}

export async function prepareTestEntry(params: {
    client: JiraClient;
    octt: OcttClient;
    testKey: string;
    testCase: string;
    xrayStatus: string;
    token: string;
    fieldIds: XrayFieldIds;
    firmwareVersion?: string;
    sut?: string;
    ocppBackend?: string;
    configurationName: string;
}): Promise<any> {
    const { client, octt, testKey, testCase, xrayStatus, token, fieldIds, firmwareVersion, sut, ocppBackend, configurationName } = params;

    let xraySteps: any[] | undefined = undefined;
    try {
        const issueDetails = await client.getIssue(testKey);
        if (issueDetails && issueDetails.id) {
            const steps = await client.getXrayTestSteps(issueDetails.id, token);
            if (steps && steps.length > 0) {
                xraySteps = buildXrayStepResults(steps, xrayStatus);
            }
        }
    } catch (stepErr: any) {
        log("warn", `Could not retrieve test steps for ${testKey}: ${stepErr.message}`, "jira");
    }

    let zipBuffer: Buffer | null = null;
    try {
        const reports = await octt.getReportsFiltered({
            testcase_name: [testCase],
            configuration_name: [configurationName]
        });
        if (reports.data && reports.data.length > 0) {
            const latestReport = reports.data[0];
            const logfileName = path.basename(latestReport.logfile);
            const configName = latestReport.configuration;
            zipBuffer = await octt.downloadReports({
                format: "ZIP",
                configuration_name: configName,
                logfile_name: logfileName
            });
        }
    } catch (err: any) {
        log("warn", `Could not download OCTT zip for ${testCase} evidence: ${err.message}`, "jira");
    }

    const customFields = [];
    if (firmwareVersion) customFields.push({ id: fieldIds.fwFieldId, value: firmwareVersion });
    if (sut) customFields.push({ id: fieldIds.dutFieldId, value: sut });
    if (ocppBackend) customFields.push({ id: fieldIds.ocppFieldId, value: ocppBackend });

    const testEntry: any = {
        testKey,
        status: xrayStatus,
        steps: xraySteps,
        customFields: customFields.length > 0 ? customFields : undefined
    };

    if (zipBuffer) {
        testEntry.evidence = [{
            data: zipBuffer.toString('base64'),
            filename: `${testCase}_logs.zip`,
            contentType: "application/zip"
        }];
    }

    return { testEntry, zipBuffer, testCase };
}

export async function uploadAndAttach(
    client: JiraClient,
    payload: any,
    token: string,
    attachments: Array<{ testCase: string; zipBuffer: Buffer }>,
    executionKey: string
): Promise<string> {
    log("info", "Uploading execution payload to Xray...", "jira");
    const response = await client.uploadXrayExecution(payload, token);
    const finalKey = response.key || executionKey || "Unknown";

    for (const att of attachments) {
        if (att.zipBuffer && finalKey && finalKey !== "Unknown") {
            try {
                await client.addAttachment(finalKey, `${att.testCase}_logs.zip`, att.zipBuffer);
                log("info", `Attached ${att.testCase}_logs.zip to ${finalKey}`, "jira");
            } catch (attachErr: any) {
                log("warn", `Failed to attach ${att.testCase}_logs.zip to ${finalKey}: ${attachErr.message}`, "jira");
            }
        }
    }

    return finalKey;
}
