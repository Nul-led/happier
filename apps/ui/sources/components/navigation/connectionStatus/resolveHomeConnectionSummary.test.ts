import { describe, expect, it } from 'vitest';

import { resolveHomeConnectionSummary, resolveHomeTargetSummary } from './resolveHomeConnectionSummary';

describe('resolveHomeConnectionSummary', () => {
    it('reports the Home as connected while only machine facts need attention', () => {
        for (const kind of ['healthy', 'no_machine', 'machine_offline', 'machine_not_ready'] as const) {
            expect(resolveHomeConnectionSummary({ healthKind: kind })).toEqual({
                kind: 'connected',
                statusLabelKey: 'connectionStatus.summary.connected',
                statusKey: 'connected',
                action: 'none',
            });
        }
    });

    it('reports reconnecting while the Home connection is being established', () => {
        for (const kind of ['connecting', 'server_restarting'] as const) {
            expect(resolveHomeConnectionSummary({ healthKind: kind })).toMatchObject({
                kind: 'reconnecting',
                statusLabelKey: 'connectionStatus.summary.reconnecting',
                statusKey: 'connecting',
                action: 'retry',
            });
        }
    });

    it('reports unavailable with a retry for an unreachable or failing Home', () => {
        for (const kind of ['server_error', 'server_unreachable'] as const) {
            expect(resolveHomeConnectionSummary({ healthKind: kind })).toMatchObject({
                kind: 'unavailable',
                statusLabelKey: 'connectionStatus.summary.unavailable',
                statusKey: 'error',
                action: 'retry',
            });
        }
    });

    it('asks the user to sign in again when the Home rejects the credential', () => {
        expect(resolveHomeConnectionSummary({ healthKind: 'auth_required' })).toEqual({
            kind: 'sign_in',
            statusLabelKey: 'connectionStatus.summary.signInAgain',
            statusKey: 'action_required',
            action: 'restore',
        });
    });

    it('prefers restoring the account over retrying when the last error was an auth failure', () => {
        expect(resolveHomeConnectionSummary({
            healthKind: 'server_unreachable',
            syncErrorKind: 'auth',
        })).toMatchObject({ kind: 'unavailable', action: 'restore' });
    });

    it('offers a retry for a retryable error even when the canonical health stays connected', () => {
        expect(resolveHomeConnectionSummary({
            healthKind: 'no_machine',
            syncErrorKind: 'unknown',
            syncErrorRetryable: true,
        })).toMatchObject({ kind: 'connected', action: 'retry' });
    });

    it('offers no action for a non-retryable non-auth error', () => {
        expect(resolveHomeConnectionSummary({
            healthKind: 'server_error',
            syncErrorKind: 'unknown',
            syncErrorRetryable: false,
        })).toMatchObject({ kind: 'unavailable', action: 'none' });
    });

    it('uses one truthful summary for secondary Home projection states', () => {
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn', projectionStatus: 'idle' })).toMatchObject({
            kind: 'connected',
            statusLabelKey: 'connectionStatus.summary.connected',
        });
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn', projectionStatus: 'loading' })).toMatchObject({
            kind: 'reconnecting',
            statusLabelKey: 'connectionStatus.summary.reconnecting',
        });
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn', projectionStatus: 'error' })).toMatchObject({
            kind: 'unavailable',
            statusLabelKey: 'connectionStatus.summary.unavailable',
        });
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn' })).toMatchObject({
            kind: 'unknown',
            statusLabelKey: 'status.unknown',
        });
    });

    it('keeps signed-out and pending target precedence in the canonical target summary', () => {
        expect(resolveHomeTargetSummary({
            authStatus: 'signedOut',
            projectionStatus: 'idle',
            pending: true,
        })).toMatchObject({
            kind: 'sign_in',
            statusLabelKey: 'connectionStatus.summary.signInAgain',
        });
        expect(resolveHomeTargetSummary({
            authStatus: 'signedIn',
            projectionStatus: 'idle',
            pending: true,
        })).toMatchObject({
            kind: 'reconnecting',
            statusLabelKey: 'connectionStatus.summary.reconnecting',
        });
    });

    it('normalizes focused socket observations through the same target owner', () => {
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn', socketStatus: 'connected' })).toMatchObject({ kind: 'connected' });
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn', socketStatus: 'connecting' })).toMatchObject({ kind: 'reconnecting' });
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn', socketStatus: 'disconnected' })).toMatchObject({ kind: 'unavailable' });
        expect(resolveHomeTargetSummary({ authStatus: 'signedIn', socketStatus: 'idle' })).toMatchObject({ kind: 'unknown' });
    });
});
