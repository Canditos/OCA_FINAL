// ══════════════════════════════════════════════════════════════
// CDS Types & Enums — extracted from e2e-automation-controller/src/cds.ts
// ══════════════════════════════════════════════════════════════

/** Parameter IDs (PIDs) for the CDS SLEP protocol */
export enum PidList {
    Control = 1,
    Status = 3,
    Warnings = 4,
    Errors = 6,
    Commands = 8,
    Type = 9,
    Mode = 10,
    Testcasenum = 11,
    Contactors = 12,
    MainContactorsControl = 13,
    Specification = 15,
    ChargeMode = 16,
    PLCControl = 17,
    CPBypassOptions = 18,
    TestCaseResult = 25,
    InsulationTestState = 27,
    CANBaudrate = 28,
    EVBoardType = 30,
    EVSEBoardType = 31,
    TimeStampLow = 35,
    TimeStampHigh = 36,
    FreeHardDiskSpace = 37,
    PowerSource = 40,
    Sink = 41,
    ServiceOptions = 50,
    TestStepWatchdogTimeout = 60,
    TestCasePauseTime = 61,
    ManualControl = 70,
    CableCheckMode = 730,
    CpStateEv = 20,
    CommStateEv = 21,
    CpStateEvse = 22,
    CommStateEvse = 23,
    GbtState = 24,
    CHAdeMOState = 26,
    EVFailMode = 105,
    EVControl = 116,
    EVChargingModel = 130,
    EVBatteryCurrentGradient = 131,
    EVMaximumCurrentLimit = 200,
    EVMaximumVoltageLimit = 201,
    EVMaximumPowerLimit = 202,
    EVEnergyCapacity = 205,
    EVEnergyRequest = 206,
    EVFullSOC = 207,
    EVBulkSOC = 208,
    EVRESSSoC = 209,
    EVMinimumCurrentLimit = 213,
    EVMinimumVoltageLimit = 214,
    EVTargetCurrent = 220,
    EVTargetVoltage = 221,
    EVBatteryVoltage = 225,
    EVChargingCurrent = 230,
    EVMaxVoltageAC = 260,
    EVMaxCurrentAC = 261,
    EVMinCurrentAC = 262,
    EVTargetSoC = 270,
    EVMinimumSoC = 271,
    EVMaximumSoC = 272,
    PowerSource_Uerr_max = 1017,
    PowerSource_Ierr_max = 1021,
    PowerSource_Perr_max = 1025,
    u_dc_act = 2200,
    i_dc_act = 2201,
    IRE_Use = 5000,
    IRE_Status = 5001,
    IRE_R_DC_Plus_Set = 5002,
    IRE_R_DC_Minus_Set = 5003,
}

/** Protocol specifications (charging standards) */
export enum Specification {
    None = 0,
    IEC_61851_1 = 1,
    DIN_SPEC_70121 = 2,
    ISO_15118 = 3,
    CHAdeMO_V0 = 4,
    GBT_27930_2015 = 5,
    SAE_J1772 = 6,
    GBT_27930_2011 = 7,
    GBT_18487 = 8,
    CHAdeMO_V1 = 9,
    CHAdeMO_V2 = 10,
    ISO_15118_20 = 11,
}

/** Charge modes */
export enum ChargeMode {
    None = 0,
    AC = 1,
    DC = 2,
}

/** CDS status bitmask flags */
export enum CdsStatus {
    Stopped = 0,
    Running = 1,
    ErrorPending = 2,
    ActiveCharging = 4,
    Unknown = 8,
    Resetting = 16,
    Initializing = 32,
    WaitingForUser = 64,
    AcContactorClosed = 256,
    DcContactorClosed = 512,
}

/** CDS control bitmask flags */
export enum CdsControl {
    Stop = 0,
    Start = 1,
    EmergencyOff = 4,
    Reset = 16,
    Initializing = 32,
    AckUserOk = 256,
    AckUserFailed = 512,
}

export type DataType = "int32" | "float";

export interface PidResponse {
    pid: number;
    name: string;
    dataType?: DataType | "void";
    value?: number | null;
    parafault: number;
    sendError?: string;
    type: "GET_RESPONSE" | "SET_RESPONSE";
}

