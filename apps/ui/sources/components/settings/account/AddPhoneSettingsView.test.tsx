import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { installAccountCommonModuleMocks } from '../../account/accountTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as any);
vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});

const modalMocks = vi.hoisted(() => ({
    alertAsync: vi.fn(async () => {}),
}));

installAccountCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: modalMocks }).module;
    },
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

const clipboardMocks = vi.hoisted(() => ({
    setStringAsync: vi.fn(async (_value: string) => {}),
}));
vi.mock('expo-clipboard', () => clipboardMocks);

vi.mock('@/components/qr/QRCode', () => ({
    QRCode: 'QRCode',
}));

vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: 'RoundButton',
}));

const AUTH_FIXTURE = Object.freeze({
    isAuthenticated: true,
    credentials: Object.freeze({ token: 'focused-home-b-token' }),
});

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => AUTH_FIXTURE,
}));

const tokenStorageMocks = vi.hoisted(() => ({
    getCredentialsForServerUrl: vi.fn(async () => ({ token: 'captured-home-a-token' })),
}));
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            ...tokenStorageMocks,
        },
    };
});

let featureState: 'enabled' | 'disabled' | 'unknown' = 'enabled';
vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: featureState }),
}));

vi.mock('@/platform/cryptoRandom', () => ({
    getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
}));

vi.mock('@/platform/digest', () => ({
    digest: vi.fn(async () => new Uint8Array(32).fill(1)),
}));

let activeServerUrl = 'https://stack.example.test';
let descriptorOverride: import('@happier-dev/protocol').HomeConnectionDescriptorV1 | null = null;
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerUrl: () => activeServerUrl,
    getServerProfileById: () => ({
        id: 'profile-test',
        serverUrl: activeServerUrl,
        canonicalServerUrl: activeServerUrl,
        serverIdentityId: 'srv_test',
    }),
    buildHomeConnectionDescriptorForProfile: (profile: {
        canonicalServerUrl?: string;
        serverUrl: string;
        serverIdentityId?: string;
    }) => {
        if (descriptorOverride) return descriptorOverride;
        const canonicalServerUrl = profile.canonicalServerUrl ?? profile.serverUrl;
        const homeServerIdentityId = profile.serverIdentityId;
        if (!homeServerIdentityId || !canonicalServerUrl.startsWith('https://')) return null;
        return {
            v: 1,
            homeServerIdentityId,
            canonicalServerUrl,
            revision: 1,
            endpoints: [{ kind: 'https', url: canonicalServerUrl }],
        };
    },
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverId: 'profile-test',
        serverUrl: activeServerUrl,
        generation: 0,
        activeShareableServerUrl: activeServerUrl,
        activeShareableServerUrlValidatedAgainstServerUrl: activeServerUrl,
        runtimeOrigin: null,
    }),
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getCachedServerFeaturesSnapshot: () => ({
        status: 'ready',
        serverIdentityId: 'srv_test',
        features: { capabilities: { server: { canonicalServerUrl: activeServerUrl } } },
    }),
}));

let pairingExpiresAt = new Date(Date.now() + 60_000).toISOString();
let accountApprovalResponse: any = { ok: true, status: 200, json: async () => ({ success: true }) };
let pairingConsumeResponse: any = { ok: true, status: 200, json: async () => ({ success: true }) };
const serverFetchSpy = vi.fn(async (path: string, _init?: any, _options?: any) => {
    if (path === '/v1/auth/pairing/start') {
        return {
            ok: true,
            status: 200,
            json: async () => ({ pairId: 'pair_123', expiresAt: pairingExpiresAt }),
        } as any;
    }
    if (path.startsWith('/v1/auth/pairing/status')) {
        return pairingStatusResponse;
    }
    if (path === '/v1/auth/account/response') {
        return accountApprovalResponse;
    }
    if (path === '/v1/auth/pairing/consume') {
        return pairingConsumeResponse;
    }
    throw new Error(`Unexpected serverFetch path: ${path}`);
});

let pairingStatusResponse: any = {
    ok: true,
    status: 200,
    json: async () => ({ state: 'pending', pairId: 'pair_123', expiresAt: '2030-02-23T00:00:00.000Z' }),
} as any;

vi.mock('@/sync/http/client', () => ({
    serverFetch: (path: string, init?: any, options?: any) => serverFetchSpy(path, init, options),
    createServerFetchAtEndpoint: (requestContext: any) => (
        path: string,
        init?: any,
        options?: any,
    ) => serverFetchSpy(path, init, { ...options, requestContext }),
}));

