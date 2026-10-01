import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';
import { deriveHomeQrBindingKeyV2, sealTerminalProvisioningV3TokenOnlyPayload, type SystemTaskSpec } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { buildHomeQrInviteDeepLink, parseHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { adoptHomeProfile, getActiveServerId } from '@/sync/domains/server/serverProfiles';
import { RestoreScanComputerQrView } from './RestoreScanComputerQrView';
import { RestoreQrView } from './RestoreQrView';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({
    request: vi.fn(),
    replace: vi.fn(),
    specs: [] as SystemTaskSpec[],
    answers: [] as unknown[],
    listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/http/client')>(),
    createServerFetchAtEndpoint: (target: { endpointUrl: string }) => (path: string, init?: RequestInit) => boundary.request(target.endpointUrl, path, init),
}));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock({
    router: { replace: boundary.replace },
}).module);
vi.mock('@react-navigation/native', async () => (await import('@/dev/testkit/mocks/reactNavigation')).createReactNavigationNativeMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
// The shell's account context is supplied by the host; enrollment itself stays real.
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ refreshFromActiveServer: async () => {} }) }));
// Native event transport is the system boundary. Keep host detection, invocation, bridge,
// runner and prompt owners real; only replace the OS event subscription.
vi.mock('@/utils/platform/desktopHost', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/platform/desktopHost')>(),
    listenDesktopHostEvent: async (name: string, listener: (payload: unknown) => void) => {
        boundary.listeners.set(name, (event) => listener(event.payload));
        return () => boundary.listeners.delete(name);
    },
}));

let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
let restoreStorage: (() => void) | undefined;
afterEach(async () => {
    await screen?.unmount();
    restoreStorage?.();
    vi.unstubAllGlobals();
    boundary.listeners.clear();
    boundary.specs.length = 0;
    boundary.answers.length = 0;
    boundary.replace.mockClear();
});

