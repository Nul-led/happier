import { afterEach, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit';

const boundary = vi.hoisted(() => ({
    // An empty modal id is this owner's existing "the host could not present
    // it" answer, so the disclosure settles without adding a test-only seam.
    show: vi.fn((_config: unknown): string => ''),
    setRecoveryKeyReminderDismissed: vi.fn(async () => true),
}));

vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal'))
    .createModalModuleMock({ spies: { show: boundary.show } }).module);
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => (await import('@/dev/testkit/mocks/tokenStorage'))
    .createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: { setRecoveryKeyReminderDismissed: boundary.setRecoveryKeyReminderDismissed },
    }));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

import { completeEmailPasswordAuthentication } from './completeEmailPasswordAuthentication';

const TARGET = { serverUrl: 'https://home.example.test', serverId: 'home-a' } as const;

afterEach(async () => {
    boundary.show.mockClear();
    boundary.setRecoveryKeyReminderDismissed.mockClear();
    await standardCleanup();
});

it('refuses a credential lifecycle that did not complete instead of continuing the flow', async () => {
    const onCompleted = vi.fn();
    const recoverySecret = new Uint8Array([7, 7, 7]);

    await expect(completeEmailPasswordAuthentication({
        outcome: { credentials: { token: 'home-token' }, recoverySecret },
        target: TARGET,
        loginWithCredentials: async () => ({ kind: 'recovery_failed' as const }),
        onCompleted,
    })).rejects.toMatchObject({ kind: 'auth', code: 'operation_failed' });

    // The Account exists but this device cannot sign in to it: the host must not
    // continue to its destination, which is what the discarded return value let
    // both hosts do.
    expect(onCompleted).not.toHaveBeenCalled();
    // The one process-held recovery handle is disclosed, not zeroed and dropped.
    expect(boundary.show).toHaveBeenCalledTimes(1);
});

it('completes and hands the flow on when the credential lifecycle completes', async () => {
    const onCompleted = vi.fn();

    await expect(completeEmailPasswordAuthentication({
        outcome: { credentials: { token: 'home-token' } },
        target: TARGET,
        loginWithCredentials: async () => ({ kind: 'completed' as const }),
        onCompleted,
    })).resolves.toBe('completed');

    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(boundary.show).not.toHaveBeenCalled();
});
