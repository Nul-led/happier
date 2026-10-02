import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import * as profiles from '@/sync/domains/server/serverProfiles';
import { createSystemTaskRunner } from '@/components/systemTasks/createSystemTaskRunner';
import { derivePersonalHomeBootstrapSnapshot } from '@/components/personalHome/bootstrap/derivePersonalHomeBootstrapSnapshot';
import { createPersonalHomeBootstrapFacts } from '@/components/personalHome/bootstrap/personalHomeBootstrapFacts';
import { useLocalRelayRuntimeControl } from './useLocalRelayRuntimeControl';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const HOME_URL = 'http://127.0.0.1:43123';
const HOME_ID = 'srv_home_erased';
let storage: ReturnType<typeof installLocalStorageMock>;

beforeEach(() => {
    storage = installLocalStorageMock();
    vi.stubGlobal('window', { localStorage: globalThis.localStorage });
    vi.stubGlobal('document', {});
    profiles.resetServerProfilesRuntimeForTests();
});
afterEach(() => {
    standardCleanup();
    storage.restore();
    profiles.resetServerProfilesRuntimeForTests();
    vi.unstubAllGlobals();
});

// Only browser storage and the native/process task bridge are replaced; completion,
// credential guard, profile removal, runner, hook and readiness reducer remain real.
function createEraseRunner(options: { outcome?: 'partial' | 'completed'; identity?: string | null } = {}) {
    let sequence = 0;
    let erased = false;
    const kinds = new Map<string, string>();
    return createSystemTaskRunner({
        mode: 'tauri',
        bridge: {
            async start(spec) {
                const id = `erase-cleanup-${++sequence}`;
                kinds.set(id, spec.kind);
                return id;
            },
            async subscribe(taskId, listeners) {
                const kind = kinds.get(taskId);
                if (kind === 'relay.runtime.personal_home.erase.v1') erased = true;
                const data = kind === 'relay.runtime.personal_home.erase.v1'
                    ? { outcome: options.outcome ?? 'completed', removedPaths: ['/data/home.sqlite'], stoppedRunningHome: true }
                    : kind === 'relay.runtime.personal_home.inspect.v1'
                        ? { identity: { homeServerIdentityId: erased ? null : options.identity === undefined ? HOME_ID : options.identity } }
                        : { installed: true, version: '1', relayUrl: HOME_URL, healthy: !erased, dataPresent: !erased,
                            purpose: { kind: 'personal-home', canonicalServerUrl: HOME_URL }, anonymousSignupEnabled: erased ? null : false,
                            service: { active: !erased, enabled: true } };
                listeners.onResult({ protocolVersion: 1, taskId, ok: true, data });
                return () => {};
            },
            async cancel() {},
            async respond() {},
        },
    });
}

