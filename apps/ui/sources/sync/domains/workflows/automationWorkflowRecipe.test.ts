import { describe, expect, it } from 'vitest';
import { AutomationStoredWorkflowDefinitionRecipeV2Schema, type WorkflowDefinitionV1 } from '@happier-dev/protocol';
import { openAutomationWorkflowRecipeForAuthoring } from './automationWorkflowRecipe';

const definition: WorkflowDefinitionV1 = {
    version: 1,
    inputs: [],
    defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
    blocks: [{ kind: 'step', id: 'analyze', document: { text: 'Analyze the release', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
};

describe('automation workflow recipe', () => {
    it('opens strict inline or referenced context through the same Account reader', async () => {
        const context = { workspace: { directory: '/repo' }, executionTarget: { kind: 'session' }, inlineDefinition: definition };
        const recipe = AutomationStoredWorkflowDefinitionRecipeV2Schema.parse({ v: 2, templateVersion: 3, workflow: { t: 'encrypted', c: 'ciphertext' }, triggerEvidence: null });
        expect(await openAutomationWorkflowRecipeForAuthoring({ recipe, decryptRaw: async () => context })).toEqual(context);
        await expect(openAutomationWorkflowRecipeForAuthoring({ recipe })).rejects.toThrow();
        await expect(openAutomationWorkflowRecipeForAuthoring({ recipe, decryptRaw: async () => context, isCurrent: () => false })).rejects.toThrow();
    });
});
