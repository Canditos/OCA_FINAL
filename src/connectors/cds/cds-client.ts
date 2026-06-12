// ══════════════════════════════════════════════════════════════
// CDS Client — SLEP TCP protocol client
// Adapted from e2e-automation-controller/src/cds.ts (CdsClientV2)
// ══════════════════════════════════════════════════════════════
//
// Communicates with the Keysight SL1040A CDS (Charging Discovery System)
// over a raw TCP socket using the SLEP (Smart Charging Language for
// Electric Power) binary protocol.
//
// Protocol frame layout (single PID request):
//   [0..3]  Magic     : "SLEP" (0x53 0x4c 0x45 0x50)
//   [4..5]  Length    : total frame length (little-endian uint16)
//   [6]     Version   : 0x01
//   [7]     Command   : 0x01 = GET, 0x03 = SET, 0x05 = SET_MULTI
//   [8..9]  PID       : parameter ID (little-endian uint16)
//   [10]    Parafault : error code from previous operation
//   [11]    DataType  : 0x01 = int32, 0x02 = float
//   [12..15] Value    : 4 bytes (int32 LE or float LE)
// ══════════════════════════════════════════════════════════════

import { Socket } from "net";
import { ReplaySubject, BehaviorSubject, Subscription, interval, firstValueFrom } from "rxjs";
import { filter, map, take, takeUntil, timeout, catchError } from "rxjs/operators";
import { of } from "rxjs";
import {
    PidList, CdsControl, CdsStatus, Specification, ChargeMode,
    pidDescription, parafaultDescriptions,
    type DataType, type PidResponse, type MultiPidResponse,
    type CdsConfig, type EvConfig, type EvConfigAc,
} from "./types.js";

/** Internal shape for a single PID write operation */
type WritePidEntry = { pid: number; dataType: DataType; value: number };

/**
 * Client for the Keysight CDS SLEP protocol.
 *
 * Responsibilities:
 *   - TCP connection management
 *   - Low-level SLEP frame encoding/decoding
 *   - Status polling and reactive state tracking
 *   - High-level operations (reset, start, stop, configure)
 */
export class CdsClient {
    /** RxJS subject that emits every raw TCP response buffer */
    public readonly responseData = new ReplaySubject<Buffer>(1);
    /** Reactive current status value (bitmask) polled from the CDS */
    public readonly statusValue = new BehaviorSubject<number>(-1);
    /** When true, logs every status change to the console */
    public statusLogging = false;
    /** True while the TCP socket is connected */
    public isConnected = false;

    private socket: Socket;
    private statusPollingSubscription?: Subscription;
    private statusSubscription?: Subscription;
    private readonly disconnect$ = new ReplaySubject<void>(1);

    /**
     * @param ip   - IP address of the CDS hardware
     * @param port - TCP port (default: 51001)
     */
    constructor(
        public readonly ip: string,
        public readonly port: number = 51001
    ) {
        this.socket = new Socket();
    }

    // ── Connection ──

    /**
     * Opens a TCP connection to the CDS and starts status polling.
     * If already connected, returns immediately.
     *
     * @returns true on successful connection, false on failure
     */
    async connect(): Promise<boolean> {
        // Detect stale connections: isConnected is true but socket is actually dead
        if (this.isConnected) {
            if (this.socket.destroyed) {
                this.isConnected = false;
                this.socket = new Socket();
            } else {
                return true;
            }
        }

        return new Promise<boolean>((resolve) => {
            this.socket.connect(this.port, this.ip, () => {
                this.isConnected = true;

                // Start polling the Status PID every second so statusValue stays current
                this.statusPollingSubscription?.unsubscribe();
                this.statusPollingSubscription = interval(1000)
                    .pipe(takeUntil(this.disconnect$))
                    .subscribe(() => this.requestSinglePid(PidList.Status));

                // Subscribe to raw responses and extract status updates
                this.statusSubscription?.unsubscribe();
                this.statusSubscription = this.responseData
                    .pipe(
                        filter((data: Buffer) => data.length <= 16),
                        map((data: Buffer) => this.parseSinglePidResponse(data)),
                        filter((response) => response.pid === PidList.Status && response.type === "GET_RESPONSE"),
                        map((response) => response.value ?? 0),
                        takeUntil(this.disconnect$)
                    )
                    .subscribe((value) => {
                        this.statusValue.next(value);
                        if (this.statusLogging) console.log("[CDS] status:", value);
                    });

                resolve(true);
            });

            this.socket.on("error", () => {
                this.isConnected = false;
                resolve(false);
            });

            this.socket.on("close", () => {
                this.isConnected = false;
            });

            this.socket.on("data", (data) => {
                this.responseData.next(data);
            });
        });
    }

