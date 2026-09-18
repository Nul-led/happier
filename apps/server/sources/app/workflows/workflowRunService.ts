import {
    AutomationRunStateV3Schema,
    decodeKeysetCursorV1,
    encodeKeysetCursorV1,
    measureExternalActionResultResponseEnvelopeUtf8BytesV1,
    projectWorkflowBigIntV1,
    readKeysetCursorIdV1,
    readKeysetCursorTextV1,
    projectAutomationAccountCurrentnessWitnessV1,
    sameAutomationAccountContentIdentityV1,
    type AutomationAccountCurrentnessWitnessV1,
    type WorkflowInvocationLifecycleV1,
    type WorkflowRunOriginV1,
    type WorkflowRunSummaryV1,
} from "@happier-dev/protocol";
import { isWorkflowResultDeliveryUnavailableV1 } from "@happier-dev/protocol/workflows";
import type { Prisma } from "@prisma/client";

import { markAccountChanged } from "@/app/changes/markAccountChanged";
import { emitAutomationRunUpdatedToMachineOnly } from "@/app/automations/automationChangePublisher";
import { acquireAccountEncryptionTransitionFenceInTx } from "@/app/encryption/accountEncryptionTransition";
import { automationRunCustodyTerminalWhere } from "@/app/automations/automationCrudService";
import { AUTOMATION_RUN_TERMINAL_STATES } from "@/app/automations/automationTypes";
import { applyAutomationRunTerminalEffectsTx } from "@/app/automations/automationRunSucceeded";
import { validateAutomationStoredContentEnvelopeOuterForMode } from "@/app/automations/automationStoredContentRead";
import { db } from "@/storage/db";
import { afterTx, inTx, type Tx } from "@/storage/inTx";
import { isPrismaErrorCode } from "@/storage/prisma";

import { assertWorkflowStoredEnvelopeOuterForMode } from "./runs/storedContent";

type WorkflowRunState = WorkflowRunSummaryV1["state"];
type WorkflowCustodyState = "pending" | "settled";
const MAX_DATABASE_BIGINT = 9_223_372_036_854_775_807n;
// A continuation cursor, rather than an unbounded SQL `take`, carries reads
// that need more rows. This is an internal fetch bound, not a workflow quota.
const WORKFLOW_PAGE_DATABASE_BATCH_ROWS = 128;

function automationPreviousStateForWorkflowTerminalEffects(state: WorkflowRunState) {
    const automationState = state === "pause_requested" || state === "paused" || state === "interrupted"
        // These are Workflow-only control states. Automation terminal effects
        // observe the underlying physical Run as having been active.
        ? "running"
        : state;
    const parsed = AutomationRunStateV3Schema.safeParse(automationState);
    if (!parsed.success) throw new WorkflowRunServiceError("currentness_conflict");
    return parsed.data;
}

function isWorkflowUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class WorkflowRunServiceError extends Error {
    constructor(readonly code: "invalid_input" | "target_unavailable" | "run_not_found" | "currentness_conflict" | "ineligible_state" | "custody_pending" | "content_unavailable") {
        super(code);
        this.name = "WorkflowRunServiceError";
    }
}

const workflowRunSelect = {
    id: true,
    accountId: true,
    originKind: true,
    automationId: true,
    originSessionId: true,
    state: true,
    revision: true,
    attempt: true,
    claimedByMachineId: true,
    workflowCustodyState: true,
    workflowResultDeliveryState: true,
    workflowAcceptedSnapshotEnvelope: true,
    executionInputEnvelope: true,
    workflowCheckpointEnvelope: true,
    resultEnvelope: true,
    scheduledAt: true,
    startedAt: true,
    finishedAt: true,
    createdAt: true,
    updatedAt: true,
    assignments: { orderBy: { priority: "asc" as const }, take: 1, select: { machineId: true } },
    workflowInvocations: { take: 1, select: { id: true } },
} satisfies Prisma.AutomationRunSelect;

type PersistedWorkflowRunSelection = Prisma.AutomationRunGetPayload<{
    select: typeof workflowRunSelect;
}>;
type WorkflowRunRow = Omit<
    PersistedWorkflowRunSelection,
    "state" | "workflowResultDeliveryState"
> & {
    state: WorkflowRunState;
    workflowResultDeliveryState: "pending" | "accepted" | "unavailable" | "workflow_outcome_unresolved" | null;
};

export function deriveWorkflowRunAvailability(input: Readonly<{
    state: WorkflowRunState;
    workflowCustodyState: WorkflowCustodyState | null;
    hasExecution: boolean;
    hasCheckpoint: boolean;
}>): WorkflowRunSummaryV1["availability"] {
    const { state, workflowCustodyState, hasExecution, hasCheckpoint } = input;
    const terminal = AUTOMATION_RUN_TERMINAL_STATES.some((candidate) => candidate === state);
    const pause = workflowCustodyState === "pending"
        && (state === "queued" || state === "claimed" || state === "running");
    const resumeBoundary = state === "paused" && hasCheckpoint;
    const restoreWorkspace = state === "interrupted" && hasExecution;
    const cancel = !terminal && workflowCustodyState === "pending";
    const disabledReasons: WorkflowRunSummaryV1["availability"]["disabledReasons"] = [];
    if (!pause) disabledReasons.push({ operation: "pause", code: terminal ? "run_terminal" : "ineligible_state" });
    if (!resumeBoundary) disabledReasons.push({ operation: "resume_boundary", code: state === "paused" ? "checkpoint_unavailable" : "ineligible_state" });
    disabledReasons.push(
        { operation: "recover_same_conversation", code: "private_recovery_evidence_required" },
        { operation: "recover_fresh_agent", code: "private_recovery_evidence_required" },
        { operation: "retry", code: "private_recovery_evidence_required" },
    );
    if (!restoreWorkspace) disabledReasons.push({ operation: "restore_workspace", code: hasExecution ? "ineligible_state" : "execution_not_admitted" });
    if (!cancel) disabledReasons.push({ operation: "cancel", code: terminal ? "run_terminal" : "custody_settled" });
    if (!hasExecution) disabledReasons.push({ operation: "inspect_execution", code: "execution_not_admitted" });
    return {
        pause,
        resumeBoundary,
        recoverSameConversation: false,
        recoverFreshAgent: false,
        retry: false,
        restoreWorkspace,
        cancel,
        inspectExecution: hasExecution,
        disabledReasons,
    };
}

function availability(row: WorkflowRunRow): WorkflowRunSummaryV1["availability"] {
    return deriveWorkflowRunAvailability({
        state: row.state as WorkflowRunState,
        workflowCustodyState: row.workflowCustodyState,
        hasExecution: row.workflowInvocations.length > 0,
        hasCheckpoint: row.workflowCheckpointEnvelope !== null,
    });
}

