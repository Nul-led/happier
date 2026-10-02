import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { createDeferred, renderHook, standardCleanup } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { InjectedAuthProvider } from '@/auth/context/AuthContext';
import { authGetTokenAtEndpoint } from '@/auth/flows/getToken';
import { adoptHomeProfile, resetServerProfilesRuntimeForTests } from '@/sync/domains/server/serverProfiles';
import { setActiveServer } from '@/sync/domains/server/serverRuntime';
import { useAuthEntryOptions } from './useAuthEntryOptions';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default } });
});
const boundary = vi.hoisted(() => ({ fetch: vi.fn(), acquire: vi.fn() }));
vi.mock('@/utils/system/runtimeFetch', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/system/runtimeFetch')>(),
    runtimeFetch: boundary.fetch,
}));
// The native bridge is the IO boundary; carrier policy and enrollment resolution stay real.
vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({ acquireIrohHomeRuntimeOrigin: boundary.acquire }));

function signedOut({ children }: React.PropsWithChildren) {
    return <InjectedAuthProvider credentials={null}>{children}</InjectedAuthProvider>;
}
function descriptor(id: string, carrier: 'https' | 'iroh'): HomeConnectionDescriptorV1 {
    return {
        v: 1, homeServerIdentityId: id, canonicalServerUrl: 'http://localhost:3010', revision: 1,
        endpoints: carrier === 'https'
            ? [{ kind: 'https', url: `https://${id}.example.test` }]
            : [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
    };
}
function lease(home: HomeConnectionDescriptorV1, release: () => Promise<void>) {
    return { homeServerIdentityId: home.homeServerIdentityId, endpointId: 'a'.repeat(64),
        leaseId: home.homeServerIdentityId, runtimeOrigin: `http://127.0.0.1:43123`, status: 'ready', release };
}
async function focus(home: HomeConnectionDescriptorV1) {
    const profile = await adoptHomeProfile({ descriptor: home, source: 'qr', descriptorAuthority: 'advisory' });
    await setActiveServer({ serverId: profile.id, scope: 'device' });
}
function network(home: HomeConnectionDescriptorV1, origin: string) {
    boundary.fetch.mockImplementation(async (url: unknown) => {
        const target = String(url);
        if (!target.startsWith(origin)) return new Response('', { status: 503 });
        if (target.endsWith('/v1/auth/entry')) return new Response('', { status: 404 });
        return new Response(JSON.stringify(target.endsWith('/v1/auth') ? { token: 'signed-in-target-token' }
            : createRootLayoutFeaturesResponse({ capabilities: {
                server: { canonicalServerUrl: home.canonicalServerUrl },
                serverIdentity: { serverIdentityId: home.homeServerIdentityId },
                auth: { keyChallenge: { v2: false } },
            } })), { status: 200, headers: { 'content-type': 'application/json' } });
    });
}
afterEach(() => {
    standardCleanup();
    resetServerProfilesRuntimeForTests();
    boundary.fetch.mockReset();
    boundary.acquire.mockReset();
});

it('uses the descriptor carrier for exact Home discovery and the actual sign-in request', async () => {
    resetServerProfilesRuntimeForTests();
    const home = descriptor('srv_entry_https', 'https');
    const origin = 'https://srv_entry_https.example.test';
    network(home, origin);
    await focus(home);
    const hook = await renderHook(() => useAuthEntryOptions(), { wrapper: signedOut });
    await vi.waitFor(() => expect(hook.getCurrent().serverAvailability).toBe('ready'));
    expect(hook.getCurrent().homeTransport).toMatchObject({ runtimeOrigin: origin });
    expect(hook.getCurrent().observedHomeServerIdentityId).toBe(home.homeServerIdentityId);
    expect(hook.getCurrent().retentionDisclosure).toMatchObject({ kind: 'unreadable' });
    expect(await authGetTokenAtEndpoint({
        endpointUrl: home.canonicalServerUrl, serverIdentityId: home.homeServerIdentityId,
        secret: new Uint8Array(32).fill(3), requireKeyChallengeV2: false,
        ...hook.getCurrent().homeTransport,
        runtimeOrigin: hook.getCurrent().homeTransport?.runtimeOrigin ?? undefined,
    })).toMatchObject({ token: 'signed-in-target-token' });
    expect(boundary.fetch.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
        `${origin}/v1/features`, `${origin}/v1/auth/entry`, `${origin}/v1/auth`,
    ]));
    expect(boundary.fetch.mock.calls.some(([url]) => String(url).startsWith(home.canonicalServerUrl))).toBe(false);
    await hook.unmount();
});

it('refuses Home authentication actions when HTTPS discovery observes a different descriptor identity', async () => {
    resetServerProfilesRuntimeForTests();
    const home = descriptor('srv_entry_identity', 'https');
    network({ ...home, homeServerIdentityId: 'srv_other_home' }, 'https://srv_entry_identity.example.test');
    await focus(home);
    const hook = await renderHook(() => useAuthEntryOptions(), { wrapper: signedOut });
    await vi.waitFor(() => expect(hook.getCurrent().serverAvailability).toBe('incompatible'));
    expect(hook.getCurrent().showAuthActions).toBe(false);
    expect(hook.getCurrent().homeTransport).toBeUndefined();
    await hook.unmount();
});

it('releases the retained enrollment carrier when Home focus changes and on unmount', async () => {
    resetServerProfilesRuntimeForTests();
    const first = descriptor('srv_entry_iroh_first', 'iroh');
    const second = { ...descriptor('srv_entry_iroh_second', 'iroh'), canonicalServerUrl: 'http://localhost:3011' };
    const releaseFirst = vi.fn(async () => {});
    const releaseSecond = vi.fn(async () => {});
    boundary.acquire.mockImplementation(async (input: { homeServerIdentityId: string }) =>
        input.homeServerIdentityId === first.homeServerIdentityId ? lease(first, releaseFirst) : lease(second, releaseSecond));
    network(first, 'http://127.0.0.1:43123');
    await focus(first);
    const hook = await renderHook(() => useAuthEntryOptions(), { wrapper: signedOut });
    await vi.waitFor(() => expect(hook.getCurrent().homeTransport).toMatchObject({ runtimeOrigin: 'http://127.0.0.1:43123' }));
    network(second, 'http://127.0.0.1:43123');
    await act(async () => { await focus(second); });
    await vi.waitFor(() => expect(releaseFirst).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(hook.getCurrent().observedHomeServerIdentityId).toBe(second.homeServerIdentityId));
    await hook.unmount();
    await vi.waitFor(() => expect(releaseSecond).toHaveBeenCalledOnce());
});

it('releases an enrollment carrier whose acquisition finishes after the auth entry unmounts', async () => {
    resetServerProfilesRuntimeForTests();
    const home = descriptor('srv_entry_obsolete', 'iroh');
    const release = vi.fn(async () => {});
    const acquired = createDeferred<ReturnType<typeof lease>>();
    boundary.acquire.mockReturnValue(acquired.promise);
    await focus(home);
    const hook = await renderHook(() => useAuthEntryOptions(), { wrapper: signedOut });
    await vi.waitFor(() => expect(boundary.acquire).toHaveBeenCalled());
    await hook.unmount();
    await act(async () => { acquired.resolve(lease(home, release)); });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(boundary.fetch).not.toHaveBeenCalled();
});
