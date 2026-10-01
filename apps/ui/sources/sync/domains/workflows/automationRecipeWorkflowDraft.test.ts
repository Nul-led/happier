import { describe, expect, it, vi } from 'vitest';

// The projection reaches Session authoring's native style boundary; use the
// complete canonical theme fixture rather than the historical global stub.
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

import {
    AutomationRunExecutionTargetV1Schema,
    SessionServerStartSpawnDraftV1Schema,
    type AutomationRunExecutionTargetV1,
} from '@happier-dev/protocol';

import {
    projectAutomationWorkflowRecipeToEditorDraft,
    projectEditorDraftToNewSessionAutomationRecipe,
    projectEditorDraftToLegacyAutomationRecipe,
    projectLegacyAutomationRecipeToEditorDraft,
} from './automationRecipeWorkflowDraft';
import { validateWorkflowEditorDraft } from './workflowAuthoring';
import { type WorkflowEditorDraft } from './workflowEditorDraft';
import { setWorkflowDefaultField, setWorkflowStepText } from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';

const AGENT_TARGET = {
    kind: 'agent' as const,
    identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
};

function spawnTarget(overrides?: Record<string, unknown>): AutomationRunExecutionTargetV1 {
    return AutomationRunExecutionTargetV1Schema.parse({
        kind: 'newSession',
        spawn: SessionServerStartSpawnDraftV1Schema.parse({
            executionTarget: { serverId: 'server-1', machineId: 'machine-1' },
            directory: { kind: 'path', path: '/repo' },
            agentTarget: AGENT_TARGET,
            permissionMode: 'default',
            configuration: {
                mode: { value: null, updatedAtMs: 10 },
                model: { value: null, updatedAtMs: 10 },
                permissionIntent: { value: 'default', updatedAtMs: 10 },
                options: {},
            },
            mcpSelection: {
                v: 1,
                managedServersEnabled: false,
                forceIncludeServerIds: ['review-tools'],
                forceExcludeServerIds: [],
            },
            checkoutCreationDraft: null,
            ...overrides,
        }),
    });
}

function legacyDraft(target: AutomationRunExecutionTargetV1, machineId: string | null = 'machine-1') {
    return projectLegacyAutomationRecipeToEditorDraft({
        draftId: 'draft-1',
        name: 'Nightly check',
        program: { v: 1, prompt: 'Review the release' },
        target,
        machineId,
    });
}

describe('legacy Automation recipe → shared Workflow draft', () => {
    it('retains a managed new-Session machine and intent through prompt edits without fabricating a project path', () => {
        const target = spawnTarget({ directory: { kind: 'managed' } });
        const projection = legacyDraft(target);
        expect(projection.project).toEqual({ machineId: 'machine-1', directory: { kind: 'managed' } });
        const edited = setWorkflowStepText(projection.draft, 'step-1', 'Review the conversation');
        const writeBack = projectEditorDraftToLegacyAutomationRecipe({
            draft: edited,
            target,
            project: { machineId: 'machine-2', directory: { kind: 'managed' } },
            configurationUpdatedAtMs: 100,
        });
        expect(writeBack).toMatchObject({
            kind: 'available',
            prompt: 'Review the conversation',
            target: { kind: 'newSession', spawn: {
                executionTarget: { serverId: 'server-1', machineId: 'machine-2' },
                directory: { kind: 'managed' },
            } },
        });
    });
    it('creates a one-shot managed Automation from the shared editor without requiring a project directory', () => {
        const projection = legacyDraft(spawnTarget({ directory: { kind: 'managed' } }));
        const result = projectEditorDraftToNewSessionAutomationRecipe({
            draft: projection.draft,
            project: { machineId: 'machine-2', directory: { kind: 'managed' } },
            serverId: 'server-1',
            configurationUpdatedAtMs: 100,
        });
        expect(result).toMatchObject({ kind: 'available', target: { kind: 'newSession', spawn: {
            executionTarget: { serverId: 'server-1', machineId: 'machine-2' },
            directory: { kind: 'managed' },
        } } });
    });
    it('adapts a one-shot new-Session recipe into one valid canonical step', () => {
        const projection = legacyDraft(spawnTarget());

        expect(projection.draft.blocks).toHaveLength(1);
        const block = projection.draft.blocks[0]!;
        expect(block.kind).toBe('step');
        expect(block.kind === 'step' ? block.document.text : null).toBe('Review the release');
        expect(projection.origin.kind).toBe('legacy');
        expect(projection.project).toEqual({ machineId: 'machine-1', directory: '/repo' });

        // The adapted draft must be a definition the canonical validator
        // accepts, not an editor-only shape.
        const validation = validateWorkflowEditorDraft(projection.draft);
        expect(validation.valid).toBe(true);
    });

    it('shows the recipe settings through the same authoring selection, not a second vocabulary', () => {
        const projection = legacyDraft(spawnTarget());

        expect(projection.draft.defaults.agentTarget).toEqual(AGENT_TARGET);
        expect(projection.draft.defaults.permissionMode).toBe('default');
        expect(projection.draft.defaults.mcpSelection).toEqual({
            v: 1,
            managedServersEnabled: false,
            forceIncludeServerIds: ['review-tools'],
            forceExcludeServerIds: [],
        });
        expect(projection.draft.defaults.conversation).toEqual({ kind: 'fresh' });
    });

    it('keeps an existing-Session recipe bound to its exact Session and machine', () => {
        const projection = legacyDraft({ kind: 'existingSession', sessionId: 'session-7' });

        expect(projection.draft.defaults.conversation).toEqual({
            kind: 'existing_session',
            sessionId: 'session-7',
            machineId: 'machine-1',
        });
    });

    it('states no conversation when no assignment resolves the existing Session machine', () => {
        const projection = legacyDraft({ kind: 'existingSession', sessionId: 'session-7' }, null);

        expect(projection.draft.defaults.conversation).toBeUndefined();
        expect(projection.project).toBeNull();
    });
});

