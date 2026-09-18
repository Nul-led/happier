import { afterEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit';
import { createModalModuleMock } from '@/dev/testkit/mocks/modal';
import { createPartialStorageModuleMock } from '@/dev/testkit/mocks/storage';

const applyServerScopedSessionListRowPatchesSpy = vi.fn();
const modalConfirmSpy = vi.fn(async () => true);

function address(sessionId: string, serverId = 'server-a') {
    return { serverId, sessionId } as const;
}

vi.mock('@/sync/domains/state/storage', async (importOriginal) =>
    createPartialStorageModuleMock(importOriginal, {
        storage: {
            getState: () => ({
                applyServerScopedSessionListRowPatches: applyServerScopedSessionListRowPatchesSpy,
                ordinarySessionListMembershipByServerId: {
                    'server-a': ['same-session'],
                    'server-b': ['same-session'],
                },
            }),
        },
    }),
);

vi.mock('@/modal', () => createModalModuleMock({
    spies: {
        confirm: modalConfirmSpy,
    },
}).module);

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => key,
    });
});

describe('stopSessionAndMaybeArchive', () => {
    afterEach(() => {
        standardCleanup();
        applyServerScopedSessionListRowPatchesSpy.mockClear();
        modalConfirmSpy.mockClear();
        delete process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_RETRY_MS;
        delete process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_MAX_RETRIES;
        delete process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_TIMEOUT_MS;
    });

    it('uses the exact Home for temporary retention and archive-success cleanup when two Homes share a Session id', async () => {
        const stopSpy = vi.fn(async () => ({ success: true }));
        const archiveSpy = vi.fn(async () => ({ success: true }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await stopSessionAndMaybeArchive({
            address: address('same-session', 'server-b'),
            hideInactiveSessions: true,
            isPinned: false,
            archiveAfterStop: 'always',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        });

        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(1, 'server-b', [
            {
                sessionId: 'same-session',
                patch: { keepVisibleWhenInactive: true },
            },
        ]);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(2, 'server-b', [
            {
                sessionId: 'same-session',
                patch: { keepVisibleWhenInactive: false },
            },
        ]);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenCalledTimes(2);
    });

    it('stops without archiving when stop-only behavior is requested', async () => {
        const stopSpy = vi.fn(async () => ({ success: true }));
        const archiveSpy = vi.fn(async () => ({ success: true }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await stopSessionAndMaybeArchive({
            address: address('session_1'),
            hideInactiveSessions: true,
            isPinned: false,
            archiveAfterStop: 'never',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        });

        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(modalConfirmSpy).not.toHaveBeenCalled();
        expect(archiveSpy).not.toHaveBeenCalled();
        expect(applyServerScopedSessionListRowPatchesSpy).not.toHaveBeenCalled();
    });

    it('clears the visibility override when stopping fails', async () => {
        const stopSpy = vi.fn(async () => ({ success: false, message: 'boom' }));
        const archiveSpy = vi.fn(async () => ({ success: true }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await expect(
            stopSessionAndMaybeArchive({
                address: address('session_2'),
                hideInactiveSessions: true,
                isPinned: false,
                archiveAfterStop: 'always',
                stopSession: stopSpy,
                archiveSession: archiveSpy,
                stopErrorMessage: 'stop failed',
                archiveErrorMessage: 'archive failed',
            }),
        ).rejects.toMatchObject({ message: 'boom' });

        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(1, 'server-a', [
            {
                sessionId: 'session_2',
                patch: { keepVisibleWhenInactive: true },
            },
        ]);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(2, 'server-a', [
            {
                sessionId: 'session_2',
                patch: { keepVisibleWhenInactive: false },
            },
        ]);
        expect(modalConfirmSpy).not.toHaveBeenCalled();
        expect(archiveSpy).not.toHaveBeenCalled();
    });

    it('treats an accepted pending Stop as stop-only success', async () => {
        const stopSpy = vi.fn(async () => ({
            success: false,
            message: 'Stop requested; waiting for the session to become inactive',
            code: 'session_stop_requested',
            recovery: 'wait_for_inactive' as const,
        }));
        const archiveSpy = vi.fn(async () => ({ success: true }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await expect(stopSessionAndMaybeArchive({
            address: address('session_requested'),
            hideInactiveSessions: false,
            isPinned: false,
            archiveAfterStop: 'never',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        })).resolves.toBeUndefined();
        expect(archiveSpy).not.toHaveBeenCalled();
    });

    it('observes accepted pending Stop until Archive becomes valid', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_RETRY_MS = '0';
        const stopSpy = vi.fn(async () => ({
            success: false,
            code: 'session_stop_requested',
            recovery: 'wait_for_inactive' as const,
        }));
        const archiveSpy = vi.fn()
            .mockResolvedValueOnce({ success: false, code: 'session_active' })
            .mockResolvedValueOnce({ success: true });

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');
        await expect(stopSessionAndMaybeArchive({
            address: address('session_requested_archive'),
            hideInactiveSessions: false,
            isPinned: false,
            archiveAfterStop: 'always',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        })).resolves.toBeUndefined();
        expect(archiveSpy).toHaveBeenCalledTimes(2);
    });

    it('surfaces truthful recovery when session control is unavailable', async () => {
        const stopSpy = vi.fn(async () => ({
            success: false,
            message: 'RPC method not available',
            code: 'session_stop_control_unavailable',
            recovery: 'retry_when_runtime_available' as const,
        }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await expect(stopSessionAndMaybeArchive({
            address: address('session_upgrade'),
            hideInactiveSessions: false,
            isPinned: false,
            archiveAfterStop: 'never',
            stopSession: stopSpy,
            archiveSession: vi.fn(async () => ({ success: true })),
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        })).rejects.toMatchObject({
            message: 'sessionInfo.stopSessionControlUnavailable',
        });
    });

    it('does not preserve visibility for stop-only sessions hidden by settings', async () => {
        const stopSpy = vi.fn(async () => ({ success: true }));
        const archiveSpy = vi.fn(async () => ({ success: true }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await stopSessionAndMaybeArchive({
            address: address('session_3'),
            hideInactiveSessions: true,
            isPinned: false,
            archiveAfterStop: 'never',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        });

        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(modalConfirmSpy).not.toHaveBeenCalled();
        expect(archiveSpy).not.toHaveBeenCalled();
        expect(applyServerScopedSessionListRowPatchesSpy).not.toHaveBeenCalled();
    });

    it('archives immediately after stopping when explicitly requested', async () => {
        const stopSpy = vi.fn(async () => ({ success: true }));
        const archiveSpy = vi.fn(async () => ({ success: true }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await stopSessionAndMaybeArchive({
            address: address('session_4'),
            hideInactiveSessions: false,
            isPinned: false,
            archiveAfterStop: 'always',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        });

        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(modalConfirmSpy).not.toHaveBeenCalled();
        expect(archiveSpy).toHaveBeenCalledTimes(1);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(1, 'server-a', [
            {
                sessionId: 'session_4',
                patch: { keepVisibleWhenInactive: true },
            },
        ]);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(2, 'server-a', [
            {
                sessionId: 'session_4',
                patch: { keepVisibleWhenInactive: false },
            },
        ]);
    });

    it('retries archive after stop when the first archive attempt still sees the session as active', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_RETRY_MS = '0';
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_MAX_RETRIES = '2';

        const stopSpy = vi.fn(async () => ({ success: true }));
        const archiveSpy = vi.fn()
            .mockResolvedValueOnce({
                success: false,
                message: 'Cannot archive an active session',
                code: 'session_active' as const,
            })
            .mockResolvedValueOnce({ success: true });

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await stopSessionAndMaybeArchive({
            address: address('session_retry'),
            hideInactiveSessions: false,
            isPinned: false,
            archiveAfterStop: 'always',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        });

        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(archiveSpy).toHaveBeenCalledTimes(2);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(1, 'server-a', [
            {
                sessionId: 'session_retry',
                patch: { keepVisibleWhenInactive: true },
            },
        ]);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(2, 'server-a', [
            {
                sessionId: 'session_retry',
                patch: { keepVisibleWhenInactive: false },
            },
        ]);
    });

    it('keeps retrying archive while the stopped session is still active server-side', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_RETRY_MS = '0';
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_TIMEOUT_MS = '1000';

        const stopSpy = vi.fn(async () => ({ success: true }));
        const activeArchiveResult = {
            success: false,
            message: 'Cannot archive an active session',
            code: 'session_active' as const,
        };
        const archiveSpy = vi.fn()
            .mockResolvedValueOnce(activeArchiveResult)
            .mockResolvedValueOnce(activeArchiveResult)
            .mockResolvedValueOnce(activeArchiveResult)
            .mockResolvedValueOnce(activeArchiveResult)
            .mockResolvedValueOnce({ success: true });

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await stopSessionAndMaybeArchive({
            address: address('session_long_retry'),
            hideInactiveSessions: false,
            isPinned: false,
            archiveAfterStop: 'always',
            stopSession: stopSpy,
            archiveSession: archiveSpy,
            stopErrorMessage: 'stop failed',
            archiveErrorMessage: 'archive failed',
        });

        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(archiveSpy).toHaveBeenCalledTimes(5);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(1, 'server-a', [
            {
                sessionId: 'session_long_retry',
                patch: { keepVisibleWhenInactive: true },
            },
        ]);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(2, 'server-a', [
            {
                sessionId: 'session_long_retry',
                patch: { keepVisibleWhenInactive: false },
            },
        ]);
    });

    it('uses a default archive wait long enough for delayed daemon exit observation', async () => {
        vi.useFakeTimers();
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_RETRY_MS = '1000';

        try {
            const stopSpy = vi.fn(async () => ({ success: true }));
            const activeArchiveResult = {
                success: false,
                message: 'Cannot archive an active session',
                code: 'session_active' as const,
            };
            const archiveSpy = vi.fn();
            for (let index = 0; index < 12; index += 1) {
                archiveSpy.mockResolvedValueOnce(activeArchiveResult);
            }
            archiveSpy.mockResolvedValueOnce({ success: true });

            const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

            const promise = stopSessionAndMaybeArchive({
                address: address('session_delayed_exit'),
                hideInactiveSessions: false,
                isPinned: false,
                archiveAfterStop: 'always',
                stopSession: stopSpy,
                archiveSession: archiveSpy,
                stopErrorMessage: 'stop failed',
                archiveErrorMessage: 'archive failed',
            });
            const assertion = expect(promise).resolves.toBeUndefined();

            for (let index = 0; index < 12; index += 1) {
                await vi.advanceTimersByTimeAsync(1000);
            }

            await assertion;
            expect(archiveSpy).toHaveBeenCalledTimes(13);
        } finally {
            vi.useRealTimers();
        }
    });

    it('uses the archive fallback message when the stopped session stays active until timeout', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_MAX_RETRIES = '0';
        process.env.EXPO_PUBLIC_HAPPIER_SESSION_ARCHIVE_AFTER_STOP_TIMEOUT_MS = '0';

        const stopSpy = vi.fn(async () => ({ success: true }));
        const archiveSpy = vi.fn(async () => ({
            success: false,
            message: '{"error":"session-active"}',
            code: 'session_active' as const,
        }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await expect(
            stopSessionAndMaybeArchive({
                address: address('session_timeout'),
                hideInactiveSessions: false,
                isPinned: false,
                archiveAfterStop: 'always',
                stopSession: stopSpy,
                archiveSession: archiveSpy,
                stopErrorMessage: 'stop failed',
                archiveErrorMessage: 'archive failed',
            }),
        ).rejects.toMatchObject({ message: 'archive failed' });

        expect(archiveSpy).toHaveBeenCalledTimes(1);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(2, 'server-a', [
            {
                sessionId: 'session_timeout',
                patch: { keepVisibleWhenInactive: false },
            },
        ]);
    });

    it('clears the visibility override when archive fails after stopping', async () => {
        const stopSpy = vi.fn(async () => ({ success: true }));
        const archiveSpy = vi.fn(async () => ({ success: false, message: 'archive boom' }));

        const { stopSessionAndMaybeArchive } = await import('./sessionStopArchiveFlow');

        await expect(
            stopSessionAndMaybeArchive({
                address: address('session_5'),
                hideInactiveSessions: false,
                isPinned: false,
                archiveAfterStop: 'always',
                stopSession: stopSpy,
                archiveSession: archiveSpy,
                stopErrorMessage: 'stop failed',
                archiveErrorMessage: 'archive failed',
            }),
        ).rejects.toMatchObject({ message: 'archive boom' });

        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(1, 'server-a', [
            {
                sessionId: 'session_5',
                patch: { keepVisibleWhenInactive: true },
            },
        ]);
        expect(applyServerScopedSessionListRowPatchesSpy).toHaveBeenNthCalledWith(2, 'server-a', [
            {
                sessionId: 'session_5',
                patch: { keepVisibleWhenInactive: false },
            },
        ]);
    });
});
