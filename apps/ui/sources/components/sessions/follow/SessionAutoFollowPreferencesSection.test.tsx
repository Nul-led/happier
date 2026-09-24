import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import { buildServerFeaturesResponse } from '@/hooks/server/serverFeaturesTestUtils';
import { getServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { getStorage } from '@/sync/domains/state/storage';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';
import { SessionAutoFollowPreferencesSection } from './SessionAutoFollowPreferencesSection';
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetRuntimeFetch(); resetServerFeaturesClientForTests(); });

async function flushAsyncWork() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function publishFollowFeature(serverId: string, following: boolean) {
    const features = buildServerFeaturesResponse();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...features, features: { ...features.features, sessions: { ...features.features.sessions, enabled: true, following: { enabled: following } } } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await getServerFeaturesSnapshot({ serverId, force: true });
}

async function renderEnabledPreferencesSection(serverUrl: string) {
    const home = await upsertAndActivateServer({ serverUrl, name: 'Home' });
    getStorage().getState().activateProfileScope({ serverId: home.id, accountId: 'account-a' });
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token: `e30.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64url')}.signature` });
    await publishFollowFeature(home.id, true);
    return home;
}

it('loads Account preferences on first render and preserves a failed toggle for retry', async () => {
    const home = await renderEnabledPreferencesSection('https://preferences-follow.example');
    let preferences = { assigned: true, direct: false, team: false, group: false };
    let failWrite = true;
    setRuntimeFetch(async (url, init) => {
        if (new URL(String(url)).pathname === '/v1/auth/ping') return new Response('{}', { status: 200 });
        if (init?.method === 'PUT') {
            if (failWrite) return new Response('{}', { status: 503 });
            preferences = JSON.parse(String(init.body));
        }
        return new Response(JSON.stringify(preferences), { status: 200 });
    });
    const screen = await renderSettingsView(<SessionAutoFollowPreferencesSection serverId={home.id} />);
    await flushAsyncWork();
    expect(screen.findByTestId('session-auto-follow-assigned')?.props.value).toBe(true);
    await act(async () => { screen.findByTestId('session-auto-follow-direct')?.props.onValueChange(true); });
    expect(screen.findByTestId('session-auto-follow-direct')?.props.value).toBe(true);
    expect(preferences.direct).toBe(false);
    expect(screen.findByTestId('session-auto-follow-retry')).not.toBeNull();
    failWrite = false;
    await act(async () => { screen.findByTestId('session-auto-follow-retry')?.props.onPress(); });
    expect(preferences.direct).toBe(true);
    expect(screen.findByTestId('session-auto-follow-retry')).toBeNull();
    await screen.unmount();
});

it('coalesces Account-change wakes during a save and reconciles to the Home after success or failure', async () => {
    const home = await renderEnabledPreferencesSection('https://preferences-follow-race.example');
    const initial = { assigned: true, direct: false, team: false, group: false };
    let authoritative = initial;
    let reads = 0;
    const firstWrite = createDeferred<Response>();
    const secondWrite = createDeferred<Response>();
    let writes = 0;
    setRuntimeFetch(async (url, init) => {
        if (new URL(String(url)).pathname === '/v1/auth/ping') return new Response('{}', { status: 200 });
        if (init?.method === 'PUT') return ++writes === 1 ? firstWrite.promise : secondWrite.promise;
        reads += 1;
        return new Response(JSON.stringify(authoritative), { status: 200 });
    });

    const screen = await renderSettingsView(<SessionAutoFollowPreferencesSection serverId={home.id} />);
    await flushAsyncWork();
    expect(reads).toBe(1);

    act(() => { screen.findByTestId('session-auto-follow-direct')?.props.onValueChange(true); });
    authoritative = { ...initial, team: true };
    act(() => {
        publishHomeAccountChange(home.id);
        publishHomeAccountChange(home.id);
    });
    expect(reads).toBe(1);
    firstWrite.resolve(new Response(JSON.stringify({ ...initial, direct: true }), { status: 200 }));
    await flushAsyncWork();
    expect(reads).toBe(2);
    expect(screen.findByTestId('session-auto-follow-direct')?.props.value).toBe(false);
    expect(screen.findByTestId('session-auto-follow-team')?.props.value).toBe(true);

    act(() => { screen.findByTestId('session-auto-follow-group')?.props.onValueChange(true); });
    authoritative = { ...initial, assigned: false };
    act(() => { publishHomeAccountChange(home.id); });
    secondWrite.resolve(new Response('{}', { status: 503 }));
    await flushAsyncWork();
    expect(reads).toBe(3);
    // The confirmed Home value is refreshed beneath the failed change…
    expect(screen.findByTestId('session-auto-follow-assigned')?.props.value).toBe(false);
    // …and the change the user asked for, its error and its retry all survive that refresh.
    expect(screen.findByTestId('session-auto-follow-group')?.props.value).toBe(true);
    expect(screen.findByTestId('session-auto-follow-error')).not.toBeNull();
    expect(screen.findByTestId('session-auto-follow-retry')).not.toBeNull();

    // A later reconnect wake is still only a refresh: it may not abandon the failed change.
    act(() => { publishHomeAccountChange(home.id); });
    await flushAsyncWork();
    expect(reads).toBe(4);
    expect(screen.findByTestId('session-auto-follow-group')?.props.value).toBe(true);
    expect(screen.findByTestId('session-auto-follow-retry')).not.toBeNull();

    // Retry re-executes that exact intent against the current confirmed value, not a stale
    // snapshot: the refreshed `assigned: false` survives and only `group` changes.
    let retried: unknown = null;
    setRuntimeFetch(async (url, init) => {
        if (new URL(String(url)).pathname === '/v1/auth/ping') return new Response('{}', { status: 200 });
        if (init?.method === 'PUT') {
            retried = JSON.parse(String(init.body));
            return new Response(String(init.body), { status: 200 });
        }
        reads += 1;
        return new Response(JSON.stringify(authoritative), { status: 200 });
    });
    await act(async () => { screen.findByTestId('session-auto-follow-retry')?.props.onPress(); });
    await flushAsyncWork();
    expect(retried).toEqual({ ...initial, assigned: false, group: true });
    expect(screen.findByTestId('session-auto-follow-error')).toBeNull();
    expect(screen.findByTestId('session-auto-follow-group')?.props.value).toBe(true);
    await screen.unmount();
});

