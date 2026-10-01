import {
    automationRunExecutionTargetDeliversComposerReferencesV1,
    LEGACY_AUTOMATION_WORKFLOW_STEP_ID,
    pluginJsonValuesEqual,
    buildWorkflowSelectionFromServerStartSpawnDraftV1,
    buildBackendTargetKeyV2,
    SessionPermissionModeInputSchema,
    SessionServerStartSpawnDraftV1Schema,
    type AutomationRunExecutionTargetV1,
    type AutomationRunTemplateV1,
    type MentionRefV1,
} from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';
import type {
    WorkflowSessionAuthoringSelection,
    WorkflowDefinitionV1,
    WorkflowStepExecutionSelection,
} from '@happier-dev/protocol/workflows/workflowV1';

import {
    applyWorkflowSelectionToServerStartSpawnDraftV1,
} from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';

import type { OpenedAutomationWorkflowDefinition } from './automationWorkflowRecipe';
import {
    buildWorkflowEditorDraftFromDefinition,
    resolveEffectiveWorkflowStepExecution,
} from './workflowAuthoring';
import type { WorkflowEditorDraft } from './workflowEditorDraft';
import type { WorkflowAuthoringTarget } from './workflowProjectTarget';

/**
 * The one seam between a saved Automation's stored recipe and the shared
 * Workflow editor.
 *
 * Both current recipe kinds open in the same editor body: the one-shot recipe
 * (`v: 1`) is adapted into the canonical one-step Workflow definition, and the
 * workflow recipe (`v: 2`) supplies inline content or a caller-resolved live
 * definition. This module owns only that
 * projection — it decrypts nothing, validates nothing and writes nothing. The
 * Account envelope stays with `automationRecipeAuthoring.ts` /
 * `automationWorkflowRecipe.ts`, definition validation stays with the canonical
 * Protocol validator, and the durable write stays with
 * `saveAutomationEditorDraft`.
 *
 * A one-shot Automation keeps its one-shot recipe while the author only edits
 * what that recipe can express. Adopting the one-machine workflow contract is
 * an explicit, visible choice, so an edit the one-shot arm cannot represent
 * fails closed here with its exact reason instead of silently converting
 * execution semantics or dropping the author's selection.
 */

export type AutomationWorkflowEditorOrigin =
    | Readonly<{ kind: 'legacy'; target: AutomationRunExecutionTargetV1 }>
    | Readonly<{
        kind: 'workflow';
        project: WorkflowProjectTargetV1;
        workflowDefinitionId: string | null;
    }>;

export type AutomationWorkflowEditorProjection = Readonly<{
    draft: WorkflowEditorDraft;
    origin: AutomationWorkflowEditorOrigin;
    /** The exact placement the recipe already records, when it records one. */
    project: WorkflowAuthoringTarget | null;
}>;

/** The single step id an adapted one-shot recipe uses, matching editor-created ids. */
export { LEGACY_AUTOMATION_WORKFLOW_STEP_ID };

function legacyProject(
    target: AutomationRunExecutionTargetV1,
    machineId: string | null,
): WorkflowAuthoringTarget | null {
    if (target.kind === 'newSession') {
        return {
            machineId: target.spawn.executionTarget.machineId,
            directory: target.spawn.directory.kind === 'path' ? target.spawn.directory.path : target.spawn.directory,
        };
    }
    return target.kind === 'executionRun' && machineId !== null && target.request.cwd
        ? { machineId, directory: target.request.cwd }
        : null;
}

/** Presentation of current one-shot targets, not retained-0.2 conversion authority. */
function oneShotExecutionSelection(
    target: AutomationRunExecutionTargetV1,
    machineId: string | null,
): WorkflowStepExecutionSelection {
    if (target.kind === 'existingSession') {
        return machineId === null ? {} : { conversation: { kind: 'existing_session', sessionId: target.sessionId, machineId } };
    }
    if (target.kind === 'newSession') {
        return { ...buildWorkflowSelectionFromServerStartSpawnDraftV1(target.spawn), conversation: { kind: 'fresh' } };
    }
    const request = target.request;
    return {
        agentTarget: request.backendTarget,
        permissionMode: SessionPermissionModeInputSchema.parse(request.permissionMode),
        ...(request.modelSelection ? { modelSelection: { v: 1, ref: request.modelSelection, updatedAt: 0 } }
            : request.modelId ? { modelSelection: { v: 1, ref: {
            agentTargetKey: buildBackendTargetKeyV2(request.backendTarget), providerConnectionId: null, modelId: request.modelId,
        }, updatedAt: 0 } } : {}),
        ...(request.sessionConfigOptionOverrides === undefined ? {} : { sessionConfigOptionOverrides: request.sessionConfigOptionOverrides }),
        ...(request.mcpSelection === undefined ? {} : { mcpSelection: request.mcpSelection }),
        ...(request.connectedServices === undefined ? {} : { connectedServices: request.connectedServices }),
        ...(request.profileId === undefined ? {} : { profileId: request.profileId }),
        conversation: { kind: 'fresh' },
    };
}