it('a desktop link joins the enrolled Home as a machine before completing, with retry after setup failure', async () => {
    restoreStorage = installLocalStorageMock().restore;
    const focusedHome = getActiveServerId();
    const descriptor = {
        v: 1 as const, homeServerIdentityId: 'srv_link_home', revision: 1,
        canonicalServerUrl: 'https://link-home.test',
        endpoints: [{ kind: 'https' as const, url: 'https://link-home.test' }],
    };
    const token = 'header.eyJzdWIiOiJsaW5rLWFjY291bnQifQ.signature';
    const secret = new Uint8Array(32).fill(37);
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + 60_000;
    const invite = {
        v: 2 as const, intent: 'home_device' as const, direction: 'trusted_home_displays' as const,
        pairId: 'pair-link-home', home: descriptor,
        qrSecretBase64Url: encodeBase64(secret, 'base64url'), issuedAtMs, expiresAtMs,
    };
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
        if (path === '/v1/features') return json({
            ...createRootLayoutFeaturesResponse({
                features: { auth: { pairing: { boundQrV2: { enabled: true }, desktopQrMobileScan: { enabled: true } } } },
                capabilities: { serverIdentity: { serverIdentityId: descriptor.homeServerIdentityId } },
            }), homeConnectionDescriptor: descriptor,
        });
        if (path === '/v1/auth/pairing/request') return json({ state: 'requested' });
        if (path.startsWith('/v1/auth/request/status?')) return json({ status: 'pending', supportsV2: true });
        if (path === '/v1/auth/response') {
            expect(endpoint).toBe(descriptor.canonicalServerUrl);
            expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
            expect(JSON.parse(String(init?.body))).toMatchObject({ responseKind: 'tokenOnly' });
            return json({});
        }
        if (path === '/v2/auth/account/request') {
            const body = JSON.parse(String(init?.body));
            if (!body.pairId) return json({});
            const publicKey = decodeBase64(body.publicKey);
            return json({ state: 'authorized',
                tokenEncrypted: encodeBase64(encryptBox(new TextEncoder().encode(token), publicKey)),
                response: encodeBase64(sealTerminalProvisioningV3TokenOnlyPayload({
                    terminalEphemeralPublicKey: publicKey, pairingSecret: deriveHomeQrBindingKeyV2(secret),
                    createdAtMs: issuedAtMs, expiresAtMs, randomBytes: tweetnacl.randomBytes,
                })),
            });
        }
        throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === 'start_system_task') {
            boundary.specs.push(JSON.parse(String(args.specJson)));
            return { taskId: `link-setup-${boundary.specs.length}` };
        }
        if (command === 'get_system_task_snapshot') return { events: [], result: null };
        if (command === 'respond_system_task_prompt') { boundary.answers.push(JSON.parse(String(args.answerJson))); return; }
        if (command === 'cancel_system_task') return;
        throw new Error(`Unexpected desktop command: ${command}`);
    } });
    const authenticated = vi.fn();
    screen = await renderScreen(<RestoreScanComputerQrView embedded entryIntent="add_home"
        initialPairingLink={buildHomeQrInviteDeepLink({ invite })} onAuthenticated={authenticated} />);
    await vi.waitFor(() => expect(boundary.specs).toHaveLength(1));
    expect(await TokenStorage.getCredentialsForServerUrl(descriptor.canonicalServerUrl,
        { serverId: descriptor.homeServerIdentityId })).toEqual({ token });
    expect(boundary.specs[0]).toMatchObject({ kind: 'setup.thisComputer.v1', params: {
        activeRelayUrl: descriptor.canonicalServerUrl, activeServerIdentityId: descriptor.homeServerIdentityId,
        activeAccountId: 'link-account', installService: true, startService: true, verifyService: true,
    } });
    expect(authenticated).not.toHaveBeenCalled();
    expect(getActiveServerId()).toBe(focusedHome);

    await vi.waitFor(() => expect([...boundary.listeners.keys()], screen?.getTextContent())
        .toContain('systemTasks://task/link-setup-1/result'));
    await act(async () => boundary.listeners.get('systemTasks://task/link-setup-1/event')?.({ payload: {
        protocolVersion: 1, taskId: 'link-setup-1', tsMs: Date.now(), type: 'prompt',
        data: { kind: 'authRequest', responseKind: 'tokenOnly', publicKey: encodeBase64(new Uint8Array(32).fill(3)),
            response: 'opaque-sealed-response', relayUrl: descriptor.canonicalServerUrl, cliProvenance: 'managed' },
    } }));
    await vi.waitFor(() => expect(boundary.answers).toEqual([{ approved: true }]));
    await act(async () => boundary.listeners.get('systemTasks://task/link-setup-1/result')?.({ payload: {
        protocolVersion: 1, taskId: 'link-setup-1', ok: false,
        error: { code: 'daemon_service_not_ready', message: 'Background service is not ready yet.' },
    } }));
    expect(authenticated).not.toHaveBeenCalled();
    expect(screen.getTextContent()).toContain('Background service is not ready yet.');
    await act(async () => screen?.pressByTestId('enrolled-computer-setup.retry'));
    await vi.waitFor(() => expect(boundary.specs).toHaveLength(2));
    await vi.waitFor(() => expect(boundary.listeners.has('systemTasks://task/link-setup-2/result')).toBe(true));
    await act(async () => boundary.listeners.get('systemTasks://task/link-setup-2/result')?.({ payload: {
        protocolVersion: 1, taskId: 'link-setup-2', ok: true, data: { machineId: 'joined-machine' },
    } }));
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledWith({ credentials: { token }, homeServerIdentityId: descriptor.homeServerIdentityId }));
    expect(getActiveServerId()).toBe(focusedHome);
    expect(boundary.replace).not.toHaveBeenCalled();
});

