import { afterEach, describe, expect, it } from 'vitest';

import type { ComposerAttachmentDraftV1 } from '@happier-dev/protocol';
import type {
    NewSessionComposerAttachmentSeedV1,
    NewSessionDraft,
} from '@/sync/domains/state/persistence';
import {
    getSessionDraftSnapshot,
    resetSessionDraftRepositoryForTests,
    writeNewSessionDraft,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';

import {
    readNewSessionDraftFromRepository,
    clearNewSessionComposerAttachmentSeedsFromRepository,
    writeNewSessionAuthoringDraftToRepository,
    writeNewSessionDraftToRepository,
} from './newSessionDraftRepositoryAdapter';

const scope = { serverId: 'server-a', accountId: 'account-a' } as const;
const attachment: ComposerAttachmentDraftV1 = {
    v: 1,
    instanceId: 'attachment-a',
    attachment: { pluginId: 'example.plugin', localId: 'ticket' },
    key: 'ticket-a',
    value: { id: 42 },
    presentation: { typeLabel: 'Ticket', label: 'Issue 42' },
};

function authoringDraft(overrides: Partial<NewSessionDraft> = {}): NewSessionDraft {
    return {
        input: 'stale delayed text',
        composerAttachments: [],
        selectedMachineId: 'machine-b',
        selectedPath: '/repo',
        entryIntent: 'session',
        selectedProfileId: null,
        selectedSecretId: null,
        agentType: 'codex',
        permissionMode: 'default',
        acpSessionModeId: null,
        updatedAt: 10,
        ...overrides,
    };
}

afterEach(() => {
    resetSessionDraftRepositoryForTests();
});

describe('newSessionDraftRepositoryAdapter', () => {
    it('projects a published 0.2 draft into canonical 0.3 selections without deleting predecessor fields', () => {
        const draftId = 'predecessor-draft';
        writeNewSessionDraft({
            scope,
            draftId,
            patch: {
                text: 'Continue on another device',
                // Reader-compatibility fixture: current writers intentionally exclude predecessor keys.
                authoring: {
                    machineId: 'machine-legacy',
                    serverId: 'server-legacy',
                    agentId: 'codex',
                    backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                    modelId: 'gpt-5',
                    codexBackendMode: 'appServer',
                } as never,
            },
            materializationIntent: 'userEdit',
        });

        const recovered = readNewSessionDraftFromRepository({ scope, draftId });
        expect(recovered).toMatchObject({
            input: 'Continue on another device',
            selectedMachineId: 'machine-legacy',
            targetServerId: 'server-legacy',
            executionTarget: { serverId: 'server-legacy', machineId: 'machine-legacy' },
            agentType: 'codex',
            agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
            modelSelection: {
                v: 1,
                ref: {
                    agentTargetKey: 'agent:happier.agent.codex/codex',
                    providerConnectionId: null,
                    modelId: 'gpt-5',
                },
            },
        });

        writeNewSessionDraftToRepository({ scope, draftId, draft: recovered! });
        expect(getSessionDraftSnapshot(scope, { kind: 'newSession', draftId })?.document.target).toMatchObject({
            kind: 'newSession',
            authoring: {
                machineId: { value: 'machine-legacy' },
                serverId: { value: 'server-legacy' },
                agentId: { value: 'codex' },
                backendTarget: { value: { kind: 'builtInAgent', agentId: 'codex' } },
                modelId: { value: 'gpt-5' },
                codexBackendMode: { value: 'appServer' },
                executionTarget: { value: { serverId: 'server-legacy', machineId: 'machine-legacy' } },
                agentTarget: {
                    value: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
                },
            },
        });
    });

    it('persists delayed authoring fields without rewriting the canonical composer document', () => {
        const draftId = 'draft-a';
        writeNewSessionDraft({
            scope,
            draftId,
            patch: {
                text: 'live composer text',
                mentions: [{ kind: 'mention', tokenText: '@issue', start: 0, end: 6 }],
                attachments: [attachment],
            },
            materializationIntent: 'userEdit',
        });

        writeNewSessionAuthoringDraftToRepository({
            scope,
            draftId,
            draft: authoringDraft(),
        });

        const snapshot = getSessionDraftSnapshot(scope, { kind: 'newSession', draftId });
        expect(snapshot?.document.composer).toMatchObject({
            text: { value: 'live composer text' },
            mentions: { value: [{ kind: 'mention', tokenText: '@issue', start: 0, end: 6 }] },
            attachments: { value: [attachment] },
        });
        expect(snapshot?.document.target).toMatchObject({
            kind: 'newSession',
            authoring: {
                executionTarget: { value: { serverId: 'server-a', machineId: 'machine-b' } },
                directory: { value: '/repo' },
                agentTarget: {
                    value: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
                },
            },
        });
    });

    it('round-trips the canonical execution and Agent selection through the repository', () => {
        const draftId = 'round-trip-draft';
        writeNewSessionDraftToRepository({
            scope,
            draftId,
            draft: authoringDraft(),
        });

        expect(readNewSessionDraftFromRepository({ scope, draftId })).toMatchObject({
            selectedMachineId: 'machine-b',
            targetServerId: 'server-a',
            executionTarget: { serverId: 'server-a', machineId: 'machine-b' },
            agentType: 'codex',
            agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
        });
    });

    it('sanitizes incomplete synchronized Automation trigger rows when materializing a local draft', () => {
        const draftId = 'incomplete-automation-draft';
        writeNewSessionDraft({
            scope,
            draftId,
            patch: {
                authoring: {
                    automation: {
                        enabled: true,
                        name: 'Continue later',
                        description: '',
                        triggers: [{
                            clientId: 'trigger-a',
                            kind: 'sessionLifecycle',
                            persisted: null,
                            enabled: true,
                            definition: null,
                        }],
                    },
                },
            },
            materializationIntent: 'userEdit',
        });

        expect(readNewSessionDraftFromRepository({ scope, draftId })?.automationDraft).toMatchObject({
            enabled: true,
            name: 'Continue later',
            triggers: [],
        });
    });

    it('retains the full writer for an initial seed before the composer mounts', () => {
        writeNewSessionDraftToRepository({
            scope,
            draftId: 'seeded-draft',
            draft: authoringDraft({
                input: 'Seeded prompt',
                composerAttachments: [attachment],
            }),
        });

        expect(getSessionDraftSnapshot(scope, { kind: 'newSession', draftId: 'seeded-draft' })?.document.composer)
            .toMatchObject({
                text: { value: 'Seeded prompt' },
                attachments: { value: [attachment] },
            });
    });

    it('round-trips device-local launch choices without synchronizing them', () => {
        const draftId = 'local-state-draft';
        writeNewSessionDraftToRepository({
            scope,
            draftId,
            draft: authoringDraft({
                entryIntent: 'automation',
                selectedSecretId: 'secret-a',
                sessionConfigOptionOverrides: {
                    v: 1,
                    updatedAt: 12,
                    overrides: { speed: { updatedAt: 12, value: 'fast' } },
                },
                windowsRemoteSessionLaunchModeOverride: {
                    machineId: 'machine-b',
                    mode: 'windows_terminal',
                },
            }),
        });

        expect(readNewSessionDraftFromRepository({ scope, draftId })).toMatchObject({
            entryIntent: 'automation',
            selectedSecretId: 'secret-a',
            sessionConfigOptionOverrides: {
                overrides: { speed: { value: 'fast' } },
            },
            windowsRemoteSessionLaunchModeOverride: {
                machineId: 'machine-b',
                mode: 'windows_terminal',
            },
        });
        expect(getSessionDraftSnapshot(scope, { kind: 'newSession', draftId })?.document.target)
            .not.toMatchObject({
                authoring: { windowsRemoteSessionLaunchMode: expect.anything() },
            });
    });

    it('round-trips draft-local attachment requests and clears only admitted identities', () => {
        const draftId = 'seed-custody-draft';
        const seed: NewSessionComposerAttachmentSeedV1 = {
            instanceId: 'seed-a',
            pluginId: 'example.plugin',
            attachmentLocalId: 'ticket',
            value: { key: 'ticket-a', value: { id: 42 }, presentation: { label: 'Issue 42' } },
        };
        const otherSeed = { ...seed, instanceId: 'seed-b', value: { ...seed.value, key: 'ticket-b' } };
        writeNewSessionDraftToRepository({
            scope,
            draftId,
            draft: authoringDraft({ composerAttachmentSeeds: [seed, otherSeed] }),
        });

        expect(readNewSessionDraftFromRepository({ scope, draftId })?.composerAttachmentSeeds)
            .toEqual([seed, otherSeed]);
        clearNewSessionComposerAttachmentSeedsFromRepository({ scope, draftId, seeds: [seed] });
        expect(readNewSessionDraftFromRepository({ scope, draftId })?.composerAttachmentSeeds)
            .toEqual([otherSeed]);
    });
});
