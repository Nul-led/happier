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

let activeServerUrl = 'https://stack.example.test';
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

        const qrContainer = screen.findByTestId('add-phone-qr');
        expect(qrContainer?.findAllByType('QRCode') ?? []).toHaveLength(0);

        const textContent = screen.getTextContent();
        expect(textContent).toContain('connect.pairingQrExpired');
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
        const showLinkButton = screen.findByTestId('add-phone-show-link');
        expect(showLinkButton).toBeTruthy();

        await act(async () => {
            await showLinkButton!.props.action();
        });
        expect(screen.findByTestId('add-phone-pairing-link')).toBeTruthy();
        const copyLinkButton = screen.findByTestId('add-phone-copy-link');
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

    it('approves the captured Home with its target-scoped credential after focus changes', async () => {
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
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId('add-phone-request-confirm-code')?.props.children).toMatch(/^\d{3} \d{3}$/u);
        expect(screen.getTextContent()).toContain('connect.confirmCodeComparisonBody');
        expect(screen.getTextContent()).toContain('connect.expiresAtLabel');
        expect(screen.getTextContent()).toContain('stack.example.test');
        await flushHookEffects({ cycles: 1 });
        const approveButton = screen.findByTestId('add-phone-approve');
        expect(approveButton).toBeTruthy();
        await act(async () => {
            await approveButton!.props.action();
        });

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
    });

    it('rejects a direct-QR request through the existing pairing finalization route without issuing credentials', async () => {
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
                    qrSecret: new Uint8Array(32).fill(7),
                    pairId: 'pair_123',
                    homeServerIdentityId: 'srv_test',
                    requesterPublicKey: requestedPublicKey,
                    expiresAtMs,
                }),
            }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 2 });
        const rejectButton = screen.findByTestId('add-phone-reject');
        expect(rejectButton).toBeTruthy();
        expect(screen.findByTestId('add-phone-generate')?.props.disabled).toBe(true);
        await act(async () => {
            await rejectButton!.props.action();
        });

        expect(serverFetchSpy.mock.calls.some((call) => call[0] === '/v1/auth/account/response')).toBe(false);
        const rejectionCall = serverFetchSpy.mock.calls.find((call) => call[0] === '/v1/auth/pairing/consume');
        expect(JSON.parse(String(rejectionCall?.[1]?.body))).toEqual({ pairId: 'pair_123', intent: 'reject' });
        expect(rejectionCall?.[2]?.requestContext).toMatchObject({
            endpointUrl: 'https://stack.example.test',
            serverId: 'profile-test',
        });
        expect(rejectionCall?.[2]?.requestContext?.credentials).not.toBeNull();
    });

    it('surfaces an approval-won reject conflict without presenting rejection as successful', async () => {
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
                    qrSecret: new Uint8Array(32).fill(7),
                    pairId: 'pair_123',
                    homeServerIdentityId: 'srv_test',
                    requesterPublicKey: requestedPublicKey,
                    expiresAtMs,
                }),
            }),
        } as any;
        pairingConsumeResponse = {
            ok: false,
            status: 409,
            json: async () => ({ error: 'already_decided' }),
        } as any;
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 2 });
        const rejectButton = screen.findByTestId('add-phone-reject');
        expect(rejectButton).toBeTruthy();
        await act(async () => {
            await rejectButton!.props.action();
        });

        const rejectionCall = serverFetchSpy.mock.calls.find((call) => call[0] === '/v1/auth/pairing/consume');
        expect(JSON.parse(String(rejectionCall?.[1]?.body))).toEqual({ pairId: 'pair_123', intent: 'reject' });
        expect(modalMocks.alertAsync).toHaveBeenCalledWith('common.error', 'errors.operationFailed');
    });

    it('keeps the captured pairing target stable by disabling QR replacement during a decision', async () => {
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
                    qrSecret: new Uint8Array(32).fill(7),
                    pairId: 'pair_123',
                    homeServerIdentityId: 'srv_test',
                    requesterPublicKey: requestedPublicKey,
                    expiresAtMs,
                }),
            }),
        } as any;
        let resolveConsume!: (response: any) => void;
        pairingConsumeResponse = new Promise((resolve) => {
            resolveConsume = resolve;
        });
        const { AddPhoneSettingsView } = await import('./AddPhoneSettingsView');

        const screen = await renderScreen(<AddPhoneSettingsView />);
        await flushHookEffects({ cycles: 2 });
        let rejection!: Promise<void>;
        const rejectButton = screen.findByTestId('add-phone-reject');
        expect(rejectButton).toBeTruthy();
        await act(async () => {
            rejection = rejectButton!.props.action();
            await Promise.resolve();
        });

        expect(screen.findByTestId('add-phone-generate')?.props.disabled).toBe(true);

        resolveConsume({ ok: true, status: 200, json: async () => ({ success: true }) });
        await act(async () => {
            await rejection;
        });
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
