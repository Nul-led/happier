import { describe, expect, it } from 'vitest';

import { resolveSessionViewConnectionStatus } from './resolveSessionViewConnectionStatus';

const baseInput = {
    connectedServicesRestartState: null,
    restartingText: 'restarting connected service',
    switchFailedText: 'switch failed',
    inactiveStatusText: null,
    sessionStatusResuming: false,
    sessionStatusState: 'ready',
    sessionStatusText: 'ready',
    sessionStatusColor: 'status-color',
    sessionStatusDotColor: 'dot-color',
    sessionStatusPulsing: false,
} as const;

describe('resolveSessionViewConnectionStatus', () => {
    it.each(['restarting', 'pending_confirmation'] as const)(
        'prioritizes non-terminal connected-service restart state %s as the main status',
        (status) => {
            expect(resolveSessionViewConnectionStatus({
                ...baseInput,
                connectedServicesRestartState: {
                    status,
                    attemptId: 'manual-auth-switch:1',
                    reason: 'manual_auth_switch',
                    startedAtMs: 1_000,
                },
            })).toEqual({
                text: 'restarting connected service',
                color: 'status-color',
                dotColor: 'dot-color',
                isPulsing: true,
            });
        },
    );

    it('shows failed restart state only when positive failure evidence reaches the shared state', () => {
        expect(resolveSessionViewConnectionStatus({
            ...baseInput,
            connectedServicesRestartState: {
                status: 'failed',
                attemptId: 'manual-auth-switch:1',
                reason: 'manual_auth_switch',
                startedAtMs: 1_000,
            },
            inactiveStatusText: 'inactive',
        })).toEqual({
            text: 'switch failed',
            color: 'status-color',
            dotColor: 'dot-color',
            isPulsing: false,
        });
    });

    it('lets the canonical resuming lifecycle override the otherwise inactive session copy', () => {
        expect(resolveSessionViewConnectionStatus({
            ...baseInput,
            inactiveStatusText: 'inactive',
            sessionStatusResuming: true,
            sessionStatusText: 'resuming',
            sessionStatusPulsing: true,
        })).toEqual({
            text: 'resuming',
            color: 'status-color',
            dotColor: 'dot-color',
            isPulsing: true,
        });
    });

    it('says nothing while the runtime state is still unknown: an "unknown" line is not a status', () => {
        expect(resolveSessionViewConnectionStatus({
            ...baseInput,
            sessionStatusState: 'unknown',
            sessionStatusText: 'unknown',
        })).toBeNull();
    });

    it('still speaks for an unknown runtime when there is a real fact to state', () => {
        expect(resolveSessionViewConnectionStatus({
            ...baseInput,
            sessionStatusState: 'unknown',
            sessionStatusText: 'unknown',
            inactiveStatusText: 'inactive',
        })?.text).toBe('inactive');
        expect(resolveSessionViewConnectionStatus({
            ...baseInput,
            sessionStatusState: 'unknown',
            sessionStatusText: 'unknown',
            connectedServicesRestartState: {
                status: 'restarting',
                attemptId: 'manual-auth-switch:1',
                reason: 'manual_auth_switch',
                startedAtMs: 1_000,
            },
        })?.text).toBe('restarting connected service');
    });
});