describe('AddPhoneSettingsView', () => {
    beforeEach(() => {
        pairingExpiresAt = new Date(Date.now() + 60_000).toISOString();
        accountApprovalResponse = { ok: true, status: 200, json: async () => ({ success: true }) };
        pairingConsumeResponse = { ok: true, status: 200, json: async () => ({ success: true }) };
        serverFetchSpy.mockClear();
        tokenStorageMocks.getCredentialsForServerUrl.mockClear();
        descriptorOverride = null;
    });
    afterEach(() => {
        clipboardMocks.setStringAsync.mockClear();
        modalMocks.alertAsync.mockClear();
    });

    it('renders a pairing QR code after starting a session', async () => {
        featureState = 'enabled';
        activeServerUrl = 'https://stack.example.test';
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({ state: 'pending', pairId: 'pair_123', expiresAt: '2030-02-23T00:00:00.000Z' }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        const qrContainer = screen.findByTestId('add-phone-qr');
        if (!qrContainer) throw new Error('Expected QR container');
        const qr = qrContainer.findByType('QRCode');
        const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        expect(parseHomeQrInviteDeepLink(String(qr.props.data))?.invite).toMatchObject({
            v: 2,
            intent: 'home_device',
            pairId: 'pair_123',
            home: { homeServerIdentityId: 'srv_test' },
        });
        expect(screen.getTextContent()).toContain('common.home');
        expect(screen.getTextContent()).toContain('connect.expiresAtLabel');
        expect(screen.getTextContent()).toContain('stack.example.test');
    });

    it('clears the QR code when the pairing session expires', async () => {
        featureState = 'enabled';
        activeServerUrl = 'https://stack.example.test';
        pairingStatusResponse = {
            ok: false,
            status: 404,
            json: async () => ({ error: 'not_found' }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 1 });

        expect(screen.findAllByTestId('add-phone-qr')).toHaveLength(0);
        expect(screen.findByTestId('add-phone-expired')).toBeTruthy();

        const textContent = screen.getTextContent();
        expect(textContent).toContain('connect.pairingQrExpired');
        expect(textContent).toContain('stack.example.test');
        expect(screen.findByTestId('add-phone-generate')).toBeTruthy();
        expect(screen.findByTestId('add-phone-generate')?.props.disabled).toBe(false);
    });

    it('does not show a sign-in prompt when the feature is disabled', async () => {
        featureState = 'disabled';
        activeServerUrl = 'https://stack.example.test';
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({ state: 'pending', pairId: 'pair_123', expiresAt: '2030-02-23T00:00:00.000Z' }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);

        const textContent = screen.getTextContent();
        expect(textContent).toContain('common.unavailable');
        expect(textContent).not.toContain('modals.pleaseSignInFirst');
    });

    it('fails closed when a local development Home has no shareable application endpoint', async () => {
        featureState = 'enabled';
        activeServerUrl = 'http://localhost:53288';
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({ state: 'pending', pairId: 'pair_123', expiresAt: '2030-02-23T00:00:00.000Z' }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);

        const textContent = screen.getTextContent();
        expect(textContent).not.toContain('connect.serverUrlNotEmbeddedTitle');
        expect(screen.findByTestId('add-phone-qr')?.findAllByType('QRCode')).toHaveLength(0);
        expect(textContent).toContain('common.unavailable');
    });

    it('keeps the secret-bearing pairing link hidden until the user reveals it, then copies it', async () => {
        featureState = 'enabled';
        activeServerUrl = 'https://stack.example.test';
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({ state: 'pending', pairId: 'pair_123', expiresAt: '2030-02-23T00:00:00.000Z' }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        expect(screen.findAllByTestId('add-phone-pairing-link')).toHaveLength(0);
        const showLinkButton = screen.findByTestId('add-phone-pairing-link-details');
        expect(showLinkButton).toBeTruthy();
        expect(showLinkButton?.props.accessibilityState).toMatchObject({ expanded: false });

        await act(async () => {
            showLinkButton!.props.onPress();
        });
        expect(screen.findByTestId('add-phone-pairing-link')).toBeTruthy();
        expect(screen.findByTestId('add-phone-pairing-link-details')?.props.accessibilityState)
            .toMatchObject({ expanded: true });
        expect(screen.getTextContent()).toContain('connect.pairingLinkSecurityWarning');
        const copyLinkButton = screen.findByTestId('add-phone-pairing-link-copy');
        expect(copyLinkButton).toBeTruthy();
        await act(async () => {
            await copyLinkButton!.props.action();
        });

        expect(clipboardMocks.setStringAsync).toHaveBeenCalledTimes(1);
        const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        expect(parseHomeQrInviteDeepLink(String(clipboardMocks.setStringAsync.mock.calls[0]?.[0]))?.invite.v).toBe(2);
        expect(modalMocks.alertAsync).not.toHaveBeenCalledWith('common.success', 'common.copied');
        expect(screen.findByTestId('add-phone-pairing-link-copy-feedback')).toBeTruthy();
    });

    it('automatically completes the captured Home once with no code or direct-QR decision UI', async () => {
        featureState = 'enabled';
        activeServerUrl = 'https://stack.example.test';
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = pairingExpiresAt;
        const expiresAtMs = Date.parse(expiresAt);
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        const { encodeBase64 } = await import('@/encryption/base64');
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({
                state: 'requested',
                pairId: 'pair_123',
                expiresAt,
                requestedPublicKey: encodeBase64(requestedPublicKey),
                requestedDeviceLabel: 'Phone',
                homeServerIdentityId: 'srv_test',
                bindingProof: computeHomeQrBindingProofV2({
                    direction: 'trusted_home_displays',
                    qrSecret: new Uint8Array(32).fill(7),
                    pairId: 'pair_123',
                    homeServerIdentityId: 'srv_test',
                    requesterPublicKey: requestedPublicKey,
                    expiresAtMs,
                }),
            }),
        } as any;
        accountApprovalResponse = {
            ok: false,
            status: 409,
            json: async () => ({ error: 'already_completed' }),
        } as any;
        serverFetchSpy.mockClear();
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 4 });

        expect(screen.findByTestId('add-phone-request-confirm-code')).toBeNull();
        expect(screen.findByTestId('add-phone-approve')).toBeNull();
        expect(screen.findByTestId('add-phone-reject')).toBeNull();
        expect(screen.findByTestId('add-phone-complete')).toBeTruthy();
        expect(screen.findByTestId('add-phone-pairing-link-details')).toBeNull();
        expect(screen.findByTestId('add-phone-pairing-link')).toBeNull();
        expect(screen.getTextContent()).toContain('stack.example.test');
        expect(screen.getTextContent()).toContain('connect.requestingDeviceLabel');
        expect(screen.getTextContent()).toContain('Phone');
        expect(screen.getTextContent()).not.toContain('connect.homeAddedPreservedFocusBody');
        expect(screen.getTextContent()).not.toContain('common.unavailable');

        expect(tokenStorageMocks.getCredentialsForServerUrl).toHaveBeenCalledWith(
            'https://stack.example.test',
            { serverId: 'profile-test' },
        );
        const approvalCall = serverFetchSpy.mock.calls.find((call) => call[0] === '/v1/auth/account/response');
        expect(approvalCall).toBeTruthy();
        expect(approvalCall?.[2]?.requestContext?.credentials).toEqual({
            token: 'captured-home-a-token',
        });
        expect(JSON.parse(String(approvalCall?.[1]?.body))).toMatchObject({
            pairId: 'pair_123',
            publicKey: encodeBase64(requestedPublicKey),
            homeServerIdentityId: 'srv_test',
            responseKind: 'tokenOnly',
            response: expect.any(String),
        });
        const approvalBody = JSON.parse(String(approvalCall?.[1]?.body)) as { response: string };
        const { inspectTerminalProvisioningV3Payload } = await import('@happier-dev/protocol');
        expect(inspectTerminalProvisioningV3Payload(
            (await import('@/encryption/base64')).decodeBase64(approvalBody.response),
        )).toEqual({ type: 'tokenOnly' });
        expect(serverFetchSpy.mock.calls.some((call) => call[0] === '/v1/auth/pairing/consume')).toBe(false);
        expect(serverFetchSpy.mock.calls.filter((call) => call[0] === '/v1/auth/account/response')).toHaveLength(1);
        expect(serverFetchSpy.mock.calls.filter((call) => call[0] === '/v1/auth/pairing/start')).toHaveLength(1);
    });

    it('shows one create-new-QR recovery after a terminal completion failure', async () => {
        featureState = 'enabled';
        activeServerUrl = 'https://stack.example.test';
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = pairingExpiresAt;
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        const { encodeBase64 } = await import('@/encryption/base64');
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({
                state: 'requested', pairId: 'pair_123', expiresAt,
                requestedPublicKey: encodeBase64(requestedPublicKey), requestedDeviceLabel: null,
                homeServerIdentityId: 'srv_test',
                bindingProof: computeHomeQrBindingProofV2({
                    qrSecret: new Uint8Array(32).fill(7), pairId: 'pair_123',
                    homeServerIdentityId: 'srv_test', requesterPublicKey: requestedPublicKey,
                    expiresAtMs: Date.parse(expiresAt),
                }),
            }),
        } as any;
        accountApprovalResponse = new Response(null, { status: 403 });
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');
        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 4 });

        expect(screen.findByTestId('add-phone-invalid-request')).toBeTruthy();
        expect(screen.findAllByTestId('add-phone-generate')).toHaveLength(1);
        expect(screen.findByTestId('add-phone-generate')?.props.disabled).toBe(false);
        expect(screen.findByTestId('add-phone-approve')).toBeNull();
        expect(screen.findByTestId('add-phone-reject')).toBeNull();
    });

    it('omits only the QR image and keeps the exact link behind disclosure when the invite exceeds QR capacity', async () => {
        featureState = 'enabled';
        activeServerUrl = 'https://stack.example.test';
        const longRelayUrls = Array.from({ length: 4 }, (_, index) =>
            `https://relay-${index}.example.test/${'a'.repeat(470)}`,
        );
        descriptorOverride = {
            v: 1,
            homeServerIdentityId: 'srv_test',
            canonicalServerUrl: 'https://stack.example.test',
            revision: 1,
            endpoints: [
                {
                    kind: 'iroh',
                    endpointId: 'a'.repeat(64),
                    relayUrls: longRelayUrls,
                    directAddresses: ['192.0.2.10:443', '192.0.2.11:443'],
                },
                { kind: 'https', url: 'https://stack.example.test' },
            ],
        };
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({ state: 'pending', pairId: 'pair_123', expiresAt: pairingExpiresAt }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 2 });

        // Only the QR image is unavailable; the pairing stays live and the
        // oversized descriptor reaches the invite unchanged.
        expect(screen.findByTestId('add-phone-qr')?.findAllByType('QRCode')).toHaveLength(0);
        const textContent = screen.getTextContent();
        expect(textContent).toContain('connect.pairingQrTooLargeTitle');
        expect(textContent).toContain('connect.pairingQrTooLargeBody');
        expect(screen.findByTestId('add-phone-invalid-request')).toBeNull();
        expect(screen.findByTestId('add-phone-cancel')).toBeTruthy();
        expect(textContent).toContain('stack.example.test');

        // The exact secret-bearing link stays behind the existing warning/disclosure.
        expect(screen.findAllByTestId('add-phone-pairing-link')).toHaveLength(0);
        const showLinkButton = screen.findByTestId('add-phone-pairing-link-details');
        expect(showLinkButton).toBeTruthy();
        await act(async () => {
            showLinkButton!.props.onPress();
        });
        expect(screen.getTextContent()).toContain('connect.pairingLinkSecurityWarning');
        const copyLinkButton = screen.findByTestId('add-phone-pairing-link-copy');
        expect(copyLinkButton).toBeTruthy();
        await act(async () => {
            await copyLinkButton!.props.action();
        });
        expect(clipboardMocks.setStringAsync).toHaveBeenCalledTimes(1);
        const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        expect(parseHomeQrInviteDeepLink(String(clipboardMocks.setStringAsync.mock.calls[0]?.[0]))?.invite.home)
            .toEqual(descriptorOverride);

        // The live pairing can still be cancelled through the strict decision.
        await act(async () => {
            await screen.findByTestId('add-phone-cancel')!.props.action();
        });
        const cancellationCall = serverFetchSpy.mock.calls.find((call) => call[0] === '/v1/auth/pairing/consume');
        expect(JSON.parse(String(cancellationCall?.[1]?.body))).toEqual({ pairId: 'pair_123', intent: 'cancel' });
    });

    it('cancels a pending invite through the strict cancellation decision and does not create a successor invite', async () => {
        featureState = 'enabled';
        activeServerUrl = 'https://stack.example.test';
        pairingStatusResponse = {
            ok: true,
            status: 200,
            json: async () => ({ state: 'pending', pairId: 'pair_123', expiresAt: pairingExpiresAt }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId('add-phone-generate')?.props.disabled).toBe(true);
        const cancelButton = screen.findByTestId('add-phone-cancel');
        expect(cancelButton).toBeTruthy();
        await act(async () => {
            await cancelButton!.props.action();
        });

        const cancellationCall = serverFetchSpy.mock.calls.find((call) => call[0] === '/v1/auth/pairing/consume');
        expect(JSON.parse(String(cancellationCall?.[1]?.body))).toEqual({ pairId: 'pair_123', intent: 'cancel' });
        expect(serverFetchSpy.mock.calls.filter((call) => call[0] === '/v1/auth/pairing/start')).toHaveLength(1);
        expect(screen.findByTestId('add-phone-pairing-link')).toBeNull();
    });
});
