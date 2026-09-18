import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AutomationStoredWorkflowDefinitionRecipeV2Schema } from '@happier-dev/protocol';

const fetchAccountEncryptionModeMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: fetchAccountEncryptionModeMock,
}));

const AGENT_TARGET = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.claude', localId: 'claude' } };

const definition = {
    version: 1,
    inputs: [],
    defaults: { agentTarget: AGENT_TARGET },
    blocks: [{
        kind: 'step',
        id: 'analyze',
        document: { text: 'Analyze the release', references: [], attachments: [] },
        input: [],
        result: { kind: 'text' },
    }],
} as const;

const credentials = { token: 'token' } as never;

type PlainDefinition = Readonly<{
    definition: Readonly<{ blocks: ReadonlyArray<Readonly<{ id: string }>> }>;
    project: Readonly<{ machineId: string; directory: string }>;
    source?: Readonly<Record<string, unknown>>;
}>;

/** Narrows the stored envelope on its own discriminant rather than casting across it. */
function plainDefinition(recipe: Readonly<{ workflow: unknown }>): PlainDefinition {
    const envelope = recipe.workflow as Readonly<{ t: string; v?: unknown }>;
    if (envelope.t !== 'plain') throw new Error('expected a plain workflow envelope');
    return envelope.v as PlainDefinition;
}

function seed(origin: unknown = null) {
    return {
        name: 'Release check',
        definition,
        project: { machineId: 'machine-1', directory: '/repo' },
        origin,
    } as never;
}

describe('automation workflow recipe', () => {
    beforeEach(() => {
        fetchAccountEncryptionModeMock.mockReset();
    });

    it('freezes the reviewed definition into the canonical V2 recipe for a plain Account', async () => {
        const { buildAutomationWorkflowRecipe } = await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'plain' });

        const recipe = await buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed(),
        });

        const parsed = AutomationStoredWorkflowDefinitionRecipeV2Schema.parse(recipe);
        expect(parsed.v).toBe(2);
        expect(parsed.templateVersion).toBe(1);
        expect(parsed.triggerEvidence).toBeNull();
        expect(parsed.workflow.t).toBe('plain');
        expect(plainDefinition(parsed).definition.blocks[0]?.id).toBe('analyze');
    });

    it('stores only the reviewed definition and defers Automation origin and input binding to Run claim', async () => {
        const { buildAutomationWorkflowRecipe } = await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'plain' });

        const recipe = await buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed(),
        });

        expect(plainDefinition(recipe)).toEqual({
            definition,
            metadata: { title: 'Release check' },
            project: { machineId: 'machine-1', directory: '/repo' },
        });
    });

    it('carries the Artifact revision only when the copy really is that revision', async () => {
        const { buildAutomationWorkflowRecipe } = await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'plain' });
        const revision = { headerVersion: 2, bodyVersion: 5 };

        const matching = await buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed({ definitionId: 'definition-1', revision, matchesSavedRevision: true }),
        });
        expect(plainDefinition(matching).source).toEqual({ definitionId: 'definition-1', revision });

        const edited = await buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed({ definitionId: 'definition-1', revision, matchesSavedRevision: false }),
        });
        const editedSource = plainDefinition(edited).source;
        // An edited draft is not that revision, so it must not claim to be.
        expect(editedSource).toBeUndefined();
    });

    it('seals the definition for an e2ee Account and never stores it in plaintext', async () => {
        const { buildAutomationWorkflowRecipe } = await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'e2ee' });
        const encryptRaw = vi.fn().mockResolvedValue('ciphertext');

        const recipe = await buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed(),
            encryptRaw,
        });

        expect(recipe.workflow).toEqual({ t: 'encrypted', c: 'ciphertext' });
        expect(JSON.stringify(recipe)).not.toContain('Analyze the release');
        expect(encryptRaw).toHaveBeenCalledTimes(1);
    });

    it('fails closed when e2ee material is unavailable rather than writing plaintext', async () => {
        const { buildAutomationWorkflowRecipe } = await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'e2ee' });

        await expect(buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed(),
        })).rejects.toThrow();
    });

    it('refuses an invalid definition instead of scheduling unrunnable content', async () => {
        const { buildAutomationWorkflowRecipe } = await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'plain' });

        await expect(buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: { name: 'Broken', definition: { version: 1, blocks: [] }, project: {
                machineId: 'machine-1', directory: '/repo',
            }, origin: null } as never,
        })).rejects.toThrow();
    });

    it('abandons the write when the authoring authority changed mid-flight', async () => {
        const { buildAutomationWorkflowRecipe } = await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'plain' });

        await expect(buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed(),
            isCurrent: () => false,
        })).rejects.toThrow();
    });
    it('opens a plain Account recipe back into the exact reviewed definition', async () => {
        const { buildAutomationWorkflowRecipe, openAutomationWorkflowRecipeForAuthoring } =
            await import('./automationWorkflowRecipe');
        fetchAccountEncryptionModeMock.mockResolvedValue({ mode: 'plain' });
        const recipe = await buildAutomationWorkflowRecipe({
            credentials,
            automationId: 'automation-1',
            templateVersion: 1,
            seed: seed(),
        });

        const opened = await openAutomationWorkflowRecipeForAuthoring({ recipe });

        expect(opened.definition).toEqual(definition);
        expect(opened.project).toEqual({ machineId: 'machine-1', directory: '/repo' });
    });

    it('opens an e2ee recipe only through the Account codec', async () => {
        const { openAutomationWorkflowRecipeForAuthoring } = await import('./automationWorkflowRecipe');
        const recipe = AutomationStoredWorkflowDefinitionRecipeV2Schema.parse({
            v: 2,
            templateVersion: 3,
            workflow: { t: 'encrypted', c: 'ciphertext' },
            triggerEvidence: null,
        });
        const decryptRaw = vi.fn().mockResolvedValue({
            definition,
            project: { machineId: 'machine-1', directory: '/repo' },
        });

        const opened = await openAutomationWorkflowRecipeForAuthoring({ recipe, decryptRaw });

        expect(decryptRaw).toHaveBeenCalledWith('ciphertext');
        expect(opened.definition).toEqual(definition);
    });

    it('fails closed when the sealed definition cannot be opened on this device', async () => {
        const { openAutomationWorkflowRecipeForAuthoring } = await import('./automationWorkflowRecipe');
        const recipe = AutomationStoredWorkflowDefinitionRecipeV2Schema.parse({
            v: 2,
            templateVersion: 3,
            workflow: { t: 'encrypted', c: 'ciphertext' },
            triggerEvidence: null,
        });

        // No Account codec: the editor must not open empty and then overwrite
        // the stored definition on Save.
        await expect(openAutomationWorkflowRecipeForAuthoring({ recipe })).rejects.toThrow();
    });

    it('abandons the read when the authoring authority changed mid-flight', async () => {
        const { openAutomationWorkflowRecipeForAuthoring } = await import('./automationWorkflowRecipe');
        const recipe = AutomationStoredWorkflowDefinitionRecipeV2Schema.parse({
            v: 2,
            templateVersion: 3,
            workflow: { t: 'encrypted', c: 'ciphertext' },
            triggerEvidence: null,
        });

        await expect(openAutomationWorkflowRecipeForAuthoring({
            recipe,
            decryptRaw: async () => ({ definition, project: { machineId: 'machine-1', directory: '/repo' } }),
            isCurrent: () => false,
        })).rejects.toThrow();
    });
});
