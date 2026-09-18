import { describe, expect, it } from 'vitest';

import type { LiveSessionAuthoringContext } from './sessionAuthoringContext';
import { resolveSessionComposerStateFromAuthoringContext } from './resolveSessionComposerStateFromAuthoringContext';

const BASE_SNAPSHOT = {
    agentId: 'claude',
    permissionMode: 'acceptEdits',
    modelId: 'claude-sonnet-4-5',
    profileId: 'profile-snapshot',
    directory: '/repo/snapshot',
} as const;

const BASE_SESSION = {
    id: 'session-1',
    encryptionMode: 'e2ee',
    metadata: {
        displayName: 'Builder',
        host: 'qa-host',
        machineId: 'machine-1',
        path: '/repo/live',
        flavor: 'claude',
    },
    permissionMode: 'acceptEdits',
    permissionModeUpdatedAt: 1,
    modelMode: 'claude-sonnet-4-5',
    modelModeUpdatedAt: 1,
} as const;

describe('resolveSessionComposerStateFromAuthoringContext', () => {
    it('resolves live-session composer state from the snapshot with fallback agent support', () => {
        const context: LiveSessionAuthoringContext = {
            kind: 'liveSession',
            session: BASE_SESSION as any,
            snapshot: {
                ...BASE_SNAPSHOT,
                agentId: 'not-a-real-agent',
            } as any,
        };

        const state = resolveSessionComposerStateFromAuthoringContext(context, {
            fallbackAgentId: 'codex',
        });

        expect(state.agentId).toBe('codex');
        expect(state.machineName).toBe('Builder');
        expect(state.permissionMode).toBe('acceptEdits');
        expect(state.modelMode).toBe('claude-sonnet-4-5');
        expect(state.profileId).toBe('profile-snapshot');
        expect(state.currentPath).toBe('/repo/snapshot');
    });

    it('leaves the live-session agent unset when there is no valid snapshot agent and no fallback', () => {
        const context: LiveSessionAuthoringContext = {
            kind: 'liveSession',
            session: BASE_SESSION as any,
            snapshot: {
                ...BASE_SNAPSHOT,
                agentId: 'not-a-real-agent',
            } as any,
        };

        const state = resolveSessionComposerStateFromAuthoringContext(context);

        expect(state.agentId).toBeNull();
        expect(state.machineName).toBe('Builder');
        expect(state.permissionMode).toBe('acceptEdits');
        expect(state.modelMode).toBe('claude-sonnet-4-5');
        expect(state.profileId).toBe('profile-snapshot');
        expect(state.currentPath).toBe('/repo/snapshot');
    });

    it('reads the layout-v1 machine label only from the owner compatibility view', () => {
        const context: LiveSessionAuthoringContext = {
            kind: 'liveSession',
            session: {
                ...BASE_SESSION,
                metadataLayoutVersion: 1,
                metadata: {
                    v: 1,
                    summary: {
                        text: 'Shared title',
                        updatedAt: 1,
                    },
                },
                ownerMetadataView: {
                    displayName: 'Private builder',
                    host: 'private-host',
                    machineId: 'private-machine',
                },
            } as never,
            snapshot: BASE_SNAPSHOT as never,
        };

        expect(resolveSessionComposerStateFromAuthoringContext(context).machineName)
            .toBe('Private builder');
    });

    it('normalizes an Agent without a configured default model to the canonical default mode', () => {
        const context: LiveSessionAuthoringContext = {
            kind: 'liveSession',
            session: {
                ...BASE_SESSION,
                metadata: {
                    ...BASE_SESSION.metadata,
                    flavor: 'grok',
                },
            } as any,
            snapshot: {
                ...BASE_SNAPSHOT,
                agentId: 'grok',
                modelId: null,
            } as any,
        };

        expect(resolveSessionComposerStateFromAuthoringContext(context).modelMode).toBe('default');
    });

});