/** Opens a current one-shot recipe as the canonical one-step Workflow draft. */
export function projectLegacyAutomationRecipeToEditorDraft(params: Readonly<{
    draftId: string;
    name: string;
    program: AutomationRunTemplateV1;
    target: AutomationRunExecutionTargetV1;
    /** The Automation's enabled assignment, used only where the target omits one. */
    machineId: string | null;
}>): AutomationWorkflowEditorProjection {
    return {
        draft: buildWorkflowEditorDraftFromDefinition({
            draftId: params.draftId,
            name: params.name,
            definition: { version: 1, inputs: [], defaults: oneShotExecutionSelection(params.target, params.machineId),
                blocks: [{ kind: 'step', id: LEGACY_AUTOMATION_WORKFLOW_STEP_ID,
                    document: { text: params.program.prompt, references: [...(params.program.mentions ?? [])], attachments: [] },
                    input: [], result: { kind: 'text' } }] },
        }),
        origin: { kind: 'legacy', target: params.target },
        project: legacyProject(params.target, params.machineId),
    };
}

/** Opens inline content or the caller's live-resolved Workflow reference. */
export function projectAutomationWorkflowRecipeToEditorDraft(params: Readonly<{
    draftId: string;
    name: string;
    stored: OpenedAutomationWorkflowDefinition;
    machineId: string;
    workflowDefinitionId: string | null;
    resolvedDefinition?: WorkflowDefinitionV1;
}>): AutomationWorkflowEditorProjection {
    const definition = params.workflowDefinitionId === null
        ? params.stored.inlineDefinition
        : params.resolvedDefinition;
    if (!definition) throw new Error('Automation workflow definition is unavailable');
    const project = { machineId: params.machineId, ...params.stored.workspace };
    return {
        draft: buildWorkflowEditorDraftFromDefinition({
            draftId: params.draftId,
            name: params.name,
            definition,
        }),
        origin: {
            kind: 'workflow',
            project,
            workflowDefinitionId: params.workflowDefinitionId,
        },
        project,
    };
}

export type LegacyAutomationRecipeWriteBackReason =
    | 'multiple_blocks'
    | 'nested_blocks'
    | 'declared_inputs'
    | 'final_output'
    | 'step_input_reference'
    | 'structured_result'
    | 'authored_timeout'
    | 'entry_condition'
    | 'prompt_required'
    | 'attachments_unsupported'
    | 'references_unsupported_target'
    | 'conversation_unrepresentable'
    | 'workspace_unrepresentable'
    | 'settings_unrepresentable'
    | 'agent_target_required'
    | 'permission_mode_required'
    | 'runtime_descriptor_unsupported'
    | 'spawn_unrepresentable';

export type LegacyAutomationRecipeWriteBack =
    | Readonly<{
        kind: 'available';
        prompt: string;
        mentions: readonly MentionRefV1[];
        target: AutomationRunExecutionTargetV1;
    }>
    | Readonly<{ kind: 'unavailable'; reason: LegacyAutomationRecipeWriteBackReason }>;

function selectionWithoutContinuity(
    execution: WorkflowStepExecutionSelection,
): WorkflowSessionAuthoringSelection {
    const { conversation: _conversation, workspace: _workspace, ...selection } = execution;
    return selection;
}

function conversationIsRepresentable(
    execution: WorkflowStepExecutionSelection,
    target: AutomationRunExecutionTargetV1,
): boolean {
    const conversation = execution.conversation;
    if (conversation === undefined) return true;
    if (target.kind === 'existingSession') {
        return conversation.kind === 'existing_session' && conversation.sessionId === target.sessionId;
    }
    return conversation.kind === 'fresh';
}

/**
 * Projects a newly authored one-step draft onto the current one-shot recipe.
 *
 * A one-prompt Automation stays a one-prompt Automation: creation only reaches
 * the managed workflow recipe when the author actually wrote something the
 * one-shot recipe cannot express. The placement the author reviewed becomes the
 * spawn's exact machine and directory.
 */