function projectRun(row: WorkflowRunRow): WorkflowRunSummaryV1 {
    const machineId = row.assignments[0]?.machineId;
    if (!machineId) throw new WorkflowRunServiceError("content_unavailable");
    const state = row.state as WorkflowRunState;
    const origin: WorkflowRunOriginV1 = row.originKind === "automation" && row.automationId
        ? { kind: "automation", automationId: row.automationId }
        : { kind: "direct", ...(row.originSessionId !== null ? { originSessionId: row.originSessionId } : {}) };
    const workflowResultDeliveryState: WorkflowRunSummaryV1["workflowResultDeliveryState"] =
        row.workflowResultDeliveryState === "unavailable"
            ? { kind: "unavailable" }
            : row.workflowResultDeliveryState === "workflow_outcome_unresolved"
                ? { kind: "unavailable", reason: "workflow_outcome_unresolved" }
                : row.workflowResultDeliveryState;
    return {
        id: row.id,
        origin,
        state,
        revision: row.revision,
        machineId,
        workflowCustodyState: row.workflowCustodyState,
        workflowResultDeliveryState,
        availability: availability(row),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

async function loadAccountModeTx(tx: Tx, accountId: string): Promise<"plain" | "e2ee"> {
    const fence = await acquireAccountEncryptionTransitionFenceInTx(tx, accountId);
    if (fence.status !== "ready") {
        throw new WorkflowRunServiceError("content_unavailable");
    }
    return fence.account.currentness.encryptionMode;
}

async function loadCurrentWorkflowAccountModeTx(
    tx: Tx,
    accountId: string,
    supplied: AutomationAccountCurrentnessWitnessV1,
): Promise<"plain" | "e2ee"> {
    const fence = await acquireAccountEncryptionTransitionFenceInTx(tx, accountId);
    if (fence.status !== "ready") throw new WorkflowRunServiceError("content_unavailable");
    const current = projectAutomationAccountCurrentnessWitnessV1({
        mode: fence.account.currentness.encryptionMode,
        version: fence.account.version,
        contentKeyFingerprint: fence.account.contentKeyFingerprint,
    });
    if (!current || !sameAutomationAccountContentIdentityV1(supplied, current)) {
        throw new WorkflowRunServiceError("currentness_conflict");
    }
    return current.mode;
}

async function markWorkflowRunChangedTx(tx: Tx, accountId: string, runId: string): Promise<void> {
    await markAccountChanged(tx, { accountId, kind: "account", entityId: `workflow-run:${runId}` });
}

export type AdmitWorkflowRunInput = Readonly<{
    accountId: string;
    runId: string;
    origin: WorkflowRunOriginV1;
    machineId: string;
    acceptedEnvelope: string;
    accountCurrentness: AutomationAccountCurrentnessWitnessV1;
    resultDelivery?: Readonly<{ kind: "originating_session" }>;
}>;

function isExactWorkflowAdmission(row: WorkflowRunRow, params: AdmitWorkflowRunInput): boolean {
    const sameOrigin = params.origin.kind === "automation"
        ? row.originKind === "automation" && row.automationId === params.origin.automationId && row.originSessionId === null
        : row.originKind === "direct" && row.automationId === null && row.originSessionId === (params.origin.originSessionId ?? null);
    const sameDelivery = params.resultDelivery === undefined
        ? row.workflowResultDeliveryState === null
        : row.workflowResultDeliveryState !== null;
    return row.workflowCustodyState !== null
        && row.workflowAcceptedSnapshotEnvelope === params.acceptedEnvelope
        && row.assignments[0]?.machineId === params.machineId
        && sameOrigin
        && sameDelivery;
}

export async function admitWorkflowRunTx(tx: Tx, params: AdmitWorkflowRunInput): Promise<{ kind: "created" | "existing"; run: WorkflowRunSummaryV1 }> {
        if (params.origin.kind === "direct" && !isWorkflowUuid(params.runId)) {
            throw new WorkflowRunServiceError("invalid_input");
        }
        const existing = await tx.automationRun.findUnique({ where: { id: params.runId }, select: workflowRunSelect });
        if (existing) {
            if (existing.accountId !== params.accountId) throw new WorkflowRunServiceError("currentness_conflict");
            if (!isExactWorkflowAdmission(existing as WorkflowRunRow, params)) throw new WorkflowRunServiceError("currentness_conflict");
            const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
            assertWorkflowStoredEnvelopeOuterForMode({ raw: existing.workflowAcceptedSnapshotEnvelope!, mode, binding: { v: 1, purpose: "accepted_snapshot", accountId: params.accountId, runId: params.runId } });
            return { kind: "existing", run: projectRun(existing as WorkflowRunRow) };
        }
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.acceptedEnvelope, mode, binding: { v: 1, purpose: "accepted_snapshot", accountId: params.accountId, runId: params.runId } });
        const machine = await tx.machine.findFirst({ where: { id: params.machineId, accountId: params.accountId, revokedAt: null }, select: { id: true } });
        if (!machine) throw new WorkflowRunServiceError("target_unavailable");
        if (params.origin.kind === "automation") {
            if (params.resultDelivery !== undefined) throw new WorkflowRunServiceError("invalid_input");
            const automation = await tx.automation.findFirst({ where: { id: params.origin.automationId, accountId: params.accountId }, select: { id: true } });
            if (!automation) throw new WorkflowRunServiceError("invalid_input");
        } else if (params.origin.originSessionId) {
            const session = await tx.session.findFirst({ where: { id: params.origin.originSessionId, accountId: params.accountId }, select: { id: true } });
            if (!session) throw new WorkflowRunServiceError("invalid_input");
        } else if (params.resultDelivery !== undefined) {
            throw new WorkflowRunServiceError("invalid_input");
        }
        const now = new Date();
        const row = await tx.automationRun.create({
                data: {
                    id: params.runId,
                    accountId: params.accountId,
                    originKind: params.origin.kind,
                    automationId: params.origin.kind === "automation" ? params.origin.automationId : null,
                    originSessionId: params.origin.kind === "direct" ? params.origin.originSessionId : null,
                    causeKind: params.origin.kind === "automation" ? "manual" : null,
                    causeOccurredAt: params.origin.kind === "automation" ? now : null,
                    state: "queued",
                    scheduledAt: now,
                    dueAt: now,
                    workflowAcceptedSnapshotEnvelope: params.acceptedEnvelope,
                    // The Automation claim corridor reads the frozen program
                    // from executionInputEnvelope for both origins. Direct
                    // admission therefore materializes the same immutable bytes
                    // at that incumbent claim boundary; it is not a second
                    // mutable definition pointer.
                    executionInputEnvelope: params.acceptedEnvelope,
                    workflowCheckpointEnvelope: null,
                    workflowCustodyState: "pending",
                    workflowResultDeliveryState: params.resultDelivery ? "pending" : null,
                    assignments: { create: { machineId: params.machineId, priority: 0 } },
                },
                select: workflowRunSelect,
            });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return { kind: "created", run: projectRun(row as WorkflowRunRow) };
}

export async function admitWorkflowRun(params: AdmitWorkflowRunInput): Promise<{ kind: "created" | "existing"; run: WorkflowRunSummaryV1 }> {
    try {
        return await inTx(async (tx) => await admitWorkflowRunTx(tx, params));
    } catch (error) {
        if (!isPrismaErrorCode(error, "P2002")) throw error;
        return await inTx(async (tx) => await admitWorkflowRunTx(tx, params));
    }
}

/** Adds the frozen Automation definition body to a parent created by canonical Automation admission. */
export async function attachAutomationWorkflowBodyTx(tx: Tx, params: Readonly<{
    accountId: string; runId: string; automationId: string; definitionEnvelope: string;
}>): Promise<WorkflowRunSummaryV1> {
    const mode = await loadAccountModeTx(tx, params.accountId);
    const definitionOuter = validateAutomationStoredContentEnvelopeOuterForMode({ raw: params.definitionEnvelope, mode });
    if (definitionOuter.kind !== "available") throw new WorkflowRunServiceError(definitionOuter.kind === "modeMismatch" ? "content_unavailable" : "invalid_input");
    const changed = await tx.automationRun.updateMany({
        where: {
            id: params.runId,
            accountId: params.accountId,
            automationId: params.automationId,
            originKind: "automation",
            workflowCustodyState: null,
            workflowAcceptedSnapshotEnvelope: null,
            assignments: { some: {} },
        },
        data: {
            executionInputEnvelope: params.definitionEnvelope,
            workflowCustodyState: "pending",
        },
    });
    if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
    const row = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
    await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
    return projectRun(row as WorkflowRunRow);
}

/** Freezes resolved Automation inputs once, before any root or effect is admitted. */
export async function resolveAutomationWorkflowAcceptedSnapshot(params: Readonly<{
    accountId: string; runId: string; automationId: string; machineId: string;
    expectedAttempt: number; expectedRevision: number;
    definitionEnvelope: string; acceptedEnvelope: string;
    accountCurrentness: AutomationAccountCurrentnessWitnessV1;
}>) {
    if (!Number.isSafeInteger(params.expectedAttempt) || params.expectedAttempt < 0) throw new WorkflowRunServiceError("invalid_input");
    return await inTx(async (tx) => {
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        const definitionOuter = validateAutomationStoredContentEnvelopeOuterForMode({ raw: params.definitionEnvelope, mode });
        if (definitionOuter.kind !== "available") throw new WorkflowRunServiceError(definitionOuter.kind === "modeMismatch" ? "content_unavailable" : "invalid_input");
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.acceptedEnvelope, mode, binding: { v: 1, purpose: "accepted_snapshot", accountId: params.accountId, runId: params.runId } });
        const current = await tx.automationRun.findFirst({ where: {
            id: params.runId,
            accountId: params.accountId,
            originKind: "automation",
            automationId: params.automationId,
            claimedByMachineId: params.machineId,
            attempt: params.expectedAttempt,
            workflowCustodyState: "pending",
            workflowCheckpointEnvelope: null,
            assignments: { some: { machineId: params.machineId } },
        }, select: workflowRunSelect });
        if (!current || current.executionInputEnvelope !== params.definitionEnvelope) throw new WorkflowRunServiceError("currentness_conflict");
        if (current.workflowAcceptedSnapshotEnvelope !== null) {
            if (current.revision === params.expectedRevision + 1) {
                return {
                    disposition: "existing" as const,
                    acceptedEnvelope: current.workflowAcceptedSnapshotEnvelope,
                    run: projectRun(current as WorkflowRunRow),
                };
            }
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        const changed = await tx.automationRun.updateMany({ where: {
            id: params.runId,
            accountId: params.accountId,
            revision: params.expectedRevision,
            originKind: "automation",
            automationId: params.automationId,
            claimedByMachineId: params.machineId,
            attempt: params.expectedAttempt,
            workflowCustodyState: "pending",
            workflowAcceptedSnapshotEnvelope: null,
            workflowCheckpointEnvelope: null,
            executionInputEnvelope: params.definitionEnvelope,
            assignments: { some: { machineId: params.machineId } },
        }, data: { workflowAcceptedSnapshotEnvelope: params.acceptedEnvelope, revision: { increment: 1 } } });
        if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
        const row = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return {
            disposition: "created" as const,
            acceptedEnvelope: row.workflowAcceptedSnapshotEnvelope!,
            run: projectRun(row as WorkflowRunRow),
        };
    });
}

export async function initializeWorkflowRunExecution(params: Readonly<{
    accountId: string; runId: string; machineId: string; parentAttempt: number; expectedRevision: number;
    checkpointEnvelope: string; rootInvocation: Readonly<{ id: string; contentEnvelope: string }>;
    accountCurrentness: AutomationAccountCurrentnessWitnessV1;
}>) {
    return await inTx(async (tx) => {
        if (!isWorkflowUuid(params.rootInvocation.id) || !Number.isSafeInteger(params.parentAttempt) || params.parentAttempt < 0) throw new WorkflowRunServiceError("invalid_input");
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.checkpointEnvelope, mode, binding: { v: 1, purpose: "checkpoint", accountId: params.accountId, runId: params.runId } });
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.rootInvocation.contentEnvelope, mode, binding: { v: 1, purpose: "invocation_progress", accountId: params.accountId, runId: params.runId, recordId: params.rootInvocation.id, sequence: "0", parentRecordId: null, memberOrdinal: "0", attempt: "0" } });
        const existing = await tx.automationRun.findFirst({
            where: { id: params.runId, accountId: params.accountId, claimedByMachineId: params.machineId, attempt: params.parentAttempt, assignments: { some: { machineId: params.machineId } }, workflowCustodyState: { not: null }, workflowAcceptedSnapshotEnvelope: { not: null } },
            select: { ...workflowRunSelect, workflowInvocations: { where: { parentRecordId: null }, take: 2, select: invocationSelect } },
        });
        if (existing && existing.workflowCheckpointEnvelope !== null) {
            const roots = existing.workflowInvocations as InvocationRow[];
            if (roots.length === 1
                && roots[0]!.id === params.rootInvocation.id
                && roots[0]!.contentEnvelope === params.rootInvocation.contentEnvelope
                && existing.workflowCheckpointEnvelope === params.checkpointEnvelope) {
                return { run: projectRun(existing as WorkflowRunRow), initialization: "existing" as const };
            }
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        const run = await tx.automationRun.findFirst({ where: { id: params.runId, accountId: params.accountId, claimedByMachineId: params.machineId, attempt: params.parentAttempt, assignments: { some: { machineId: params.machineId } }, revision: params.expectedRevision, state: { in: ["queued", "claimed", "running"] }, workflowCustodyState: "pending", workflowAcceptedSnapshotEnvelope: { not: null }, workflowCheckpointEnvelope: null }, select: { id: true } });
        if (!run) throw new WorkflowRunServiceError("currentness_conflict");
        if (await tx.workflowRunInvocation.findUnique({ where: { id: params.rootInvocation.id }, select: { id: true } })) throw new WorkflowRunServiceError("currentness_conflict");
        const roots = await tx.workflowRunInvocation.count({ where: { runId: params.runId, parentRecordId: null } });
        if (roots !== 0) throw new WorkflowRunServiceError("currentness_conflict");
        await tx.workflowRunInvocation.create({ data: { id: params.rootInvocation.id, runId: params.runId, sequence: 0n, parentRecordId: null, memberOrdinal: 0n, attempt: 0n, lifecycle: "pending", contentEnvelope: params.rootInvocation.contentEnvelope } });
        const parent = await tx.automationRun.update({
            where: { id: params.runId },
            data: { workflowCheckpointEnvelope: params.checkpointEnvelope, state: "running", startedAt: new Date(), revision: { increment: 1 } },
            select: workflowRunSelect,
        });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return { run: projectRun(parent as WorkflowRunRow), initialization: "created" as const };
    });
}