it('requester-displayed desktop QR also completes the exact Home setup and cancels it when the view leaves', async () => {
    restoreStorage = installLocalStorageMock().restore;
    const descriptor = {
        v: 1 as const, homeServerIdentityId: 'srv_reverse_desktop', revision: 1,
        canonicalServerUrl: 'https://reverse-desktop.test',
        endpoints: [{ kind: 'https' as const, url: 'https://reverse-desktop.test' }],
    };
    const profile = await adoptHomeProfile({ descriptor, source: 'qr', descriptorAuthority: 'current_connection_observation' });
    const focusedHome = getActiveServerId();
    const token = 'header.eyJzdWIiOiJyZXZlcnNlLWFjY291bnQifQ.signature';
    let invite: ReturnType<typeof parseHomeQrInviteDeepLink> = null;
    let releasePairing: (() => void) | undefined;
    const pairingReady = new Promise<void>((resolve) => { releasePairing = resolve; });
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    boundary.request.mockImplementation(async (_endpoint: string, path: string, init?: RequestInit) => {
        if (path === '/v1/features') return json({ ...createRootLayoutFeaturesResponse({
            features: { auth: { pairing: { boundQrV2: { enabled: true }, desktopQrMobileScan: { enabled: true } } } },
            capabilities: { serverIdentity: { serverIdentityId: descriptor.homeServerIdentityId } },
        }), homeConnectionDescriptor: descriptor });
        if (path === '/v1/auth/pairing/request') { await pairingReady; return json({ state: 'requested' }); }
        if (path === '/v2/auth/account/request') {
            const body = JSON.parse(String(init?.body));
            if (!body.pairId) return json({});
            if (!invite) throw new Error('Requester invite not presented');
            const publicKey = decodeBase64(body.publicKey);
            return json({ state: 'authorized',
                tokenEncrypted: encodeBase64(encryptBox(new TextEncoder().encode(token), publicKey)),
                response: encodeBase64(sealTerminalProvisioningV3TokenOnlyPayload({
                    terminalEphemeralPublicKey: publicKey,
                    pairingSecret: deriveHomeQrBindingKeyV2(decodeBase64(invite.invite.qrSecretBase64Url, 'base64url')),
                    createdAtMs: invite.invite.issuedAtMs, expiresAtMs: invite.invite.expiresAtMs, randomBytes: tweetnacl.randomBytes,
                })),
            });
        }
        throw new Error(`Unexpected request: ${path}`);
    });
    const cancel = vi.fn();
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === 'start_system_task') {
            boundary.specs.push(JSON.parse(String(args.specJson)));
            return { taskId: 'reverse-setup' };
        }
        if (command === 'get_system_task_snapshot') return { events: [], result: null };
        if (command === 'cancel_system_task') { cancel(args.taskId); return; }
        throw new Error(`Unexpected desktop command: ${command}`);
    } });
    screen = await renderScreen(<RestoreQrView embedded entryIntent="add_home" targetProfileId={profile.id} />);
    await vi.waitFor(() => expect(screen?.findByTestId('restore-requester-link-details')).toBeTruthy());
    await act(async () => screen?.pressByTestId('restore-requester-link-details'));
    invite = parseHomeQrInviteDeepLink(String(screen.findByTestId('restore-requester-link-value')?.props.children));
    expect(invite?.invite.direction).toBe('requester_displays');
    await act(async () => { releasePairing?.(); });
    await vi.waitFor(() => expect(boundary.specs).toHaveLength(1));
    expect(boundary.specs[0]).toMatchObject({ kind: 'setup.thisComputer.v1', params: {
        activeRelayUrl: descriptor.canonicalServerUrl, activeServerIdentityId: descriptor.homeServerIdentityId,
        activeAccountId: 'reverse-account', installService: true, startService: true, verifyService: true,
    } });
    expect(getActiveServerId()).toBe(focusedHome);
    expect(boundary.replace).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(boundary.listeners.has('systemTasks://task/reverse-setup/result')).toBe(true));
    await screen.unmount();
    screen = undefined;
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('reverse-setup'));
});
