import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import tweetnacl from "tweetnacl";
import {
    EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
    measureExternalActionResultResponseEnvelopeUtf8BytesV1,
    prepareExternalActionResponseEnvelopeV1,
    signAccountContentKeyBindingV1,
} from "@happier-dev/protocol";
import {
    sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
    sealWorkflowCheckpointStoredEnvelopeV1,
    sealWorkflowFinalResultStoredEnvelopeV1,
    sealWorkflowProgressStoredEnvelopeV1,
    serializeWorkflowStoredContentEnvelopeV1,
} from "@happier-dev/protocol/workflows";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { automationAccountCurrentnessSelect, deriveAutomationAccountCurrentnessWitness } from "@/app/automations/automationAccountCurrentness";
import { cancelAutomationRun } from "@/app/automations/automationRunService";
import { AUTOMATION_RUN_TERMINAL_STATES } from "@/app/automations/automationTypes";

import {
    admitWorkflowInvocations as admitWorkflowInvocationsOwner,
    admitWorkflowRun as admitWorkflowRunOwner,
    appendBoundedPage,
    cancelWorkflowRun,
    commitWorkflowInvocationFact as commitWorkflowInvocationFactOwner,
    deleteWorkflowRun,
    getWorkflowRun,
    initializeWorkflowRunExecution as initializeWorkflowRunExecutionOwner,
    listWorkflowRunInvocations,
    listWorkflowRunsForRecovery,
    listWorkflowRuns,
    pauseWorkflowRun,
    recoverWorkflowInvocations as recoverWorkflowInvocationsOwner,
    retryWorkflowInvocation as retryWorkflowInvocationOwner,
    resolveAutomationWorkflowAcceptedSnapshot as resolveAutomationWorkflowAcceptedSnapshotOwner,
    settleWorkflowRunResultDelivery,
    transitionWorkflowRun as transitionWorkflowRunOwner,
    waitWorkflowRun,
} from "./workflowRunService";

const definition = {
    version: 1 as const,
    inputs: [],
    defaults: { agentTarget: { kind: "agent" as const, identity: { pluginId: "happier.agent.test", localId: "test" } } },
    blocks: [{ kind: "step" as const, id: "step", document: { text: "Work", references: [], attachments: [] }, input: [], result: { kind: "text" as const } }],
};
const e2eeWorkflowContent = {
    mode: "e2ee" as const,
    material: { type: "dataKey" as const, machineKey: new Uint8Array(32).fill(7) },
    randomBytes: (length: number) => new Uint8Array(length).fill(3),
};
function acceptedEnvelope(params: { accountId: string; runId: string; machineId: string; originSessionId?: string; deliver?: boolean; permission?: "default" | "read-only" }) {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
        mode: "plain",
        binding: { v: 1, purpose: "accepted_snapshot", accountId: params.accountId, runId: params.runId },
        acceptedSnapshot: {
            definition,
            source: { kind: "inline" },
            inputs: {},
            machineId: params.machineId,
            executionTarget: { kind: "session" },
            workspaceTarget: {
                project: { machineId: params.machineId, directory: "/repo", checkoutRootPath: "/repo" },
            },
            origin: { kind: "direct", ...(params.originSessionId ? { originSessionId: params.originSessionId } : {}) },
            authorization: { admittedPermissionCeiling: params.permission ?? "default", principal: { kind: "host" } },
            ...(params.deliver && params.originSessionId ? { resultDelivery: { kind: "originating_session" as const, originSessionId: params.originSessionId, localInputId: "workflow-input-v2:stable" } } : {}),
        },
    }));
}
function encryptedAcceptedEnvelope(params: { accountId: string; runId: string; machineId: string }) {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
        ...e2eeWorkflowContent,
        binding: { v: 1, purpose: "accepted_snapshot", accountId: params.accountId, runId: params.runId },
        acceptedSnapshot: {
            definition,
            source: { kind: "inline" },
            inputs: {},
            machineId: params.machineId,
            executionTarget: { kind: "session" },
            workspaceTarget: { project: { machineId: params.machineId, directory: "/repo", checkoutRootPath: "/repo" } },
            origin: { kind: "direct" },
            authorization: { admittedPermissionCeiling: "default", principal: { kind: "host" } },
        },
    }));
}
function encryptedCheckpointEnvelope(accountId: string, runId: string, rootRecordId: string) {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
        ...e2eeWorkflowContent,
        binding: { v: 1, purpose: "checkpoint", accountId, runId },
        checkpoint: { kind: "happier.workflow-checkpoint.v1", rootRecordId, nextSequence: "1", frontier: { nextBlockOrdinal: 1, paused: false } },
    }));
}
function encryptedProgressEnvelope(params: { accountId: string; runId: string; id: string }) {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
        ...e2eeWorkflowContent,
        binding: { v: 1, purpose: "invocation_progress", accountId: params.accountId, runId: params.runId, recordId: params.id, sequence: "0", parentRecordId: null, memberOrdinal: "0", attempt: "0" },
        progress: {
            kind: "happier.workflow-progress.v1",
            invocationPath: { blockId: "$root", scope: [] },
            blockKind: "root",
            attempt: "0",
            logicalInvocationRecordId: params.id,
        },
    }));
}
function checkpointEnvelope(accountId: string, runId: string, rootRecordId: string, nextSequence: bigint) {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
        mode: "plain",
        binding: { v: 1, purpose: "checkpoint", accountId, runId },
        checkpoint: { kind: "happier.workflow-checkpoint.v1", rootRecordId, nextSequence: nextSequence.toString(), frontier: { nextBlockOrdinal: Number(nextSequence), paused: false } },
    }));
}
function progressEnvelope(params: { accountId: string; runId: string; id: string; sequence: bigint; parentRecordId: string | null; memberOrdinal: bigint; attempt?: bigint; previousAttemptRecordId?: string; logicalInvocationRecordId?: string; reason?: string }) {
    const attempt = params.attempt ?? 0n;
    const isStructuralRoot = params.parentRecordId === null && attempt === 0n;
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
        mode: "plain",
        binding: { v: 1, purpose: "invocation_progress", accountId: params.accountId, runId: params.runId, recordId: params.id, sequence: params.sequence.toString(), parentRecordId: params.parentRecordId, memberOrdinal: params.memberOrdinal.toString(), attempt: attempt.toString() },
        progress: {
            kind: "happier.workflow-progress.v1",
            invocationPath: { blockId: isStructuralRoot ? "$root" : "step", scope: [] },
            blockKind: isStructuralRoot ? "root" : "step",
            attempt: attempt.toString(),
            ...(params.reason ? { reason: { code: params.reason } } : {}),
            ...(params.previousAttemptRecordId ? { previousAttemptRecordId: params.previousAttemptRecordId } : {}),
            logicalInvocationRecordId: params.logicalInvocationRecordId ?? params.id,
        },
    }));
}
function finalResultEnvelope(accountId: string, runId: string, value = "done") {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowFinalResultStoredEnvelopeV1({
        mode: "plain",
        binding: { v: 1, purpose: "final_result", accountId, runId },
        finalResult: {
            kind: "happier.workflow-final-result.v1",
            result: { kind: "text", value },
            producerInvocation: { recordId: "workflow-final-producer" },
        },
    }));
}

function workflowDefinitionEnvelope() {
    return JSON.stringify({ t: "plain", v: { definition, source: { definitionId: "workflow-definition", revision: "1" } } });
}

