import { describe, expect, it } from "vitest";
import { buildXrayStepResults } from "../../../src/apps/certification-dashboard/services/xray-upload.service.js";

describe("Jira routes Xray step results", () => {
    it("marks every manual step with the overall Xray status", () => {
        const steps = buildXrayStepResults([{ id: "step-1" }, { id: "step-2" }], "PASSED");

        expect(steps).toEqual([
            {
                status: "PASSED",
                actualResult: "Step 1 automatically marked as PASSED by the test runner.",
                comment: "Step 1 automatically marked as PASSED by the test runner.",
            },
            {
                status: "PASSED",
                actualResult: "Step 2 automatically marked as PASSED by the test runner.",
                comment: "Step 2 automatically marked as PASSED by the test runner.",
            },
        ]);
    });
});