export async function admitWorkflowInvocations(params: Readonly<{
    accountId: string; runId: string; machineId: string; parentAttempt: number; expectedRevision: number; checkpointEnvelope: string;
    invocations: readonly Readonly<{
        id: string; sequence: bigint; parentRecordId: string; memberOrdinal: bigint;
        lifecycle?: "pending" | "waiting_for_capacity"; contentEnvelope: string;
    }>[];
    accountCurrentness: AutomationAccountCurrentnessWitnessV1;
}>) {
    if (params.invocations.length === 0 || !Number.isSafeInteger(params.parentAttempt) || params.parentAttempt < 0) throw new WorkflowRunServiceError("invalid_input");
    return await inTx(async (tx) => {
        const invocationIds = params.invocations.map((invocation) => invocation.id);
        if (new Set(invocationIds).size !== invocationIds.length) throw new WorkflowRunServiceError("invalid_input");
        for (const invocation of params.invocations) {
            if (!isWorkflowUuid(invocation.id)
                || invocation.sequence < 0n || invocation.sequence > MAX_DATABASE_BIGINT
                || invocation.memberOrdinal < 0n || invocation.memberOrdinal > MAX_DATABASE_BIGINT) {
                throw new WorkflowRunServiceError("invalid_input");
            }
        }
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.checkpointEnvelope, mode, binding: { v: 1, purpose: "checkpoint", accountId: params.accountId, runId: params.runId } });
        for (const invocation of params.invocations) {
            assertWorkflowStoredEnvelopeOuterForMode({
                raw: invocation.contentEnvelope,
                mode,
                binding: {
                    v: 1,
                    purpose: "invocation_progress",
                    accountId: params.accountId,
                    runId: params.runId,
                    recordId: invocation.id,
                    sequence: invocation.sequence.toString(),
                    parentRecordId: invocation.parentRecordId,
                    memberOrdinal: invocation.memberOrdinal.toString(),
                    attempt: "0",
                },
            });
        }
        const current = await tx.automationRun.findFirst({
            where: { id: params.runId, accountId: params.accountId, claimedByMachineId: params.machineId, attempt: params.parentAttempt, assignments: { some: { machineId: params.machineId } }, workflowCustodyState: "pending", workflowCheckpointEnvelope: { not: null } },
            select: { revision: true, workflowCheckpointEnvelope: true },
        });
        if (!current) throw new WorkflowRunServiceError("currentness_conflict");
        const existingRows = await tx.workflowRunInvocation.findMany({ where: { id: { in: invocationIds } }, select: invocationSelect }) as InvocationRow[];
        if (existingRows.length > 0) {
            const byId = new Map(existingRows.map((row) => [row.id, row]));
            const exact = existingRows.length === params.invocations.length
                && current.revision === params.expectedRevision + 1
                && current.workflowCheckpointEnvelope === params.checkpointEnvelope
                && params.invocations.every((invocation) => {
                    const row = byId.get(invocation.id);
                    return row?.runId === params.runId
                        && row.parentRecordId === invocation.parentRecordId
                        && row.sequence === invocation.sequence
                        && row.memberOrdinal === invocation.memberOrdinal
                        && row.attempt === 0n
                        && row.lifecycle === (invocation.lifecycle ?? "pending")
                        && row.contentEnvelope === invocation.contentEnvelope;
                });
            if (!exact) throw new WorkflowRunServiceError("currentness_conflict");
            return {
                invocations: params.invocations.map((invocation) => projectInvocation(byId.get(invocation.id)!)),
                parentRevision: current.revision,
                disposition: "existing" as const,
            };
        }
        if (current.revision !== params.expectedRevision) throw new WorkflowRunServiceError("currentness_conflict");
        const parentIds = [...new Set(params.invocations.map((item) => item.parentRecordId))];
        const validParents = await tx.workflowRunInvocation.count({ where: { runId: params.runId, id: { in: parentIds } } });
        if (validParents !== parentIds.length) throw new WorkflowRunServiceError("invalid_input");
        const occupiedSlots = await tx.workflowRunInvocation.count({ where: {
            runId: params.runId,
            OR: params.invocations.map((invocation) => ({ parentRecordId: invocation.parentRecordId, memberOrdinal: invocation.memberOrdinal, attempt: 0n })),
        } });
        if (occupiedSlots !== 0) throw new WorkflowRunServiceError("currentness_conflict");
        const max = await tx.workflowRunInvocation.aggregate({ where: { runId: params.runId }, _max: { sequence: true } });
        const nextSequence = (max._max.sequence ?? -1n) + 1n;
        if (nextSequence + BigInt(params.invocations.length) - 1n > MAX_DATABASE_BIGINT
            || params.invocations.some((invocation, index) => invocation.sequence !== nextSequence + BigInt(index))) {
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        const changed = await tx.automationRun.updateMany({ where: { id: params.runId, accountId: params.accountId, revision: params.expectedRevision }, data: { workflowCheckpointEnvelope: params.checkpointEnvelope, revision: { increment: 1 } } });
        if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
        const created: InvocationRow[] = [];
        for (const invocation of params.invocations) {
            created.push(await tx.workflowRunInvocation.create({ data: {
                id: invocation.id,
                runId: params.runId,
                sequence: invocation.sequence,
                parentRecordId: invocation.parentRecordId,
                memberOrdinal: invocation.memberOrdinal,
                attempt: 0n,
                lifecycle: invocation.lifecycle ?? "pending",
                contentEnvelope: invocation.contentEnvelope,
            }, select: invocationSelect }) as InvocationRow);
        }
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return { invocations: created.map(projectInvocation), parentRevision: params.expectedRevision + 1, disposition: "created" as const };
    });
}

export async function getWorkflowRun(params: Readonly<{ accountId: string; runId: string }>) {
    return await inTx(async (tx) => {
        const mode = await loadAccountModeTx(tx, params.accountId);
        const row = await tx.automationRun.findFirst({ where: { id: params.runId, accountId: params.accountId, workflowCustodyState: { not: null }, workflowAcceptedSnapshotEnvelope: { not: null } }, select: workflowRunSelect });
        if (!row) throw new WorkflowRunServiceError("run_not_found");
        assertWorkflowStoredEnvelopeOuterForMode({ raw: row.workflowAcceptedSnapshotEnvelope!, mode, binding: { v: 1, purpose: "accepted_snapshot", accountId: params.accountId, runId: params.runId } });
        if (row.workflowCheckpointEnvelope !== null) assertWorkflowStoredEnvelopeOuterForMode({ raw: row.workflowCheckpointEnvelope, mode, binding: { v: 1, purpose: "checkpoint", accountId: params.accountId, runId: params.runId } });
        if (row.resultEnvelope !== null) assertWorkflowStoredEnvelopeOuterForMode({ raw: row.resultEnvelope, mode, binding: { v: 1, purpose: "final_result", accountId: params.accountId, runId: params.runId } });
        return { run: projectRun(row as WorkflowRunRow), acceptedEnvelope: row.workflowAcceptedSnapshotEnvelope!, checkpointEnvelope: row.workflowCheckpointEnvelope, resultEnvelope: row.resultEnvelope };
    }, { isolationLevel: "ReadCommitted" });
}

type PageOptions = Readonly<{ cursor?: string; limit?: number; pageByteLimit: number }>;

/**
 * Appends projected rows while measuring the complete response shape. The
 * empty-array measurement supplies the exact wrapper, cursor, and external
 * Action framing bytes; row serialization remains incremental so a 24 MB page
 * does not require repeatedly serializing its growing prefix.
 */
export function appendBoundedPage<T>(params: Readonly<{
    existing: readonly T[];
    existingBytes: number;
    candidates: readonly T[];
    byteLimit: number;
    project: (row: T) => unknown;
    projectPage: (rows: readonly unknown[], nextCursor?: string) => unknown;
    nextCursorFor: (row: T) => string;
    hasMoreAfter: (candidateIndex: number) => boolean;
    measurePage?: (page: unknown) => number;
}>): { rows: T[]; bytes: number; shortened: boolean } {
    const { existing, existingBytes, candidates, byteLimit, project } = params;
    if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) throw new WorkflowRunServiceError("invalid_input");
    const kept = [...existing];
    let bytes = existingBytes;
    const measurePage = params.measurePage ?? measureExternalActionResultResponseEnvelopeUtf8BytesV1;
    for (const [candidateIndex, row] of candidates.entries()) {
        const rowBytes = Buffer.byteLength(JSON.stringify(project(row)), "utf8") + (kept.length === 0 ? 0 : 1);
        const nextCursor = params.hasMoreAfter(candidateIndex) ? params.nextCursorFor(row) : undefined;
        const pageOverheadBytes = measurePage(params.projectPage([], nextCursor)) - 2;
        if (kept.length > 0 && bytes + rowBytes + pageOverheadBytes > byteLimit) {
            return { rows: kept, bytes, shortened: true };
        }
        if (bytes + rowBytes + pageOverheadBytes > byteLimit) throw new WorkflowRunServiceError("content_unavailable");
        kept.push(row);
        bytes += rowBytes;
    }
    return { rows: kept, bytes, shortened: false };
}

