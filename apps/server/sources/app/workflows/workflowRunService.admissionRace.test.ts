import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    transactionAttempts: 0,
    markAccountChanged: vi.fn(),
    recoveryWhere: null as unknown,
}));

vi.mock("@/storage/inTx", () => ({
    afterTx: vi.fn(),
    inTx: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => {
        mocks.transactionAttempts += 1;
        const attempt = mocks.transactionAttempts;
        const winner = {
            id: "11111111-1111-4111-8111-111111111111",
            accountId: "account-1",
            originKind: "direct",
            automationId: null,
            originSessionId: null,
            state: "queued",
            revision: 0,
            attempt: 0,
            claimedByMachineId: null,
            workflowCustodyState: "pending",
            workflowResultDeliveryState: null,
            workflowAcceptedSnapshotEnvelope: "accepted-envelope",
            executionInputEnvelope: "accepted-envelope",
            workflowCheckpointEnvelope: null,
            resultEnvelope: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            assignments: [{ machineId: "machine-1" }],
            workflowInvocations: [],
        };
        const tx = {
            automationRun: {
                findUnique: vi.fn(async () => attempt === 1 ? null : winner),
                findMany: vi.fn(async (args: { where: unknown }) => {
                    mocks.recoveryWhere = args.where;
                    return [];
                }),
                findFirst: vi.fn(async () => {
                    throw Object.assign(new Error("current transaction is aborted"), { code: "25P02" });
                }),
                create: vi.fn(async () => {
                    throw Object.assign(new Error("duplicate run"), { code: "P2002" });
                }),
            },
            machine: { findFirst: vi.fn(async () => ({ id: "machine-1" })) },
        };
        return await operation(tx);
    }),
}));

vi.mock("@/app/encryption/accountEncryptionTransition", () => ({
    acquireAccountEncryptionTransitionFenceInTx: vi.fn(async () => ({
        status: "ready",
        account: {
            version: 1,
            contentKeyFingerprint: null,
            currentness: { encryptionMode: "plain" },
        },
    })),
}));

vi.mock("@/app/changes/markAccountChanged", () => ({
    markAccountChanged: mocks.markAccountChanged,
}));

vi.mock("./runs/storedContent", () => ({
    assertWorkflowStoredEnvelopeOuterForMode: vi.fn(),
}));

import { admitWorkflowRun, deriveWorkflowRunAvailability, listWorkflowRunsForRecovery } from "./workflowRunService";

beforeEach(() => {
    mocks.transactionAttempts = 0;
    mocks.markAccountChanged.mockReset();
    mocks.recoveryWhere = null;
});

it("selects exact-machine terminal custody and nonterminal cancellation recovery only", async () => {
    await expect(listWorkflowRunsForRecovery({
        accountId: "account-1",
        machineId: "machine-1",
        pageByteLimit: 4_096,
    })).resolves.toEqual({ candidates: [] });

    expect(mocks.recoveryWhere).toEqual({
        accountId: "account-1",
        workflowCustodyState: { not: null },
        assignments: { some: { machineId: "machine-1" } },
        OR: [
            {
                state: { in: [
                    "succeeded",
                    "failed",
                    "cancelled",
                    "expired",
                    "dispatch_failed",
                    "skipped",
                    "missed",
                    "outcome_uncertain",
                ] },
                OR: [
                    { workflowCustodyState: "pending" },
                    { workflowResultDeliveryState: "pending" },
                ],
            },
            {
                state: { notIn: [
                    "succeeded",
                    "failed",
                    "cancelled",
                    "expired",
                    "dispatch_failed",
                    "skipped",
                    "missed",
                    "outcome_uncertain",
                ] },
                workflowCustodyState: "pending",
                workflowInvocations: { some: { lifecycle: "cancel_requested" } },
            },
        ],
    });
});

it("restarts the complete admission transaction after a unique Run race and rejoins the committed winner", async () => {
    await expect(admitWorkflowRun({
        accountId: "account-1",
        runId: "11111111-1111-4111-8111-111111111111",
        origin: { kind: "direct" },
        machineId: "machine-1",
        acceptedEnvelope: "accepted-envelope",
        accountCurrentness: { mode: "plain", version: 1, contentKeyFingerprint: null },
    })).resolves.toMatchObject({ kind: "existing", run: { id: "11111111-1111-4111-8111-111111111111" } });
    expect(mocks.transactionAttempts).toBe(2);
    expect(mocks.markAccountChanged).not.toHaveBeenCalled();
});

it("projects only coarse workspace-restore availability from server-visible Run facts", () => {
    expect(deriveWorkflowRunAvailability({
        state: "interrupted",
        workflowCustodyState: "pending",
        hasExecution: true,
        hasCheckpoint: false,
    })).toMatchObject({ restoreWorkspace: true });

    expect(deriveWorkflowRunAvailability({
        state: "interrupted",
        workflowCustodyState: "pending",
        hasExecution: false,
        hasCheckpoint: false,
    })).toMatchObject({
        restoreWorkspace: false,
        disabledReasons: expect.arrayContaining([
            { operation: "restore_workspace", code: "execution_not_admitted" },
        ]),
    });
});
