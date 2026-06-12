// ══════════════════════════════════════════════════════════════
// OCTT API Types — adapted from octt-api-main/src/types/index.ts
// ══════════════════════════════════════════════════════════════

export type OcppVersion = "ocpp1.6" | "ocpp2.0.1" | (string & {});
export type SutType = "CS" | "CSMS";
export type ReportFormat = "CSV" | "XLS" | "ZIP";

export interface OcttApiOptions {
    baseUrl: string;
    token: string;
    ocppVersion: OcppVersion;
    role: SutType;
}

// ── Generic Responses ──

export interface MessageResponse {
    message: string;
}

export interface ResponseMessageResponse {
    responseMessage: string;
}

// ── Configurations ──

export interface GetConfigurationsResponse {
    configurations: string[];
}

export interface GetConfigurationResponse {
    data: {
        config: Record<string, unknown>;
    };
    fileName: string;
    octtCertificationMode: boolean | string;
    sut: string;
}

// ── Reports ──

export interface ReportStartTime {
    date: { day: number; month: number; year: number };
    time: { hour: number; minute: number; nano: number; second: number };
}

export interface ReportEntry {
    category: string;
    config_version: string;
    configuration: string;
    description: string;
    duration: number;
    logfile: string;
    ocppVersion: string;
    pics_mode: boolean | string;
    startTime: ReportStartTime;
    sut: string;
    testCaseName: string;
    timeStr: string;
    verdict: string;
}

export interface GetReportsResponse {
    data: ReportEntry[];
}

export interface GetReportsFilter {
    certification_profiles?: string[];
    configuration_name?: string[];
    end_date?: number;
    result?: string[];
    start_date?: number;
    testcase_name?: string[];
}

export interface DownloadReportsFilter {
    configuration_name?: string[];
    end_date?: number;
    format?: string;
    logfile_name?: string;
    profiles?: string[];
    result?: string[];
    start_date?: number;
    testcase_name?: string[];
}

// ── Comments ──

export interface GetCommentResponse {
    data: string;
    responseMessage: string;
}

// ── SUT Status ──

export interface SutConnectionStatus {
    isConnected: boolean;
    selectedConfigurationProfile: string;
    sessionStatus: string;
    sut: string;
    sutEndpointUrl: string;
}

// ── Test Execution ──

export interface TestCaseInfo {
    certification_excluded: boolean;
    certification_only: boolean;
    certification_profiles: string[];
    description: string;
    functionalBlock: string;
    testcase_name: string;
}

export interface TestCaseGroup {
    data: TestCaseInfo[];
    header: string;
}

export interface BuiltinFunction {
    description: string;
    moduleName: string;
    testcase_name: string;
}

export interface GetTestCasesResponse {
    data: {
        builtinFunctionsData: BuiltinFunction[];
        certificationProfileData: string[];
        testcasesData: TestCaseGroup[];
        testcasesVerdictData: Record<string, string[]>;
    };
}

export interface ExecuteTestCaseResponse {
    data: ReportEntry[];
}

// ── OCPP Versions ──

export interface OcppVersionInfo {
    activated: boolean;
    description: string;
    id: string;
    isDefault: boolean;
    name: string;
}

export interface GetOcppVersionsResponse {
    data: OcppVersionInfo[];
}