export async function listWorkflowRuns(params: PageOptions & Readonly<{
    accountId: string; origin?: "automation" | "direct"; states?: readonly WorkflowRunState[]; attention?: "required";
    originSessionId?: string; automationId?: string; machineId?: string;
}>) {
    if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit <= 0)) throw new WorkflowRunServiceError("invalid_input");
    const queryKey = JSON.stringify({ origin: params.origin ?? null, states: [...(params.states ?? [])].sort(), attention: params.attention ?? null, originSessionId: params.originSessionId ?? null, automationId: params.automationId ?? null, machineId: params.machineId ?? null });
    const decoded = params.cursor ? decodeKeysetCursorV1(params.cursor, queryKey) : null;
    const afterDate = decoded?.status === "ok" ? readKeysetCursorTextV1(decoded.parts[0]) : null;
    const afterId = decoded?.status === "ok" ? readKeysetCursorIdV1(decoded.parts[1]) : null;
    if (params.cursor && (!afterDate || !afterId)) throw new WorkflowRunServiceError("invalid_input");
    const page = await inTx(async (tx) => {
        await loadAccountModeTx(tx, params.accountId);
        const wanted = params.limit ?? Number.POSITIVE_INFINITY;
        let pageAfterDate = afterDate;
        let pageAfterId = afterId;
        let collected: WorkflowRunRow[] = [];
        let collectedBytes = 2;
        for (;;) {
            const batchSize = Math.min(wanted - collected.length, WORKFLOW_PAGE_DATABASE_BATCH_ROWS);
            const additionalWhere: Prisma.AutomationRunWhereInput[] = [];
            if (params.attention === "required") {
                additionalWhere.push({
                    OR: [
                        { state: "interrupted" },
                        { state: { in: [...AUTOMATION_RUN_TERMINAL_STATES] }, workflowCustodyState: "pending" },
                        { workflowResultDeliveryState: { in: ["unavailable", "workflow_outcome_unresolved"] } },
                        { workflowInvocations: { some: { lifecycle: { in: [...WORKFLOW_ATTENTION_INVOCATION_LIFECYCLES] } } } },
                    ],
                });
            }
            if (pageAfterDate && pageAfterId) {
                additionalWhere.push({
                    OR: [
                        { createdAt: { lt: new Date(pageAfterDate) } },
                        { createdAt: new Date(pageAfterDate), id: { lt: pageAfterId } },
                    ],
                });
            }
            const rows = await tx.automationRun.findMany({
        where: {
            accountId: params.accountId,
            workflowCustodyState: { not: null },
            ...(params.origin ? { originKind: params.origin } : {}),
            ...(params.states ? { state: { in: [...params.states] } } : {}),
            ...(params.originSessionId ? { originSessionId: params.originSessionId } : {}),
            ...(params.automationId ? { automationId: params.automationId } : {}),
            ...(params.machineId ? { assignments: { some: { machineId: params.machineId } } } : {}),
            ...(additionalWhere.length > 0 ? { AND: additionalWhere } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: batchSize + 1, select: workflowRunSelect,
            });
            const candidates = rows.slice(0, batchSize);
            const batchHasMore = rows.length > batchSize;
            const bounded = appendBoundedPage({
                existing: collected,
                existingBytes: collectedBytes,
                candidates,
                byteLimit: params.pageByteLimit,
                project: projectRun,
                projectPage: (runs, nextCursor) => ({ runs, ...(nextCursor ? { nextCursor } : {}) }),
                nextCursorFor: (row) => encodeKeysetCursorV1({ queryKey, parts: [row.createdAt.toISOString(), row.id] }),
                hasMoreAfter: (candidateIndex) => candidateIndex < candidates.length - 1 || batchHasMore,
            });
            if (bounded.shortened) return { ...bounded, hasMore: true };
            collected = bounded.rows;
            collectedBytes = bounded.bytes;
            if (collected.length >= wanted || !batchHasMore) return { rows: collected, hasMore: batchHasMore };
            const last = candidates.at(-1);
            if (!last) return { rows: collected, hasMore: true };
            pageAfterDate = last.createdAt.toISOString();
            pageAfterId = last.id;
        }
    }, { isolationLevel: "ReadCommitted" });
    const last = page.rows.at(-1);
    return { runs: page.rows.map(projectRun), ...(page.hasMore && last ? { nextCursor: encodeKeysetCursorV1({ queryKey, parts: [last.createdAt.toISOString(), last.id] }) } : {}) };
}

const WORKFLOW_TERMINAL_INVOCATION_LIFECYCLES = [
    "completed",
    "failed",
    "skipped",
    "cancelled",
    "outcome_uncertain",
    "superseded",
] as const satisfies readonly WorkflowInvocationLifecycleV1[];
const WORKFLOW_RECOVERY_INVOCATION_LIFECYCLES = [
    "pending",
    "waiting_for_capacity",
    "admitting",
    "running",
    "waiting_for_approval",
    "needs_attention",
    "cancel_requested",
    "outcome_uncertain",
] as const satisfies readonly WorkflowInvocationLifecycleV1[];

/**
 * Returns only exact-machine Runs whose persisted custody still requires the
 * existing worker startup/reconnect owner. This is a targeted indexed read,
 * not a claim, interpreter, history scan, or private-content disclosure.
 */
export async function listWorkflowRunsForRecovery(params: PageOptions & Readonly<{
    accountId: string;
    machineId: string;
}>) {
    if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit <= 0)) {
        throw new WorkflowRunServiceError("invalid_input");
    }
    const queryKey = JSON.stringify({ machineId: params.machineId, selector: "workflow_recovery_v1" });
    const decoded = params.cursor ? decodeKeysetCursorV1(params.cursor, queryKey) : null;
    const afterDate = decoded?.status === "ok" ? readKeysetCursorTextV1(decoded.parts[0]) : null;
    const afterId = decoded?.status === "ok" ? readKeysetCursorIdV1(decoded.parts[1]) : null;
    if (params.cursor && (!afterDate || !afterId)) throw new WorkflowRunServiceError("invalid_input");
    const page = await inTx(async (tx) => {
        await loadAccountModeTx(tx, params.accountId);
        const wanted = params.limit ?? Number.POSITIVE_INFINITY;
        let pageAfterDate = afterDate;
        let pageAfterId = afterId;
        let collected: WorkflowRunRow[] = [];
        let collectedBytes = 2;
        for (;;) {
            const batchSize = Math.min(wanted - collected.length, WORKFLOW_PAGE_DATABASE_BATCH_ROWS);
            const rows = await tx.automationRun.findMany({
                where: {
                    accountId: params.accountId,
                    workflowCustodyState: { not: null },
                    assignments: { some: { machineId: params.machineId } },
                    OR: [
                        {
                            state: { in: [...AUTOMATION_RUN_TERMINAL_STATES] },
                            OR: [
                                { workflowCustodyState: "pending" },
                                { workflowResultDeliveryState: "pending" },
                            ],
                        },
                        {
                            state: { notIn: [...AUTOMATION_RUN_TERMINAL_STATES] },
                            workflowCustodyState: "pending",
                            workflowInvocations: { some: { lifecycle: "cancel_requested" } },
                        },
                    ],
                    ...(pageAfterDate && pageAfterId ? {
                        AND: [{ OR: [
                            { createdAt: { lt: new Date(pageAfterDate) } },
                            { createdAt: new Date(pageAfterDate), id: { lt: pageAfterId } },
                        ] }],
                    } : {}),
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: batchSize + 1,
                select: workflowRunSelect,
            }) as WorkflowRunRow[];
            const candidates = rows.slice(0, batchSize);
            const batchHasMore = rows.length > batchSize;
            const bounded = appendBoundedPage({
                existing: collected,
                existingBytes: collectedBytes,
                candidates,
                byteLimit: params.pageByteLimit,
                project: (row) => ({ run: projectRun(row), parentAttempt: row.attempt }),
                projectPage: (candidates, nextCursor) => ({ candidates, ...(nextCursor ? { nextCursor } : {}) }),
                nextCursorFor: (row) => encodeKeysetCursorV1({ queryKey, parts: [row.createdAt.toISOString(), row.id] }),
                hasMoreAfter: (candidateIndex) => candidateIndex < candidates.length - 1 || batchHasMore,
                measurePage: (page) => Buffer.byteLength(JSON.stringify(page), "utf8"),
            });
            if (bounded.shortened) return { ...bounded, hasMore: true };
            collected = bounded.rows;
            collectedBytes = bounded.bytes;
            if (collected.length >= wanted || !batchHasMore) return { rows: collected, hasMore: batchHasMore };
            const last = candidates.at(-1);
            if (!last) return { rows: collected, hasMore: true };
            pageAfterDate = last.createdAt.toISOString();
            pageAfterId = last.id;
        }
    }, { isolationLevel: "ReadCommitted" });
    const last = page.rows.at(-1);
    return {
        candidates: page.rows.map((row) => ({
            run: projectRun(row),
            parentAttempt: row.attempt,
        })),
        ...(page.hasMore && last
            ? { nextCursor: encodeKeysetCursorV1({ queryKey, parts: [last.createdAt.toISOString(), last.id] }) }
            : {}),
    };
}