    /**
     * Closes the TCP connection and tears down subscriptions.
     * Safe to call multiple times; no-ops if already disconnected.
     *
     * @returns true when the socket closes
     */
    async disconnect(): Promise<boolean> {
        if (!this.isConnected && this.socket.destroyed) return true;
        return new Promise((resolve) => {
            const onClose = () => { this.isConnected = false; resolve(true); };
            if (this.socket.destroyed) { onClose(); return; }
            this.socket.once("close", onClose);
            this.socket.once("error", () => {});
            this.disconnect$.next();
            this.statusPollingSubscription?.unsubscribe();
            this.statusSubscription?.unsubscribe();
            this.socket.destroy();
        });
    }

    // ── Low-level SLEP protocol ──

    /** Sends a raw buffer over the TCP socket. */
    private sendCommand(buffer: Buffer): void {
        this.socket.write(Uint8Array.from(buffer));
    }

    /**
     * Sends a GET request for a single PID.
     *
     * @param pid - Parameter ID to read
     */
    requestSinglePid(pid: number): void {
        const header = Buffer.from([0x53, 0x4c, 0x45, 0x50, 0x0c, 0x00, 0x01, 0x01]);
        const pidBuffer = Buffer.alloc(2);
        pidBuffer.writeUInt16LE(pid, 0);
        const reserved = Buffer.from([0x00, 0x00]);
        this.sendCommand(Buffer.concat([header, pidBuffer, reserved]));
    }

    /**
     * Sends a SET request for a single PID value.
     *
     * @param pid      - Parameter ID to write
     * @param dataType - "int32" or "float"
     * @param value    - Numeric value to write
     */
    writeSinglePid(pid: number, dataType: DataType, value: number): void {
        const header = Buffer.from([0x53, 0x4c, 0x45, 0x50, 0x10, 0x00, 0x01, 0x03]);
        const pidBuffer = Buffer.alloc(2);
        pidBuffer.writeUInt16LE(pid, 0);
        const reservedAndType = Buffer.from([0x00, dataType === "int32" ? 0x01 : 0x02]);
        const valueBuffer = Buffer.alloc(4);
        if (dataType === "int32") valueBuffer.writeInt32LE(value, 0);
        else valueBuffer.writeFloatLE(value, 0);
        this.sendCommand(Buffer.concat([header, pidBuffer, reservedAndType, valueBuffer]));
    }

    /**
     * Sends a SET request for a single PID and waits for the SET_RESPONSE.
     * Prevents race conditions during rapid state transitions (like reset).
     */
    async writeSinglePidAsync(pid: number, dataType: DataType, value: number, timeoutMs = 2000): Promise<boolean> {
        return new Promise((resolve) => {
            let subscription: Subscription;
            const timer = setTimeout(() => { subscription?.unsubscribe(); resolve(false); }, timeoutMs);

            subscription = this.responseData
                .pipe(filter((data: Buffer) => data.length === 12))
                .subscribe((data: Buffer) => {
                    try {
                        const response = this.parseSinglePidResponse(data);
                        if (response.pid === pid) {
                            clearTimeout(timer);
                            subscription.unsubscribe();
                            resolve(response.parafault === 0);
                        }
                    } catch {
                        // ignore parse errors for unrelated packets
                    }
                });

            this.writeSinglePid(pid, dataType, value);
        });
    }

