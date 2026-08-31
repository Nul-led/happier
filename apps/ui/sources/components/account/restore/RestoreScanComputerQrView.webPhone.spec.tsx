import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import type { QRAuthKeyPair } from '@/auth/flows/qrStart';
import type { AuthQrWaitOptions, AuthQrWaitResult } from '@/auth/flows/qrWait';
import type { PairingRequestResult } from '@/sync/api/account/apiPairingAuth';
import type { HomeQrEnrollmentTarget } from '@/auth/flows/qrStart';
import type { AuthCredentials, ServerCredentialLookupOptions } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import {
    computeHomeQrConfirmationCodeV2,
    deriveHomeQrRendezvousSecretV2,
} from '@happier-dev/protocol';
import {
    installRestoreScanComputerQrViewCommonModuleMocks,
    resetRestoreScanComputerQrViewCommonModuleMockState,
} from './restoreScanComputerQrViewTestHelpers';

type PairingRequestParams = {
    pairId: string;
    secret: string;
    publicKey: string;
    deviceLabel?: string;
    homeServerIdentityId: string;
    expiresAtMs: number;
    bindingProof: string;
};

type EnrollmentRequestOptions = Readonly<{ signal?: AbortSignal }>;
type AdoptHomeProfileInput = Parameters<
    (typeof import('@/sync/domains/server/serverProfiles'))['adoptHomeProfile']
>[0];

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const navigationState = vi.hoisted(() => ({
    isFocused: true,
}));
const modalAlertSpy = vi.hoisted(() => vi.fn(async (
    _title?: string,
    _message?: string,
    _buttons?: Array<{ text?: string; onPress?: () => void }>,
) => {}));

const restoreScanSuccessState = vi.hoisted(() => ({
    loginSpy: vi.fn(async () => ({ kind: 'completed' as const })),
    trackAccountRestoredSpy: vi.fn(),
    setCredentialsForServerUrlSpy: vi.fn<(
        serverUrl: string,
        options: ServerCredentialLookupOptions,
        credentials: AuthCredentials,
    ) => Promise<boolean>>(async () => true),
    adoptHomeProfileSpy: vi.fn<(input: AdoptHomeProfileInput) => Promise<unknown>>(async () => ({
        id: 'profile-home-b',
        serverUrl: 'https://home-b.test',
        serverIdentityId: 'srv_home_b',
    })),
    pairingRequestSpy: vi.fn<(params: PairingRequestParams, target?: HomeQrEnrollmentTarget, options?: EnrollmentRequestOptions) => Promise<PairingRequestResult>>(async (_params) => ({
        ok: false,
        reason: 'not_found',
        status: 404,
    })),
    authQRStartSpy: vi.fn<(keypair: QRAuthKeyPair, target: unknown, options?: EnrollmentRequestOptions) => Promise<boolean>>(async () => true),
    authQRWaitSpy: vi.fn<(keypair: QRAuthKeyPair, target: unknown, options?: AuthQrWaitOptions) => Promise<AuthQrWaitResult>>(async () => ({
        ok: false,
        reason: 'cancelled',
    })),
    getActiveServerUrlSpy: vi.fn(() => 'https://stack.example.test'),
}));

installRestoreScanComputerQrViewCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { alertAsync: modalAlertSpy } }).module;
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            ScrollView: 'ScrollView',
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'web',
                select: (options: any) => options?.web ?? options?.default ?? options?.ios ?? options?.android,
            },
        });
    },
    reactNavigation: async () => {
        const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
        return {
            ...createReactNavigationNativeMock(),
            useIsFocused: () => navigationState.isFocused,
        };
    },
});

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'enabled' }),
}));

vi.mock('@/utils/platform/platform', () => ({
    isRunningOnMac: () => false,
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ loginWithCredentials: restoreScanSuccessState.loginSpy, refreshFromActiveServer: vi.fn(async () => {}) }),
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerUrl: () => restoreScanSuccessState.getActiveServerUrlSpy(),
    preflightHomeProfileAdoption: (input: {
        descriptor: { canonicalServerUrl: string; homeServerIdentityId: string };
    }) => ({
        canonicalServerUrl: input.descriptor.canonicalServerUrl,
        serverIdentityId: input.descriptor.homeServerIdentityId,
    }),
    adoptHomeProfile: (input: AdoptHomeProfileInput) => restoreScanSuccessState.adoptHomeProfileSpy(input),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        setCredentialsForServerUrl: (
            serverUrl: string,
            options: ServerCredentialLookupOptions,
            credentials: AuthCredentials,
        ) => restoreScanSuccessState.setCredentialsForServerUrlSpy(serverUrl, options, credentials),
        setCredentialsForServerUrlWithRollback: async (
            serverUrl: string,
            options: ServerCredentialLookupOptions,
            credentials: AuthCredentials,
        ) => {
            const written = await restoreScanSuccessState.setCredentialsForServerUrlSpy(
                serverUrl,
                options,
                credentials,
            );
            return written ? { rollback: vi.fn(async () => {}) } : null;
        },
    },
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    normalizeServerUrl: (s: string) => s,
    upsertActivateAndSwitchServer: vi.fn(async () => {}),
}));

vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingRequest: (params: PairingRequestParams, target?: HomeQrEnrollmentTarget, options?: EnrollmentRequestOptions) => restoreScanSuccessState.pairingRequestSpy(params, target, options),
}));

vi.mock('@/auth/flows/qrStart', () => ({
    generateAuthKeyPair: () => ({ publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) }),
    authQRStart: (keypair: QRAuthKeyPair, target: unknown, options?: EnrollmentRequestOptions) => restoreScanSuccessState.authQRStartSpy(keypair, target, options),
}));

vi.mock('@/auth/enrollment/homeEnrollmentTransport', () => ({
    resolveHomeEnrollmentTransport: (descriptor: { canonicalServerUrl: string }) => ({
        ok: true,
        transport: { endpointUrl: descriptor.canonicalServerUrl, descriptor, close: async () => {} },
    }),
}));

vi.mock('@/auth/flows/qrWait', () => ({
    authQRWait: (keypair: QRAuthKeyPair, target: unknown, options?: AuthQrWaitOptions) => restoreScanSuccessState.authQRWaitSpy(keypair, target, options),
}));

let lastScannerProps: any = null;
vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => {
        lastScannerProps = props;
        return React.createElement('div', { 'data-testid': 'QrCodeScannerView' }, props.footer ?? null);
    },
}));

vi.mock('@/track', () => ({
    trackAccountRestored: restoreScanSuccessState.trackAccountRestoredSpy,
}));

const HOME_B_INVITE = {
    v: 2 as const,
    intent: 'home_device' as const,
    pairId: 'pair-b',
    home: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
    },
    qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(4), 'base64url'),
    issuedAtMs: Date.now() - 1_000,
    expiresAtMs: Date.now() + 120_000,
};

