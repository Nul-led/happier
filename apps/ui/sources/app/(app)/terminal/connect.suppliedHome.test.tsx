import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createSignInServiceFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { buildTerminalConnectWebHref } from '@/utils/path/terminalConnectUrl';
import { parsePendingTerminalConnectPreAuthEnvelope } from '@/sync/domains/pending/pendingTerminalConnect.shared';
import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { MMKV } from 'react-native-mmkv';
import { clearPendingTerminalConnect } from '@/sync/domains/pending/pendingTerminalConnect';

installTokenStorageWebPlatformMocks();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const replaceSpy = vi.hoisted(() => vi.fn());

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { replace: replaceSpy } }).module;
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false, credentials: null, refreshFromActiveServer: async () => {} }),
}));
const runtimeFetchSpy = vi.hoisted(() => vi.fn(async () => new Response('', { status: 503 })));
vi.mock('@/utils/system/runtimeFetch', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/system/runtimeFetch')>(),
    runtimeFetch: runtimeFetchSpy,
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ confirmResult: true }).module;
});

const { default: TerminalConnectScreen } = await import('./connect');

function createStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => { values.delete(key); },
        setItem: (key, value) => { values.set(key, value); },
    };
}

function terminalRequest(serverUrl: string, serverIdentityId: string) {
    return {
        publicKeyB64Url: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        serverUrl,
        serverIdentityId,
        pairing: {
            secretB64Url: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            createdAtMs: 1_900_000_000_000,
            expiresAtMs: 1_900_000_060_000,
        },
    };
}

afterEach(() => {
    standardCleanup();
    clearPendingTerminalConnect();
    replaceSpy.mockClear();
    vi.unstubAllGlobals();
});

it('does not redirect preauth terminal pairing to an unreachable unsaved Home', async () => {
    runtimeFetchSpy.mockClear();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    vi.stubGlobal('window', {
        location: {
            href: `https://app.example.test${buildTerminalConnectWebHref(terminalRequest('https://unreachable.example.test', 'srv_new_home'))}`,
            pathname: '/terminal/connect',
        },
        history: { replaceState: vi.fn() },
        sessionStorage: globalThis.sessionStorage,
    });
    vi.stubGlobal('document', { getElementById: () => null });
    const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
    const { listServerProfiles, resetServerProfilesRuntimeForTests } = await import('@/sync/domains/server/serverProfiles');
    resetServerProfilesRuntimeForTests();

    await upsertAndActivateServer({ serverUrl: 'https://saved.example.test', source: 'manual', scope: 'device' });
    const screen = await renderScreen(<TerminalConnectScreen />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(runtimeFetchSpy).toHaveBeenCalledWith('https://unreachable.example.test/health', expect.any(Object));
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(listServerProfiles().some((profile) => profile.serverUrl === 'https://unreachable.example.test')).toBe(false);
    await screen.unmount();
});

it('adopts a preauth terminal Home address and opens its sign-in without changing the selected service', async () => {
    const address = 'https://accounts.example.test';
    const captured = terminalRequest(address, 'srv_accounts_entry');
    runtimeFetchSpy.mockImplementation(async (...args: unknown[]) => {
        const url = String(args[0]);
        return new Response(JSON.stringify(url.endsWith('/health') ? { status: 'ok' } : createSignInServiceFeaturesResponse(address)), {
            status: url.endsWith('/health') || url.endsWith('/v1/features') ? 200 : 404, headers: { 'content-type': 'application/json' },
        });
    });
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    vi.stubGlobal('window', {
        location: { href: `https://app.example.test${buildTerminalConnectWebHref(captured)}`, pathname: '/terminal/connect' },
        history: { replaceState: vi.fn() }, sessionStorage: globalThis.sessionStorage,
    });
    vi.stubGlobal('document', { getElementById: () => null });
    const profiles = await import('@/sync/domains/server/serverProfiles');
    profiles.resetServerProfilesRuntimeForTests();
    const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
    const pending = await import('@/sync/domains/pending/pendingTerminalConnect');
    const active = await upsertAndActivateServer({ serverUrl: 'https://saved.example.test', source: 'manual', scope: 'device' });
    const beforeService = profiles.resolveSelectedAccountServiceEndpoint();
    const screen = await renderScreen(<TerminalConnectScreen />);
    await vi.waitFor(() => expect(replaceSpy).toHaveBeenCalledWith(`/?server=${encodeURIComponent(address)}`));
    expect(profiles.resolveSelectedAccountServiceEndpoint()).toEqual(beforeService);
    expect(profiles.listServerProfiles().some((profile) => profile.serverUrl === address)).toBe(true);
    expect(profiles.getActiveServerId()).not.toBe(active.id);
    expect(pending.getPendingTerminalConnect()).toMatchObject(captured);
    const custodyStorage = new MMKV({ id: scopedStorageId('pending-terminal-connect', readStorageScopeFromEnv()) });
    const envelope = parsePendingTerminalConnectPreAuthEnvelope(JSON.parse(custodyStorage.getString('record:pre-auth:v1')!));
    expect(envelope?.record).toMatchObject(captured);
    await screen.unmount();
});