const invocationSelect = { id: true, runId: true, sequence: true, parentRecordId: true, memberOrdinal: true, attempt: true, lifecycle: true, contentEnvelope: true, createdAt: true, updatedAt: true } as const;
type InvocationRow = { id: string; runId: string; sequence: bigint; parentRecordId: string | null; memberOrdinal: bigint; attempt: bigint; lifecycle: string; contentEnvelope: string; createdAt: Date; updatedAt: Date };
function projectInvocation(row: InvocationRow) {
    return { id: row.id, runId: row.runId, sequence: projectWorkflowBigIntV1(row.sequence), parentRecordId: row.parentRecordId, memberOrdinal: projectWorkflowBigIntV1(row.memberOrdinal), attempt: projectWorkflowBigIntV1(row.attempt), lifecycle: row.lifecycle as WorkflowInvocationLifecycleV1, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listWorkflowRunInvocations(params: PageOptions & Readonly<{ accountId: string; runId: string; parentRecordId?: string; lifecycles?: readonly WorkflowInvocationLifecycleV1[] }>) {
    if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit <= 0)) throw new WorkflowRunServiceError("invalid_input");
    const queryKey = JSON.stringify({ runId: params.runId, parentRecordId: params.parentRecordId ?? null, lifecycles: [...(params.lifecycles ?? [])].sort() });
    const decoded = params.cursor ? decodeKeysetCursorV1(params.cursor, queryKey) : null;
    const afterSequence = decoded?.status === "ok" ? readKeysetCursorTextV1(decoded.parts[0]) : null;
    const afterId = decoded?.status === "ok" ? readKeysetCursorIdV1(decoded.parts[1]) : null;
    if (params.cursor && (!afterSequence || !afterId || !/^(0|[1-9][0-9]*)$/.test(afterSequence) || BigInt(afterSequence) > MAX_DATABASE_BIGINT)) throw new WorkflowRunServiceError("invalid_input");
    return await inTx(async (tx) => {
        await loadAccountModeTx(tx, params.accountId);
        const run = await tx.automationRun.findFirst({ where: { id: params.runId, accountId: params.accountId, workflowCustodyState: { not: null } }, select: { revision: true } });
        if (!run) throw new WorkflowRunServiceError("run_not_found");
        if (params.parentRecordId !== undefined) {
            const wanted = params.limit ?? Number.POSITIVE_INFINITY;
            let pageAfterOrdinal = afterSequence === null ? null : BigInt(afterSequence);
            let collected: InvocationRow[] = [];
            let collectedBytes = 2;
            for (;;) {
                // The public limit bounds returned newest attempts, not the
                // number of logical slots inspected before lifecycle filtering.
                const batchSize = WORKFLOW_PAGE_DATABASE_BATCH_ROWS;
                const slots = await tx.workflowRunInvocation.groupBy({
                by: ["memberOrdinal"],
                where: {
                    runId: params.runId,
                    parentRecordId: params.parentRecordId,
                    ...(pageAfterOrdinal === null ? {} : { memberOrdinal: { gt: pageAfterOrdinal } }),
                },
                _max: { attempt: true },
                orderBy: { memberOrdinal: "asc" },
                take: batchSize + 1,
                });
                const examined = slots.slice(0, batchSize);
                const newestSelectors = examined.flatMap((slot) => slot._max.attempt === null ? [] : [{ memberOrdinal: slot.memberOrdinal, attempt: slot._max.attempt }]);
                const newestRows = newestSelectors.length === 0 ? [] : await tx.workflowRunInvocation.findMany({
                where: {
                    runId: params.runId,
                    parentRecordId: params.parentRecordId,
                    OR: newestSelectors,
                    ...(params.lifecycles ? { lifecycle: { in: [...params.lifecycles] } } : {}),
                },
                orderBy: [{ memberOrdinal: "asc" }, { id: "asc" }],
                select: invocationSelect,
                }) as InvocationRow[];
                const remaining = wanted - collected.length;
                const candidates = newestRows.slice(0, remaining);
                const batchHasMore = slots.length > batchSize || newestRows.length > candidates.length;
                const bounded = appendBoundedPage({
                    existing: collected,
                    existingBytes: collectedBytes,
                    candidates,
                    byteLimit: params.pageByteLimit,
                    project: projectInvocation,
                    projectPage: (invocations, nextCursor) => ({ invocations, ...(nextCursor ? { nextCursor } : {}), parentRevision: run.revision }),
                    nextCursorFor: (row) => encodeKeysetCursorV1({ queryKey, parts: [row.memberOrdinal.toString(), row.id] }),
                    hasMoreAfter: (candidateIndex) => candidateIndex < candidates.length - 1 || batchHasMore,
                });
                if (bounded.shortened) {
                    const last = bounded.rows.at(-1);
                    return { invocations: bounded.rows.map(projectInvocation), parentRevision: run.revision, ...(last ? { nextCursor: encodeKeysetCursorV1({ queryKey, parts: [last.memberOrdinal.toString(), last.id] }) } : {}) };
                }
                collected = bounded.rows;
                collectedBytes = bounded.bytes;
                const lastExamined = examined.at(-1);
                if (collected.length >= wanted) {
                    const last = collected.at(-1);
                    return { invocations: collected.map(projectInvocation), parentRevision: run.revision, ...(batchHasMore && last ? { nextCursor: encodeKeysetCursorV1({ queryKey, parts: [last.memberOrdinal.toString(), last.id] }) } : {}) };
                }
                if (!batchHasMore) return { invocations: collected.map(projectInvocation), parentRevision: run.revision };
                if (!lastExamined) return { invocations: collected.map(projectInvocation), parentRevision: run.revision };
                pageAfterOrdinal = lastExamined.memberOrdinal;
            }
        }
        const wanted = params.limit ?? Number.POSITIVE_INFINITY;
        let pageAfterSequence = afterSequence === null ? null : BigInt(afterSequence);
        let pageAfterId = afterId;
        let collected: InvocationRow[] = [];
        let collectedBytes = 2;
        for (;;) {
            const batchSize = Math.min(wanted - collected.length, WORKFLOW_PAGE_DATABASE_BATCH_ROWS);
            const rows = await tx.workflowRunInvocation.findMany({ where: {
            runId: params.runId,
            ...(params.lifecycles ? { lifecycle: { in: [...params.lifecycles] } } : {}),
            ...(pageAfterSequence !== null && pageAfterId ? { OR: [{ sequence: { gt: pageAfterSequence } }, { sequence: pageAfterSequence, id: { gt: pageAfterId } }] } : {}),
            }, orderBy: [{ sequence: "asc" }, { id: "asc" }], take: batchSize + 1, select: invocationSelect }) as InvocationRow[];
            const candidates = rows.slice(0, batchSize);
            const batchHasMore = rows.length > batchSize;
            const bounded = appendBoundedPage({
                existing: collected,
                existingBytes: collectedBytes,
                candidates,
                byteLimit: params.pageByteLimit,
                project: projectInvocation,
                projectPage: (invocations, nextCursor) => ({ invocations, ...(nextCursor ? { nextCursor } : {}), parentRevision: run.revision }),
                nextCursorFor: (row) => encodeKeysetCursorV1({ queryKey, parts: [row.sequence.toString(), row.id] }),
                hasMoreAfter: (candidateIndex) => candidateIndex < candidates.length - 1 || batchHasMore,
            });
            if (bounded.shortened) {
                const last = bounded.rows.at(-1);
                return { invocations: bounded.rows.map(projectInvocation), parentRevision: run.revision, ...(last ? { nextCursor: encodeKeysetCursorV1({ queryKey, parts: [last.sequence.toString(), last.id] }) } : {}) };
            }
            collected = bounded.rows;
            collectedBytes = bounded.bytes;
            if (collected.length >= wanted || !batchHasMore) {
                const last = collected.at(-1);
                return { invocations: collected.map(projectInvocation), parentRevision: run.revision, ...(batchHasMore && last ? { nextCursor: encodeKeysetCursorV1({ queryKey, parts: [last.sequence.toString(), last.id] }) } : {}) };
            }
            const last = candidates.at(-1);
            if (!last) return { invocations: collected.map(projectInvocation), parentRevision: run.revision };
            pageAfterSequence = last.sequence;
            pageAfterId = last.id;
        }
    }, { isolationLevel: "ReadCommitted" });
}

export async function getWorkflowRunInvocation(params: Readonly<{ accountId: string; runId: string; invocationId: string }>) {
    return await inTx(async (tx) => {
        const mode = await loadAccountModeTx(tx, params.accountId);
        const run = await tx.automationRun.findFirst({ where: { id: params.runId, accountId: params.accountId, workflowCustodyState: { not: null } }, select: { revision: true } });
        if (!run) throw new WorkflowRunServiceError("run_not_found");
        const row = await tx.workflowRunInvocation.findFirst({ where: { id: params.invocationId, runId: params.runId }, select: invocationSelect }) as InvocationRow | null;
        if (!row) throw new WorkflowRunServiceError("run_not_found");
        assertWorkflowStoredEnvelopeOuterForMode({ raw: row.contentEnvelope, mode, binding: { v: 1, purpose: "invocation_progress", accountId: params.accountId, runId: params.runId, recordId: row.id, sequence: row.sequence.toString(), parentRecordId: row.parentRecordId, memberOrdinal: row.memberOrdinal.toString(), attempt: row.attempt.toString() } });
        return { invocation: { index: projectInvocation(row), contentEnvelope: row.contentEnvelope, parentRevision: run.revision } };
    }, { isolationLevel: "ReadCommitted" });
}