describe('Personal Home erase app cleanup', () => {
    it.each(['secure-storage', 'profile-persistence', 'retirement-persistence', 'credential-guard'] as const)(
        'acknowledges deletion, retires exact readiness and surfaces %s failure', async (failure) => {
            const profile = await profiles.adoptPersonalHomeProfileAndComplete({
                descriptor: { serverUrl: HOME_URL, homeServerIdentityId: HOME_ID },
                source: 'desktop-personal-home',
            });
            await TokenStorage.setCredentialsForServerUrl(HOME_URL, { serverId: HOME_ID }, { token: 'erased-token', secret: 'erased-secret' });
            if (failure === 'credential-guard') {
                const createdAt = Date.now();
                await TokenStorage.setPendingExternalAuth({
                    provider: 'github', proof: 'proof', secret: 'erased-secret', serverId: HOME_ID,
                    serverUrl: HOME_URL, returnTo: '/settings/account',
                    accountEncryptionFirstKey: { accountId: 'account-1', requestDigest: `aemrb1_${'A'.repeat(43)}`,
                        requestJson: '{"toMode":"e2ee"}', createdAt, expiresAt: createdAt + 600000,
                        pending: 'oauth-pending', migrationSubmissionAttempted: true },
                });
            }
            if (failure === 'secure-storage') storage.removeItemMock.mockImplementation(() => { throw new Error('secure storage unavailable'); });
            if (failure === 'profile-persistence') storage.setItemMock.mockImplementation((key, value) => {
                if (key.includes('server-state-v1') && !value.includes(profile.id)) throw new Error('profile write unavailable');
                storage.store.set(key, value);
            });
            if (failure === 'retirement-persistence') storage.setItemMock.mockImplementation(() => { throw new Error('profile write unavailable'); });
            const runner = createEraseRunner();
            const hook = await renderHook(() => useLocalRelayRuntimeControl({ runner }));
            expect(hook.getCurrent().status?.purpose?.kind).toBe('personal-home');
            await act(async () => { await hook.getCurrent().refreshInspection(); });
            let result: Awaited<ReturnType<ReturnType<typeof hook.getCurrent>['erasePersonalHomeData']>> | undefined;
            await act(async () => { result = await hook.getCurrent().erasePersonalHomeData(); });
            expect(result).toMatchObject({ outcome: 'completed_with_cleanup_attention', removedPaths: ['/data/home.sqlite'], error: expect.any(String) });
            expect(hook.getCurrent().lastOperation).toEqual({ operation: 'erase', erase: result });
            expect(profiles.getServerProfileById(profile.id)).not.toBeNull();
            const retained = profiles.getServerProfileById(profile.id);
            if (failure === 'retirement-persistence') {
                expect(retained?.personalHomeBootstrapCompleted).toBe(true);
            } else {
                expect(retained?.personalHomeBootstrapCompleted).toBeUndefined();
                expect(retained?.source).toBe('manual');
                // Retire both supported receipt representations across an actual owner reload.
                profiles.resetServerProfilesRuntimeForTests();
                expect(profiles.findPersonalHomeBootstrapCompletedProfile(profiles.listServerProfiles())).toBeNull();
            }
            const snapshot = derivePersonalHomeBootstrapSnapshot(createPersonalHomeBootstrapFacts({
                hostIsDesktop: true, isDesktopMainWindow: true,
                explicitlySelectedOtherHome: false, candidateLocalProfile: null,
                localHomeReachability: 'unreachable', localHomeIdentity: null, localHomeAuth: 'missing',
                anonymousSignup: 'unknown', daemon: null, activeTask: null,
                completedPersonalHomeProfile: profiles.findPersonalHomeBootstrapCompletedProfile(profiles.listServerProfiles()),
                relayRuntime: { relayUrl: HOME_URL, installed: true, dataPresent: false, status: 'stopped',
                    purpose: { kind: 'personal-home', canonicalServerUrl: HOME_URL } },
            }));
            expect(snapshot).toMatchObject({ homeReady: false, detail: { code: 'personal_home_erased' } });
        },
    );

    it('forgets only the exact erased Home when another completed Home is retained', async () => {
        const erased = await profiles.adoptPersonalHomeProfileAndComplete({
            descriptor: { serverUrl: HOME_URL, homeServerIdentityId: HOME_ID }, source: 'desktop-personal-home',
        });
        const other = await profiles.adoptPersonalHomeProfileAndComplete({
            descriptor: { serverUrl: 'https://other-home.example', homeServerIdentityId: 'srv_other_home' }, source: 'desktop-personal-home',
        });
        const runner = createEraseRunner();
        const hook = await renderHook(() => useLocalRelayRuntimeControl({ runner }));
        await act(async () => { await hook.getCurrent().refreshInspection(); });
        await act(async () => { await hook.getCurrent().erasePersonalHomeData(); });
        expect(profiles.getServerProfileById(erased.id)).toBeNull();
        expect(profiles.getServerProfileById(other.id)).toEqual(other);
    });

    it.each(['partial', 'unknown-identity'] as const)('retains the saved binding for %s', async (scenario) => {
        const profile = await profiles.adoptPersonalHomeProfileAndComplete({
            descriptor: { serverUrl: HOME_URL, homeServerIdentityId: HOME_ID }, source: 'desktop-personal-home',
        });
        const runner = createEraseRunner(scenario === 'partial' ? { outcome: 'partial' } : { identity: null });
        const hook = await renderHook(() => useLocalRelayRuntimeControl({ runner }));
        await act(async () => { await hook.getCurrent().refreshInspection(); });
        await act(async () => { await hook.getCurrent().erasePersonalHomeData(); });
        expect(profiles.getServerProfileById(profile.id)).toEqual(profile);
        expect(hook.getCurrent().lastOperation).toMatchObject({ operation: 'erase', erase: {
            outcome: scenario === 'partial' ? 'partial' : 'completed',
        } });
    });
});
