import { describe, expect, it } from 'vitest';

import {
    listEligibleSessionFollowSourceCandidates,
    resolveSessionFollowSourceRuntimeState,
} from './sessionFollowSourcePresentation';

describe('resolveSessionFollowSourceRuntimeState', () => {
    it('derives archived, offline, unsupported, and eligible states without persisting runtime facts', () => {
        expect(resolveSessionFollowSourceRuntimeState({ deliveryState: 'paused_archived', machine: null })).toBe('paused_archived');
        expect(resolveSessionFollowSourceRuntimeState({ deliveryState: 'eligible', machine: null })).toBe('waiting_for_runtime');
        expect(resolveSessionFollowSourceRuntimeState({
            deliveryState: 'eligible',
            machine: { active: true, operationProtocolCapabilities: {} },
        })).toBe('runtime_unsupported');
        expect(resolveSessionFollowSourceRuntimeState({
            deliveryState: 'eligible',
            machine: { active: true, operationProtocolCapabilities: { sessionFollow: { contextV1: true } } },
        })).toBe('eligible');
        expect(resolveSessionFollowSourceRuntimeState({
            deliveryState: 'eligible',
            hasPendingUpdates: true,
            machine: { active: true, operationProtocolCapabilities: { sessionFollow: { contextV1: true } } },
        })).toBe('catch_up_pending');
        expect(resolveSessionFollowSourceRuntimeState({
            deliveryState: 'eligible',
            hasPendingUpdates: true,
            machine: null,
        })).toBe('waiting_for_runtime');
        expect(resolveSessionFollowSourceRuntimeState({
            deliveryState: 'eligible',
            sourceEncryptionMode: 'e2ee',
            machine: {
                active: true,
                kind: 'ephemeral_session_runner',
                operationProtocolCapabilities: { sessionFollow: { contextV1: true } },
            },
        })).toBe('waiting_for_source_key');
        expect(resolveSessionFollowSourceRuntimeState({
            deliveryState: 'eligible',
            sourceEncryptionMode: 'e2ee',
            preparedInUiLifetime: true,
            machine: {
                active: true,
                kind: 'ephemeral_session_runner',
                operationProtocolCapabilities: { sessionFollow: { contextV1: true } },
            },
        })).toBe('eligible');
    });

    it('keeps source candidates on the exact destination Home and excludes self and existing edges', () => {
        const sessions = [{ id: 'destination' }, { id: 'existing' }, { id: 'candidate' }, { id: 'other-home' }];
        expect(listEligibleSessionFollowSourceCandidates({
            sessions,
            destination: { serverId: 'home-a', sessionId: 'destination' },
            existingSourceSessionIds: ['existing'],
            resolveServerId: (sessionId) => sessionId === 'other-home' ? 'home-b' : 'home-a',
        })).toEqual([{ id: 'candidate' }]);
    });
});
