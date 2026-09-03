import {
    buildBackendTargetKeyV2,
    readBackendTargetRefV2,
    SessionDraftPredecessorAuthoringValueV1Schema,
    SYNCED_SESSION_AUTHORING_FIELD_IDS_V1,
    SyncedSessionAuthoringValueV1Schema,
    type SyncedSessionAuthoringFieldIdV1,
    type SyncedSessionAuthoringValueV1,
} from '@happier-dev/protocol';

import { resolveAgentExecutionTargetForPersistedSelection } from '@/agents/backendCatalog/resolveAgentExecutionTargetForBackendTarget';
import type { NewSessionDraft } from '@/sync/domains/state/persistence';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Projects the safe synchronized subset through the protocol field catalog.
 * Fields are parsed independently so one malformed optional selection cannot
 * discard otherwise recoverable authoring intent.
 */
export function projectSyncedSessionAuthoringFields(value: unknown): Partial<SyncedSessionAuthoringValueV1> {
    if (!isRecord(value)) return {};

    const projected: Partial<Record<SyncedSessionAuthoringFieldIdV1, unknown>> = {};
    for (const fieldId of SYNCED_SESSION_AUTHORING_FIELD_IDS_V1) {
        if (!Object.prototype.hasOwnProperty.call(value, fieldId)) continue;
        const parsed = SyncedSessionAuthoringValueV1Schema.shape[fieldId].safeParse(value[fieldId]);
        if (parsed.success) {
            projected[fieldId] = parsed.data;
        }
    }
    return projected as Partial<SyncedSessionAuthoringValueV1>;
}

/**
 * Projects the published 0.2 draft vocabulary into the safe canonical subset.
 * This is a reader bridge only: 0.3 writers still emit catalogued 0.3 fields.
 */
export function projectPredecessorSessionDraftAuthoringFields(
    value: unknown,
    updatedAt: number,
): Partial<SyncedSessionAuthoringValueV1> {
    if (!isRecord(value)) return {};

    const machineId = SessionDraftPredecessorAuthoringValueV1Schema.shape.machineId.safeParse(value.machineId);
    const serverId = SessionDraftPredecessorAuthoringValueV1Schema.shape.serverId.safeParse(value.serverId);
    const agentId = SessionDraftPredecessorAuthoringValueV1Schema.shape.agentId.safeParse(value.agentId);
    const backendTarget = SessionDraftPredecessorAuthoringValueV1Schema.shape.backendTarget.safeParse(value.backendTarget);
    const modelId = SessionDraftPredecessorAuthoringValueV1Schema.shape.modelId.safeParse(value.modelId);

    let canonicalBackendTarget = null;
    if (backendTarget.success && backendTarget.data) {
        try {
            canonicalBackendTarget = readBackendTargetRefV2(backendTarget.data);
        } catch {
            canonicalBackendTarget = null;
        }
    }
    const agentTarget = resolveAgentExecutionTargetForPersistedSelection({
        backendTarget: canonicalBackendTarget,
        fallbackAgentId: agentId.success ? agentId.data : null,
    });
    const executionTarget = machineId.success && machineId.data && serverId.success && serverId.data
        ? { machineId: machineId.data, serverId: serverId.data }
        : undefined;
    const modelSelection = modelId.success && modelId.data && agentTarget
        ? {
            v: 1 as const,
            ref: {
                agentTargetKey: buildBackendTargetKeyV2(agentTarget),
                providerConnectionId: null,
                modelId: modelId.data,
            },
            updatedAt,
        }
        : undefined;

    return {
        ...(executionTarget ? { executionTarget } : {}),
        ...(agentTarget ? { agentTarget } : {}),
        ...(modelSelection ? { modelSelection } : {}),
    };
}

/**
 * Projects the UI New Session draft (canonical plus retired compatibility
 * selections) onto the catalogued synchronized authoring fields. The canonical
 * `executionTarget`/`agentTarget` selections win; the retired flat vocabulary
 * only feeds their derivation and is never projected itself.
 */
export function projectNewSessionDraftSyncedAuthoringFields(params: Readonly<{
    draft: NewSessionDraft;
    scopeServerId: string;
}>): Partial<SyncedSessionAuthoringValueV1> {
    const draft = params.draft;
    const executionTarget = draft.executionTarget ?? (draft.selectedMachineId
        ? {
            serverId: draft.targetServerId?.trim() || params.scopeServerId,
            machineId: draft.selectedMachineId,
        }
        : null);
    return projectSyncedSessionAuthoringFields({
        targetType: 'new_session',
        executionTarget,
        ...(draft.selectedPath ? { directory: draft.selectedPath } : {}),
        ...(draft.checkoutCreationDraft ? { checkoutCreationDraft: draft.checkoutCreationDraft } : {}),
        ...(draft.organizationPlacement ? { organizationPlacement: draft.organizationPlacement } : {}),
        agentTarget: draft.agentTarget
            ?? resolveAgentExecutionTargetForPersistedSelection({
                backendTarget: draft.backendTarget ?? null,
                fallbackAgentId: draft.agentType,
            }),
        ...(draft.transcriptStorage !== undefined ? { transcriptStorage: draft.transcriptStorage } : {}),
        profileId: draft.selectedProfileId,
        ...(draft.resumeSessionId ? { resumeSessionId: draft.resumeSessionId } : {}),
        permissionMode: draft.permissionMode,
        ...(draft.modelSelection !== undefined ? { modelSelection: draft.modelSelection } : {}),
        ...(draft.mcpSelection !== undefined ? { mcpSelection: draft.mcpSelection } : {}),
        ...(draft.runtimeDescriptorV1 !== undefined ? { runtimeDescriptorV1: draft.runtimeDescriptorV1 } : {}),
        acpSessionModeId: draft.acpSessionModeId,
        ...(draft.automationDraft ? { automation: draft.automationDraft } : {}),
    });
}
