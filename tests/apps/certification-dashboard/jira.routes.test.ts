import { describe, expect, it } from "vitest";
import { buildXrayStepResults } from "../../../src/apps/certification-dashboard/routes/jira.routes.js";

describe("Jira routes Xray step results", () => {
    it("marks every manual step with the overall Xray status", () => {
        const steps = buildXrayStepResults([{ id: "step-1" }, { id: "step-2" }], "PASSED");

        expect(steps).toEqual([
            {
                id: "step-1",
                stepId: "step-1",
                status: "PASSED",
                actualResult: "Step 1 automatically marked as PASSED by the test runner.",
                comment: "Step 1 automatically marked as PASSED by the test runner.",
            },
            {
                id: "step-2",
                stepId: "step-2",
                status: "PASSED",
                actualResult: "Step 2 automatically marked as PASSED by the test runner.",
                comment: "Step 2 automatically marked as PASSED by the test runner.",
            },
        ]);
    });
});