export function projectEditorDraftToNewSessionAutomationRecipe(params: Readonly<{
    draft: WorkflowEditorDraft;
    project: WorkflowAuthoringTarget;
    serverId: string;
    configurationUpdatedAtMs: number;
}>): LegacyAutomationRecipeWriteBack {
    const defaults = params.draft.defaults;
    const agentTarget = defaults.agentTarget;
    if (!agentTarget) return { kind: 'unavailable', reason: 'agent_target_required' };
    const base = SessionServerStartSpawnDraftV1Schema.safeParse({
        executionTarget: { serverId: params.serverId, machineId: params.project.machineId },
        directory: typeof params.project.directory === 'string' ? { kind: 'path', path: params.project.directory } : params.project.directory,
        agentTarget,
        permissionMode: defaults.permissionMode ?? 'default',
    });
    if (!base.success) return { kind: 'unavailable', reason: 'spawn_unrepresentable' };
    return projectEditorDraftToLegacyAutomationRecipe({
        draft: params.draft,
        target: { kind: 'newSession', spawn: base.data },
        configurationUpdatedAtMs: params.configurationUpdatedAtMs,
    });
}

/**
 * Projects the edited one-step draft back onto its current one-shot recipe.
 *
 * A one-step draft has no inheritance to preserve — its effective execution is
 * what the single occurrence runs with — so the effective selection is written
 * back and an explicit-but-equal override is not a distinction the one-shot
 * recipe can or needs to express.
 */
export function projectEditorDraftToLegacyAutomationRecipe(params: Readonly<{
    draft: WorkflowEditorDraft;
    target: AutomationRunExecutionTargetV1;
    project?: WorkflowAuthoringTarget | null;
    configurationUpdatedAtMs: number;
}>): LegacyAutomationRecipeWriteBack {
    const blocks = params.draft.blocks;
    if (blocks.length !== 1) return { kind: 'unavailable', reason: 'multiple_blocks' };
    const step = blocks[0]!;
    if (step.kind !== 'step') return { kind: 'unavailable', reason: 'nested_blocks' };
    if (params.draft.inputs.length > 0) return { kind: 'unavailable', reason: 'declared_inputs' };
    if (params.draft.finalOutput !== undefined) return { kind: 'unavailable', reason: 'final_output' };
    if (step.input.length > 0) return { kind: 'unavailable', reason: 'step_input_reference' };
    if (step.result.kind !== 'text') return { kind: 'unavailable', reason: 'structured_result' };
    if (step.timeoutMs !== undefined) return { kind: 'unavailable', reason: 'authored_timeout' };
    if (step.onlyWhen !== undefined) return { kind: 'unavailable', reason: 'entry_condition' };

    const prompt = step.document.text;
    if (prompt.trim().length === 0) return { kind: 'unavailable', reason: 'prompt_required' };
    if (step.document.attachments.length > 0) {
        return { kind: 'unavailable', reason: 'attachments_unsupported' };
    }
    const references = step.document.references;
    if (
        references.length > 0
        && !automationRunExecutionTargetDeliversComposerReferencesV1(params.target.kind)
    ) {
        // The canonical materializer only hands composer references to the
        // existing-Session target, so storing them here would persist content
        // that dispatch drops.
        return { kind: 'unavailable', reason: 'references_unsupported_target' };
    }

    const effective = resolveEffectiveWorkflowStepExecution(params.draft, step);
    if (!conversationIsRepresentable(effective, params.target)) {
        return { kind: 'unavailable', reason: 'conversation_unrepresentable' };
    }
    const workspace = effective.workspace;
    if (workspace !== undefined && workspace.kind !== 'inherit' && workspace.kind !== 'project_checkout') {
        return { kind: 'unavailable', reason: 'workspace_unrepresentable' };
    }

    const selection = selectionWithoutContinuity(effective);
    if (params.target.kind !== 'newSession') {
        const retained = selectionWithoutContinuity(
            oneShotExecutionSelection(params.target, null),
        );
        return pluginJsonValuesEqual(selection, retained)
            ? { kind: 'available', prompt, mentions: references, target: params.target }
            : { kind: 'unavailable', reason: 'settings_unrepresentable' };
    }

    const retainedSpawn = params.target.spawn;
    const directory = params.project
        ? typeof params.project.directory === 'string'
            ? { kind: 'path' as const, path: params.project.directory }
            : params.project.directory
        : retainedSpawn.directory;
    const placementChanged = params.project !== undefined && params.project !== null && (
        params.project.machineId !== retainedSpawn.executionTarget.machineId
        || !pluginJsonValuesEqual(directory, retainedSpawn.directory)
    );
    const spawn = applyWorkflowSelectionToServerStartSpawnDraftV1({
        spawn: params.project ? {
            ...retainedSpawn,
            executionTarget: { ...retainedSpawn.executionTarget, machineId: params.project.machineId },
            directory,
            ...(placementChanged || directory.kind === 'managed' ? { checkoutCreationDraft: null } : {}),
        } : retainedSpawn,
        selection,
        configurationUpdatedAtMs: params.configurationUpdatedAtMs,
    });
    if (spawn.kind === 'unavailable') return { kind: 'unavailable', reason: spawn.reason };
    return {
        kind: 'available',
        prompt,
        mentions: references,
        target: { kind: 'newSession', spawn: spawn.spawn },
    };
}