describe("workflowRunService (integration)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => { harness = await createLightSqliteHarness({ tempDirPrefix: "happier-workflow-runs-" }); }, 120_000);
    afterAll(async () => { await harness.close(); });
    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.workflowRunInvocation.deleteMany(),
            () => db.automationRunAssignment.deleteMany(),
            () => db.automationRun.deleteMany(),
            () => db.session.deleteMany(),
            () => db.machine.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it("honors an already-aborted wait before reading run state", async () => {
        const reason = new Error("caller stopped waiting");
        const controller = new AbortController();
        controller.abort(reason);

        await expect(waitWorkflowRun({
            accountId: randomUUID(),
            runId: randomUUID(),
            signal: controller.signal,
        })).rejects.toBe(reason);
    });

    async function seed() {
        const account = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" }, select: { id: true } });
        const machine = await db.machine.create({ data: { id: randomUUID(), accountId: account.id, metadata: "{}" }, select: { id: true } });
        const session = await db.session.create({ data: { id: randomUUID(), tag: randomUUID(), accountId: account.id, metadata: "{}", encryptionMode: "plain" }, select: { id: true } });
        return { accountId: account.id, machineId: machine.id, sessionId: session.id };
    }

    async function accountCurrentness(accountId: string) {
        const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: automationAccountCurrentnessSelect });
        const witness = deriveAutomationAccountCurrentnessWitness(account);
        if (!witness) throw new Error("Expected a current workflow test Account");
        return witness;
    }

    async function admitWorkflowRun(params: Omit<Parameters<typeof admitWorkflowRunOwner>[0], "accountCurrentness">) {
        return await admitWorkflowRunOwner({ ...params, accountCurrentness: await accountCurrentness(params.accountId) });
    }

    async function commitWorkflowInvocationFact(params: Omit<Parameters<typeof commitWorkflowInvocationFactOwner>[0], "accountCurrentness">) {
        return await commitWorkflowInvocationFactOwner({ ...params, accountCurrentness: await accountCurrentness(params.accountId) });
    }

    async function transitionWorkflowRun(params: Omit<Parameters<typeof transitionWorkflowRunOwner>[0], "accountCurrentness">) {
        return await transitionWorkflowRunOwner({ ...params, accountCurrentness: await accountCurrentness(params.accountId) });
    }

    async function resolveAutomationWorkflowAcceptedSnapshot(params: Omit<Parameters<typeof resolveAutomationWorkflowAcceptedSnapshotOwner>[0], "accountCurrentness">) {
        return await resolveAutomationWorkflowAcceptedSnapshotOwner({ ...params, accountCurrentness: await accountCurrentness(params.accountId) });
    }

    async function claimRun(runId: string, machineId: string, parentAttempt = 1): Promise<void> {
        await db.automationRun.update({
            where: { id: runId },
            data: { state: "claimed", claimedByMachineId: machineId, attempt: parentAttempt },
        });
    }

    async function seedTerminalWorkflowRunWithReplyCustody(
        replyHandoffState: "ready" | "handingOff" | "accepted" | "suppressed" | "blocked",
    ) {
        const seeded = await seed();
        const automation = await db.automation.create({
            data: {
                accountId: seeded.accountId,
                name: "Workflow reply custody",
                targetType: null,
                templateCiphertext: "{}",
            },
            select: { id: true },
        });
        const runId = randomUUID();
        await admitWorkflowRun({
            accountId: seeded.accountId,
            runId,
            origin: { kind: "automation", automationId: automation.id },
            machineId: seeded.machineId,
            acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }),
        });
        await db.automationRun.update({
            where: { id: runId },
            data: {
                state: "succeeded",
                causeKind: "conversation",
                occurrenceKey: `conversation-${runId}`,
                triggerEvidenceEnvelope: JSON.stringify({ t: "plain", v: {} }),
                workflowCustodyState: "settled",
                finishedAt: new Date(),
                resultEnvelope: JSON.stringify({ t: "plain", v: {} }),
                replyContextEnvelope: JSON.stringify({ t: "plain", v: {} }),
                replyHandoffActionPluginId: "happier.channels",
                replyHandoffActionLocalId: "automation/result-deliver-v1",
                replyHandoffTargetMachineId: seeded.machineId,
                replyHandoffTargetMachineInstallationId: "installation-workflow-delete",
                replyHandoffTargetMaterializationId: "materialization-workflow-delete",
                replyHandoffId: `handoff-${runId}`,
                replyHandoffState,
            },
        });
        return { ...seeded, runId };
    }

    async function initializeWorkflowRunExecution(params: Omit<Parameters<typeof initializeWorkflowRunExecutionOwner>[0], "accountCurrentness"> | Readonly<{
        accountId: string;
        runId: string;
        expectedRevision: number;
        checkpointEnvelope: string;
        rootInvocation: Readonly<{ id: string; contentEnvelope: string }>;
    }>) {
        if ("machineId" in params) return await initializeWorkflowRunExecutionOwner({ ...params, accountCurrentness: await accountCurrentness(params.accountId) });
        const assignment = await db.automationRunAssignment.findFirstOrThrow({
            where: { runId: params.runId },
            orderBy: { priority: "asc" },
            select: { machineId: true },
        });
        await claimRun(params.runId, assignment.machineId);
        return await initializeWorkflowRunExecutionOwner({ ...params, machineId: assignment.machineId, parentAttempt: 1, accountCurrentness: await accountCurrentness(params.accountId) });
    }

    async function admitWorkflowInvocationsWithClaim(params: Omit<Parameters<typeof admitWorkflowInvocationsOwner>[0], "machineId" | "parentAttempt" | "accountCurrentness">) {
        const assignment = await db.automationRunAssignment.findFirstOrThrow({
            where: { runId: params.runId },
            orderBy: { priority: "asc" },
            select: { machineId: true },
        });
        return await admitWorkflowInvocationsOwner({ ...params, machineId: assignment.machineId, parentAttempt: 1, accountCurrentness: await accountCurrentness(params.accountId) });
    }

    async function retryWorkflowInvocation(params: Omit<Parameters<typeof retryWorkflowInvocationOwner>[0], "checkpointEnvelope" | "accountCurrentness"> & Readonly<{ newSequence: bigint }>) {
        const root = await db.workflowRunInvocation.findFirstOrThrow({ where: { runId: params.runId, parentRecordId: null }, select: { id: true } });
        const { newSequence, ...request } = params;
        return await retryWorkflowInvocationOwner({ ...request, checkpointEnvelope: checkpointEnvelope(params.accountId, params.runId, root.id, newSequence + 1n), accountCurrentness: await accountCurrentness(params.accountId) });
    }

    async function recoverWorkflowInvocations(params: Omit<Parameters<typeof recoverWorkflowInvocationsOwner>[0], "checkpointEnvelope" | "recoveries" | "accountCurrentness"> & Readonly<{
        recoveries: readonly (Parameters<typeof recoverWorkflowInvocationsOwner>[0]["recoveries"][number] & Readonly<{ newSequence: bigint }>)[];
    }>) {
        const root = await db.workflowRunInvocation.findFirstOrThrow({ where: { runId: params.runId, parentRecordId: null }, select: { id: true } });
        const nextSequence = params.recoveries.reduce((maximum, recovery) => recovery.newSequence > maximum ? recovery.newSequence : maximum, -1n) + 1n;
        const recoveries = params.recoveries.map(({ newSequence: _callerSequence, ...recovery }) => recovery);
        return await recoverWorkflowInvocationsOwner({ ...params, recoveries, checkpointEnvelope: checkpointEnvelope(params.accountId, params.runId, root.id, nextSequence), accountCurrentness: await accountCurrentness(params.accountId) });
    }

    it("admits a direct Run, initializes exactly one root, and commits a row fact without advancing parent revision", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        const accepted = acceptedEnvelope({ ...seeded, runId, originSessionId: seeded.sessionId, deliver: true });
        const initialCurrentness = await accountCurrentness(seeded.accountId);
        const admitted = await admitWorkflowRunOwner({ accountId: seeded.accountId, runId, origin: { kind: "direct", originSessionId: seeded.sessionId }, machineId: seeded.machineId, accountCurrentness: initialCurrentness, acceptedEnvelope: accepted, resultDelivery: { kind: "originating_session" } });
        expect(admitted.run).toMatchObject({ state: "queued", revision: 0, workflowCustodyState: "pending", workflowResultDeliveryState: "pending" });
        await expect(db.automationRun.findUniqueOrThrow({ where: { id: runId }, select: { executionInputEnvelope: true } }))
            .resolves.toEqual({ executionInputEnvelope: accepted });
        await expect(admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct", originSessionId: seeded.sessionId }, machineId: seeded.machineId, acceptedEnvelope: accepted, resultDelivery: { kind: "originating_session" } })).resolves.toMatchObject({ kind: "existing", run: { id: runId } });
        await expect(admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct", originSessionId: seeded.sessionId }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId, originSessionId: seeded.sessionId, deliver: true, permission: "read-only" }), resultDelivery: { kind: "originating_session" } })).rejects.toMatchObject({ code: "currentness_conflict" });
        await claimRun(runId, seeded.machineId);
        const rootId = randomUUID();
        const checkpoint = checkpointEnvelope(seeded.accountId, runId, rootId, 1n);
        const rootContentEnvelope = progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n });
        const initialize = { accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, expectedRevision: 0, checkpointEnvelope: checkpoint, rootInvocation: { id: rootId, contentEnvelope: rootContentEnvelope } } as const;
        await expect(initializeWorkflowRunExecution({ ...initialize, machineId: randomUUID() })).rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(initializeWorkflowRunExecutionOwner({ ...initialize, accountCurrentness: initialCurrentness })).resolves.toMatchObject({ initialization: "created" });
        await expect(initializeWorkflowRunExecution(initialize)).resolves.toMatchObject({ initialization: "existing", run: { revision: 1 } });
        await commitWorkflowInvocationFact({ accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, invocationId: rootId, invocationAttempt: 0n, expectedLifecycle: "pending", lifecycle: "completed", contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) });
        const completedEnvelope = progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n });
        await expect(commitWorkflowInvocationFact({ accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, invocationId: rootId, invocationAttempt: 0n, expectedLifecycle: "completed", lifecycle: "completed", contentEnvelope: completedEnvelope }))
            .resolves.toMatchObject({ id: rootId, lifecycle: "completed", attempt: "0" });
        const conflictingEnvelope = progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n, reason: "different-terminal-fact" });
        await expect(commitWorkflowInvocationFact({ accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, invocationId: rootId, invocationAttempt: 0n, expectedLifecycle: "completed", lifecycle: "completed", contentEnvelope: conflictingEnvelope }))
            .rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(commitWorkflowInvocationFact({ accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, invocationId: rootId, invocationAttempt: 0n, expectedLifecycle: "completed", lifecycle: "failed", contentEnvelope: completedEnvelope }))
            .rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(commitWorkflowInvocationFact({ accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, invocationId: rootId, invocationAttempt: 0n, expectedLifecycle: "failed", lifecycle: "completed", contentEnvelope: completedEnvelope }))
            .rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: { lifecycle: true, contentEnvelope: true } }))
            .resolves.toEqual({ lifecycle: "completed", contentEnvelope: completedEnvelope });
        expect((await getWorkflowRun({ accountId: seeded.accountId, runId })).run.revision).toBe(1);
        const rows = await listWorkflowRunInvocations({ accountId: seeded.accountId, runId, pageByteLimit: 4096 });
        expect(rows.invocations).toEqual([expect.objectContaining({ id: rootId, sequence: "0", memberOrdinal: "0", attempt: "0", lifecycle: "completed" })]);
    });

    it("allows unrelated Account version changes but rejects same-mode content-key rotation before storing private workflow bytes", async () => {
        const signing = tweetnacl.sign.keyPair();
        const firstContentKey = new Uint8Array(tweetnacl.box.keyPair().publicKey);
        const account = await db.account.create({
            data: {
                publicKey: Buffer.from(signing.publicKey).toString("hex"),
                encryptionMode: "e2ee",
                contentPublicKey: firstContentKey,
                contentPublicKeySig: signAccountContentKeyBindingV1({ accountSigningSecretKey: signing.secretKey, contentPublicKey: firstContentKey }),
            },
            select: { id: true },
        });
        const machine = await db.machine.create({ data: { id: randomUUID(), accountId: account.id, metadata: "{}" }, select: { id: true } });
        const seeded = { accountId: account.id, machineId: machine.id };
        const runId = randomUUID();
        const stale = await accountCurrentness(seeded.accountId);
        await db.account.update({ where: { id: seeded.accountId }, data: { seq: { increment: 1 } } });

        await expect(admitWorkflowRunOwner({
            accountId: seeded.accountId,
            runId,
            origin: { kind: "direct" },
            machineId: seeded.machineId,
            accountCurrentness: stale,
            acceptedEnvelope: encryptedAcceptedEnvelope({ ...seeded, runId }),
        })).resolves.toMatchObject({ kind: "created" });
        await claimRun(runId, seeded.machineId);
        const rootId = randomUUID();
        const initialization = {
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 0,
            accountCurrentness: stale,
            checkpointEnvelope: encryptedCheckpointEnvelope(seeded.accountId, runId, rootId),
            rootInvocation: { id: rootId, contentEnvelope: encryptedProgressEnvelope({ ...seeded, runId, id: rootId }) },
        } as const;
        await expect(initializeWorkflowRunExecutionOwner(initialization))
            .resolves.toMatchObject({ initialization: "created" });

        const rotatedContentKey = new Uint8Array(tweetnacl.box.keyPair().publicKey);
        await db.account.update({
            where: { id: seeded.accountId },
            data: {
                contentPublicKey: rotatedContentKey,
                contentPublicKeySig: signAccountContentKeyBindingV1({ accountSigningSecretKey: signing.secretKey, contentPublicKey: rotatedContentKey }),
            },
        });
        const rejectedRunId = randomUUID();
        await expect(initializeWorkflowRunExecutionOwner(initialization))
            .rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(admitWorkflowRunOwner({
            accountId: seeded.accountId,
            runId: rejectedRunId,
            origin: { kind: "direct" },
            machineId: seeded.machineId,
            accountCurrentness: stale,
            acceptedEnvelope: encryptedAcceptedEnvelope({ ...seeded, runId: rejectedRunId }),
        })).rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(db.automationRun.findUnique({ where: { id: rejectedRunId } })).resolves.toBeNull();
    });

    it("admits caller-bound invocation ids once and rejects conflicting or foreign parents", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct", originSessionId: seeded.sessionId }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId, originSessionId: seeded.sessionId }) });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        const childId = randomUUID();
        const request = {
            accountId: seeded.accountId,
            runId,
            expectedRevision: 1,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 2n),
            invocations: [{ id: childId, sequence: 1n, parentRecordId: rootId, memberOrdinal: 0n, contentEnvelope: progressEnvelope({ ...seeded, runId, id: childId, sequence: 1n, parentRecordId: rootId, memberOrdinal: 0n }) }],
        } as const;
        await expect(admitWorkflowInvocationsWithClaim(request)).resolves.toMatchObject({ disposition: "created", parentRevision: 2, invocations: [{ id: childId, sequence: "1" }] });
        await expect(admitWorkflowInvocationsWithClaim(request)).resolves.toMatchObject({ disposition: "existing", parentRevision: 2, invocations: [{ id: childId, sequence: "1" }] });
        await expect(admitWorkflowInvocationsWithClaim({
            ...request,
            invocations: [{
                ...request.invocations[0],
                memberOrdinal: 1n,
                contentEnvelope: progressEnvelope({ ...seeded, runId, id: childId, sequence: 1n, parentRecordId: rootId, memberOrdinal: 1n }),
            }],
        })).rejects.toMatchObject({ code: "currentness_conflict" });

        const otherRunId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId: otherRunId, origin: { kind: "direct" }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId: otherRunId }) });
        const otherRootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId: otherRunId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, otherRunId, otherRootId, 1n), rootInvocation: { id: otherRootId, contentEnvelope: progressEnvelope({ ...seeded, runId: otherRunId, id: otherRootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        const foreignChildId = randomUUID();
        await expect(admitWorkflowInvocationsWithClaim({ ...request, expectedRevision: 2, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 2n), invocations: [{ id: foreignChildId, sequence: 2n, parentRecordId: otherRootId, memberOrdinal: 1n, contentEnvelope: progressEnvelope({ ...seeded, runId, id: foreignChildId, sequence: 2n, parentRecordId: otherRootId, memberOrdinal: 1n }) }] })).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("atomically resolves an Automation definition body to one accepted snapshot", async () => {
        const seeded = await seed();
        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId,
            name: "Workflow automation",
            targetType: null,
            templateCiphertext: "{}",
        }, select: { id: true } });
        const runId = randomUUID();
        const definitionEnvelope = workflowDefinitionEnvelope();
        await db.automationRun.create({ data: {
            id: runId,
            accountId: seeded.accountId,
            originKind: "automation",
            automationId: automation.id,
            state: "claimed",
            causeKind: "manual",
            causeOccurredAt: new Date(),
            scheduledAt: new Date(),
            dueAt: new Date(),
            claimedByMachineId: seeded.machineId,
            attempt: 3,
            revision: 4,
            executionInputEnvelope: definitionEnvelope,
            workflowCustodyState: "pending",
            assignments: { create: { machineId: seeded.machineId, priority: 0 } },
        } });
        const accepted = acceptedEnvelope({ ...seeded, runId });
        const request = {
            accountId: seeded.accountId,
            runId,
            automationId: automation.id,
            machineId: seeded.machineId,
            expectedAttempt: 3,
            expectedRevision: 4,
            definitionEnvelope,
            acceptedEnvelope: accepted,
        } as const;
        await expect(resolveAutomationWorkflowAcceptedSnapshot(request)).resolves.toMatchObject({ disposition: "created", acceptedEnvelope: accepted, run: { revision: 5 } });
        await expect(resolveAutomationWorkflowAcceptedSnapshot(request)).resolves.toMatchObject({ disposition: "existing", acceptedEnvelope: accepted, run: { revision: 5 } });
        await expect(resolveAutomationWorkflowAcceptedSnapshot({
            ...request,
            acceptedEnvelope: acceptedEnvelope({ ...seeded, runId, permission: "read-only" }),
        })).resolves.toMatchObject({ disposition: "existing", acceptedEnvelope: accepted, run: { revision: 5 } });
        await expect(resolveAutomationWorkflowAcceptedSnapshot({ ...request, machineId: randomUUID() })).rejects.toMatchObject({ code: "currentness_conflict" });
    });

    it("settles Automation-origin workflow success with the incumbent Automation terminal semantics", async () => {
        const seeded = await seed();
        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId,
            name: "Workflow automation",
            targetType: null,
            templateCiphertext: "{}",
        }, select: { id: true } });
        const runId = randomUUID();
        const rootId = randomUUID();
        await db.automationRun.create({ data: {
            id: runId,
            accountId: seeded.accountId,
            originKind: "automation",
            automationId: automation.id,
            state: "claimed",
            causeKind: "manual",
            causeOccurredAt: new Date(),
            scheduledAt: new Date(),
            dueAt: new Date(),
            claimedByMachineId: seeded.machineId,
            attempt: 1,
            executionInputEnvelope: workflowDefinitionEnvelope(),
            workflowAcceptedSnapshotEnvelope: acceptedEnvelope({ ...seeded, runId }),
            workflowCustodyState: "pending",
            assignments: { create: { machineId: seeded.machineId, priority: 0 } },
        } });
        await initializeWorkflowRunExecutionOwner({
            accountId: seeded.accountId,
            accountCurrentness: await accountCurrentness(seeded.accountId),
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 0,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            rootInvocation: {
                id: rootId,
                contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            },
        });
        await commitWorkflowInvocationFact({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            invocationId: rootId,
            invocationAttempt: 0n,
            expectedLifecycle: "pending",
            lifecycle: "completed",
            contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
        });

        await expect(pauseWorkflowRun({
            accountId: seeded.accountId,
            runId,
            expectedRevision: 1,
        })).resolves.toMatchObject({
            intent: "pause_requested",
            run: { state: "pause_requested", revision: 2 },
        });

        await transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 2,
            state: "succeeded",
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            resultEnvelope: finalResultEnvelope(seeded.accountId, runId),
            custodyState: "settled",
        });

        await expect(db.automation.findUniqueOrThrow({ where: { id: automation.id }, select: { lastRunAt: true } }))
            .resolves.toEqual({ lastRunAt: expect.any(Date) });
        await expect(db.automationRunEvent.findMany({ where: { runId }, select: { type: true } }))
            .resolves.toEqual([expect.objectContaining({ type: "run_succeeded" })]);
        await expect(db.accountChange.findFirst({
            where: { accountId: seeded.accountId, kind: "automation", entityId: automation.id },
            select: { entityId: true },
        })).resolves.toEqual({ entityId: automation.id });
    });

    it.each([
        ["failed", "run_failed"],
        ["cancelled", "run_cancelled"],
        ["outcome_uncertain", "run_outcome_uncertain"],
    ] as const)("settles Automation-origin workflow %s with the incumbent Automation terminal semantics", async (state, eventType) => {
        const seeded = await seed();
        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId,
            name: `Workflow automation ${state}`,
            targetType: null,
            templateCiphertext: "{}",
        }, select: { id: true } });
        const runId = randomUUID();
        const rootId = randomUUID();
        await db.automationRun.create({ data: {
            id: runId,
            accountId: seeded.accountId,
            originKind: "automation",
            automationId: automation.id,
            state: "claimed",
            causeKind: "manual",
            causeOccurredAt: new Date(),
            scheduledAt: new Date(),
            dueAt: new Date(),
            claimedByMachineId: seeded.machineId,
            attempt: 1,
            executionInputEnvelope: workflowDefinitionEnvelope(),
            workflowAcceptedSnapshotEnvelope: acceptedEnvelope({ ...seeded, runId }),
            workflowCustodyState: "pending",
            assignments: { create: { machineId: seeded.machineId, priority: 0 } },
        } });
        await initializeWorkflowRunExecutionOwner({
            accountId: seeded.accountId,
            accountCurrentness: await accountCurrentness(seeded.accountId),
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 0,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            rootInvocation: {
                id: rootId,
                contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            },
        });

        await expect(transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 1,
            state,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            custodyState: "settled",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "pending", lifecycle: state }],
        })).resolves.toMatchObject({ state, workflowCustodyState: "settled" });
        await expect(db.automationRunEvent.findMany({ where: { runId }, select: { type: true } }))
            .resolves.toEqual([{ type: eventType }]);
        await expect(db.automation.findUniqueOrThrow({ where: { id: automation.id }, select: { lastRunAt: true } }))
            .resolves.toEqual({ lastRunAt: expect.any(Date) });
        await expect(db.accountChange.findFirst({
            where: { accountId: seeded.accountId, kind: "automation", entityId: automation.id },
            select: { entityId: true },
        })).resolves.toEqual({ entityId: automation.id });
    });

    it.each([
        "succeeded",
        "failed",
        "cancelled",
        "outcome_uncertain",
    ] as const)("keeps a terminal %s workflow Run and its invocation facts immutable", async (terminalState) => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({
            accountId: seeded.accountId,
            runId,
            origin: { kind: "direct" },
            machineId: seeded.machineId,
            acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }),
        });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({
            accountId: seeded.accountId,
            runId,
            expectedRevision: 0,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            rootInvocation: {
                id: rootId,
                contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            },
        });
        await transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 1,
            state: terminalState,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            resultEnvelope: finalResultEnvelope(seeded.accountId, runId, "terminal-result"),
            custodyState: "pending",
        });
        const parentSelect = {
            state: true,
            revision: true,
            workflowCheckpointEnvelope: true,
            resultEnvelope: true,
            finishedAt: true,
            updatedAt: true,
        } as const;
        const invocationSelect = {
            id: true,
            runId: true,
            sequence: true,
            parentRecordId: true,
            memberOrdinal: true,
            attempt: true,
            lifecycle: true,
            contentEnvelope: true,
            createdAt: true,
            updatedAt: true,
        } as const;
        const parentBefore = await db.automationRun.findUniqueOrThrow({ where: { id: runId }, select: parentSelect });
        const invocationBefore = await db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: invocationSelect });
        const rejoinedBefore = await getWorkflowRun({ accountId: seeded.accountId, runId });

        await expect(transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: parentBefore.revision,
            state: "running",
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 2n),
            resultEnvelope: finalResultEnvelope(seeded.accountId, runId, "mutated-result"),
            custodyState: "pending",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "pending", lifecycle: "running" }],
        })).rejects.toMatchObject({ code: "currentness_conflict" });

        await expect(db.automationRun.findUniqueOrThrow({ where: { id: runId }, select: parentSelect }))
            .resolves.toEqual(parentBefore);
        await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: invocationSelect }))
            .resolves.toEqual(invocationBefore);
        await expect(getWorkflowRun({ accountId: seeded.accountId, runId }))
            .resolves.toEqual(rejoinedBefore);
    });

    it("settles exact recovery-shaped terminal custody without replaying Automation terminal effects", async () => {
        const seeded = await seed();
        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId,
            name: "Recovered workflow settlement",
            targetType: null,
            templateCiphertext: "{}",
        }, select: { id: true } });
        const runId = randomUUID();
        const rootId = randomUUID();
        const checkpoint = checkpointEnvelope(seeded.accountId, runId, rootId, 1n);
        await db.automationRun.create({ data: {
            id: runId,
            accountId: seeded.accountId,
            originKind: "automation",
            automationId: automation.id,
            state: "claimed",
            causeKind: "manual",
            causeOccurredAt: new Date(),
            scheduledAt: new Date(),
            dueAt: new Date(),
            claimedByMachineId: seeded.machineId,
            attempt: 1,
            executionInputEnvelope: workflowDefinitionEnvelope(),
            workflowAcceptedSnapshotEnvelope: acceptedEnvelope({ ...seeded, runId }),
            workflowCustodyState: "pending",
            assignments: { create: { machineId: seeded.machineId, priority: 0 } },
        } });
        await initializeWorkflowRunExecutionOwner({
            accountId: seeded.accountId,
            accountCurrentness: await accountCurrentness(seeded.accountId),
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 0,
            checkpointEnvelope: checkpoint,
            rootInvocation: {
                id: rootId,
                contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            },
        });
        await transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 1,
            state: "succeeded",
            checkpointEnvelope: checkpoint,
            custodyState: "pending",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "pending", lifecycle: "completed" }],
        });
        const invocationBeforeSettlement = await db.workflowRunInvocation.findUniqueOrThrow({
            where: { id: rootId },
            select: { lifecycle: true, contentEnvelope: true, updatedAt: true },
        });

        await expect(transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 2,
            state: "succeeded",
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 2n),
            custodyState: "settled",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "completed", lifecycle: "completed" }],
        })).rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 2,
            state: "succeeded",
            checkpointEnvelope: checkpoint,
            custodyState: "settled",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "completed", lifecycle: "needs_attention" }],
        })).rejects.toMatchObject({ code: "currentness_conflict" });

        await expect(transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 2,
            state: "succeeded",
            checkpointEnvelope: checkpoint,
            custodyState: "settled",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "completed", lifecycle: "completed" }],
        })).resolves.toMatchObject({
            state: "succeeded",
            workflowCustodyState: "settled",
            revision: 3,
        });
        await expect(db.automationRun.findUniqueOrThrow({
            where: { id: runId },
            select: { workflowCheckpointEnvelope: true, resultEnvelope: true },
        })).resolves.toEqual({ workflowCheckpointEnvelope: checkpoint, resultEnvelope: null });
        await expect(db.workflowRunInvocation.findUniqueOrThrow({
            where: { id: rootId },
            select: { lifecycle: true, contentEnvelope: true, updatedAt: true },
        })).resolves.toEqual(invocationBeforeSettlement);
        await expect(db.automationRunEvent.findMany({ where: { runId }, select: { type: true } }))
            .resolves.toEqual([{ type: "run_succeeded" }]);
    });

    it.each(["ready", "handingOff"] as const)(
        "retains a terminal workflow Run while reply custody is %s",
        async (replyHandoffState) => {
            const seeded = await seedTerminalWorkflowRunWithReplyCustody(replyHandoffState);

            await expect(deleteWorkflowRun({
                accountId: seeded.accountId,
                runId: seeded.runId,
                expectedRevision: 0,
            })).rejects.toMatchObject({ code: "custody_pending" });
            await expect(db.automationRun.findUnique({ where: { id: seeded.runId }, select: { id: true } }))
                .resolves.toEqual({ id: seeded.runId });
        },
    );

    it.each(["accepted", "suppressed", "blocked"] as const)(
        "deletes a terminal workflow Run after reply custody is %s",
        async (replyHandoffState) => {
            const seeded = await seedTerminalWorkflowRunWithReplyCustody(replyHandoffState);

            await expect(deleteWorkflowRun({
                accountId: seeded.accountId,
                runId: seeded.runId,
                expectedRevision: 0,
            })).resolves.toEqual({ deleted: true, runId: seeded.runId });
            await expect(db.automationRun.findUnique({ where: { id: seeded.runId }, select: { id: true } }))
                .resolves.toBeNull();
        },
    );

    it("reports a stale revision on an otherwise deletable Run as a currentness conflict, not an ineligible state", async () => {
        const seeded = await seedTerminalWorkflowRunWithReplyCustody("accepted");

        await expect(deleteWorkflowRun({
            accountId: seeded.accountId,
            runId: seeded.runId,
            expectedRevision: 7,
        })).rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(db.automationRun.findUnique({ where: { id: seeded.runId }, select: { id: true } }))
            .resolves.toEqual({ id: seeded.runId });
    });

    it.each(["running", "paused", "interrupted"] as const)(
        "rejects settled custody while the workflow parent remains %s",
        async (state) => {
            const seeded = await seed();
            const runId = randomUUID();
            await admitWorkflowRun({
                accountId: seeded.accountId,
                runId,
                origin: { kind: "direct" },
                machineId: seeded.machineId,
                acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }),
            });
            await db.automationRun.update({
                where: { id: runId },
                data: { state, claimedByMachineId: seeded.machineId, attempt: 1 },
            });

            await expect(transitionWorkflowRun({
                accountId: seeded.accountId,
                runId,
                machineId: seeded.machineId,
                parentAttempt: 1,
                expectedRevision: 0,
                state,
                checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, randomUUID(), 1n),
                custodyState: "settled",
            })).rejects.toMatchObject({ code: "currentness_conflict" });
            await expect(db.automationRun.findUniqueOrThrow({
                where: { id: runId },
                select: { state: true, workflowCustodyState: true, revision: true },
            })).resolves.toEqual({ state, workflowCustodyState: "pending", revision: 0 });
        },
    );

    it("allows a terminal workflow transition to settle eligible custody", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({
            accountId: seeded.accountId,
            runId,
            origin: { kind: "direct" },
            machineId: seeded.machineId,
            acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }),
        });
        await db.automationRun.update({
            where: { id: runId },
            data: { state: "running", claimedByMachineId: seeded.machineId, attempt: 1 },
        });

        await expect(transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 0,
            state: "succeeded",
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, randomUUID(), 1n),
            custodyState: "settled",
        })).resolves.toMatchObject({
            state: "succeeded",
            workflowCustodyState: "settled",
            revision: 1,
        });
    });

    it("finds off-page invocation attention and settles direct delivery independently from lifecycle", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct", originSessionId: seeded.sessionId }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId, originSessionId: seeded.sessionId, deliver: true }), resultDelivery: { kind: "originating_session" } });
        await expect(getWorkflowRun({ accountId: seeded.accountId, runId })).resolves.toMatchObject({
            run: {
                availability: {
                    inspectExecution: false,
                    recoverSameConversation: false,
                    recoverFreshAgent: false,
                    retry: false,
                    disabledReasons: expect.arrayContaining([
                        expect.objectContaining({ operation: "inspect_execution", code: "execution_not_admitted" }),
                    ]),
                },
            },
        });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        await expect(getWorkflowRun({ accountId: seeded.accountId, runId })).resolves.toMatchObject({
            run: { availability: { inspectExecution: true } },
        });
        const approvalId = randomUUID();
        await db.workflowRunInvocation.create({ data: { id: approvalId, runId, sequence: 1n, parentRecordId: rootId, memberOrdinal: 0n, attempt: 0n, lifecycle: "waiting_for_approval", contentEnvelope: progressEnvelope({ ...seeded, runId, id: approvalId, sequence: 1n, parentRecordId: rootId, memberOrdinal: 0n }) } });
        const attention = await listWorkflowRuns({ accountId: seeded.accountId, attention: "required", limit: 1, pageByteLimit: 4096 });
        expect(attention.runs.map((run) => run.id)).toContain(runId);
        await expect(waitWorkflowRun({ accountId: seeded.accountId, runId, timeoutSeconds: 1 }))
            .resolves.toMatchObject({ observation: "needs_attention", run: { id: runId } });
        await db.workflowRunInvocation.update({ where: { id: approvalId }, data: { lifecycle: "cancel_requested" } });
        await expect(waitWorkflowRun({ accountId: seeded.accountId, runId, timeoutSeconds: 1 }))
            .resolves.toMatchObject({ observation: "needs_attention", run: { id: runId } });
        // Direct workflow states are broader than the incumbent Automation
        // state machine and must not be parsed by Automation success effects.
        await db.automationRun.update({ where: { id: runId }, data: { state: "interrupted" } });
        await transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 1,
            state: "succeeded",
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 2n),
            resultEnvelope: finalResultEnvelope(seeded.accountId, runId),
            custodyState: "pending",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "pending", lifecycle: "completed" }],
        });
        await expect(settleWorkflowRunResultDelivery({ accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, expectedRevision: 2, state: "accepted" }))
            .rejects.toMatchObject({ code: "currentness_conflict" });
        await db.workflowRunInvocation.update({ where: { id: approvalId }, data: { lifecycle: "completed" } });
        const settled = await settleWorkflowRunResultDelivery({ accountId: seeded.accountId, runId, machineId: seeded.machineId, parentAttempt: 1, expectedRevision: 2, state: "accepted" });
        expect(settled).toMatchObject({ state: "succeeded", workflowCustodyState: "settled", workflowResultDeliveryState: "accepted" });
    });

    it("shortens Run and invocation pages for the complete external Action response envelope", async () => {
        const seeded = await seed();
        const runIds = [randomUUID(), randomUUID(), randomUUID()];
        for (const runId of runIds) {
            await admitWorkflowRun({
                accountId: seeded.accountId,
                runId,
                origin: { kind: "direct" },
                machineId: seeded.machineId,
                acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }),
            });
        }

        const firstRunPage = await listWorkflowRuns({
            accountId: seeded.accountId,
            limit: 1,
            pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
        });
        expect(firstRunPage).toMatchObject({ runs: [expect.any(Object)], nextCursor: expect.any(String) });
        const runPageByteLimit = measureExternalActionResultResponseEnvelopeUtf8BytesV1(firstRunPage);
        const boundedRunPage = await listWorkflowRuns({
            accountId: seeded.accountId,
            pageByteLimit: runPageByteLimit,
        });
        expect(boundedRunPage.runs).toHaveLength(1);
        expect(boundedRunPage.nextCursor).toEqual(expect.any(String));

        const runId = runIds[0]!;
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({
            accountId: seeded.accountId,
            runId,
            expectedRevision: 0,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            rootInvocation: {
                id: rootId,
                contentEnvelope: progressEnvelope({
                    ...seeded,
                    runId,
                    id: rootId,
                    sequence: 0n,
                    parentRecordId: null,
                    memberOrdinal: 0n,
                }),
            },
        });
        for (let sequence = 1n; sequence <= 3n; sequence += 1n) {
            const id = randomUUID();
            await db.workflowRunInvocation.create({
                data: {
                    id,
                    runId,
                    sequence,
                    parentRecordId: rootId,
                    memberOrdinal: sequence - 1n,
                    attempt: 0n,
                    lifecycle: "pending",
                    contentEnvelope: progressEnvelope({
                        ...seeded,
                        runId,
                        id,
                        sequence,
                        parentRecordId: rootId,
                        memberOrdinal: sequence - 1n,
                    }),
                },
            });
        }
        const firstInvocationPage = await listWorkflowRunInvocations({
            accountId: seeded.accountId,
            runId,
            limit: 1,
            pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
        });
        expect(firstInvocationPage).toMatchObject({ invocations: [expect.any(Object)], nextCursor: expect.any(String) });
        const invocationPageByteLimit = measureExternalActionResultResponseEnvelopeUtf8BytesV1(firstInvocationPage);
        const boundedInvocationPage = await listWorkflowRunInvocations({
            accountId: seeded.accountId,
            runId,
            pageByteLimit: invocationPageByteLimit,
        });
        expect(boundedInvocationPage.invocations).toHaveLength(1);
        expect(boundedInvocationPage.nextCursor).toEqual(expect.any(String));

        for (const [actionId, result] of [
            ["workflow.run.list", boundedRunPage],
            ["workflow.run.invocations.list", boundedInvocationPage],
        ] as const) {
            const prepared = prepareExternalActionResponseEnvelopeV1({
                v: 1,
                actionId,
                requestId: "paging-regression",
                execution: { ok: true, result },
            });
            expect(prepared.response.execution).toMatchObject({ ok: true });
            expect(prepared.byteLength).toBeLessThanOrEqual(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES);
        }
    });

    it("keeps multibyte Run and invocation continuation pages inside the incumbent 24 MB Action boundary", () => {
        const maximumMultibyteId = `${"😀".repeat(45)}identifier`;
        const timestamp = "2026-09-12T00:00:00.000Z";
        const run = {
            id: maximumMultibyteId,
            origin: { kind: "automation" as const, automationId: maximumMultibyteId },
            state: "running" as const,
            revision: 1,
            machineId: maximumMultibyteId,
            workflowCustodyState: "pending" as const,
            workflowResultDeliveryState: null,
            availability: {
                pause: true,
                resumeBoundary: false,
                recoverSameConversation: false,
                recoverFreshAgent: false,
                retry: false,
                restoreWorkspace: false,
                cancel: true,
                inspectExecution: true,
                disabledReasons: [],
            },
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        const invocation = {
            id: maximumMultibyteId,
            runId: maximumMultibyteId,
            sequence: "1",
            parentRecordId: maximumMultibyteId,
            memberOrdinal: "1",
            attempt: "0",
            lifecycle: "running" as const,
            createdAt: timestamp,
            updatedAt: timestamp,
        };

        for (const [actionId, row, projectPage] of [
            ["workflow.run.list", run, (rows: readonly unknown[], nextCursor?: string) => ({ runs: rows, ...(nextCursor ? { nextCursor } : {}) })],
            ["workflow.run.invocations.list", invocation, (rows: readonly unknown[], nextCursor?: string) => ({ invocations: rows, ...(nextCursor ? { nextCursor } : {}), parentRevision: 1 })],
        ] as const) {
            const serializedRowBytes = Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
            const candidates = Array.from(
                { length: Math.ceil(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES / serializedRowBytes) + 2 },
                () => row,
            );
            const bounded = appendBoundedPage({
                existing: [],
                existingBytes: 2,
                candidates,
                byteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
                project: (candidate) => candidate,
                projectPage,
                nextCursorFor: () => "opaque-continuation",
                hasMoreAfter: () => true,
            });
            expect(bounded.rows.length).toBeGreaterThan(0);
            expect(bounded.rows.length).toBeLessThan(candidates.length);

            const result = projectPage(bounded.rows, "opaque-continuation");
            const prepared = prepareExternalActionResponseEnvelopeV1({
                v: 1,
                actionId,
                requestId: "😀".repeat(32),
                execution: { ok: true, result },
            });
            expect(prepared.response.execution).toMatchObject({ ok: true });
            expect(prepared.byteLength).toBeLessThanOrEqual(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES);
        }
    });

    it("settles unavailable direct delivery after the originating Session is deleted", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({
            accountId: seeded.accountId,
            runId,
            origin: { kind: "direct", originSessionId: seeded.sessionId },
            machineId: seeded.machineId,
            acceptedEnvelope: acceptedEnvelope({ ...seeded, runId, originSessionId: seeded.sessionId, deliver: true }),
            resultDelivery: { kind: "originating_session" },
        });
        await claimRun(runId, seeded.machineId);
        const rootId = randomUUID();
        await initializeWorkflowRunExecutionOwner({
            accountId: seeded.accountId,
            accountCurrentness: await accountCurrentness(seeded.accountId),
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 0,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            rootInvocation: {
                id: rootId,
                contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            },
        });
        await transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 1,
            state: "succeeded",
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            resultEnvelope: finalResultEnvelope(seeded.accountId, runId),
            custodyState: "pending",
            invocationTransitions: [{ id: rootId, expectedLifecycle: "pending", lifecycle: "completed" }],
        });
        await db.session.delete({ where: { id: seeded.sessionId } });

        await expect(settleWorkflowRunResultDelivery({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 2,
            state: "unavailable",
        })).resolves.toMatchObject({
            origin: { kind: "direct" },
            workflowResultDeliveryState: { kind: "unavailable" },
            workflowCustodyState: "settled",
        });
        await expect(db.workflowRunInvocation.findUnique({ where: { id: rootId }, select: { lifecycle: true } }))
            .resolves.toEqual({ lifecycle: "completed" });
    });

    it("returns exact-machine terminal custody and nonterminal cancellation recovery without generic active Runs", async () => {
        const seeded = await seed();
        const otherMachine = await db.machine.create({
            data: { id: randomUUID(), accountId: seeded.accountId, metadata: "{}" },
            select: { id: true },
        });
        const terminalRunId = randomUUID();
        const activeRunId = randomUUID();
        const quietRunId = randomUUID();
        const otherMachineRunId = randomUUID();
        for (const [runId, machineId] of [
            [terminalRunId, seeded.machineId],
            [activeRunId, seeded.machineId],
            [quietRunId, seeded.machineId],
            [otherMachineRunId, otherMachine.id],
        ] as const) {
            await admitWorkflowRun({
                accountId: seeded.accountId,
                runId,
                origin: { kind: "direct" },
                machineId,
                acceptedEnvelope: acceptedEnvelope({ ...seeded, runId, machineId }),
            });
        }
        await db.automationRun.update({
            where: { id: terminalRunId },
            data: {
                state: "succeeded",
                attempt: 1,
                finishedAt: new Date(),
                workflowResultDeliveryState: "pending",
            },
        });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({
            accountId: seeded.accountId,
            runId: activeRunId,
            expectedRevision: 0,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, activeRunId, rootId, 1n),
            rootInvocation: {
                id: rootId,
                contentEnvelope: progressEnvelope({ ...seeded, runId: activeRunId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            },
        });
        await db.workflowRunInvocation.update({ where: { id: rootId }, data: { lifecycle: "cancel_requested" } });
        await db.automationRun.update({
            where: { id: otherMachineRunId },
            data: { state: "failed", finishedAt: new Date() },
        });

        const first = await listWorkflowRunsForRecovery({
            accountId: seeded.accountId,
            machineId: seeded.machineId,
            limit: 10,
            pageByteLimit: 4_096,
        });
        expect(first.candidates).toHaveLength(2);
        expect(first.candidates.every((candidate) => candidate.parentAttempt === 1)).toBe(true);
        expect(first.nextCursor).toBeUndefined();
        expect(first.candidates.map((candidate) => candidate.run.id).sort())
            .toEqual([activeRunId, terminalRunId].sort());
    });

    it("fails workflow reads closed while the Account encryption state is inconsistent", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({
            accountId: seeded.accountId,
            runId,
            origin: { kind: "direct" },
            machineId: seeded.machineId,
            acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }),
        });
        await db.account.update({
            where: { id: seeded.accountId },
            data: { encryptionMode: "e2ee", contentPublicKey: null, contentPublicKeySig: null },
        });

        await expect(listWorkflowRuns({ accountId: seeded.accountId, pageByteLimit: 4_096 }))
            .rejects.toMatchObject({ code: "content_unavailable" });
        await expect(getWorkflowRun({ accountId: seeded.accountId, runId }))
            .rejects.toMatchObject({ code: "content_unavailable" });
    });

    it("pages newest child attempts before lifecycle filtering and persists cancel intent on active rows", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct" }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }) });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        const childIds = Array.from({ length: 130 }, () => randomUUID());
        const attentionId = randomUUID();
        await db.workflowRunInvocation.createMany({ data: [
            ...childIds.map((id, index) => ({ id, runId, sequence: BigInt(index + 1), parentRecordId: rootId, memberOrdinal: BigInt(index), attempt: 0n, lifecycle: "completed" as const, contentEnvelope: progressEnvelope({ ...seeded, runId, id, sequence: BigInt(index + 1), parentRecordId: rootId, memberOrdinal: BigInt(index) }) })),
            { id: attentionId, runId, sequence: 131n, parentRecordId: rootId, memberOrdinal: 130n, attempt: 0n, lifecycle: "waiting_for_approval" as const, contentEnvelope: progressEnvelope({ ...seeded, runId, id: attentionId, sequence: 131n, parentRecordId: rootId, memberOrdinal: 130n }) },
        ] });
        const page = await listWorkflowRunInvocations({ accountId: seeded.accountId, runId, parentRecordId: rootId, lifecycles: ["waiting_for_approval"], limit: 1, pageByteLimit: 4096 });
        expect(page.invocations).toEqual([expect.objectContaining({ memberOrdinal: "130", lifecycle: "waiting_for_approval" })]);
        expect(page.nextCursor).toBeUndefined();

        const cancelled = await cancelWorkflowRun({ accountId: seeded.accountId, runId, expectedRevision: 1 });
        expect(cancelled).toMatchObject({ intent: "cancel_requested", run: { state: "running", revision: 2 } });
        expect(await db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: { lifecycle: true } })).toEqual({ lifecycle: "cancel_requested" });
    });

    it("settles cancellation before root admission and prevents a later launch", async () => {
        const seeded = await seed();
        const directRunId = randomUUID();
        await admitWorkflowRun({
            accountId: seeded.accountId,
            runId: directRunId,
            origin: { kind: "direct", originSessionId: seeded.sessionId },
            machineId: seeded.machineId,
            acceptedEnvelope: acceptedEnvelope({ ...seeded, runId: directRunId, originSessionId: seeded.sessionId, deliver: true }),
            resultDelivery: { kind: "originating_session" },
        });
        await expect(cancelWorkflowRun({ accountId: seeded.accountId, runId: directRunId, expectedRevision: 0 }))
            .resolves.toMatchObject({
                intent: "cancelled",
                run: {
                    state: "cancelled",
                    workflowCustodyState: "settled",
                    workflowResultDeliveryState: { kind: "unavailable" },
                },
            });

        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId,
            name: "Claimed workflow cancellation",
            targetType: null,
            templateCiphertext: "{}",
        }, select: { id: true } });
        const claimedRunId = randomUUID();
        await db.automationRun.create({ data: {
            id: claimedRunId,
            accountId: seeded.accountId,
            originKind: "automation",
            automationId: automation.id,
            state: "claimed",
            causeKind: "manual",
            causeOccurredAt: new Date(),
            scheduledAt: new Date(),
            dueAt: new Date(),
            claimedByMachineId: seeded.machineId,
            attempt: 1,
            executionInputEnvelope: workflowDefinitionEnvelope(),
            workflowAcceptedSnapshotEnvelope: acceptedEnvelope({ ...seeded, runId: claimedRunId }),
            workflowCustodyState: "pending",
            assignments: { create: { machineId: seeded.machineId, priority: 0 } },
        } });
        const cancelled = await cancelWorkflowRun({ accountId: seeded.accountId, runId: claimedRunId, expectedRevision: 0 });
        expect(cancelled).toMatchObject({
            intent: "cancelled",
            run: { state: "cancelled", workflowCustodyState: "settled" },
        });
        await expect(db.automationRunEvent.findMany({ where: { runId: claimedRunId }, select: { type: true } }))
            .resolves.toEqual([{ type: "run_cancelled" }]);
        const lateRootId = randomUUID();
        await expect(initializeWorkflowRunExecutionOwner({
            accountId: seeded.accountId,
            accountCurrentness: await accountCurrentness(seeded.accountId),
            runId: claimedRunId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: cancelled.run.revision,
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, claimedRunId, lateRootId, 1n),
            rootInvocation: {
                id: lateRootId,
                contentEnvelope: progressEnvelope({ ...seeded, runId: claimedRunId, id: lateRootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            },
        })).rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(db.workflowRunInvocation.count({ where: { runId: claimedRunId } })).resolves.toBe(0);
    });

    it("does not let cancellation mutate any terminal parent with pending custody", async () => {
        const seeded = await seed();
        for (const terminalState of AUTOMATION_RUN_TERMINAL_STATES) {
            const runId = randomUUID();
            await admitWorkflowRun({
                accountId: seeded.accountId,
                runId,
                origin: { kind: "direct" },
                machineId: seeded.machineId,
                acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }),
            });
            const rootId = randomUUID();
            await initializeWorkflowRunExecution({
                accountId: seeded.accountId,
                runId,
                expectedRevision: 0,
                checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
                rootInvocation: {
                    id: rootId,
                    contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
                },
            });
            await db.automationRun.update({
                where: { id: runId },
                data: { state: terminalState, finishedAt: new Date() },
            });
            await db.workflowRunInvocation.update({
                where: { id: rootId },
                data: { lifecycle: "needs_attention" },
            });

            await expect(cancelWorkflowRun({ accountId: seeded.accountId, runId, expectedRevision: 1 }))
                .rejects.toMatchObject({ code: "currentness_conflict" });
            await expect(db.automationRun.findUniqueOrThrow({ where: { id: runId }, select: { state: true, revision: true } }))
                .resolves.toEqual({ state: terminalState, revision: 1 });
            await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: { lifecycle: true } }))
                .resolves.toEqual({ lifecycle: "needs_attention" });
        }
    });

    it("routes retained Automation cancellation through Workflow invocation custody", async () => {
        const seeded = await seed();
        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId,
            name: "Workflow cancellation compatibility",
            targetType: null,
            templateCiphertext: "{}",
        }, select: { id: true } });
        for (const requireV2RunRepresentability of [undefined, true] as const) {
            const runId = randomUUID();
            const rootId = randomUUID();
            await db.automationRun.create({ data: {
                id: runId,
                accountId: seeded.accountId,
                originKind: "automation",
                automationId: automation.id,
                state: "running",
                causeKind: "manual",
                causeOccurredAt: new Date(),
                scheduledAt: new Date(),
                dueAt: new Date(),
                claimedByMachineId: seeded.machineId,
                attempt: 1,
                executionInputEnvelope: workflowDefinitionEnvelope(),
                workflowAcceptedSnapshotEnvelope: acceptedEnvelope({ ...seeded, runId }),
                workflowCheckpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
                workflowCustodyState: "pending",
                assignments: { create: { machineId: seeded.machineId, priority: 0 } },
                workflowInvocations: { create: {
                    id: rootId,
                    sequence: 0n,
                    parentRecordId: null,
                    memberOrdinal: 0n,
                    attempt: 0n,
                    lifecycle: "needs_attention",
                    contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
                } },
            } });

            await expect(cancelAutomationRun({
                accountId: seeded.accountId,
                runId,
                ...(requireV2RunRepresentability ? { requireV2RunRepresentability } : {}),
            })).resolves.toMatchObject({ id: runId, state: "running", revision: 1, workflowCustodyState: "pending" });
            await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: { lifecycle: true } }))
                .resolves.toEqual({ lifecycle: "cancel_requested" });
        }

        const interruptedRunId = randomUUID();
        const interruptedRootId = randomUUID();
        await db.automationRun.create({ data: {
            id: interruptedRunId,
            accountId: seeded.accountId,
            originKind: "automation",
            automationId: automation.id,
            state: "interrupted",
            causeKind: "manual",
            causeOccurredAt: new Date(),
            scheduledAt: new Date(),
            dueAt: new Date(),
            claimedByMachineId: seeded.machineId,
            attempt: 1,
            executionInputEnvelope: workflowDefinitionEnvelope(),
            workflowAcceptedSnapshotEnvelope: acceptedEnvelope({ ...seeded, runId: interruptedRunId }),
            workflowCheckpointEnvelope: checkpointEnvelope(seeded.accountId, interruptedRunId, interruptedRootId, 1n),
            workflowCustodyState: "pending",
            assignments: { create: { machineId: seeded.machineId, priority: 0 } },
            workflowInvocations: { create: {
                id: interruptedRootId,
                sequence: 0n,
                parentRecordId: null,
                memberOrdinal: 0n,
                attempt: 0n,
                lifecycle: "needs_attention",
                contentEnvelope: progressEnvelope({ ...seeded, runId: interruptedRunId, id: interruptedRootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
            } },
        } });
        await expect(cancelAutomationRun({
            accountId: seeded.accountId,
            runId: interruptedRunId,
            requireV2RunRepresentability: true,
        })).resolves.toBeNull();
        await expect(db.automationRun.findUniqueOrThrow({ where: { id: interruptedRunId }, select: { revision: true } }))
            .resolves.toEqual({ revision: 0 });
        await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: interruptedRootId }, select: { lifecycle: true } }))
            .resolves.toEqual({ lifecycle: "needs_attention" });
    });

    it("settles a paused Automation workflow cancellation through Automation terminal effects", async () => {
        const seeded = await seed();
        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId,
            name: "Paused workflow cancellation",
            targetType: null,
            templateCiphertext: "{}",
        }, select: { id: true } });
        const runId = randomUUID();
        await db.automationRun.create({ data: {
            id: runId,
            accountId: seeded.accountId,
            originKind: "automation",
            automationId: automation.id,
            state: "paused",
            causeKind: "manual",
            causeOccurredAt: new Date(),
            scheduledAt: new Date(),
            dueAt: new Date(),
            claimedByMachineId: seeded.machineId,
            attempt: 1,
            executionInputEnvelope: workflowDefinitionEnvelope(),
            workflowAcceptedSnapshotEnvelope: acceptedEnvelope({ ...seeded, runId }),
            workflowCheckpointEnvelope: checkpointEnvelope(seeded.accountId, runId, randomUUID(), 1n),
            workflowCustodyState: "pending",
            assignments: { create: { machineId: seeded.machineId, priority: 0 } },
        } });

        await expect(cancelWorkflowRun({ accountId: seeded.accountId, runId, expectedRevision: 0 }))
            .resolves.toMatchObject({
                intent: "cancelled",
                run: { state: "cancelled", workflowCustodyState: "settled" },
            });
        await expect(db.automationRunEvent.findMany({ where: { runId }, select: { type: true } }))
            .resolves.toEqual([{ type: "run_cancelled" }]);
    });

    it("uses the parent revision as the retry CAS", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct" }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }) });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        await db.workflowRunInvocation.update({ where: { id: rootId }, data: { lifecycle: "failed" } });
        await db.automationRun.update({ where: { id: runId }, data: { state: "interrupted" } });
        const retryId = randomUUID();
        const retryRequest = { accountId: seeded.accountId, runId, expectedRevision: 1, invocationId: rootId, newInvocationId: retryId, newSequence: 99n, contentEnvelope: progressEnvelope({ ...seeded, runId, id: retryId, sequence: 1n, parentRecordId: null, memberOrdinal: 0n, attempt: 1n, previousAttemptRecordId: rootId, logicalInvocationRecordId: rootId }) } as const;
        await expect(retryWorkflowInvocation(retryRequest)).resolves.toMatchObject({ disposition: "accepted", run: { revision: 2 }, invocation: { sequence: "1", attempt: "1" } });
        await expect(retryWorkflowInvocation(retryRequest)).resolves.toMatchObject({ disposition: "existing", run: { revision: 2 }, invocation: { id: retryId } });
        await expect(retryWorkflowInvocation({ ...retryRequest, newInvocationId: randomUUID(), newSequence: 2n, expectedRevision: 2 }))
            .rejects.toMatchObject({ code: "ineligible_state" });
        const staleRetryId = randomUUID();
        await expect(retryWorkflowInvocation({ accountId: seeded.accountId, runId, expectedRevision: 1, invocationId: rootId, newInvocationId: staleRetryId, newSequence: 2n, contentEnvelope: progressEnvelope({ ...seeded, runId, id: staleRetryId, sequence: 2n, parentRecordId: null, memberOrdinal: 0n, attempt: 1n, previousAttemptRecordId: rootId, logicalInvocationRecordId: rootId }) })).rejects.toMatchObject({ code: "currentness_conflict" });
    });

    it("does not let acknowledgement replace an invocation whose outcome may still be active", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct" }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }) });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        await db.workflowRunInvocation.update({ where: { id: rootId }, data: { lifecycle: "outcome_uncertain" } });
        await db.automationRun.update({ where: { id: runId }, data: { state: "interrupted" } });
        const retryId = randomUUID();

        await expect(retryWorkflowInvocation({ accountId: seeded.accountId, runId, expectedRevision: 1, invocationId: rootId, newInvocationId: retryId, newSequence: 1n,
            contentEnvelope: progressEnvelope({ ...seeded, runId, id: retryId, sequence: 1n, parentRecordId: null, memberOrdinal: 0n, attempt: 1n, previousAttemptRecordId: rootId, logicalInvocationRecordId: rootId }) }))
            .rejects.toMatchObject({ code: "ineligible_state" });

        await expect(transitionWorkflowRun({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            expectedRevision: 1,
            state: "outcome_uncertain",
            checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n),
            custodyState: "settled",
        })).rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(deleteWorkflowRun({ accountId: seeded.accountId, runId, expectedRevision: 1 }))
            .rejects.toMatchObject({ code: "custody_pending" });

        const reconciledEnvelope = progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n, reason: "observed-stopped" });
        await expect(commitWorkflowInvocationFact({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            invocationId: rootId,
            invocationAttempt: 0n,
            expectedLifecycle: "outcome_uncertain",
            lifecycle: "outcome_uncertain",
            contentEnvelope: reconciledEnvelope,
        })).rejects.toMatchObject({ code: "currentness_conflict" });
        const stoppedResolution: Parameters<typeof commitWorkflowInvocationFact>[0] = {
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            invocationId: rootId,
            invocationAttempt: 0n,
            expectedLifecycle: "outcome_uncertain",
            lifecycle: "needs_attention",
            contentEnvelope: reconciledEnvelope,
            resolution: "observed_terminal_execution" as const,
        };
        await expect(commitWorkflowInvocationFact(stoppedResolution)).resolves.toMatchObject({ lifecycle: "needs_attention" });
        await expect(commitWorkflowInvocationFact(stoppedResolution)).resolves.toMatchObject({ lifecycle: "needs_attention" });
        await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: { lifecycle: true, contentEnvelope: true } }))
            .resolves.toEqual({ lifecycle: "needs_attention", contentEnvelope: reconciledEnvelope });
        await expect(retryWorkflowInvocation({ accountId: seeded.accountId, runId, expectedRevision: 1, invocationId: rootId, newInvocationId: retryId, newSequence: 1n,
            contentEnvelope: progressEnvelope({ ...seeded, runId, id: retryId, sequence: 1n, parentRecordId: null, memberOrdinal: 0n, attempt: 1n, previousAttemptRecordId: rootId, logicalInvocationRecordId: rootId }) }))
            .resolves.toMatchObject({ disposition: "accepted", invocation: { attempt: "1" } });
    });

    it("keeps interrupted cancellation in stop custody instead of acknowledging terminal cancellation", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct" }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }) });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        await db.workflowRunInvocation.update({ where: { id: rootId }, data: { lifecycle: "needs_attention" } });
        await db.automationRun.update({ where: { id: runId }, data: { state: "interrupted" } });

        await expect(cancelWorkflowRun({ accountId: seeded.accountId, runId, expectedRevision: 1 }))
            .resolves.toMatchObject({ intent: "cancel_requested", run: { state: "interrupted" } });
        await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: { lifecycle: true } }))
            .resolves.toEqual({ lifecycle: "cancel_requested" });
    });

    it("rejects a late row fact from an attempt superseded by retry", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct" }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }) });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 1n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        await db.automationRun.update({ where: { id: runId }, data: { claimedByMachineId: seeded.machineId, attempt: 1 } });
        await db.workflowRunInvocation.update({ where: { id: rootId }, data: { lifecycle: "failed" } });
        await db.automationRun.update({ where: { id: runId }, data: { state: "interrupted" } });
        const retryId = randomUUID();
        await retryWorkflowInvocation({ accountId: seeded.accountId, runId, expectedRevision: 1, invocationId: rootId, newInvocationId: retryId, newSequence: 1n, contentEnvelope: progressEnvelope({ ...seeded, runId, id: retryId, sequence: 1n, parentRecordId: null, memberOrdinal: 0n, attempt: 1n, previousAttemptRecordId: rootId, logicalInvocationRecordId: rootId }) });

        await expect(commitWorkflowInvocationFact({
            accountId: seeded.accountId,
            runId,
            machineId: seeded.machineId,
            parentAttempt: 1,
            invocationId: rootId,
            invocationAttempt: 0n,
            expectedLifecycle: "superseded",
            lifecycle: "completed",
            contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }),
        })).rejects.toMatchObject({ code: "currentness_conflict" });
        await expect(db.workflowRunInvocation.findUniqueOrThrow({ where: { id: rootId }, select: { lifecycle: true } }))
            .resolves.toEqual({ lifecycle: "superseded" });
        await expect(db.automationRun.findUniqueOrThrow({ where: { id: runId }, select: { revision: true } }))
            .resolves.toEqual({ revision: 2 });
    });

    it("recovers several interrupted invocations in one rejoinable parent CAS", async () => {
        const seeded = await seed();
        const runId = randomUUID();
        await admitWorkflowRun({ accountId: seeded.accountId, runId, origin: { kind: "direct" }, machineId: seeded.machineId, acceptedEnvelope: acceptedEnvelope({ ...seeded, runId }) });
        const rootId = randomUUID();
        await initializeWorkflowRunExecution({ accountId: seeded.accountId, runId, expectedRevision: 0, checkpointEnvelope: checkpointEnvelope(seeded.accountId, runId, rootId, 3n), rootInvocation: { id: rootId, contentEnvelope: progressEnvelope({ ...seeded, runId, id: rootId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n }) } });
        const previousIds = [randomUUID(), randomUUID()];
        await db.workflowRunInvocation.createMany({ data: previousIds.map((id, index) => ({
            id, runId, sequence: BigInt(index + 1), parentRecordId: rootId, memberOrdinal: BigInt(index), attempt: 0n,
            lifecycle: "needs_attention" as const,
            contentEnvelope: progressEnvelope({ ...seeded, runId, id, sequence: BigInt(index + 1), parentRecordId: rootId, memberOrdinal: BigInt(index) }),
        })) });
        await db.automationRun.update({ where: { id: runId }, data: { state: "interrupted" } });
        const newIds = [randomUUID(), randomUUID()];
        const request = {
            accountId: seeded.accountId,
            runId,
            expectedRevision: 1,
            recoveries: newIds.map((newInvocationId, index) => ({
                invocationId: previousIds[index]!,
                newInvocationId,
                newSequence: BigInt(index + 3),
                contentEnvelope: progressEnvelope({ ...seeded, runId, id: newInvocationId, sequence: BigInt(index + 3), parentRecordId: rootId, memberOrdinal: BigInt(index), attempt: 1n, previousAttemptRecordId: previousIds[index]!, logicalInvocationRecordId: previousIds[index]! }),
            })),
        } as const;
        await expect(recoverWorkflowInvocations(request)).resolves.toMatchObject({ disposition: "accepted", run: { revision: 2, state: "queued" }, invocations: [{ id: newIds[0] }, { id: newIds[1] }] });
        await expect(recoverWorkflowInvocations(request)).resolves.toMatchObject({ disposition: "existing", run: { revision: 2 } });
    });
});
