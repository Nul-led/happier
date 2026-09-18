import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: boundary.request }));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);

let restore: () => void;
beforeEach(() => {
    restore = installLocalStorageMock().restore;
    boundary.request.mockReset();
    boundary.request.mockResolvedValue(new Response('{}', { status: 404 }));
});
afterEach(() => restore());

async function runGenericExecution(execution: unknown) {
    const { executeHomeAuthentication } = await import('./executeHomeAuthentication');
    const { TokenStorage } = await import('@/auth/storage/tokenStorage');
    const fixture = createDirectoryHttpFixture();
    const target = {
        kind: 'descriptor' as const,
        descriptor: fixture.home.connectionDescriptor,
        authority: 'current_connection' as const,
    };
    const outcome = await executeHomeAuthentication({
        // The generic helper must decide from the execution alone; the caller is
        // deliberately the ordinary Welcome/onboarding shape.
        request: {
            method: { id: 'email_password', enabledActions: [] },
            action: { id: 'provision', mode: 'either' },
            execution,
            authority: { purpose: 'home', target },
            intendedHome: target,
        } as never,
        loginWithCredentials: vi.fn(),
        returnTo: '/',
    });
    const pending = (await TokenStorage.readPendingExternalAuthState().catch(() => null))?.value ?? null;
    return { outcome, pending };
}

it('delegates email/password to its own controller instead of falling through to the mTLS tail', async () => {
    const { outcome, pending } = await runGenericExecution({ kind: 'email_password', action: 'provision', mode: 'either' });

    expect(pending).toBeNull();
    expect(boundary.request).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'no_effect', reason: 'delegated_email_password' });
});

it('fails closed on an unknown execution kind rather than performing mTLS', async () => {
    const { outcome, pending } = await runGenericExecution({ kind: 'future_method_from_a_newer_home' });

    expect(pending).toBeNull();
    expect(boundary.request).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'no_effect', reason: 'unsupported_execution' });
});