    /**
     * Sends a SET request for multiple PID values in a single frame.
     * More efficient than calling writeSinglePid repeatedly.
     *
     * @param pids - Array of PID entries to write
     */
    writeMultiplePids(pids: WritePidEntry[]): void {
        const header = Buffer.from([0x53, 0x4c, 0x45, 0x50, 0x00, 0x00, 0x01, 0x05]);
        const reserved = Buffer.alloc(4);
        const tuples = Buffer.concat(
            pids.map(({ pid, dataType, value }) => {
                const buf = Buffer.alloc(8);
                buf.writeUInt8(0x02, 0);
                buf.writeUInt8(dataType === "int32" ? 0x01 : 0x02, 1);
                buf.writeUInt16LE(pid, 2);
                if (dataType === "int32") buf.writeInt32LE(value, 4);
                else buf.writeFloatLE(value, 4);
                return buf;
            })
        );
        const totalLength = header.length + reserved.length + tuples.length;
        header.writeUInt16LE(totalLength, 4);
        this.sendCommand(Buffer.concat([header, reserved, tuples]));
    }

    /**
     * Parses a single-PID response frame (12 bytes for SET_RESPONSE,
     * 16 bytes for GET_RESPONSE).
     *
     * @param data - Raw response buffer
     * @returns Structured PID response
     * @throws if the frame length is unexpected
     */
    parseSinglePidResponse(data: Buffer): PidResponse {
        const pid = data.readUInt16LE(8);
        const parafault = data.readUInt8(10);
        const name = pidDescription[pid] ?? "Unknown";

        if (data.length === 16) {
            const dataTypeCode = data.readUInt8(11);
            const valueBuffer = data.subarray(12, 16);
            let dataType: "int32" | "float" | "void" = "void";
            let value: number | null = null;

            if (dataTypeCode === 0x01) { dataType = "int32"; value = valueBuffer.readInt32LE(0); }
            else if (dataTypeCode === 0x02) { dataType = "float"; value = valueBuffer.readFloatLE(0); }

            const sendError = parafault !== 0 ? parafaultDescriptions[parafault] ?? "Unknown error" : undefined;
            return { pid, name, dataType, value, parafault, sendError, type: "GET_RESPONSE" };
        } else if (data.length === 12) {
            const sendError = parafault !== 0 ? parafaultDescriptions[parafault] ?? "Unknown error" : undefined;
            return { pid, name, parafault, sendError, type: "SET_RESPONSE" };
        }

        throw new Error(`Unknown response format: length=${data.length}`);
    }

    /**
     * Parses a multi-PID response frame (command 0x05).
     *
     * @param data - Raw response buffer
     * @returns Array of parsed PID responses
     */
    parseMultiResponse(data: Buffer): MultiPidResponse[] {
        const results: MultiPidResponse[] = [];
        const count = (data.length - 12) / 8;
        let hasValues = false;

        for (let i = 0; i < count; i++) {
            const offset = 12 + i * 8;
            const parafault = data.readUInt8(offset);
            const dataTypeCode = data.readUInt8(offset + 1);
            const pid = data.readUInt16LE(offset + 2);
            const name = pidDescription[pid] ?? "Unknown";
            const valueBuffer = data.subarray(offset + 4, offset + 8);

            let dataType: "int32" | "float" | "void" = "void";
            let value: number | null = null;

            if (dataTypeCode === 0x01) { dataType = "int32"; value = valueBuffer.readInt32LE(0); hasValues = true; }
            else if (dataTypeCode === 0x02) { dataType = "float"; value = valueBuffer.readFloatLE(0); hasValues = true; }

            results.push({
                pid, name, dataType, value, parafault,
                sendError: parafault !== 0 ? parafaultDescriptions[parafault] ?? "Unknown error" : undefined,
                type: hasValues ? "GET_MULTIRESPONSE" : "SET_MULTIRESPONSE",
            });
        }
        return results;
    }

