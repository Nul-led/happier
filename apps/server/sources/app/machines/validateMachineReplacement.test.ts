import { describe, expect, it } from "vitest";
import { validateMachineReplacement } from "./validateMachineReplacement";

describe("validateMachineReplacement Machine kind eligibility", () => {
    it.each(["oldMachine", "replacementMachine"] as const)("rejects an ephemeral %s", (ephemeralSide) => {
        const oldMachine = { id: "old", accountId: "owner", active: false, revokedAt: null, kind: "persistent" as const };
        const replacementMachine = { ...oldMachine, id: "new" };
        expect(validateMachineReplacement({
            accountId: "owner", oldMachine, replacementMachine, replacementMachineId: "new", source: "manual",
            [ephemeralSide]: { ...(ephemeralSide === "oldMachine" ? oldMachine : replacementMachine), kind: "ephemeral_session_runner" },
        })).toMatchObject({ ok: false, statusCode: 400 });
    });

    it("keeps legacy persistent projections eligible", () => {
        const oldMachine = { id: "old", accountId: "owner", active: false, revokedAt: null };
        expect(validateMachineReplacement({
            accountId: "owner", oldMachine, replacementMachine: { ...oldMachine, id: "new" },
            replacementMachineId: "new", source: "manual",
        })).toEqual({ ok: true });
    });
});