export async function commitWorkflowInvocationFact(params: Readonly<{ accountId: string; runId: string; machineId: string; parentAttempt: number; invocationId: string; invocationAttempt: bigint; expectedLifecycle: WorkflowInvocationLifecycleV1; lifecycle: WorkflowInvocationLifecycleV1; contentEnvelope: string; resolution?: "observed_terminal_execution"; accountCurrentness: AutomationAccountCurrentnessWitnessV1 }>) {
    return await inTx(async (tx) => {
        if (!Number.isSafeInteger(params.parentAttempt)
            || params.parentAttempt < 0
            || params.invocationAttempt < 0n
            || params.invocationAttempt > MAX_DATABASE_BIGINT) {
            throw new WorkflowRunServiceError("invalid_input");
        }
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        const run = await tx.automationRun.findFirst({ where: { id: params.runId, accountId: params.accountId, claimedByMachineId: params.machineId, attempt: params.parentAttempt, assignments: { some: { machineId: params.machineId } }, workflowCustodyState: "pending" }, select: { id: true } });
        if (!run) throw new WorkflowRunServiceError("currentness_conflict");
        const current = await tx.workflowRunInvocation.findFirst({ where: { id: params.invocationId, runId: params.runId, attempt: params.invocationAttempt }, select: invocationSelect }) as InvocationRow | null;
        if (!current) throw new WorkflowRunServiceError("currentness_conflict");
        const newestAttempt = await tx.workflowRunInvocation.findFirst({
            where: {
                runId: params.runId,
                parentRecordId: current.parentRecordId,
                memberOrdinal: current.memberOrdinal,
            },
            orderBy: { attempt: "desc" },
            select: { id: true },
        });
        if (newestAttempt?.id !== current.id) throw new WorkflowRunServiceError("currentness_conflict");
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.contentEnvelope, mode, binding: { v: 1, purpose: "invocation_progress", accountId: params.accountId, runId: params.runId, recordId: current.id, sequence: current.sequence.toString(), parentRecordId: current.parentRecordId, memberOrdinal: current.memberOrdinal.toString(), attempt: current.attempt.toString() } });
        if (current.lifecycle !== params.expectedLifecycle) {
            if (params.expectedLifecycle === "outcome_uncertain"
                && params.resolution === "observed_terminal_execution"
                && current.lifecycle === params.lifecycle
                && current.contentEnvelope === params.contentEnvelope
                && (params.lifecycle === "completed" || params.lifecycle === "needs_attention")) {
                return projectInvocation(current);
            }
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        if (current.lifecycle === params.lifecycle && current.contentEnvelope === params.contentEnvelope) return projectInvocation(current);
        if (WORKFLOW_TERMINAL_INVOCATION_LIFECYCLES.some((lifecycle) => lifecycle === current.lifecycle)) {
            if (current.lifecycle === "outcome_uncertain"
                && params.resolution === "observed_terminal_execution"
                && (params.lifecycle === "completed" || params.lifecycle === "needs_attention")) {
                const resolved = await tx.workflowRunInvocation.update({
                    where: { id: current.id },
                    data: { lifecycle: params.lifecycle, contentEnvelope: params.contentEnvelope },
                    select: invocationSelect,
                }) as InvocationRow;
                await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
                return projectInvocation(resolved);
            }
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        const updated = await tx.workflowRunInvocation.update({ where: { id: current.id }, data: { lifecycle: params.lifecycle, contentEnvelope: params.contentEnvelope }, select: invocationSelect }) as InvocationRow;
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return projectInvocation(updated);
    });
}

export async function transitionWorkflowRun(params: Readonly<{ accountId: string; runId: string; machineId: string; parentAttempt: number; expectedRevision: number; state: WorkflowRunState; checkpointEnvelope: string; resultEnvelope?: string | null; custodyState?: WorkflowCustodyState; invocationTransitions?: readonly Readonly<{ id: string; expectedLifecycle: WorkflowInvocationLifecycleV1; lifecycle: WorkflowInvocationLifecycleV1 }>[]; accountCurrentness: AutomationAccountCurrentnessWitnessV1 }>) {
    return await inTx(async (tx) => {
        if (!Number.isSafeInteger(params.parentAttempt) || params.parentAttempt < 0) throw new WorkflowRunServiceError("invalid_input");
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.checkpointEnvelope, mode, binding: { v: 1, purpose: "checkpoint", accountId: params.accountId, runId: params.runId } });
        if (params.resultEnvelope) assertWorkflowStoredEnvelopeOuterForMode({ raw: params.resultEnvelope, mode, binding: { v: 1, purpose: "final_result", accountId: params.accountId, runId: params.runId } });
        const reconciledTerminalInvocationIds: string[] = [];
        let allInvocationTransitionsTerminalIdempotent = true;
        for (const transition of params.invocationTransitions ?? []) {
            const current = await tx.workflowRunInvocation.findFirst({
                where: { id: transition.id, runId: params.runId },
                select: { parentRecordId: true, memberOrdinal: true, attempt: true, lifecycle: true },
            });
            if (!current || current.lifecycle !== transition.expectedLifecycle) {
                throw new WorkflowRunServiceError("currentness_conflict");
            }
            const terminal = WORKFLOW_TERMINAL_INVOCATION_LIFECYCLES.some((lifecycle) => lifecycle === current.lifecycle);
            if (terminal && transition.lifecycle !== current.lifecycle) {
                throw new WorkflowRunServiceError("currentness_conflict");
            }
            if (!terminal || transition.lifecycle !== current.lifecycle) {
                allInvocationTransitionsTerminalIdempotent = false;
            }
            const newer = await tx.workflowRunInvocation.findFirst({
                where: {
                    runId: params.runId,
                    parentRecordId: current.parentRecordId,
                    memberOrdinal: current.memberOrdinal,
                    attempt: { gt: current.attempt },
                },
                select: { id: true },
            });
            if (newer) throw new WorkflowRunServiceError("currentness_conflict");
            if (
                terminal
                || WORKFLOW_TERMINAL_INVOCATION_LIFECYCLES.some((lifecycle) => lifecycle === transition.lifecycle)
            ) reconciledTerminalInvocationIds.push(transition.id);
        }
        const transitionsToTerminal = AUTOMATION_RUN_TERMINAL_STATES.some(
            (candidate) => candidate === params.state,
        );
        if (params.custodyState === "settled") {
            if (!transitionsToTerminal) {
                throw new WorkflowRunServiceError("currentness_conflict");
            }
            const unsettled = await tx.workflowRunInvocation.findFirst({
                where: {
                    runId: params.runId,
                    lifecycle: { in: [...WORKFLOW_RECOVERY_INVOCATION_LIFECYCLES] },
                    ...(reconciledTerminalInvocationIds.length > 0 ? { id: { notIn: reconciledTerminalInvocationIds } } : {}),
                },
                select: { id: true },
            });
            const parent = await tx.automationRun.findFirst({
                where: { id: params.runId, accountId: params.accountId },
                select: { workflowResultDeliveryState: true },
            });
            if (!parent || parent.workflowResultDeliveryState === "pending" || unsettled) {
                throw new WorkflowRunServiceError("currentness_conflict");
            }
        }
        const now = new Date();
        const previous = await tx.automationRun.findFirst({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                attempt: params.parentAttempt,
                assignments: { some: { machineId: params.machineId } },
                revision: params.expectedRevision,
                workflowCustodyState: { not: null },
            },
            select: {
                state: true,
                originKind: true,
                workflowCheckpointEnvelope: true,
                resultEnvelope: true,
                workflowCustodyState: true,
            },
        });
        if (!previous) throw new WorkflowRunServiceError("currentness_conflict");
        const sameTerminalCustodySettlement = transitionsToTerminal
            && previous.state === params.state
            && AUTOMATION_RUN_TERMINAL_STATES.some((candidate) => candidate === previous.state)
            && previous.workflowCustodyState === "pending"
            && params.custodyState === "settled"
            && previous.workflowCheckpointEnvelope === params.checkpointEnvelope
            && (params.resultEnvelope === undefined || previous.resultEnvelope === params.resultEnvelope)
            && allInvocationTransitionsTerminalIdempotent;
        if (AUTOMATION_RUN_TERMINAL_STATES.some((candidate) => candidate === previous.state)
            && !sameTerminalCustodySettlement) {
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        const terminalAutomationState = transitionsToTerminal
            && previous.originKind === "automation"
            && !sameTerminalCustodySettlement;
        const previousAutomationState = terminalAutomationState
            ? automationPreviousStateForWorkflowTerminalEffects(previous.state as WorkflowRunState)
            : null;
        const updated = await tx.automationRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                attempt: params.parentAttempt,
                assignments: { some: { machineId: params.machineId } },
                revision: params.expectedRevision,
                ...(sameTerminalCustodySettlement
                    ? { state: params.state, workflowCustodyState: "pending" as const }
                    : { state: { notIn: [...AUTOMATION_RUN_TERMINAL_STATES] }, workflowCustodyState: { not: null } }),
            },
            data: sameTerminalCustodySettlement
                ? { workflowCustodyState: "settled", revision: { increment: 1 } }
                : {
                    state: params.state,
                    workflowCheckpointEnvelope: params.checkpointEnvelope,
                    ...(params.resultEnvelope !== undefined ? { resultEnvelope: params.resultEnvelope } : {}),
                    ...(params.custodyState ? { workflowCustodyState: params.custodyState } : {}),
                    revision: { increment: 1 },
                    ...(transitionsToTerminal ? { finishedAt: now } : {}),
                },
        });
        if (updated.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
        if (!sameTerminalCustodySettlement) {
            for (const transition of params.invocationTransitions ?? []) {
                const changed = await tx.workflowRunInvocation.updateMany({
                    where: { id: transition.id, runId: params.runId, lifecycle: transition.expectedLifecycle },
                    data: { lifecycle: transition.lifecycle },
                });
                if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
            }
        }
        if (terminalAutomationState) {
            if (!previousAutomationState) throw new WorkflowRunServiceError("currentness_conflict");
            await applyAutomationRunTerminalEffectsTx({
                tx,
                accountId: params.accountId,
                runId: params.runId,
                previousState: previousAutomationState,
                state: params.state as "succeeded" | "failed" | "cancelled" | "outcome_uncertain",
                now,
                prepareWorkflowReplyHandoff: params.state === "succeeded",
                eventPayload: { machineId: params.machineId },
            });
        }
        const row = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return projectRun(row as WorkflowRunRow);
    });
}

