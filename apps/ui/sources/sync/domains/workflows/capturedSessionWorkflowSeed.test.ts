import { describe, expect, it } from 'vitest';

import type { SessionAuthoringDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraft';

import { buildCapturedSessionWorkflowSeed } from './capturedSessionWorkflowSeed';

const SESSION_DRAFT: SessionAuthoringDraft = {
    targetType: 'existing_session',
    executionTarget: {
        kind: 'machine',
        target: { serverId: 'server-1', machineId: 'machine-1' },
    },
    directory: '/repo/project',
    checkoutCreationDraft: null,
    organizationPlacement: { folderId: null, tagIds: [] },
    prompt: '',
    displayText: '',
    agentTarget: {
        kind: 'agent',
        identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
    },
    transcriptStorage: null,
    profileId: null,
    environmentVariables: null,
    resumeSessionId: null,
    permissionMode: 'default',
    permissionModeUpdatedAt: 123,
    modelId: null,
    modelUpdatedAt: null,
    mcpSelection: null,
    connectedServices: null,
    terminal: null,
    windowsRemoteSessionLaunchMode: null,
    windowsRemoteSessionConsole: null,
    runtimeDescriptorV1: null,
    acpSessionModeId: null,
    sessionConfigOptionOverrides: null,
    existingSessionId: 'session-1',
    sessionEncryptionMode: 'e2ee',
    sessionEncryptionKeyBase64: 'dek-1',
    sessionEncryptionVariant: 'dataKey',
    automation: null,
};

describe('buildCapturedSessionWorkflowSeed', () => {
    it('captures the current Agent, exact machine, project, and existing Session continuity for prompt-only steps', () => {
        const seed = buildCapturedSessionWorkflowSeed({
            draftId: 'workflow-draft-1',
            sessionId: 'session-1',
            draft: SESSION_DRAFT,
        });

        expect(seed).toMatchObject({
            project: { machineId: 'machine-1', directory: '/repo/project' },
            draft: {
                draftId: 'workflow-draft-1',
                defaults: {
                    agentTarget: SESSION_DRAFT.agentTarget,
                    permissionMode: 'default',
                    conversation: {
                        kind: 'existing_session',
                        sessionId: 'session-1',
                        machineId: 'machine-1',
                    },
                    workspace: { kind: 'inherit' },
                },
            },
        });
    });
});