    // ── High-level operations ──

    /**
     * Reads a single PID value and waits for the response.
     *
     * @param pid       - Parameter ID to read
     * @param timeoutMs - Maximum wait time in milliseconds
     * @returns Parsed PID response, or null on timeout
     */
    async readPid(pid: number, timeoutMs = 2000): Promise<PidResponse | null> {
        return new Promise((resolve) => {
            let subscription: Subscription;
            const timer = setTimeout(() => { subscription?.unsubscribe(); resolve(null); }, timeoutMs);

            subscription = this.responseData
                .pipe(filter((data: Buffer) => data.length === 16))
                .subscribe((data: Buffer) => {
                    const response = this.parseSinglePidResponse(data);
                    if (response.pid === pid) {
                        clearTimeout(timer);
                        subscription.unsubscribe();
                        resolve(response);
                    }
                });

            this.requestSinglePid(pid);
        });
    }

    /**
     * Waits until the CDS status equals the target value.
     * Skips the initial placeholder value (-1) to avoid false matches.
     *
     * @param target    - Desired status bitmask value
     * @param timeoutMs - Maximum wait time
     * @returns true if target reached, false on timeout
     */
    async waitForStatus(target: number, timeoutMs = 5000): Promise<boolean> {
        return firstValueFrom(
            this.statusValue.pipe(
                filter((status) => status !== -1 && status === target),
                timeout(timeoutMs),
                map(() => true),
                catchError(() => of(false))
            )
        );
    }

    /**
     * Waits until at least one bit in the given bitmask is set in the status.
     * Skips the initial placeholder value (-1).
     *
     * @param bitMask   - Bitmask to test (e.g., CdsStatus.Running)
     * @param timeoutMs - Maximum wait time
     * @returns true if any bit matched, false on timeout
     */
    async waitForStatusBit(bitMask: number, timeoutMs = 5000): Promise<boolean> {
        return firstValueFrom(
            this.statusValue.pipe(
                filter((status) => status !== -1 && (status & bitMask) !== 0),
                timeout(timeoutMs),
                map(() => true),
                catchError(() => of(false))
            )
        );
    }

    /**
     * Calculates a plausible battery voltage from SoC and voltage limits.
     * Used to initialize the EV battery voltage PID before starting.
     */
    private calcBattVoltage(maxVoltage: number, minVoltage: number, soc: number): number {
        let result = Math.round((maxVoltage - minVoltage) * (soc / 100) + minVoltage);
        if (result >= maxVoltage) result = maxVoltage - 1;
        return result;
    }

    /**
     * Waits for a multi-PID SET response and verifies all PIDs were
     * written successfully (parafault === 0 for each).
     *
     * @param sendData - The PID entries that were sent
     * @returns true if all writes succeeded
     */
    private async checkWriteResponse(sendData: WritePidEntry[]): Promise<boolean> {
        return firstValueFrom(
            this.responseData.pipe(
                filter((data: Buffer) => data.length === 12 + 8 * sendData.length),
                map((data: Buffer) => {
                    const response = this.parseMultiResponse(data);
                    const allPresent = sendData.every((sent) => response.some((r) => r.pid === sent.pid));
                    return allPresent && response.every((r) => r.parafault === 0);
                }),
                take(1)
            )
        );
    }

    // ── Lifecycle ──