export async function settleWorkflowRunResultDelivery(params: Readonly<{
    accountId: string; runId: string; machineId: string; parentAttempt: number; expectedRevision: number;
    state: "accepted" | "unavailable";
    reason?: "workflow_outcome_unresolved";
}>) {
    return await inTx(async (tx) => {
        if (!Number.isSafeInteger(params.parentAttempt) || params.parentAttempt < 0) throw new WorkflowRunServiceError("invalid_input");
        await loadAccountModeTx(tx, params.accountId);
        const changed = await tx.automationRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                attempt: params.parentAttempt,
                assignments: { some: { machineId: params.machineId } },
                revision: params.expectedRevision,
                originKind: "direct",
                workflowResultDeliveryState: "pending",
                state: { in: [...AUTOMATION_RUN_TERMINAL_STATES] },
                workflowInvocations: {
                    none: { lifecycle: { in: [...WORKFLOW_RECOVERY_INVOCATION_LIFECYCLES] } },
                },
            },
            data: {
                workflowResultDeliveryState: params.state === "unavailable"
                    ? (params.reason ?? "unavailable")
                    : "accepted",
                workflowCustodyState: "settled",
                revision: { increment: 1 },
            },
        });
        if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
        const row = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return projectRun(row as WorkflowRunRow);
    });
}

async function controlWorkflowRun(params: Readonly<{
    accountId: string; runId: string; expectedRevision: number;
    eligibleStates: readonly WorkflowRunState[]; state: WorkflowRunState;
}>) {
    return await inTx(async (tx) => {
        await loadAccountModeTx(tx, params.accountId);
        const changed = await tx.automationRun.updateMany({ where: {
            id: params.runId,
            accountId: params.accountId,
            revision: params.expectedRevision,
            workflowCustodyState: { not: null },
            state: { in: [...params.eligibleStates] },
        }, data: { state: params.state, revision: { increment: 1 } } });
        if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
        const row = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return projectRun(row as WorkflowRunRow);
    });
}

export async function pauseWorkflowRun(params: Readonly<{ accountId: string; runId: string; expectedRevision: number }>) {
    const run = await controlWorkflowRun({ ...params, eligibleStates: ["queued", "claimed", "running"], state: "pause_requested" });
    return { run, intent: "pause_requested" as const };
}

export async function resumeWorkflowRunBoundary(params: Readonly<{ accountId: string; runId: string; expectedRevision: number }>) {
    const run = await controlWorkflowRun({ ...params, eligibleStates: ["paused"], state: "running" });
    return { run, intent: "resumed" as const };
}

export async function cancelWorkflowRunTx(
    tx: Tx,
    params: Readonly<{
        accountId: string;
        runId: string;
        expectedRevision: number;
        cause?: "permanent_target_loss";
    }>,
) {
    const current = await tx.automationRun.findFirst({
        where: {
            id: params.runId,
            accountId: params.accountId,
            revision: params.expectedRevision,
            workflowCustodyState: { not: null },
            state: { notIn: [...AUTOMATION_RUN_TERMINAL_STATES] },
        },
        select: {
            state: true,
            originKind: true,
            workflowResultDeliveryState: true,
            workflowInvocations: { take: 1, select: { id: true } },
        },
    });
    if (!current) throw new WorkflowRunServiceError("currentness_conflict");
    const beforeRootAdmission = current.workflowInvocations.length === 0
        && (
            current.state === "queued"
            || current.state === "claimed"
            || current.state === "pause_requested"
        );
    const immediate = beforeRootAdmission || current.state === "paused";
    // Ordinary cancellation preserves active/unknown custody for the exact
    // Machine to reconcile. Permanent loss of that sole frozen target closes
    // the approved same-Run recovery path, so an admitted Run must instead
    // settle as uncertain rather than remain indefinitely actionable.
    const permanentTargetLoss = params.cause === "permanent_target_loss";
    const settlesNow = immediate || permanentTargetLoss;
    const terminalState = immediate ? "cancelled" as const : "outcome_uncertain" as const;
    const now = new Date();
    const changed = await tx.automationRun.updateMany({
        where: {
            id: params.runId,
            accountId: params.accountId,
            revision: params.expectedRevision,
            state: {
                equals: current.state,
                notIn: [...AUTOMATION_RUN_TERMINAL_STATES],
            },
        },
        data: {
            state: settlesNow ? terminalState : current.state,
            revision: { increment: 1 },
            ...(settlesNow ? {
                finishedAt: now,
                workflowCustodyState: "settled",
                ...(current.workflowResultDeliveryState === "pending"
                    ? { workflowResultDeliveryState: "unavailable" }
                    : {}),
            } : {}),
        },
    });
    if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
    await tx.workflowRunInvocation.updateMany({
        where: {
            runId: params.runId,
            lifecycle: { in: ["pending", "waiting_for_capacity", "admitting", "running", "waiting_for_approval", "needs_attention", "cancel_requested"] },
        },
        data: {
            lifecycle: settlesNow
                ? terminalState
                : "cancel_requested",
        },
    });
    if (settlesNow && current.originKind === "automation") {
        await applyAutomationRunTerminalEffectsTx({
            tx,
            accountId: params.accountId,
            runId: params.runId,
            previousState: automationPreviousStateForWorkflowTerminalEffects(current.state as WorkflowRunState),
            state: terminalState,
            now,
            ...(permanentTargetLoss && !immediate
                ? { eventPayload: { reason: "permanent_target_loss" } }
                : {}),
        });
    }
    const row = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
    const cursor = await markAccountChanged(tx, { accountId: params.accountId, kind: "account", entityId: `workflow-run:${params.runId}` });
    if (!settlesNow) {
        const machineId = row.assignments[0]?.machineId;
        if (machineId) afterTx(tx, () => emitAutomationRunUpdatedToMachineOnly({
            accountId: params.accountId,
            machineId,
            run: row as WorkflowRunRow,
            cursor,
            workflowControl: "cancel_requested",
        }));
    }
    return {
        run: projectRun(row as WorkflowRunRow),
        intent: settlesNow ? "cancelled" as const : "cancel_requested" as const,
    };
}

export async function cancelWorkflowRun(params: Readonly<{ accountId: string; runId: string; expectedRevision: number }>) {
    return await inTx(async (tx) => {
        await loadAccountModeTx(tx, params.accountId);
        return await cancelWorkflowRunTx(tx, params);
    });
}

const WORKFLOW_ATTENTION_INVOCATION_LIFECYCLES = [
    "waiting_for_approval", "needs_attention", "cancel_requested", "outcome_uncertain",
] as const satisfies readonly WorkflowInvocationLifecycleV1[];

async function waitForWorkflowObservationPoll(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    await new Promise<void>((resolve, reject) => {
        const finish = () => {
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const timer = setTimeout(finish, 250);
        const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(signal?.reason);
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}

export async function waitWorkflowRun(params: Readonly<{
    accountId: string;
    runId: string;
    timeoutSeconds?: number;
    afterRevision?: number;
    signal?: AbortSignal;
}>) {
    const deadline = params.timeoutSeconds === undefined ? null : Date.now() + params.timeoutSeconds * 1_000;
    for (;;) {
        if (params.signal?.aborted) throw params.signal.reason;
        const current = await getWorkflowRun({ accountId: params.accountId, runId: params.runId });
        const state = current.run.state;
        if (state === "interrupted" || isWorkflowResultDeliveryUnavailableV1(current.run.workflowResultDeliveryState)) return { observation: "needs_attention" as const, run: current.run };
        if (AUTOMATION_RUN_TERMINAL_STATES.some((candidate) => candidate === state)) return { observation: "terminal" as const, run: current.run, ...(current.resultEnvelope ? { resultEnvelope: current.resultEnvelope } : {}) };
        if (state === "paused") return { observation: "paused" as const, run: current.run };
        const actionableInvocation = await db.workflowRunInvocation.findFirst({
            where: {
                runId: params.runId,
                run: { accountId: params.accountId },
                lifecycle: { in: [...WORKFLOW_ATTENTION_INVOCATION_LIFECYCLES] },
            },
            select: { id: true },
        });
        if (actionableInvocation) return { observation: "needs_attention" as const, run: current.run };
        if (params.afterRevision !== undefined && current.run.revision !== params.afterRevision) {
            return { observation: "changed" as const, run: current.run };
        }
        if (deadline !== null && Date.now() >= deadline) return { observation: "timeout" as const, run: current.run };
        await waitForWorkflowObservationPoll(params.signal);
    }
}

export async function retryWorkflowInvocation(params: Readonly<{ accountId: string; runId: string; expectedRevision: number; invocationId: string; newInvocationId: string; checkpointEnvelope: string; contentEnvelope: string; accountCurrentness: AutomationAccountCurrentnessWitnessV1 }>) {
    return await inTx(async (tx) => {
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        if (!isWorkflowUuid(params.newInvocationId)) throw new WorkflowRunServiceError("invalid_input");
        const previous = await tx.workflowRunInvocation.findFirst({ where: { id: params.invocationId, runId: params.runId }, select: invocationSelect }) as InvocationRow | null;
        if (!previous) throw new WorkflowRunServiceError("ineligible_state");
        const existing = await tx.workflowRunInvocation.findFirst({
            where: { id: params.newInvocationId },
            select: invocationSelect,
        }) as InvocationRow | null;
        if (existing) {
            const parent = await tx.automationRun.findFirst({
                where: { id: params.runId, accountId: params.accountId, revision: params.expectedRevision + 1 },
                select: workflowRunSelect,
            });
            if (
                parent
                && previous.lifecycle === "superseded"
                && existing.runId === params.runId
                && parent.workflowCheckpointEnvelope === params.checkpointEnvelope
                && existing.parentRecordId === previous.parentRecordId
                && existing.memberOrdinal === previous.memberOrdinal
                && existing.attempt === previous.attempt + 1n
                && existing.contentEnvelope === params.contentEnvelope
            ) return { run: projectRun(parent as WorkflowRunRow), invocation: projectInvocation(existing), disposition: "existing" as const };
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        const run = await tx.automationRun.findFirst({ where: {
            id: params.runId,
            accountId: params.accountId,
            workflowCustodyState: { not: null },
        }, select: { revision: true, state: true } });
        if (!run || run.revision !== params.expectedRevision) throw new WorkflowRunServiceError("currentness_conflict");
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.checkpointEnvelope, mode, binding: { v: 1, purpose: "checkpoint", accountId: params.accountId, runId: params.runId } });
        if (!["failed", "cancelled", "needs_attention"].includes(previous.lifecycle)) throw new WorkflowRunServiceError("ineligible_state");
        const newer = await tx.workflowRunInvocation.findFirst({
            where: {
                runId: params.runId,
                parentRecordId: previous.parentRecordId,
                memberOrdinal: previous.memberOrdinal,
                attempt: { gt: previous.attempt },
            },
            select: { id: true },
        });
        if (newer) throw new WorkflowRunServiceError("ineligible_state");
        if (run.state !== "interrupted") throw new WorkflowRunServiceError("ineligible_state");
        const max = await tx.workflowRunInvocation.aggregate({ where: { runId: params.runId }, _max: { sequence: true } });
        if ((max._max.sequence ?? -1n) >= MAX_DATABASE_BIGINT || previous.attempt >= MAX_DATABASE_BIGINT) throw new WorkflowRunServiceError("invalid_input");
        const newSequence = (max._max.sequence ?? -1n) + 1n;
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.contentEnvelope, mode, binding: { v: 1, purpose: "invocation_progress", accountId: params.accountId, runId: params.runId, recordId: params.newInvocationId, sequence: newSequence.toString(), parentRecordId: previous.parentRecordId, memberOrdinal: previous.memberOrdinal.toString(), attempt: (previous.attempt + 1n).toString() } });
        const created = await tx.workflowRunInvocation.create({ data: { id: params.newInvocationId, runId: params.runId, sequence: newSequence, parentRecordId: previous.parentRecordId, memberOrdinal: previous.memberOrdinal, attempt: previous.attempt + 1n, lifecycle: "pending", contentEnvelope: params.contentEnvelope }, select: invocationSelect }) as InvocationRow;
        await tx.workflowRunInvocation.update({ where: { id: previous.id }, data: { lifecycle: "superseded" } });
        const changed = await tx.automationRun.updateMany({
            where: { id: params.runId, accountId: params.accountId, revision: params.expectedRevision },
            data: { revision: { increment: 1 }, state: "queued", claimedByMachineId: null, claimedAt: null, leaseExpiresAt: null, workflowCheckpointEnvelope: params.checkpointEnvelope, workflowCustodyState: "pending", finishedAt: null },
        });
        if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
        const parent = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return { run: projectRun(parent as WorkflowRunRow), invocation: projectInvocation(created), disposition: "accepted" as const };
    });
}

