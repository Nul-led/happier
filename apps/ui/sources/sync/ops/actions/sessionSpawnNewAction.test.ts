import { describe, expect, it } from 'vitest';
import { RPC_ERROR_CODES, type SessionSpawnNewResultV1 } from '@happier-dev/protocol';

import * as sessionSpawnNewAction from './sessionSpawnNewAction';

type FailurePresentationResolver = (result: Readonly<{
    ok: false;
    errorCode: string;
    error: string;
}>) => 'update_required' | 'generic_failure';

type FailureMessageKeyResolver = (result: Readonly<{
    ok: false;
    errorCode: string;
    error: string;
}>) => 'newSession.actionMethodUnavailable' | 'newSession.failedToStart';

type ResultFailureMessageKeyResolver = (
    result: Exclude<SessionSpawnNewResultV1, Readonly<{ type: 'success' }>>,
) =>
    | 'newSession.launchStillPendingBody'
    | 'newSession.daemonRpcUnavailableBody'
    | 'newSession.failedToStart'
    | 'session.access.repairBody'
    | 'session.access.preparationKeyUnavailable'
    | 'teams.policy.externalSharingDisabled'
    | 'teams.policy.externalSharingAdmins';

describe('session.spawn_new Action failure presentation', () => {
    it('reserves update guidance for an unavailable Action method', () => {
        const resolveFailurePresentation = (
            sessionSpawnNewAction as unknown as Readonly<{
                resolveSessionSpawnNewActionFailurePresentation?: FailurePresentationResolver;
            }>
        ).resolveSessionSpawnNewActionFailurePresentation;

        expect(resolveFailurePresentation?.({
            ok: false,
            errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
            error: 'RPC method not available',
        })).toBe('update_required');
        expect(resolveFailurePresentation?.({
            ok: false,
            errorCode: 'action_method_unavailable',
            error: 'offline',
        })).toBe('generic_failure');

        const resolveFailureMessageKey = (
            sessionSpawnNewAction as unknown as Readonly<{
                resolveSessionSpawnNewActionFailureMessageKey?: FailureMessageKeyResolver;
            }>
        ).resolveSessionSpawnNewActionFailureMessageKey;
        expect(resolveFailureMessageKey?.({
            ok: false,
            errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
            error: 'RPC method not available',
        })).toBe('newSession.actionMethodUnavailable');
        expect(resolveFailureMessageKey?.({
            ok: false,
            errorCode: 'daemon_unavailable',
            error: 'offline',
        })).toBe('newSession.failedToStart');
    });

    it('keeps pending and server-proven machine-offline outcomes distinct from other typed rejections', () => {
        const resolveResultFailureMessageKey = (
            sessionSpawnNewAction as unknown as Readonly<{
                resolveSessionSpawnNewResultFailureMessageKey?: ResultFailureMessageKeyResolver;
            }>
        ).resolveSessionSpawnNewResultFailureMessageKey;

        expect(resolveResultFailureMessageKey?.({
            type: 'pending',
            retryWithSameCreationKey: true,
            outcome: 'unknown',
        })).toBe('newSession.launchStillPendingBody');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'machine_offline',
            retryable: true,
        })).toBe('newSession.daemonRpcUnavailableBody');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'target_unavailable',
            retryable: true,
        })).toBe('newSession.failedToStart');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'organization_invalid',
            retryable: false,
        })).toBe('newSession.failedToStart');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'recipient_key_unavailable',
            retryable: false,
        })).toBe('session.access.repairBody');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'session_access_invalid_recipient_envelope',
            retryable: false,
        })).toBe('session.access.repairBody');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'session_data_key_unavailable',
            retryable: false,
        })).toBe('session.access.preparationKeyUnavailable');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'session_access_external_sharing_disabled',
            retryable: false,
        })).toBe('teams.policy.externalSharingDisabled');
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'session_access_external_sharing_requires_team_admin',
            retryable: false,
        })).toBe('teams.policy.externalSharingAdmins');
        // A Home whose Session sharing is off refuses access-bearing creation with
        // its own reason; the copy states that cause instead of a generic failure.
        expect(resolveResultFailureMessageKey?.({
            type: 'error',
            code: 'session_access_sharing_unavailable',
            retryable: false,
        })).toBe('session.collaboration.accessUnavailableReason');
    });
});
