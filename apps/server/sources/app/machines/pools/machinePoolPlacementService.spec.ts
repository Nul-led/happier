import { describe, expect, it } from "vitest";

import { selectMachinePoolCandidate } from "./machinePoolPlacementService";

describe("personal Machine Pool selection", () => {
    const members = [
        { machineId: "primary", priorityTier: 0, enabled: true },
        { machineId: "fallback-a", priorityTier: 3, enabled: true },
        { machineId: "fallback-b", priorityTier: 3, enabled: true },
        { machineId: "disabled", priorityTier: 0, enabled: false },
    ];

    it("uses the first eligible enabled tier, including an offline-primary fallback", () => {
        expect(selectMachinePoolCandidate({ members, availableMachineIds: new Set(["primary", "fallback-a"]), requestKey: "one" }))
            .toEqual({ machineId: "primary", priorityTier: 0 });
        expect(selectMachinePoolCandidate({ members, availableMachineIds: new Set(["disabled", "fallback-a"]), requestKey: "one" }))
            .toEqual({ machineId: "fallback-a", priorityTier: 3 });
        expect(selectMachinePoolCandidate({ members, availableMachineIds: new Set(["disabled"]), requestKey: "one" })).toBeNull();
    });

    it("is order-independent and lets distinct keys reach both equal-tier Machines", () => {
        const availableMachineIds = new Set(["fallback-a", "fallback-b"]);
        const choices = new Set<string>();
        for (const requestKey of ["one", "two", "three", "four", "five", "six", "seven", "eight"]) {
            const chosen = selectMachinePoolCandidate({ members, availableMachineIds, requestKey });
            expect(selectMachinePoolCandidate({ members: [...members].reverse(), availableMachineIds, requestKey })).toEqual(chosen);
            if (chosen) choices.add(chosen.machineId);
        }
        expect(choices).toEqual(new Set(["fallback-a", "fallback-b"]));
    });
});
