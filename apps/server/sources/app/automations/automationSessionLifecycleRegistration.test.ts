import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/storage/inTx";
import {
    AutomationSessionLifecycleRegistrationValidationError,
    validateSessionLifecycleExecutionTargetInequality,
    validateSessionLifecycleTriggerRegistrationTx,
} from "./automationSessionLifecycleRegistration";

const input = {
    kind: "sessionLifecycle" as const,
    enabled: true,
    sourceSessionId: "source-session",
    events: ["parentTurnCompleted"] as ["parentTurnCompleted"],
    policy: { kind: "currentTurn" as const, sourceTurnId: "source-turn" },
};

function txFixture(params: {
    sourceSession?: { latestTurnId: string | null } | null;
    sourceTurn?: { status: string } | null;
    terminalReceipt?: { id: string } | null;
} = {}): Tx {
    return {
        session: { findFirst: vi.fn(async () => params.sourceSession === undefined ? { latestTurnId: "source-turn" } : params.sourceSession) },
        sessionTurn: { findUnique: vi.fn(async () => params.sourceTurn === undefined ? { status: "in_progress" } : params.sourceTurn) },
        sessionTurnMutationReceipt: { findFirst: vi.fn(async () => params.terminalReceipt ?? null) },
    } as unknown as Tx;
}

async function code(promise: Promise<unknown>) {
    try { await promise; return null; } catch (error) {
        expect(error).toBeInstanceOf(AutomationSessionLifecycleRegistrationValidationError);
        return (error as AutomationSessionLifecycleRegistrationValidationError).code;
    }
}

describe("Session lifecycle trigger registration", () => {
    it("accepts only the same-Account exact current in-progress turn", async () => {
        await expect(validateSessionLifecycleTriggerRegistrationTx({
            tx: txFixture(),
            accountId: "account",
            automationTargetType: "new_session",
            input,
        })).resolves.toEqual({
            kind: "sessionLifecycle",
            sourceSessionId: "source-session",
            events: ["parentTurnCompleted"],
            policy: { kind: "currentTurn", sourceTurnId: "source-turn" },
        });
    });

    it("arms future policies from the same-Account Session without requiring an active turn", async () => {
        const tx = txFixture({ sourceSession: { latestTurnId: null } });
        await expect(validateSessionLifecycleTriggerRegistrationTx({
            tx,
            accountId: "account",
            automationTargetType: "new_session",
            input: {
                kind: "sessionLifecycle",
                enabled: true,
                sourceSessionId: "source-session",
                events: ["parentTurnFailed", "userActionRequired"],
                policy: { kind: "everyMatch" },
            },
        })).resolves.toMatchObject({
            sourceSessionId: "source-session",
            policy: { kind: "everyMatch" },
        });
        expect(tx.sessionTurn.findUnique).not.toHaveBeenCalled();
    });

    it.each([
        [{ sourceSession: null }, "sourceSessionUnavailable"],
        [{ sourceSession: { latestTurnId: "newer-turn" } }, "sourceTurnNotCurrent"],
        [{ sourceTurn: null }, "sourceTurnUnavailable"],
        [{ sourceTurn: { status: "completed" } }, "sourceTurnNotInProgress"],
        [{ sourceTurn: { status: "failed" } }, "sourceTurnNotInProgress"],
        [{ sourceTurn: { status: "cancelled" } }, "sourceTurnNotInProgress"],
        [{ terminalReceipt: { id: "terminal" } }, "sourceTurnNotInProgress"],
    ] as const)("rejects stale/unavailable/terminal source truth", async (fixture, expected) => {
        await expect(code(validateSessionLifecycleTriggerRegistrationTx({
            tx: txFixture(fixture),
            accountId: "account",
            automationTargetType: "new_session",
            input,
        }))).resolves.toBe(expected);
    });

    it("requires an existing-Session target distinct from the source", async () => {
        await expect(code(validateSessionLifecycleTriggerRegistrationTx({
            tx: txFixture(),
            accountId: "account",
            automationTargetType: "existing_session",
            input,
        }))).resolves.toBe("executionTargetInequalityUnproven");
        await expect(code(validateSessionLifecycleTriggerRegistrationTx({
            tx: txFixture(),
            accountId: "account",
            automationTargetType: "existing_session",
            automationExistingSessionId: "source-session",
            input,
        }))).resolves.toBe("sourceMatchesExecutionTarget");
        expect(() => validateSessionLifecycleExecutionTargetInequality({
            automationTargetType: "existing_session",
            automationExistingSessionId: "target-session",
            sourceSessionId: "source-session",
        })).not.toThrow();
    });
});
