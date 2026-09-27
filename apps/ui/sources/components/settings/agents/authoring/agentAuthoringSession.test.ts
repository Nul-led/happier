import { describe, expect, it, vi } from 'vitest';

import { buildAgentAuthoringSessionSeed } from './agentAuthoringSession';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

describe('buildAgentAuthoringSessionSeed', () => {
    it('opens on the machine Agents manages, leaving the folder to the New Session defaults', () => {
        expect(buildAgentAuthoringSessionSeed({
            intent: 'configureAcpBackend',
            target: { serverId: 'server-a', machineId: 'machine-1' },
        })).toEqual({
            prompt: 'settingsAgents.authoring.configureAcpBackendPrompt',
            placement: { kind: 'exactTarget', serverId: 'server-a', machineId: 'machine-1' },
        });
    });

    it('lets New Session pick the last used machine when Agents manages none, and keeps one prompt per intent', () => {
        expect(buildAgentAuthoringSessionSeed({ intent: 'addAgent', target: null })).toEqual({
            prompt: 'settingsAgents.authoring.addAgentPrompt',
        });
    });
});