    /**
     * Performs a full CDS reset cycle:
     *   1. Stop if running or in error state
     *   2. Send Initializing command to trigger reset sequence
     *   3. Wait for Resetting state
     *   4. Wait for Stopped state
     *
     * This returns the CDS to a known idle state ready for start().
     *
     * @returns true if the reset completed successfully
     */
    async reset(): Promise<boolean> {
        try {
            // Step 1: Ensure the CDS is stopped (send Stop if needed)
            if (!(await this.waitForStatus(CdsStatus.Stopped, 2000))
                && !(await this.waitForStatus(CdsStatus.ErrorPending, 2000))) {
                this.writeSinglePid(PidList.Control, "int32", CdsControl.Stop);
                const stopped = await this.waitForStatus(CdsStatus.Stopped, 20000);
                if (!stopped) return false;
            }

            // Step 2: Trigger the reset cycle — Initializing causes the CDS
            // to transition through Resetting and back to Stopped automatically
            this.writeSinglePid(PidList.Control, "int32", CdsControl.Initializing);

            // Step 3: Wait for the Resetting state to confirm the cycle started
            const resetting = await this.waitForStatusBit(CdsStatus.Resetting, 3000);
            if (!resetting) return false;

            // Step 4: Wait for the cycle to complete (back to Stopped)
            return await this.waitForStatus(CdsStatus.Stopped, 15000);
        } catch {
            return false;
        }
    }

    /**
     * Starts the EV simulation (transitions CDS from Stopped to Running).
     *
     * @returns true if Running status is reached within 5s
     */
    async start(): Promise<boolean> {
        const written = await this.writeSinglePidAsync(PidList.Control, "int32", CdsControl.Start);
        if (!written) return false;
        return this.waitForStatus(CdsStatus.Running, 5000);
    }

    /**
     * Stops the EV simulation (transitions CDS to Stopped).
     *
     * @returns true if Stopped status is reached within 20s
     */
    async stop(): Promise<boolean> {
        const written = await this.writeSinglePidAsync(PidList.Control, "int32", CdsControl.Stop);
        if (!written) return false;
        return this.waitForStatus(CdsStatus.Stopped, 20000);
    }

    /**
     * Triggers an emergency off (immediate power disconnect).
     * This does not wait for status confirmation.
     */
    async emergencyStop(): Promise<void> {
        this.writeSinglePid(PidList.Control, "int32", CdsControl.EmergencyOff);
    }

    // ── Configuration ──

    /**
     * Configures the CDS hardware: charging specification, DC/AC mode,
     * sink ID, and test mode.
     *
     * @param config - CDS configuration parameters
     * @returns true if all PID writes were acknowledged without error
     */
    async configureCds(config: CdsConfig): Promise<boolean> {
        const { specification, chargeMode, sinkId, mode = 2 } = config;
        const sendData: WritePidEntry[] = [
            { pid: PidList.Specification, dataType: "int32", value: specification },
            { pid: PidList.ChargeMode, dataType: "int32", value: chargeMode },
            { pid: PidList.Sink, dataType: "int32", value: sinkId },
            { pid: PidList.Mode, dataType: "int32", value: mode },
            { pid: PidList.EVChargingModel, dataType: "int32", value: 1 },
        ];
        this.writeMultiplePids(sendData);
        return this.checkWriteResponse(sendData);
    }