export interface MultiPidResponse {
    pid: number;
    name: string;
    dataType: DataType | "void";
    value: number | null;
    parafault: number;
    sendError?: string;
    type: "GET_MULTIRESPONSE" | "SET_MULTIRESPONSE";
}

export interface CdsConfig {
    specification: Specification;
    chargeMode: ChargeMode;
    sinkId: number;
    mode?: number;
    evBatteryCurrentGradient?: number;
}

export interface EvConfig {
    SwitchOffLimitVoltage?: number;
    SwitchOffLimitCurrent?: number;
    SwitchOffLimitPowerInW?: number;
    EVMaximumCurrentLimit?: number;
    EVMaximumVoltageLimit?: number;
    EVMaximumPowerLimit?: number;
    EVMinimumCurrentLimit?: number;
    EVMinimumVoltageLimit?: number;
    EVstateOfCharge?: number;
    BatteryCapacity?: number;
}

export interface EvConfigAc {
    EVstateOfCharge?: number;
    BatteryCapacity?: number;
}

/** PID number → human-readable name */
export const pidDescription: Record<number, string> = {
    1: "Control", 3: "Status", 4: "Warnings", 6: "Errors", 8: "Commands",
    9: "Type", 10: "Mode", 11: "Testcasenum", 12: "Contactors",
    13: "MainContactorsControl", 15: "Specification", 16: "ChargeMode",
    17: "PLCControl", 18: "CPBypassOptions", 20: "CpStateEv",
    21: "CommStateEv", 22: "CpStateEvse", 23: "CommStateEvse",
    24: "GbtState", 25: "TestCaseResult", 26: "CHAdeMOState",
    27: "InsulationTestState", 28: "CANBaudrate", 30: "EVBoardType",
    31: "EVSEBoardType", 35: "TimeStampLow", 36: "TimeStampHigh",
    37: "FreeHardDiskSpace", 40: "PowerSource", 41: "Sink",
    50: "ServiceOptions", 60: "TestStepWatchdogTimeout", 61: "TestCasePauseTime",
    70: "ManualControl", 105: "EVFailMode", 116: "EVControl",
    130: "EVChargingModel", 131: "EVBatteryCurrentGradient",
    200: "EVMaximumCurrentLimit", 201: "EVMaximumVoltageLimit",
    202: "EVMaximumPowerLimit", 205: "EVEnergyCapacity",
    206: "EVEnergyRequest", 207: "EVFullSOC", 208: "EVBulkSOC",
    209: "EVRESSSoC", 213: "EVMinimumCurrentLimit", 214: "EVMinimumVoltageLimit",
    220: "EVTargetCurrent", 221: "EVTargetVoltage", 225: "EVBatteryVoltage",
    230: "EVChargingCurrent", 260: "EVMaxVoltageAC", 261: "EVMaxCurrentAC",
    262: "EVMinCurrentAC", 270: "EVTargetSoC", 271: "EVMinimumSoC",
    272: "EVMaximumSoC", 730: "CableCheckMode",
    1017: "PowerSource_Uerr_max", 1021: "PowerSource_Ierr_max",
    1025: "PowerSource_Perr_max", 2200: "u_dc_act", 2201: "i_dc_act",
    5000: "IRE_Use", 5001: "IRE_Status", 5002: "IRE_R_DC_Plus_Set",
    5003: "IRE_R_DC_Minus_Set",
};

/** Parafault error codes */
export const parafaultDescriptions: Record<number, string> = {
    0: "OK (no error)",
    1: "Invalid or unknown PID",
    4: "Invalid value (range violation)",
    5: "Not writable (read only)",
    6: "Not readable (write only)",
    7: "Access not allowed during current system state",
    9: "Bad value data type",
    10: "Internal error",
};

/** Error flag bitmask descriptions */
export const errorFlagDescriptions: Record<number, string> = {
    1: "Initialization error",
    2: "Peripheral error (power source in error state)",
    4: "Start error (test could not be started)",
    8: "Statemachine error",
    16: "PWM error",
    32: "Inlet connection motor error",
    64: "SLAC error",
    128: "V2G protocol error",
    256: "V2G timeout error",
    512: "EXI / V2GTP error",
    1024: "Emergency Off",
    2048: "Pilot signal",
    4096: "Insulation error",
    8192: "System limit violation",
    16384: "Low disk space error",
};
