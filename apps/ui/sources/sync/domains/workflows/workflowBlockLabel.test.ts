import { describe, expect, it } from 'vitest';

import type { WorkflowDefinitionV1 } from '@happier-dev/protocol/workflows/workflowV1';

import { workflowDefinitionPromptTitle, workflowStepPromptLabel } from './workflowBlockLabel';

const AGENT_TARGET = {
    kind: 'agent' as const,
    identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
};

describe('workflowBlockLabel', () => {
    it('derives a frozen definition title only from its first authored prompt in reading order', () => {
        const step = {
            kind: 'step' as const,
            id: 'analyze',
            document: { text: '\n  Review the release changes  \nmore detail', references: [], attachments: [] },
            input: [],
            result: { kind: 'text' as const },
        };
        const definition: WorkflowDefinitionV1 = {
            version: 1,
            inputs: [],
            defaults: { agentTarget: AGENT_TARGET },
            blocks: [{
                kind: 'parallel',
                id: 'parallel',
                failurePolicy: 'fail_stop',
                branches: [{
                    id: 'first',
                    blocks: [step],
                }],
            }],
        };

        expect(workflowDefinitionPromptTitle(definition)).toBe('Review the release changes');
        expect(workflowStepPromptLabel(step)).toBe('Review the release changes');
    });
});
