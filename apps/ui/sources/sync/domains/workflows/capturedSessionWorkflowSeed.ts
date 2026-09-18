import { PortableRuntimeDescriptorV1Schema } from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';

import {
    buildSessionServerStartSpawnDraftV1FromAuthoringDraft,
    buildWorkflowSelectionFromServerStartSpawnDraftV1,
} from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';
import type { SessionAuthoringDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraft';

import { createWorkflowEditorDraft, type WorkflowEditorDraft } from './workflowEditorDraft';

export type CapturedSessionWorkflowSeed = Readonly<{
    draft: WorkflowEditorDraft;
    project: WorkflowProjectTargetV1;
}>;

/**
 * Captures the incumbent Session-authoring selection through its canonical
 * spawn projection, then adds only the existing-Session continuity choice.
 * The Session id is runtime context, not persisted author-authored JSON.
 */
export function buildCapturedSessionWorkflowSeed(input: Readonly<{
    draftId: string;
    sessionId: string;
    draft: SessionAuthoringDraft;
}>): CapturedSessionWorkflowSeed | null {
    if (input.draft.executionTarget?.kind !== 'machine' || input.draft.agentTarget === null) return null;
    const permissionMode = input.draft.permissionMode?.trim();
    if (!permissionMode) return null;
    try {
        const spawn = buildSessionServerStartSpawnDraftV1FromAuthoringDraft({
            draft: input.draft,
            permissionMode,
            configurationUpdatedAtMs: input.draft.permissionModeUpdatedAt ?? 0,
        });
        const machineId = spawn.executionTarget.machineId;
        // A saved definition retains only the authored launch selection. A live
        // Session descriptor carrying Agent-owned recovery data is not portable,
        // so it is left out rather than smuggled into author-authored JSON.
        const portableRuntimeDescriptor = PortableRuntimeDescriptorV1Schema
            .safeParse(input.draft.runtimeDescriptorV1);
        return {
            draft: createWorkflowEditorDraft({
                draftId: input.draftId,
                defaults: {
                    ...buildWorkflowSelectionFromServerStartSpawnDraftV1(spawn),
                    ...(portableRuntimeDescriptor.success
                        ? { runtimeDescriptorV1: portableRuntimeDescriptor.data }
                        : {}),
                    conversation: {
                        kind: 'existing_session',
                        sessionId: input.sessionId,
                        machineId,
                    },
                    workspace: { kind: 'inherit' },
                },
            }),
            project: { machineId, directory: spawn.directory },
        };
    } catch {
        return null;
    }
}