describe('RestoreScanComputerQrView (web phone)', () => {
    beforeEach(() => {
        vi.resetModules();
        resetRestoreScanComputerQrViewCommonModuleMockState();
        navigationState.isFocused = true;
        lastScannerProps = null;
        modalAlertSpy.mockClear();
        restoreScanSuccessState.loginSpy.mockClear();
        restoreScanSuccessState.trackAccountRestoredSpy.mockClear();
        restoreScanSuccessState.setCredentialsForServerUrlSpy.mockClear();
        restoreScanSuccessState.adoptHomeProfileSpy.mockClear();
        restoreScanSuccessState.adoptHomeProfileSpy.mockImplementation(async (params) => ({
            id: `profile-${params.descriptor.homeServerIdentityId}`,
            serverUrl: params.descriptor.canonicalServerUrl,
            serverIdentityId: params.descriptor.homeServerIdentityId,
        }));
        restoreScanSuccessState.pairingRequestSpy.mockClear();
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: false,
            reason: 'not_found',
            status: 404,
        });
        restoreScanSuccessState.authQRStartSpy.mockClear();
        restoreScanSuccessState.authQRStartSpy.mockResolvedValue(true);
        restoreScanSuccessState.authQRWaitSpy.mockClear();
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({ ok: false, reason: 'cancelled' });
    });

    it('renders the QR scanner in idle state on web', async () => {
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        const screen = await renderScreen(<RestoreScanComputerQrView />);

        expect(screen.findByProps({ 'data-testid': 'QrCodeScannerView' })).toBeTruthy();
        expect(screen.findByTestId('restore-open-manual')).toBeTruthy();
        expect(screen.findByTestId('restore-show-qr-instead')).toBeTruthy();
        expect(lastScannerProps?.testIDPrefix).toBe('restore-scan');
        expect(lastScannerProps?.active).toBe(true);
    });

    it('marks the QR scanner inactive when the restore route is covered by another screen', async () => {
        navigationState.isFocused = false;

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);

        expect(lastScannerProps?.active).toBe(false);
    });

    it('runs an initial V2 link through the same restore processor used by scanner input', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const initialPairingLink = buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE });
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({
            ok: true,
            credentials: { token: 'tok_home_b' },
            homeServerIdentityId: 'srv_home_b',
        });
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView initialPairingLink={initialPairingLink} />);
        await flushHookEffects({ cycles: 4, turns: 2 });

        expect(restoreScanSuccessState.pairingRequestSpy).toHaveBeenCalledTimes(1);
        expect(restoreScanSuccessState.authQRWaitSpy).toHaveBeenCalledTimes(1);
        expect(restoreScanSuccessState.adoptHomeProfileSpy).toHaveBeenCalledWith(expect.objectContaining({
            descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_home_b' }),
        }));
    });

    it('routes an account-connect QR through the embedded restore owner instead of treating it as invalid', async () => {
        modalAlertSpy.mockImplementationOnce(async (_title, _message, buttons) => {
            buttons?.find((button: { text?: string }) => button.text === 'connect.showQrInstead')?.onPress?.();
        });
        const onShowQrInstead = vi.fn();
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView embedded onShowQrInstead={onShowQrInstead} />);
        await act(async () => {
            await lastScannerProps?.onScan('happier:///account?abc123');
        });

        expect(modalAlertSpy).toHaveBeenCalledWith(
            'connect.restoreAccount',
            'connect.legacyAccountQrUnavailable',
            expect.any(Array),
        );
        expect(onShowQrInstead).toHaveBeenCalledOnce();
    });

    it('enrolls an explicit Home target without calling focused login, changing focus, or touching existing credentials', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({
            ok: true,
            credentials: { token: 'tok_home_b' },
            homeServerIdentityId: 'srv_home_b',
        });

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => {
            await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
        });

        // Start and wait are explicitly targeted at the scanned Home.
        expect(restoreScanSuccessState.authQRStartSpy).toHaveBeenCalledTimes(1);
        expect(restoreScanSuccessState.authQRStartSpy.mock.calls[0]?.[1]).toMatchObject({
            endpointUrl: 'https://home-b.test',
        });
        expect(restoreScanSuccessState.authQRWaitSpy.mock.calls[0]?.[1]).toMatchObject({
            endpointUrl: 'https://home-b.test',
            descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_home_b' }),
        });
        const startSignal = restoreScanSuccessState.authQRStartSpy.mock.calls[0]?.[2]?.signal;
        expect(startSignal).toBeInstanceOf(AbortSignal);
        expect(restoreScanSuccessState.pairingRequestSpy.mock.calls[0]?.[2]?.signal).toBe(startSignal);
        expect(restoreScanSuccessState.authQRWaitSpy.mock.calls[0]?.[2]?.signal).toBe(startSignal);

        // Joining request derives the rendezvous secret from QR-only material.
        const pairingParams = restoreScanSuccessState.pairingRequestSpy.mock.calls[0]?.[0] as PairingRequestParams;
        expect(pairingParams.pairId).toBe('pair-b');
        expect(pairingParams.secret).toBe(encodeBase64(
            deriveHomeQrRendezvousSecretV2(new Uint8Array(32).fill(4)),
            'base64url',
        ));

        // Credentials are stored under the target Home; focus/adoption is non-mutating.
        expect(restoreScanSuccessState.loginSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.adoptHomeProfileSpy).toHaveBeenCalledWith(expect.objectContaining({
            source: 'qr',
            preserveUserLabel: true,
            descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_home_b' }),
        }));
        expect(restoreScanSuccessState.setCredentialsForServerUrlSpy).toHaveBeenCalledWith(
            'https://home-b.test',
            { serverId: 'srv_home_b' },
            { token: 'tok_home_b' },
        );
        expect(restoreScanSuccessState.setCredentialsForServerUrlSpy.mock.invocationCallOrder[0]).toBeLessThan(
            restoreScanSuccessState.adoptHomeProfileSpy.mock.invocationCallOrder[0]!,
        );
        expect(restoreScanSuccessState.trackAccountRestoredSpy).toHaveBeenCalledTimes(1);
        expect(modalAlertSpy).toHaveBeenCalledWith(
            'home-b.test',
            'connect.homeAddedPreservedFocusBody',
        );
    });

    it('shows the client-computed confirmation code, not the server-returned one, for V2 invites', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        let resolveWait!: (result: { ok: false; reason: 'cancelled' }) => void;
        restoreScanSuccessState.authQRWaitSpy.mockImplementation(() => new Promise((resolve) => {
            resolveWait = resolve;
        }));

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        const screen = await renderScreen(<RestoreScanComputerQrView />);
        let scanPromise!: Promise<void>;
        await act(async () => {
            scanPromise = lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(screen.findByTestId('restore-scan-confirm-code')).not.toBeNull());

        const expectedCode = computeHomeQrConfirmationCodeV2({
            qrSecret: new Uint8Array(32).fill(4),
            pairId: 'pair-b',
            homeServerIdentityId: 'srv_home_b',
            requesterPublicKey: new Uint8Array(32).fill(1),
            expiresAtMs: HOME_B_INVITE.expiresAtMs,
        });
        expect(expectedCode).not.toBe('999999');

        // The rendered status card must display the locally derived code.
        expect(screen.findByTestId('restore-scan-confirm-code')?.props.children)
            .toBe(`${expectedCode.slice(0, 3)} ${expectedCode.slice(3)}`);
        expect(screen.getTextContent()).toContain('home-b.test');
        expect(screen.getTextContent()).toContain('common.home');
        expect(screen.getTextContent()).toContain('connect.requestingDeviceLabel');
        expect(screen.getTextContent()).toContain('connect.expiresAtLabel');
        expect(screen.getTextContent()).toContain('connect.confirmCodeComparisonBody');
        await act(async () => {
            resolveWait({ ok: false, reason: 'cancelled' });
            await scanPromise;
        });
    });

    it('surfaces an expired V2 wait as expiry instead of a generic authentication failure', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({ ok: false, reason: 'expired' });

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => {
            await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
        });

        expect(modalAlertSpy).toHaveBeenCalledWith(
            'modals.authRequestExpired',
            'modals.authRequestExpiredDescription',
            [{ text: 'connect.startAgain' }],
        );
        expect(modalAlertSpy).not.toHaveBeenCalledWith('common.error', 'errors.authenticationFailed');
    });

    it.each([
        ['rejected', 'connect.pairingRejectedTitle', 'connect.pairingRejectedBody', 'connect.requestAgain'],
        ['wrong_target', 'connect.wrongHomeTitle', 'connect.wrongHomeBody', 'connect.scanCorrectHome'],
        ['malformed_response', 'connect.unsupportedEnrollmentResponseTitle', 'connect.unsupportedEnrollmentResponseBody', 'common.ok'],
        ['legacy_provisioning_unavailable', 'connect.updateRequiredTitle', 'connect.updateRequiredBody', 'common.ok'],
    ] as const)(
        'maps the %s terminal outcome to precise recovery guidance',
        async (reason, expectedTitle, expectedBody, expectedAction) => {
            const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
                ok: true,
                data: { state: 'requested' },
            });
            restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({ ok: false, reason });

            const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
            await renderScreen(<RestoreScanComputerQrView />);
            await act(async () => {
                await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
            });

            expect(modalAlertSpy).toHaveBeenCalledWith(
                expectedTitle,
                expectedBody,
                [{ text: expectedAction }],
            );
        },
    );

    it('keeps the waiting status stable when poll progress advances', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        let resolveWait!: (result: AuthQrWaitResult) => void;
        restoreScanSuccessState.authQRWaitSpy.mockImplementation((_keypair, _target, options) => new Promise((resolve) => {
            resolveWait = resolve;
            options?.onProgress?.(3);
        }));

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        const screen = await renderScreen(<RestoreScanComputerQrView />);
        let scanPromise!: Promise<void>;
        await act(async () => {
            scanPromise = lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(screen.getTextContent()).toContain('connect.waitingForApproval'));
        expect(screen.getTextContent()).not.toContain('connect.waitingForApproval...');
        expect(screen.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(1);

        await act(async () => {
            resolveWait({ ok: false, reason: 'cancelled' });
            await scanPromise;
        });
    });

    it('returns quietly to scanning when a V2 wait is cancelled', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({ ok: false, reason: 'cancelled' });

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => {
            await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
        });

        expect(modalAlertSpy).not.toHaveBeenCalled();
    });

    it('owns one cancellable enrollment attempt and ignores a stale successful result', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const pairingLink = buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE });
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        let resolveWait!: (result: AuthQrWaitResult) => void;
        restoreScanSuccessState.authQRWaitSpy.mockImplementation(() => new Promise((resolve) => {
            resolveWait = resolve;
        }));

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        const screen = await renderScreen(<RestoreScanComputerQrView />);

        let firstAttempt!: Promise<void>;
        await act(async () => {
            firstAttempt = lastScannerProps.onScan(pairingLink);
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(restoreScanSuccessState.authQRWaitSpy).toHaveBeenCalledTimes(1));

        // A stale scanner callback or competing manual submission cannot start a second attempt.
        await act(async () => {
            await lastScannerProps.onScan(pairingLink);
        });
        expect(restoreScanSuccessState.authQRStartSpy).toHaveBeenCalledTimes(1);
        expect(restoreScanSuccessState.authQRWaitSpy).toHaveBeenCalledTimes(1);
        expect(screen.findAllByTestId('restore-enter-pairing-link')).toHaveLength(0);

        const waitOptions = restoreScanSuccessState.authQRWaitSpy.mock.calls[0]?.[2];
        expect(waitOptions?.shouldCancel?.()).toBe(false);
        await act(async () => {
            screen.findByTestId('restore-enrollment-cancel')!.props.onPress();
        });
        expect(waitOptions?.shouldCancel?.()).toBe(true);

        await act(async () => {
            resolveWait({
                ok: true,
                credentials: { token: 'stale-token-must-not-persist' },
                homeServerIdentityId: 'srv_home_b',
            });
            await firstAttempt;
        });

        expect(restoreScanSuccessState.adoptHomeProfileSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.setCredentialsForServerUrlSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.trackAccountRestoredSpy).not.toHaveBeenCalled();
        expect(screen.findByProps({ 'data-testid': 'QrCodeScannerView' })).toBeTruthy();
    });

    it('makes the credential commit non-cancellable and presents a securing stage before persistence completes', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const pairingLink = buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE });
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        let resolveWait!: (result: AuthQrWaitResult) => void;
        restoreScanSuccessState.authQRWaitSpy.mockImplementation(() => new Promise((resolve) => {
            resolveWait = resolve;
        }));
        let resolveAdoption!: () => void;
        restoreScanSuccessState.adoptHomeProfileSpy.mockImplementation(() => new Promise((resolve) => {
            resolveAdoption = () => resolve({
                id: 'profile-home-b',
                serverUrl: 'https://home-b.test',
                serverIdentityId: 'srv_home_b',
            });
        }));

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        const screen = await renderScreen(<RestoreScanComputerQrView />);

        let attempt!: Promise<void>;
        await act(async () => {
            attempt = lastScannerProps.onScan(pairingLink);
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(screen.findByTestId('restore-enrollment-cancel')).not.toBeNull());
        const staleCancel = screen.findByTestId('restore-enrollment-cancel')!.props.onPress as () => void;

        await act(async () => {
            resolveWait({
                ok: true,
                credentials: { token: 'tok_home_b' },
                homeServerIdentityId: 'srv_home_b',
            });
            await Promise.resolve();
        });

        await vi.waitFor(() => expect(screen.findByTestId('restore-enrollment-securing')).not.toBeNull());
        expect(screen.getTextContent()).toContain('connect.securingCredentials');
        expect(screen.findAllByTestId('restore-enrollment-cancel')).toHaveLength(0);

        // A stale native press dispatched at the phase boundary must not cancel a commit
        // that may already have persisted the target credential.
        await act(async () => {
            staleCancel();
        });
        expect(screen.findByTestId('restore-enrollment-securing')).not.toBeNull();

        await act(async () => {
            resolveAdoption();
            await attempt;
        });

        expect(restoreScanSuccessState.trackAccountRestoredSpy).toHaveBeenCalledOnce();
        expect(modalAlertSpy).toHaveBeenCalledWith(
            'home-b.test',
            'connect.homeAddedPreservedFocusBody',
        );
    });

    it('recognizes a V1 pairing link only to show update/current-Home guidance', async () => {
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({
            ok: true,
            credentials: { token: 'tok_v1' },
            homeServerIdentityId: 'srv_v1_identity',
        });

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => {
            await lastScannerProps.onScan('happier:///pair?v=1&pairId=p&secret=s&server=https%3A%2F%2Fv1home.test');
        });

        expect(restoreScanSuccessState.loginSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.authQRStartSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.authQRWaitSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.setCredentialsForServerUrlSpy).not.toHaveBeenCalled();
        expect(modalAlertSpy).toHaveBeenCalled();
    });

    it('does not poll or persist a V1 QR credential when the target Home identity is missing', async () => {
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({
            ok: true,
            credentials: { token: 'tok_unbound_v1' },
            homeServerIdentityId: null,
        });

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => {
            await lastScannerProps.onScan('happier:///pair?v=1&pairId=p&secret=s&server=https%3A%2F%2Funbound-v1.test');
        });

        expect(restoreScanSuccessState.adoptHomeProfileSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.setCredentialsForServerUrlSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.authQRWaitSpy).not.toHaveBeenCalled();
    });

    it('surfaces a typed failure without storing credentials when the wait fails closed', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
            ok: true,
            data: { state: 'requested' },
        });
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({
            ok: false,
            reason: 'legacy_provisioning_unavailable',
        });

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => {
            await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
        });

        expect(restoreScanSuccessState.setCredentialsForServerUrlSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.adoptHomeProfileSpy).not.toHaveBeenCalled();
        expect(modalAlertSpy).toHaveBeenCalled();
    });
});