    /**
     * Configures EV DC parameters: voltage/current limits, power limit,
     * battery capacity, and state of charge. Also computes an initial
     * battery voltage from the SoC.
     *
     * @param config - EV electrical parameters
     * @returns true if all PID writes were acknowledged without error
     */
    async configureEv(config: EvConfig): Promise<boolean> {
        const {
            SwitchOffLimitVoltage = 1000, SwitchOffLimitCurrent = 600,
            SwitchOffLimitPowerInW = 180000, EVMaximumCurrentLimit = 100,
            EVMaximumVoltageLimit = 500, EVMaximumPowerLimit = 20000,
            EVMinimumCurrentLimit = 0, EVMinimumVoltageLimit = 300,
            EVstateOfCharge = 20, BatteryCapacity = 10000,
        } = config;

        const sendData: WritePidEntry[] = [
            { pid: PidList.PowerSource_Ierr_max, dataType: "float", value: SwitchOffLimitCurrent },
            { pid: PidList.PowerSource_Perr_max, dataType: "float", value: SwitchOffLimitPowerInW },
            { pid: PidList.PowerSource_Uerr_max, dataType: "float", value: SwitchOffLimitVoltage },
            { pid: PidList.EVMaximumCurrentLimit, dataType: "float", value: EVMaximumCurrentLimit },
            { pid: PidList.EVMaximumVoltageLimit, dataType: "float", value: EVMaximumVoltageLimit },
            { pid: PidList.EVMaximumPowerLimit, dataType: "float", value: EVMaximumPowerLimit },
            { pid: PidList.EVMinimumCurrentLimit, dataType: "float", value: EVMinimumCurrentLimit },
            { pid: PidList.EVMinimumVoltageLimit, dataType: "float", value: EVMinimumVoltageLimit },
            { pid: PidList.EVRESSSoC, dataType: "float", value: EVstateOfCharge },
            { pid: PidList.EVEnergyCapacity, dataType: "float", value: BatteryCapacity },
            { pid: PidList.EVBatteryVoltage, dataType: "float", value: this.calcBattVoltage(EVMaximumVoltageLimit, EVMinimumVoltageLimit, EVstateOfCharge) },
        ];
        this.writeMultiplePids(sendData);
        return this.checkWriteResponse(sendData);
    }

    /**
     * Configures minimal EV AC parameters (SoC and battery capacity).
     *
     * @param config - EV AC parameters
     * @returns true if all PID writes were acknowledged without error
     */
    async configureEvAc(config: EvConfigAc): Promise<boolean> {
        const { EVstateOfCharge = 20, BatteryCapacity = 10000 } = config;
        const sendData: WritePidEntry[] = [
            { pid: PidList.EVRESSSoC, dataType: "float", value: EVstateOfCharge },
            { pid: PidList.EVEnergyCapacity, dataType: "float", value: BatteryCapacity },
        ];
        this.writeMultiplePids(sendData);
        return this.checkWriteResponse(sendData);
    }

    // ── Measurements ──

    /**
     * Reads the current DC measurements from the CDS:
     * voltage, current, state of charge, and CP state.
     *
     * @returns Object with nullable measurement values
     */
    async readMeasurements(): Promise<{ voltage: number | null; current: number | null; soc: number | null; cpStateRaw: number | null }> {
        const voltageResponse = await this.readPid(PidList.u_dc_act);
        const currentResponse = await this.readPid(PidList.i_dc_act);
        const socResponse = await this.readPid(PidList.EVRESSSoC);
        const cpResponse = await this.readPid(PidList.CpStateEvse);

        return {
            voltage: voltageResponse?.value ?? null,
            current: currentResponse?.value ?? null,
            soc: socResponse?.value ?? null,
            cpStateRaw: cpResponse?.value ?? null,
        };
    }

    /**
     * Translates a status bitmask into an array of human-readable flag names.
     *
     * @param value - Raw status value from the CDS
     * @returns Array of active status descriptions
     */
    getStatusDescription(value: number): string[] {
        const flags: string[] = [];
        if (value === 0) return ["stopped"];
        if (value & CdsStatus.Running) flags.push("running");
        if (value & CdsStatus.ErrorPending) flags.push("error_pending");
        if (value & CdsStatus.ActiveCharging) flags.push("active_charging");
        if (value & CdsStatus.Resetting) flags.push("resetting");
        if (value & CdsStatus.Initializing) flags.push("initializing");
        if (value & CdsStatus.WaitingForUser) flags.push("waiting_for_user");
        if (value & CdsStatus.AcContactorClosed) flags.push("ac_contactor_closed");
        if (value & CdsStatus.DcContactorClosed) flags.push("dc_contactor_closed");
        return flags;
    }
}