describe('detached legacy Automation editing', () => {
    it('preserves detached settings through the shared read projection and unchanged V1 write-back', () => {
        const target = AutomationRunExecutionTargetV1Schema.parse({
            kind: 'executionRun',
            request: {
                intent: 'task', backendTarget: AGENT_TARGET, permissionMode: 'read_only',
                retentionPolicy: 'ephemeral', runClass: 'bounded', ioMode: 'request_response',
                cwd: '/detached-repo', modelId: 'review-model',
                sessionConfigOptionOverrides: { v: 1, updatedAt: 10, overrides: { reasoning_effort: { value: 'high', updatedAt: 10 } } },
            },
        });
        const projection = legacyDraft(target);
        expect(projection.project).toEqual({ machineId: 'machine-1', directory: '/detached-repo' });
        expect(projection.draft.defaults).toMatchObject({
            agentTarget: AGENT_TARGET, permissionMode: 'read-only', conversation: { kind: 'fresh' },
            modelSelection: { ref: { modelId: 'review-model', providerConnectionId: null } },
            sessionConfigOptionOverrides: { v: 1, updatedAt: 10, overrides: { reasoning_effort: { value: 'high', updatedAt: 10 } } },
        });
        expect(projectEditorDraftToLegacyAutomationRecipe({ draft: projection.draft, target, configurationUpdatedAtMs: 10 }))
            .toMatchObject({ kind: 'available', target });
    });
});