export async function recoverWorkflowInvocations(params: Readonly<{
    accountId: string;
    runId: string;
    expectedRevision: number;
    checkpointEnvelope: string;
    accountCurrentness: AutomationAccountCurrentnessWitnessV1;
    recoveries: readonly Readonly<{
        invocationId: string;
        newInvocationId: string;
        contentEnvelope: string;
    }>[];
}>) {
    if (params.recoveries.length === 0) throw new WorkflowRunServiceError("invalid_input");
    return await inTx(async (tx) => {
        const mode = await loadCurrentWorkflowAccountModeTx(tx, params.accountId, params.accountCurrentness);
        const ids = new Set<string>();
        for (const recovery of params.recoveries) {
            if (!isWorkflowUuid(recovery.newInvocationId)
                || ids.has(recovery.invocationId)
                || ids.has(recovery.newInvocationId)) throw new WorkflowRunServiceError("invalid_input");
            ids.add(recovery.invocationId);
            ids.add(recovery.newInvocationId);
        }
        const prior = await tx.workflowRunInvocation.findMany({
            where: { runId: params.runId, id: { in: params.recoveries.map((item) => item.invocationId) } },
            select: invocationSelect,
        }) as InvocationRow[];
        const priorById = new Map(prior.map((row) => [row.id, row]));
        const existing = await tx.workflowRunInvocation.findMany({
            where: { id: { in: params.recoveries.map((item) => item.newInvocationId) } },
            select: invocationSelect,
        }) as InvocationRow[];
        if (existing.length > 0) {
            const existingById = new Map(existing.map((row) => [row.id, row]));
            const parent = await tx.automationRun.findFirst({
                where: { id: params.runId, accountId: params.accountId, revision: params.expectedRevision + 1 },
                select: workflowRunSelect,
            });
            const rejoinedRows: InvocationRow[] = [];
            const rejoins = parent && params.recoveries.every((recovery) => {
                const previous = priorById.get(recovery.invocationId);
                const next = existingById.get(recovery.newInvocationId);
                const exact = previous?.lifecycle === "superseded"
                    && next?.runId === params.runId
                    && next?.parentRecordId === previous.parentRecordId
                    && next?.memberOrdinal === previous.memberOrdinal
                    && next?.attempt === previous.attempt + 1n
                    && next?.contentEnvelope === recovery.contentEnvelope;
                if (exact && next) rejoinedRows.push(next);
                return exact;
            });
            if (rejoins && parent.workflowCheckpointEnvelope === params.checkpointEnvelope) return {
                disposition: "existing" as const,
                run: projectRun(parent as WorkflowRunRow),
                invocations: rejoinedRows.map(projectInvocation),
            };
            throw new WorkflowRunServiceError("currentness_conflict");
        }
        const parent = await tx.automationRun.findFirst({
            where: {
                id: params.runId,
                accountId: params.accountId,
                revision: params.expectedRevision,
                state: "interrupted",
                workflowCustodyState: { not: null },
            },
            select: { revision: true },
        });
        if (!parent || prior.length !== params.recoveries.length) throw new WorkflowRunServiceError("currentness_conflict");
        assertWorkflowStoredEnvelopeOuterForMode({ raw: params.checkpointEnvelope, mode, binding: { v: 1, purpose: "checkpoint", accountId: params.accountId, runId: params.runId } });
        const maximum = await tx.workflowRunInvocation.aggregate({ where: { runId: params.runId }, _max: { sequence: true } });
        const firstSequence = (maximum._max.sequence ?? -1n) + 1n;
        const created: InvocationRow[] = [];
        for (const [index, recovery] of params.recoveries.entries()) {
            const previous = priorById.get(recovery.invocationId);
            if (!previous
                || !["failed", "cancelled", "needs_attention"].includes(previous.lifecycle)
                || previous.attempt >= MAX_DATABASE_BIGINT
                || firstSequence + BigInt(index) > MAX_DATABASE_BIGINT) throw new WorkflowRunServiceError("ineligible_state");
            const newSequence = firstSequence + BigInt(index);
            const newer = await tx.workflowRunInvocation.findFirst({
                where: { runId: params.runId, parentRecordId: previous.parentRecordId, memberOrdinal: previous.memberOrdinal, attempt: { gt: previous.attempt } },
                select: { id: true },
            });
            if (newer) throw new WorkflowRunServiceError("ineligible_state");
            assertWorkflowStoredEnvelopeOuterForMode({
                raw: recovery.contentEnvelope,
                mode,
                binding: {
                    v: 1,
                    purpose: "invocation_progress",
                    accountId: params.accountId,
                    runId: params.runId,
                    recordId: recovery.newInvocationId,
                    sequence: newSequence.toString(),
                    parentRecordId: previous.parentRecordId,
                    memberOrdinal: previous.memberOrdinal.toString(),
                    attempt: (previous.attempt + 1n).toString(),
                },
            });
            created.push(await tx.workflowRunInvocation.create({
                data: {
                    id: recovery.newInvocationId,
                    runId: params.runId,
                    sequence: newSequence,
                    parentRecordId: previous.parentRecordId,
                    memberOrdinal: previous.memberOrdinal,
                    attempt: previous.attempt + 1n,
                    lifecycle: "pending",
                    contentEnvelope: recovery.contentEnvelope,
                },
                select: invocationSelect,
            }) as InvocationRow);
        }
        await tx.workflowRunInvocation.updateMany({
            where: { runId: params.runId, id: { in: params.recoveries.map((item) => item.invocationId) } },
            data: { lifecycle: "superseded" },
        });
        const changed = await tx.automationRun.updateMany({
            where: { id: params.runId, accountId: params.accountId, revision: params.expectedRevision, state: "interrupted" },
            data: { revision: { increment: 1 }, state: "queued", claimedByMachineId: null, claimedAt: null, leaseExpiresAt: null, workflowCheckpointEnvelope: params.checkpointEnvelope, workflowCustodyState: "pending", finishedAt: null },
        });
        if (changed.count !== 1) throw new WorkflowRunServiceError("currentness_conflict");
        const updatedParent = await tx.automationRun.findUniqueOrThrow({ where: { id: params.runId }, select: workflowRunSelect });
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return { disposition: "accepted" as const, run: projectRun(updatedParent as WorkflowRunRow), invocations: created.map(projectInvocation) };
    });
}

export async function deleteWorkflowRun(params: Readonly<{ accountId: string; runId: string; expectedRevision: number }>) {
    return await inTx(async (tx) => {
        await loadAccountModeTx(tx, params.accountId);
        const deleted = await tx.automationRun.deleteMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                revision: params.expectedRevision,
                ...automationRunCustodyTerminalWhere(),
                workflowCustodyState: "settled",
            },
        });
        if (deleted.count !== 1) {
            const exists = await tx.automationRun.findFirst({
                where: { id: params.runId, accountId: params.accountId },
                select: { state: true, workflowCustodyState: true },
            });
            if (!exists) throw new WorkflowRunServiceError("run_not_found");
            if (exists.workflowCustodyState === "pending") throw new WorkflowRunServiceError("custody_pending");
            if (AUTOMATION_RUN_TERMINAL_STATES.some((candidate) => candidate === exists.state)) {
                const custodyTerminal = await tx.automationRun.findFirst({
                    where: {
                        id: params.runId,
                        accountId: params.accountId,
                        ...automationRunCustodyTerminalWhere(),
                    },
                    select: { id: true },
                });
                if (!custodyTerminal) throw new WorkflowRunServiceError("custody_pending");
                // A settled workflow Run is deletable; only the caller's expected
                // revision is stale. Report the currentness conflict so the caller
                // refreshes instead of treating the settled Run as ineligible.
                if (exists.workflowCustodyState === "settled") throw new WorkflowRunServiceError("currentness_conflict");
            }
            throw new WorkflowRunServiceError("ineligible_state");
        }
        await markWorkflowRunChangedTx(tx, params.accountId, params.runId);
        return { deleted: true as const, runId: params.runId };
    });
}