it('reloads the Home after the Follow feature decision disappears during an outstanding save', async () => {
    const home = await renderEnabledPreferencesSection('https://preferences-follow-feature-flip.example');
    const write = createDeferred<Response>();
    let reads = 0;
    const DIAG: string[] = [];
    setRuntimeFetch(async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/v1/auth/ping') return new Response('{}', { status: 200 });
        // The Home feature decision is the thing this test flips, and the features
        // client reads it through the same runtime fetch. Delegate that path to the
        // decision `publishFollowFeature` installs instead of answering it with this
        // section's preference payload, which would pin the feature off forever.
        if (pathname === '/v1/features') return await globalThis.fetch(url, init);
        if (init?.method === 'PUT') return write.promise;
        reads += 1;
        DIAG.push(`read:${pathname}`);
        return new Response(JSON.stringify({ assigned: true, direct: false, team: false, group: false }), { status: 200 });
    });

    const screen = await renderSettingsView(<SessionAutoFollowPreferencesSection serverId={home.id} />);
    await flushAsyncWork();
    DIAG.push('mounted');
    act(() => { screen.findByTestId('session-auto-follow-direct')?.props.onValueChange(true); });
    DIAG.push('toggled');

    await act(async () => { await publishFollowFeature(home.id, false); });
    DIAG.push('feature-off');
    expect(screen.findByTestId('session-auto-follow-direct')).toBeNull();
    write.resolve(new Response(JSON.stringify({ assigned: true, direct: true, team: false, group: false }), { status: 200 }));
    await flushAsyncWork();
    DIAG.push('write-settled');

    await act(async () => { await publishFollowFeature(home.id, true); });
    DIAG.push('feature-on');
    await flushAsyncWork();
    expect(reads, DIAG.join(' > ')).toBe(2);
    expect(screen.findByTestId('session-auto-follow-direct')?.props.value).toBe(false);
    expect(screen.findByTestId('session-auto-follow-direct')?.props.disabled).toBe(false);
    await screen.unmount();
});

it('does not start a deferred refresh after the settings lifetime is retired', async () => {
    const home = await renderEnabledPreferencesSection('https://preferences-follow-retire.example');
    const write = createDeferred<Response>();
    let reads = 0;
    setRuntimeFetch(async (url, init) => {
        if (new URL(String(url)).pathname === '/v1/auth/ping') return new Response('{}', { status: 200 });
        if (init?.method === 'PUT') return write.promise;
        reads += 1;
        return new Response(JSON.stringify({ assigned: true, direct: false, team: false, group: false }), { status: 200 });
    });

    const screen = await renderSettingsView(<SessionAutoFollowPreferencesSection serverId={home.id} />);
    await flushAsyncWork();
    act(() => { screen.findByTestId('session-auto-follow-direct')?.props.onValueChange(true); });
    act(() => { publishHomeAccountChange(home.id); });
    await screen.unmount();
    write.resolve(new Response(JSON.stringify({ assigned: true, direct: true, team: false, group: false }), { status: 200 }));
    await flushAsyncWork();
    expect(reads).toBe(1);
});
