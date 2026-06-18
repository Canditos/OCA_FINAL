import { describe, it, expect, vi, beforeEach } from "vitest";
import { CdsClient } from "../src/connectors/cds/cds-client.js";
import { PidList, CdsStatus, CdsControl } from "../src/connectors/cds/types.js";

// ── Helpers ──

function makeSetResponse(pid: number, parafault: number): Buffer {
    const buf = Buffer.alloc(12);
    buf.write("SLEP");
    buf.writeUInt16LE(12, 4);
    buf[6] = 0x01;
    buf[7] = 0x03;
    buf.writeUInt16LE(pid, 8);
    buf[10] = parafault;
    return buf;
}

// ── start() — plugin ──

describe("CdsClient — start (plugin)", () => {
    let cds: CdsClient;

    beforeEach(() => {
        cds = new CdsClient("127.0.0.1", 51001);
        vi.spyOn(cds["socket"], "write").mockReturnValue(true);
        (cds as any).isConnected = true;
    });

    it("deve retornar true quando SET response + Running status recebidos", async () => {
        const promise = cds.start();

        cds.responseData.next(makeSetResponse(PidList.Control, 0));
        cds.statusValue.next(CdsStatus.Running);

        await expect(promise).resolves.toBe(true);
        expect(cds["socket"].write).toHaveBeenCalled();
    });

    it("deve falhar quando SET response tem parafault != 0", async () => {
        const promise = cds.start();

        cds.responseData.next(makeSetResponse(PidList.Control, 4));

        await expect(promise).resolves.toBe(false);
    });

    it("deve falhar quando SET response tem PID diferente do esperado", async () => {
        const promise = cds.start();

        cds.responseData.next(makeSetResponse(999, 0));

        await expect(promise).resolves.toBe(false);
    });

    it("deve falhar se Running status não for atingido (timeout)", async () => {
        vi.useFakeTimers();

        const promise = cds.start();

        cds.responseData.next(makeSetResponse(PidList.Control, 0));
        await vi.advanceTimersByTimeAsync(5100);

        await expect(promise).resolves.toBe(false);

        vi.useRealTimers();
    });
});

// ── reset() — high-level logic ──

describe("CdsClient — reset (lógica de alto nível)", () => {
    let cds: CdsClient;

    beforeEach(() => {
        cds = new CdsClient("127.0.0.1", 51001);
        (cds as any).isConnected = true;
        vi.spyOn(cds as any, "sendCommand").mockImplementation(() => {});
        vi.spyOn(cds, "writeSinglePid");
    });

    it("deve fazer stop + initializing quando está Running", async () => {
        cds.statusValue.next(CdsStatus.Running);
        const wfsReturns = [false, true];
        let wfsIdx = 0;
        vi.spyOn(cds, "waitForStatus").mockImplementation(() =>
            Promise.resolve(wfsReturns[wfsIdx++])
        );

        vi.spyOn(cds, "waitForStatusBit").mockResolvedValue(true);

        const result = await cds.reset();

        expect(result).toBe(true);
        expect(cds.writeSinglePid).toHaveBeenCalledWith(PidList.Control, "int32", CdsControl.Stop);
        expect(cds.writeSinglePid).toHaveBeenCalledWith(PidList.Control, "int32", CdsControl.Initializing);
        expect(cds.writeSinglePid).toHaveBeenCalledTimes(2);
    });

    it("deve pular stop se já estiver Stopped", async () => {
        cds.statusValue.next(CdsStatus.Stopped);
        const wfsReturns = [true];
        let wfsIdx = 0;
        vi.spyOn(cds, "waitForStatus").mockImplementation(() =>
            Promise.resolve(wfsReturns[wfsIdx++])
        );

        vi.spyOn(cds, "waitForStatusBit").mockResolvedValue(true);

        const result = await cds.reset();

        expect(result).toBe(true);
        expect(cds.writeSinglePid).toHaveBeenCalledWith(PidList.Control, "int32", CdsControl.Initializing);
        expect(cds.writeSinglePid).not.toHaveBeenCalledWith(PidList.Control, "int32", CdsControl.Stop);
        expect(cds.writeSinglePid).toHaveBeenCalledTimes(1);
    });

    it("deve tratar ErrorPending com Reset + Initializing (sem Stop)", async () => {
        cds.statusValue.next(CdsStatus.ErrorPending);
        const wfsReturns = [false, true];
        let wfsIdx = 0;
        vi.spyOn(cds, "waitForStatus").mockImplementation(() =>
            Promise.resolve(wfsReturns[wfsIdx++])
        );

        vi.spyOn(cds, "waitForStatusBit").mockResolvedValue(true);

        const result = await cds.reset();

        expect(result).toBe(true);
        expect(cds.writeSinglePid).toHaveBeenCalledWith(PidList.Control, "int32", CdsControl.Reset);
        expect(cds.writeSinglePid).toHaveBeenCalledWith(PidList.Control, "int32", CdsControl.Initializing);
        expect(cds.writeSinglePid).not.toHaveBeenCalledWith(PidList.Control, "int32", CdsControl.Stop);
    });

    it("deve retornar false se não conseguir parar o CDS", async () => {
        cds.statusValue.next(CdsStatus.Running);
        const wfsReturns = [false, false];
        let wfsIdx = 0;
        vi.spyOn(cds, "waitForStatus").mockImplementation(() =>
            Promise.resolve(wfsReturns[wfsIdx++])
        );

        vi.spyOn(cds, "waitForStatusBit").mockResolvedValue(true);

        const result = await cds.reset();

        expect(result).toBe(false);
    });

    it("deve retornar false se Resetting não for atingido", async () => {
        vi.spyOn(cds, "waitForStatus").mockResolvedValue(true);

        vi.spyOn(cds, "waitForStatusBit").mockResolvedValue(false);

        const result = await cds.reset();

        expect(result).toBe(false);
    });
});

