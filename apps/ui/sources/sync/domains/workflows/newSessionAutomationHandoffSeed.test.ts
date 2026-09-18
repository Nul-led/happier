import { describe, expect, it } from 'vitest';

import { buildNewSessionAutomationHandoffSeed } from './newSessionAutomationHandoffSeed';
import type { SessionAuthoringDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraft';

const AGENT_TARGET = {
    kind: 'agent' as const,
    identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
};

function authoringDraft(overrides?: Partial<SessionAuthoringDraft>): SessionAuthoringDraft {
    return {
        targetType: 'new_session',
        executionTarget: { kind: 'machine', target: { serverId: 'server-1', machineId: 'machine-1' } },
        directory: '/repo',
        checkoutCreationDraft: null,
        organizationPlacement: { folderId: null, tagIds: [] },
        prompt: 'Summarize the release notes',
        displayText: 'Summarize the release notes',
        agentTarget: AGENT_TARGET,
        transcriptStorage: null,
        profileId: null,
        environmentVariables: null,
        resumeSessionId: null,
        permissionMode: 'default',
        permissionModeUpdatedAt: 42,
        modelSelection: null,
        mcpSelection: null,
        connectedServices: null,
        terminal: null,
        windowsRemoteSessionLaunchMode: null,
        windowsRemoteSessionConsole: null,
        windowsTerminalWindowName: null,
        runtimeDescriptorV1: null,
        acpSessionModeId: null,
        sessionConfigOptionOverrides: null,
        existingSessionId: null,
        sessionEncryptionMode: null,
        sessionEncryptionKeyBase64: null,
        sessionEncryptionVariant: null,
        automation: null,
        ...overrides,
    } as SessionAuthoringDraft;
}

const automationDraft = {
    enabled: true,
    name: 'Nightly notes',
    description: 'Summarize each night',
    triggers: [{
        clientId: 'schedule-1',
        definition: {
            kind: 'schedule' as const,
            enabled: true,
            schedule: { kind: 'interval' as const, scheduleExpr: null, everyMs: 60_000, timezone: null },
        },
    }],
};

describe('New Session → Automation handoff', () => {
    it('transfers the composed prompt, selections and exact placement', () => {
        const seed = buildNewSessionAutomationHandoffSeed({
            draftId: 'handoff-1',
            authoring: authoringDraft(),
            automation: automationDraft,
        });

        expect(seed.name).toBe('Nightly notes');
        expect(seed.description).toBe('Summarize each night');
        expect(seed.triggers).toEqual(automationDraft.triggers);
        expect(seed.project).toEqual({ machineId: 'machine-1', directory: '/repo' });
        const block = seed.draft.blocks[0]!;
        expect(block.kind === 'step' ? block.document.text : null).toBe('Summarize the release notes');
        // The selections travel through the same seam a saved one-shot
        // Automation uses, so nothing the person chose is silently dropped.
        expect(seed.draft.defaults.agentTarget).toEqual(AGENT_TARGET);
        expect(seed.draft.defaults.permissionMode).toBe('default');
    });

    it('still transfers the authored prompt when no placement is resolved yet', () => {
        const seed = buildNewSessionAutomationHandoffSeed({
            draftId: 'handoff-2',
            authoring: authoringDraft({ executionTarget: null, agentTarget: null }),
            automation: { ...automationDraft, triggers: [] },
        });

        const block = seed.draft.blocks[0]!;
        expect(block.kind === 'step' ? block.document.text : null).toBe('Summarize the release notes');
        // No machine was chosen, so the destination shows placement as
        // unresolved rather than inventing one.
        expect(seed.project).toBeNull();
    });
});
