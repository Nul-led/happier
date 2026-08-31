import type {
    ActionExecuteResult,
    ActionExecutorContext,
    ActionUiPlacement,
    HandoffWorkspaceActionV1,
    WorkspaceContentPolicyV1,
    WorkspaceSyncPersistentModeV1,
} from '@happier-dev/protocol';

import {
    openSessionHandoffPicker,
    type SessionHandoffPickerResult,
} from '@/components/sessions/handoff/openSessionHandoffPicker';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import { randomUUID } from '@/platform/randomUUID';
import { actionOperationPresentationCoordinator } from '@/components/inbox/actionOperations/actionOperationPresentationRuntime';
import { storage } from '@/sync/domains/state/storageStore';
import { requireOneShotAccountSettingsMutationApplied } from '@/sync/engine/settings/syncSettings';
import {
    findWorkspaceRefByScope,
    upsertWorkspaceRefByScope,
} from '@/sync/domains/workspaces/workspaceRefs';
import { WorkspaceRefV1Schema, type WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import {
    parseWorkspaceSyncRelationshipRecords,
    upsertWorkspaceSyncRelationshipRecord,
} from './workspaceSyncRelationshipMutations';

import { readSessionHandoffSessionActivity } from './readSessionHandoffSessionActivity';
import {
    executeSessionHandoffAction,
    type ExecuteSessionHandoffActionResult,
} from './executeSessionHandoffAction';

type ExecuteAction = (
    actionId: 'session.handoff',
    input: unknown,
    context?: ActionExecutorContext,
) => Promise<ActionExecuteResult>;

type MaterializedWorkspaceRefs = Readonly<{
    sourceWorkspaceRefId: string;
    targetWorkspaceRefId: string;
    settingsVersion: number;
    workspaceAction?: HandoffWorkspaceActionV1;
}>;

type MaterializedWorkspaceRefsWithoutVersion = Omit<MaterializedWorkspaceRefs, 'settingsVersion'>;

function requireMaterializedWorkspaceRefs(
    value: MaterializedWorkspaceRefsWithoutVersion | null,
): MaterializedWorkspaceRefsWithoutVersion {
    if (!value) throw workspaceRefError();
    return value;
}

function workspaceRefError(): Error {
    return Object.assign(new Error('workspace_ref_not_ready'), { code: 'workspace_ref_not_ready' });
}

function parseWorkspaceRefs(value: unknown): WorkspaceRefV1[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw workspaceRefError();
    return value.map((candidate) => {
        const parsed = WorkspaceRefV1Schema.safeParse(candidate);
        if (!parsed.success) throw workspaceRefError();
        return parsed.data;
    });
}

async function materializeWorkspaceRefs(input: Readonly<{
    serverId: string | null;
    sourceMachineId?: string | null;
    sourceRootPath?: string;
    targetMachineId: string;
    targetRootPath?: string;
    relationshipIntent?: Readonly<{
        mode: WorkspaceSyncPersistentModeV1;
        contentPolicy: WorkspaceContentPolicyV1;
    }>;
}>): Promise<MaterializedWorkspaceRefs> {
    const serverId = input.serverId?.trim() ?? '';
    const sourceMachineId = input.sourceMachineId?.trim() ?? '';
    const sourceRootPath = input.sourceRootPath?.trim() ?? '';
    const targetMachineId = input.targetMachineId.trim();
    const targetRootPath = input.targetRootPath?.trim() ?? '';
    if (!serverId || !sourceMachineId || !sourceRootPath || !targetMachineId || !targetRootPath) {
        throw workspaceRefError();
    }

    const expectedSettingsVersion = storage.getState().settingsVersion;
    if (typeof expectedSettingsVersion !== 'number'
        || !Number.isSafeInteger(expectedSettingsVersion)
        || expectedSettingsVersion < 0) {
        throw workspaceRefError();
    }
    const nowMs = Date.now();
    const candidateRelationshipId = input.relationshipIntent ? randomUUID() : null;
    const result = await sync.mutateAccountSettingsOnce({
      expectedSettingsVersion,
      mutate: (raw) => {
        const sourceScope = { serverId, machineId: sourceMachineId, rootPath: sourceRootPath };
        const targetScope = { serverId, machineId: targetMachineId, rootPath: targetRootPath };
        const withSource = upsertWorkspaceRefByScope(parseWorkspaceRefs(raw.workspaceRefsV1), {
            scope: sourceScope,
            nowMs,
            patch: {},
        });
        const nextRefs = upsertWorkspaceRefByScope(withSource, {
            scope: targetScope,
            nowMs,
            patch: {},
        });
        const source = findWorkspaceRefByScope(nextRefs, sourceScope);
        const target = findWorkspaceRefByScope(nextRefs, targetScope);
        if (!source || !target) throw workspaceRefError();
        let workspaceAction: HandoffWorkspaceActionV1 | undefined;
        let nextRelationshipsRaw = raw.workspaceSyncRelationshipsV1;
        if (input.relationshipIntent) {
            const relationships = parseWorkspaceSyncRelationshipRecords(nextRelationshipsRaw);
            const existing = relationships.find((relationship) => (
                relationship.mode === input.relationshipIntent?.mode
                && relationship.contentPolicy.policyDigest === input.relationshipIntent.contentPolicy.policyDigest
                && (
                    (
                        relationship.controllerMachineId === sourceMachineId
                        && relationship.alphaWorkspaceRefId === source.id
                        && relationship.betaWorkspaceRefId === target.id
                    )
                    || (
                        relationship.mode === 'keep_both_in_sync'
                        && relationship.alphaWorkspaceRefId === target.id
                        && relationship.betaWorkspaceRefId === source.id
                    )
                )
            ));
            const relationshipId = existing?.relationshipId ?? candidateRelationshipId;
            if (!relationshipId) throw workspaceRefError();
            nextRelationshipsRaw = upsertWorkspaceSyncRelationshipRecord(relationships, existing ? {
                ...existing,
                enabled: true,
                updatedAtMs: nowMs,
            } : {
                v: 1,
                relationshipId,
                controllerMachineId: sourceMachineId,
                alphaWorkspaceRefId: source.id,
                betaWorkspaceRefId: target.id,
                mode: input.relationshipIntent.mode,
                contentPolicy: input.relationshipIntent.contentPolicy,
                enabled: true,
                createdAtMs: nowMs,
                updatedAtMs: nowMs,
            });
            workspaceAction = { kind: 'relationship', relationshipId, flushBeforeCommit: true };
        }
        const materialized: MaterializedWorkspaceRefsWithoutVersion = {
            sourceWorkspaceRefId: source.id,
            targetWorkspaceRefId: target.id,
            ...(workspaceAction ? { workspaceAction } : {}),
        };
        return {
            settings: {
                ...raw,
                workspaceRefsV1: nextRefs,
                ...(input.relationshipIntent
                    ? { workspaceSyncRelationshipsV1: nextRelationshipsRaw }
                    : {}),
            },
            value: materialized,
        };
      },
    });
    if (result.status !== 'applied') throw workspaceRefError();
    const applied = requireOneShotAccountSettingsMutationApplied(result);
    return {
        ...requireMaterializedWorkspaceRefs(applied.value),
        settingsVersion: applied.settingsVersion,
    };
}

async function confirmActiveSessionHandoff(sessionId: string): Promise<boolean> {
    if (readSessionHandoffSessionActivity(sessionId)?.active !== true) return true;

    return await Modal.confirm(
        t('sessionHandoff.activeWarning.title'),
        t('sessionHandoff.activeWarning.message'),
        {
            cancelText: t('common.cancel'),
            confirmText: t('sessionHandoff.activeWarning.confirm'),
            destructive: true,
        },
    );
}

async function confirmMirrorExactly(input: Readonly<{
    sourceMachineId?: string | null;
    selection: SessionHandoffPickerResult;
}>): Promise<boolean> {
    if (input.selection.workspaceSyncRelationshipIntent?.mode !== 'mirror_exactly') return true;

    return await Modal.confirm(
        t('sessionHandoff.mirrorConfirmation.title'),
        t('sessionHandoff.mirrorConfirmation.message', {
            sourceMachine: input.sourceMachineId?.trim() || '—',
            sourcePath: input.selection.sourceRootPath?.trim() || '—',
            targetMachine: input.selection.targetMachineLabel?.trim() || input.selection.targetMachineId,
            targetPath: input.selection.targetPath?.trim() || '—',
        }),
        {
            cancelText: t('common.cancel'),
            confirmText: t('sessionHandoff.mirrorConfirmation.confirm'),
            destructive: true,
        },
    );
}

export async function runSessionHandoffPickerFlow(args: Readonly<{
    execute: ExecuteAction;
    sessionId: string;
    sourceMachineId?: string | null;
    serverId: string | null;
    placement: ActionUiPlacement;
}>): Promise<ExecuteSessionHandoffActionResult | Readonly<{ ok: false; handled: true }> | null> {
    const selection = await openSessionHandoffPicker({
        sessionId: args.sessionId,
        sourceMachineId: args.sourceMachineId ?? null,
        serverId: args.serverId,
    });
    if (!selection) return null;
    if (!await confirmActiveSessionHandoff(args.sessionId)) return { ok: false, handled: true };
    if (!await confirmMirrorExactly({ sourceMachineId: args.sourceMachineId, selection })) {
        return { ok: false, handled: true };
    }

    const releaseUserRequestLease = sync.acquireUserRequestLease();
    const requestId = randomUUID();
    actionOperationPresentationCoordinator.register({ requestId, onStart: 'current' });
    try {
        const needsWorkspaceRefs = selection.workspaceAction?.kind === 'copy_once'
            || Boolean(selection.workspaceSyncRelationshipIntent);
        const workspaceRefs = needsWorkspaceRefs
            ? await materializeWorkspaceRefs({
                serverId: args.serverId,
                sourceMachineId: args.sourceMachineId,
                sourceRootPath: selection.sourceRootPath,
                targetMachineId: selection.targetMachineId,
                targetRootPath: selection.targetPath,
                ...(selection.workspaceSyncRelationshipIntent
                    ? { relationshipIntent: selection.workspaceSyncRelationshipIntent }
                    : {}),
            })
            : null;
        return await executeSessionHandoffAction({
            execute: args.execute,
            sessionId: args.sessionId,
            targetMachineId: selection.targetMachineId,
            ...(selection.targetPath ? { targetPath: selection.targetPath } : {}),
            targetSessionStorageMode: selection.targetSessionStorageMode,
            workspaceAction: workspaceRefs?.workspaceAction ?? selection.workspaceAction,
            ...(workspaceRefs
                ? {
                    workspaceSyncSourceWorkspaceRefId: workspaceRefs.sourceWorkspaceRefId,
                    workspaceSyncTargetWorkspaceRefId: workspaceRefs.targetWorkspaceRefId,
                    workspaceSyncSettingsVersion: workspaceRefs.settingsVersion,
                }
                : {}),
            context: {
                defaultSessionId: args.sessionId,
                serverId: args.serverId,
                surface: 'ui',
                placement: args.placement,
                actionRequestId: requestId,
            },
        });
    } finally {
        releaseUserRequestLease();
    }
}