describe('shared Workflow draft → legacy Automation recipe', () => {
    it('writes an edited prompt back through the one-shot recipe it came from', () => {
        const target = spawnTarget();
        const projection = legacyDraft(target);
        const edited = setWorkflowStepText(
            projection.draft,
            projection.draft.blocks[0]!.id,
            'Review the release and report risks',
        );

        const writeBack = projectEditorDraftToLegacyAutomationRecipe({
            draft: edited,
            target,
            configurationUpdatedAtMs: 100,
        });

        expect(writeBack.kind).toBe('available');
        if (writeBack.kind !== 'available') return;
        expect(writeBack.prompt).toBe('Review the release and report risks');
        expect(writeBack.target.kind).toBe('newSession');
        // One-shot execution semantics are preserved: the same spawn target,
        // machine and directory the Automation already ran with.
        expect(writeBack.target.kind === 'newSession' ? writeBack.target.spawn.directory : null).toEqual({ kind: 'path', path: '/repo' });
    });

    it('applies an edited selection to the retained spawn and keeps its configuration snapshot consistent', () => {
        const target = spawnTarget();
        const projection = legacyDraft(target);
        const edited = setWorkflowDefaultField(projection.draft, 'permissionMode', 'safe-yolo');

        const writeBack = projectEditorDraftToLegacyAutomationRecipe({
            draft: edited,
            target,
            configurationUpdatedAtMs: 4242,
        });

        expect(writeBack.kind).toBe('available');
        if (writeBack.kind !== 'available' || writeBack.target.kind !== 'newSession') return;
        expect(writeBack.target.spawn.permissionMode).toBe('safe-yolo');
        expect(writeBack.target.spawn.configuration?.permissionIntent).toEqual({
            value: 'safe-yolo',
            updatedAtMs: 4242,
        });
        // Settings the author did not touch survive the round trip.
        expect(writeBack.target.spawn.mcpSelection?.forceIncludeServerIds).toEqual(['review-tools']);
    });

    it('round-trips an untouched recipe to the same effective target', () => {
        const target = spawnTarget();
        const writeBack = projectEditorDraftToLegacyAutomationRecipe({
            draft: legacyDraft(target).draft,
            target,
            configurationUpdatedAtMs: 10,
        });

        expect(writeBack.kind === 'available' ? writeBack.target : null).toEqual({
            kind: 'newSession',
            spawn: {
                ...(target.kind === 'newSession' ? target.spawn : {}),
                // The canonical spawn writer states the default placement
                // explicitly; nothing the Automation actually ran with changed.
                organizationPlacement: { folderId: null, tagIds: [] },
            },
        });
    });

    it('refuses to reduce a grown workflow into a one-shot recipe', () => {
        const target = spawnTarget();
        const projection = legacyDraft(target);
        const grown: WorkflowEditorDraft = {
            ...projection.draft,
            blocks: [...projection.draft.blocks, {
                kind: 'step',
                id: 'step-2',
                document: { text: 'Then implement it', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        };

        const writeBack = projectEditorDraftToLegacyAutomationRecipe({
            draft: grown,
            target,
            configurationUpdatedAtMs: 10,
        });

        expect(writeBack).toEqual({ kind: 'unavailable', reason: 'multiple_blocks' });
    });

    it('refuses a selection an existing-Session recipe cannot express instead of dropping it', () => {
        const target: AutomationRunExecutionTargetV1 = { kind: 'existingSession', sessionId: 'session-7' };
        const projection = legacyDraft(target);
        const edited = setWorkflowDefaultField(projection.draft, 'permissionMode', 'safe-yolo');

        expect(projectEditorDraftToLegacyAutomationRecipe({
            draft: edited,
            target,
            configurationUpdatedAtMs: 10,
        })).toEqual({ kind: 'unavailable', reason: 'settings_unrepresentable' });
    });

    it('keeps composer references only where the canonical materializer delivers them', () => {
        const reference = { v: 1, kind: 'file', id: 'file-1', label: 'README.md' } as never;
        const sessionTarget: AutomationRunExecutionTargetV1 = { kind: 'existingSession', sessionId: 'session-7' };
        const withReference = (target: AutomationRunExecutionTargetV1): WorkflowEditorDraft => {
            const projection = legacyDraft(target);
            const step = projection.draft.blocks[0]!;
            return {
                ...projection.draft,
                blocks: [{
                    ...step,
                    ...(step.kind === 'step'
                        ? { document: { ...step.document, references: [reference] } }
                        : {}),
                } as never],
            };
        };

        expect(projectEditorDraftToLegacyAutomationRecipe({
            draft: withReference(sessionTarget),
            target: sessionTarget,
            configurationUpdatedAtMs: 10,
        }).kind).toBe('available');

        const spawn = spawnTarget();
        expect(projectEditorDraftToLegacyAutomationRecipe({
            draft: withReference(spawn),
            target: spawn,
            configurationUpdatedAtMs: 10,
        })).toEqual({ kind: 'unavailable', reason: 'references_unsupported_target' });
    });

    it('refuses an authored workspace the one-shot recipe has no owner for', () => {
        const target = spawnTarget();
        const projection = legacyDraft(target);
        const edited = setWorkflowDefaultField(projection.draft, 'workspace', {
            kind: 'new_worktree',
            source: { kind: 'original' },
        });

        expect(projectEditorDraftToLegacyAutomationRecipe({
            draft: edited,
            target,
            configurationUpdatedAtMs: 10,
        })).toEqual({ kind: 'unavailable', reason: 'workspace_unrepresentable' });
    });
    it('round-trips structured MCP, Connected Service and explicit-null selections without collapsing them', () => {
        const connectedServices = {
            v: 1 as const,
            bindingsByServiceId: { 'happier.plugin.github/github': { source: 'native' as const } },
        };
        const target = spawnTarget({
            modelSelection: undefined,
            connectedServices,
            transcriptStorage: 'direct',
        });
        const projection = legacyDraft(target);

        // Structured selections stay structured: the MCP policy is a selection
        // object, not a list of server names, and the Connected Service binding
        // keeps its typed source.
        expect(projection.draft.defaults.mcpSelection).toEqual({
            v: 1,
            managedServersEnabled: false,
            forceIncludeServerIds: ['review-tools'],
            forceExcludeServerIds: [],
        });
        // The canonical spawn ingress already normalized the V1 binding map
        // onto its current V2 shape before the draft saw it; the typed
        // bindings themselves survive unchanged.
        expect(projection.draft.defaults.connectedServices).toEqual({
            v: 2,
            bindingsByServiceId: connectedServices.bindingsByServiceId,
        });
        expect(projection.draft.defaults.transcriptStorage).toBe('direct');

        // An explicit "automatic" model selection is recorded as an explicit
        // null rather than being dropped into inheritance.
        const edited = setWorkflowDefaultField(projection.draft, 'modelSelection', null);
        expect(Object.hasOwn(edited.defaults, 'modelSelection')).toBe(true);
        expect(edited.defaults.modelSelection).toBeNull();

        const writeBack = projectEditorDraftToLegacyAutomationRecipe({
            draft: edited,
            target,
            configurationUpdatedAtMs: 77,
        });
        expect(writeBack.kind).toBe('available');
        if (writeBack.kind !== 'available' || writeBack.target.kind !== 'newSession') return;
        const spawn = writeBack.target.spawn;
        expect(spawn.mcpSelection?.forceIncludeServerIds).toEqual(['review-tools']);
        // The canonical spawn writer normalizes the binding map onto its own
        // current ingress version; the typed bindings themselves survive.
        expect(spawn.connectedServices?.bindingsByServiceId)
            .toEqual(connectedServices.bindingsByServiceId);
        expect(spawn.transcriptStorage).toBe('direct');
        // The one-shot spawn expresses "automatic" by omission, and its
        // duplicated configuration snapshot agrees.
        expect(spawn.modelSelection).toBeUndefined();
        expect(spawn.configuration?.model.value).toBeNull();
    });

    /**
     * The one-shot spawn accepts the canonical V2 binding map, whose Team
     * resource selections a V1 map cannot express. Projecting onto the workflow
     * definition must keep the canonical V2 selection byte-equivalent through
     * the draft, the normalized definition and the write-back — never narrow
     * it to V1 and drop the Team resource alongside the native binding.
     */
    it('preserves canonical V2 Connected Service bindings, including Team resources, through draft and definition', () => {
        const connectedServices = {
            v: 2 as const,
            bindingsByServiceId: {
                'happier.plugin.github/github': { source: 'native' as const },
                'happier.plugin.linear/linear': {
                    source: 'connected' as const,
                    selection: 'profile' as const,
                    profileId: 'profile-1',
                },
                'happier.plugin.slack/slack': {
                    source: 'team_resource' as const,
                    resourceId: 'resource-1',
                    deliveryMode: 'brokered' as const,
                },
            },
        };
        const target = spawnTarget({ connectedServices });
        const projection = legacyDraft(target);
        expect(projection.draft.defaults.connectedServices).toEqual(connectedServices);

        const validation = validateWorkflowEditorDraft(projection.draft);
        expect(validation.valid).toBe(true);
        expect(validation.normalizedDefinition?.defaults.connectedServices).toEqual(connectedServices);

        const writeBack = projectEditorDraftToLegacyAutomationRecipe({
            draft: projection.draft,
            target,
            configurationUpdatedAtMs: 77,
        });
        expect(writeBack.kind).toBe('available');
        if (writeBack.kind !== 'available' || writeBack.target.kind !== 'newSession') return;
        expect(writeBack.target.spawn.connectedServices).toEqual(connectedServices);
    });
});

describe('managed Automation workflow recipe → shared Workflow draft', () => {
    it('opens a live resolved reference without copying source metadata into trigger context', () => {
        const definition = {
            version: 1 as const,
            inputs: [],
            defaults: { agentTarget: AGENT_TARGET },
            blocks: [{
                kind: 'step' as const,
                id: 'analyze',
                document: { text: 'Analyze', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' as const },
            }],
        };
        const stored = { workspace: { directory: '/srv' }, executionTarget: { kind: 'session' as const } };

        const projection = projectAutomationWorkflowRecipeToEditorDraft({
            draftId: 'draft-2',
            name: 'Managed',
            stored,
            machineId: 'machine-2',
            workflowDefinitionId: 'definition-1',
            resolvedDefinition: definition,
        });

        expect(projection.draft.name).toBe('Managed');
        expect(projection.draft.blocks[0]?.id).toBe('analyze');
        expect(projection.project).toEqual({ machineId: 'machine-2', directory: '/srv' });
        expect(projection.origin).toEqual({
            kind: 'workflow',
            project: { machineId: 'machine-2', directory: '/srv' },
            workflowDefinitionId: 'definition-1',
        });
    });
});
