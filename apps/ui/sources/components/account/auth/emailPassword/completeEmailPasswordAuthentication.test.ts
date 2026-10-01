import { afterEach, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit';
import type { PendingExternalAuth } from '@/auth/storage/tokenStorage';
import { guardAccountEncryptionFirstKeyCredentialMutation } from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';

const boundary = vi.hoisted(() => ({
    // An empty modal id is this owner's existing "the host could not present
    // it" answer, so the disclosure settles without adding a test-only seam.
    show: vi.fn((_config: unknown): string => ''),
    setRecoveryKeyReminderDismissed: vi.fn(async () => true),
    readPending: vi.fn(),
}));

vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal'))
    .createModalModuleMock({ spies: { show: boundary.show } }).module);
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => (await import('@/dev/testkit/mocks/tokenStorage'))
    .createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            setRecoveryKeyReminderDismissed: boundary.setRecoveryKeyReminderDismissed,
            readPendingExternalAuthStateForServerUrl: boundary.readPending,
        },
    }));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

import { completeEmailPasswordAuthentication } from './completeEmailPasswordAuthentication';

const TARGET = { serverUrl: 'https://home.example.test', serverId: 'home-a' } as const;

afterEach(async () => {
    boundary.show.mockReset().mockReturnValue('');
    boundary.setRecoveryKeyReminderDismissed.mockClear();
    boundary.readPending.mockReset();
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

it('presents the real first-key recovery lifecycle and keeps custody when its host is closed', async () => {
    const pending = {
        provider: 'github', proof: 'pending-proof', ...TARGET,
        accountEncryptionFirstKey: {
            accountId: 'account-a', requestDigest: 'request-digest', requestJson: '{}',
            createdAt: Date.now(), expiresAt: Date.now() + 60_000, migrationSubmissionAttempted: true,
        },
    } satisfies PendingExternalAuth;
    boundary.readPending.mockResolvedValue({ value: pending, serverMismatch: false });
    const guarded = await guardAccountEncryptionFirstKeyCredentialMutation(TARGET);
    if (guarded.kind !== 'finish_encryption_setup') throw new Error('Expected retained first-key custody');
    boundary.show.mockReturnValue('first-key-modal');
    const onCompleted = vi.fn();
    const completion = completeEmailPasswordAuthentication({
        outcome: { credentials: { token: 'home-token' } }, target: TARGET,
        loginWithCredentials: async () => guarded, onCompleted,
    }).catch((cause: unknown) => cause);

    await vi.waitFor(() => expect(boundary.show).toHaveBeenCalledOnce());
    // Modal is the genuine UI host boundary; the guard and lifecycle presenter remain real.
    const config = boundary.show.mock.calls[0]?.[0] as {
        props: { finish: () => Promise<unknown>; abandon: () => Promise<unknown> };
        onHostUnmount: () => void;
    };
    expect(config.props.finish).toBeTypeOf('function');
    expect(config.props.abandon).toBeTypeOf('function');
    expect(onCompleted).not.toHaveBeenCalled();
    config.onHostUnmount();
    await expect(completion).resolves.toBe('retired');
    expect(onCompleted).not.toHaveBeenCalled();
});

it('records a new account-service account reminder on that service, never on the Home', async () => {
    const service = { kind: 'account_service' as const, serverIdentityId: 'srv_accounts' };

    await expect(completeEmailPasswordAuthentication({
        outcome: { credentials: { token: 'directory-token' }, recoverySecret: new Uint8Array(32).fill(3) },
        target: TARGET,
        reminderTarget: service,
        loginWithCredentials: async () => ({ kind: 'completed' as const }),
        onCompleted: vi.fn(),
    })).resolves.toBe('retired');

    expect(boundary.setRecoveryKeyReminderDismissed).toHaveBeenCalledWith(false, service);
    expect(boundary.setRecoveryKeyReminderDismissed.mock.calls.every((call) => (call as unknown[])[1] === service)).toBe(true);
});

it('retries canonical credential adoption after first-key recovery finishes before completing arrival', async () => {
    boundary.readPending.mockResolvedValue({ value: {
        provider: 'github', proof: 'pending-proof', ...TARGET,
        accountEncryptionFirstKey: {
            accountId: 'account-a', requestDigest: 'request-digest', requestJson: '{}',
            createdAt: Date.now(), expiresAt: Date.now() + 60_000, migrationSubmissionAttempted: true,
        },
    } satisfies PendingExternalAuth, serverMismatch: false });
    const guarded = await guardAccountEncryptionFirstKeyCredentialMutation(TARGET);
    if (guarded.kind !== 'finish_encryption_setup') throw new Error('Expected retained first-key custody');
    boundary.show.mockReturnValue('first-key-modal');
    const onCompleted = vi.fn();
    let recoveryFinished = false;
    const completion = completeEmailPasswordAuthentication({
        outcome: { credentials: { token: 'home-token' } }, target: TARGET,
        loginWithCredentials: async () => recoveryFinished ? { kind: 'completed' } : guarded,
        onCompleted,
    }).catch((cause: unknown) => cause);

    await vi.waitFor(() => expect(boundary.show).toHaveBeenCalledOnce());
    expect(onCompleted).not.toHaveBeenCalled();
    // The modal boundary reports its successful recovery action; the completion
    // and lifecycle presenter must still retry the real credential-adoption callback.
    const config = boundary.show.mock.calls[0]?.[0] as {
        props: { onSettled: (outcome: 'finish') => void };
    };
    recoveryFinished = true;
    config.props.onSettled('finish');
    await expect(completion).resolves.toBe('completed');
    expect(onCompleted).toHaveBeenCalledOnce();
});
