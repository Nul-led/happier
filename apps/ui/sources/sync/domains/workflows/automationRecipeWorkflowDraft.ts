import {
    automationRunExecutionTargetDeliversComposerReferencesV1,
    pluginJsonValuesEqual,
    SessionServerStartSpawnDraftV1Schema,
    type AutomationRunExecutionTargetV1,
    type AutomationRunTemplateV1,
    type MentionRefV1,
} from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';
import type {
    WorkflowSessionAuthoringSelection,
    WorkflowStep,
    WorkflowStepExecutionSelection,
} from '@happier-dev/protocol/workflows/workflowV1';

import {
    applyWorkflowSelectionToServerStartSpawnDraftV1,
    buildWorkflowSelectionFromServerStartSpawnDraftV1,
} from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';

import type { OpenedAutomationWorkflowDefinition } from './automationWorkflowRecipe';
import {
    buildWorkflowEditorDraftFromDefinition,
    resolveEffectiveWorkflowStepExecution,
} from './workflowAuthoring';
import { createWorkflowEditorDraft, type WorkflowEditorDraft } from './workflowEditorDraft';

/**
 * The one seam between a saved Automation's stored recipe and the shared
 * Workflow editor.
 *
 * Both recipe epochs open in the same editor body: the released one-shot recipe
 * (`v: 1`) is adapted into the canonical one-step Workflow definition, and the
 * managed workflow recipe (`v: 2`) already is one. This module owns only that
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
        source?: OpenedAutomationWorkflowDefinition['source'];
    }>;

export type AutomationWorkflowEditorProjection = Readonly<{
    draft: WorkflowEditorDraft;
    origin: AutomationWorkflowEditorOrigin;
    /** The exact placement the recipe already records, when it records one. */
    project: WorkflowProjectTargetV1 | null;
}>;

/** The single step id an adapted one-shot recipe uses, matching editor-created ids. */
export const LEGACY_AUTOMATION_WORKFLOW_STEP_ID = 'step-1';

function legacyDefaults(
    target: AutomationRunExecutionTargetV1,
    machineId: string | null,
): WorkflowStepExecutionSelection {
    switch (target.kind) {
        case 'newSession':
            return {
                ...buildWorkflowSelectionFromServerStartSpawnDraftV1(target.spawn),
                // Each occurrence spawns its own Session, which is exactly the
                // workflow vocabulary's fresh conversation.
                conversation: { kind: 'fresh' },
            };
        case 'existingSession':
            // The conversation schema binds the Session to its exact machine.
            // Without a resolved assignment the selection stays unstated rather
            // than inventing a placement the recipe never recorded.
            return machineId === null
                ? {}
                : { conversation: { kind: 'existing_session', sessionId: target.sessionId, machineId } };
        case 'executionRun':
            // The detached request carries a backend target and permission
            // mode that have no authored Session-selection equivalent; they are
            // retained verbatim and are not re-expressed as workflow defaults.
            return {};
    }
}

function legacyProject(
    target: AutomationRunExecutionTargetV1,
    machineId: string | null,
): WorkflowProjectTargetV1 | null {
    if (target.kind === 'newSession') {
        return {
            machineId: target.spawn.executionTarget.machineId,
            directory: target.spawn.directory,
        };
    }
    // These arms record no project directory. The assignment still names the
    // exact machine, and the editor shows the directory as visibly unresolved
    // rather than inventing a checkout path the Automation never had.
    return machineId === null ? null : { machineId, directory: '' };
}

/** Opens a released one-shot recipe as the canonical one-step Workflow draft. */
export function projectLegacyAutomationRecipeToEditorDraft(params: Readonly<{
    draftId: string;
    name: string;
    program: AutomationRunTemplateV1;
    target: AutomationRunExecutionTargetV1;
    /** The Automation's enabled assignment, used only where the target omits one. */
    machineId: string | null;
}>): AutomationWorkflowEditorProjection {
    const step: WorkflowStep = {
        kind: 'step',
        id: LEGACY_AUTOMATION_WORKFLOW_STEP_ID,
        document: {
            text: params.program.prompt,
            references: [...(params.program.mentions ?? [])],
            attachments: [],
        },
        input: [],
        result: { kind: 'text' },
    };
    return {
        draft: createWorkflowEditorDraft({
            draftId: params.draftId,
            name: params.name,
            defaults: legacyDefaults(params.target, params.machineId),
            blocks: [step],
        }),
        origin: { kind: 'legacy', target: params.target },
        project: legacyProject(params.target, params.machineId),
    };
}

/** Opens a frozen managed workflow recipe in the same editor body. */
export function projectAutomationWorkflowRecipeToEditorDraft(params: Readonly<{
    draftId: string;
    name: string;
    stored: OpenedAutomationWorkflowDefinition;
}>): AutomationWorkflowEditorProjection {
    return {
        draft: buildWorkflowEditorDraftFromDefinition({
            draftId: params.draftId,
            name: params.name,
            definition: params.stored.definition,
        }),
        origin: {
            kind: 'workflow',
            project: params.stored.project,
            ...(params.stored.source === undefined ? {} : { source: params.stored.source }),
        },
        project: params.stored.project,
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
 * Projects a newly authored one-step draft onto the released one-shot recipe.
 *
 * A one-prompt Automation stays a one-prompt Automation: creation only reaches
 * the managed workflow recipe when the author actually wrote something the
 * one-shot recipe cannot express. The placement the author reviewed becomes the
 * spawn's exact machine and directory.
 */
export function projectEditorDraftToNewSessionAutomationRecipe(params: Readonly<{
    draft: WorkflowEditorDraft;
    project: WorkflowProjectTargetV1;
    serverId: string;
    configurationUpdatedAtMs: number;
}>): LegacyAutomationRecipeWriteBack {
    const defaults = params.draft.defaults;
    const agentTarget = defaults.agentTarget;
    if (!agentTarget) return { kind: 'unavailable', reason: 'agent_target_required' };
    const base = SessionServerStartSpawnDraftV1Schema.safeParse({
        executionTarget: { serverId: params.serverId, machineId: params.project.machineId },
        directory: params.project.directory,
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
 * Projects the edited one-step draft back onto its released one-shot recipe.
 *
 * A one-step draft has no inheritance to preserve — its effective execution is
 * what the single occurrence runs with — so the effective selection is written
 * back and an explicit-but-equal override is not a distinction the one-shot
 * recipe can or needs to express.
 */
export function projectEditorDraftToLegacyAutomationRecipe(params: Readonly<{
    draft: WorkflowEditorDraft;
    target: AutomationRunExecutionTargetV1;
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
            legacyDefaults(params.target, null),
        );
        return pluginJsonValuesEqual(selection, retained)
            ? { kind: 'available', prompt, mentions: references, target: params.target }
            : { kind: 'unavailable', reason: 'settings_unrepresentable' };
    }

    const spawn = applyWorkflowSelectionToServerStartSpawnDraftV1({
        spawn: params.target.spawn,
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