// ── reset() — cenários com integração RxJS real ──

describe("CdsClient — reset (integração com RxJS)", () => {
    let cds: CdsClient;

    /** Dá tempo ao event loop para processar microtasks do RxJS */
    const yieldToMicrotasks = () => new Promise(r => setTimeout(r, 0));

    beforeEach(() => {
        cds = new CdsClient("127.0.0.1", 51001);
        vi.spyOn(cds["socket"], "write").mockReturnValue(true);
        (cds as any).isConnected = true;
    });

    it("deve completar ciclo completo de Running → Stopped → Resetting → Stopped", async () => {
        cds.statusValue.next(CdsStatus.Running);
        const promise = cds.reset();

        // reset() está a aguardar waitForStatus(Stopped, 20000)
        await yieldToMicrotasks();

        cds.statusValue.next(CdsStatus.Stopped);
        await yieldToMicrotasks();

        // reset() escreveu Initializing e aguarda waitForStatusBit(Resetting, 5000)
        cds.statusValue.next(CdsStatus.Resetting);
        await yieldToMicrotasks();

        // reset() aguarda waitForStatus(Stopped, 15000)
        cds.statusValue.next(CdsStatus.Stopped);

        await expect(promise).resolves.toBe(true);
    }, 10000);

    it("deve retornar true se já estiver Stopped", async () => {
        cds.statusValue.next(CdsStatus.Stopped);
        const promise = cds.reset();

        // reset() vê Stopped, salta stop, escreve Initializing, aguarda Resetting
        await yieldToMicrotasks();

        cds.statusValue.next(CdsStatus.Resetting);
        await yieldToMicrotasks();

        // reset() aguarda waitForStatus(Stopped, 15000)
        cds.statusValue.next(CdsStatus.Stopped);

        await expect(promise).resolves.toBe(true);
    }, 10000);

    it("deve retornar false se Resetting não vier", async () => {
        // Mock waitForStatusBit para simular timeout real do RxJS
        // (O RxJS captura setTimeout ao carregar o módulo, pelo que
        // vi.useFakeTimers não consegue acelerar o timeout do operador)
        vi.spyOn(cds, "waitForStatusBit").mockResolvedValue(false);

        cds.statusValue.next(CdsStatus.Stopped);
        const result = await cds.reset();

        expect(result).toBe(false);
    }, 10000);
});
