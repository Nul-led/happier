import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import type { AuthQrStartResult, QRAuthKeyPair } from '@/auth/flows/qrStart';
import type { AuthQrWaitOptions, AuthQrWaitResult } from '@/auth/flows/qrWait';
import type { PairingRequestResult } from '@/sync/api/account/apiPairingAuth';
import type { HomeQrEnrollmentTarget } from '@/auth/flows/qrStart';
import type { AuthCredentials, ServerCredentialLookupOptions } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import {
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
const featureDecisionState = vi.hoisted(() => ({
    focusedDecision: { state: 'enabled', blockedBy: null } as {
        state: 'enabled' | 'disabled' | 'unknown';
        blockedBy: string | null;
    },
    targetEnabled: true,
    targetProbeMode: 'ready' as 'ready' | 'identity_mismatch' | 'invalid_payload',
    targetProbeTransientFailuresRemaining: 0,
    targetProbeSpy: vi.fn(),
}));
const transportResolutionState = vi.hoisted(() => ({
    transientFailuresRemaining: 0,
    calls: [] as Array<{ homeServerIdentityId: string; canonicalServerUrl: string }>,
}));
const modalAlertSpy = vi.hoisted(() => vi.fn(async (
    _title?: string,
    _message?: string,
    _buttons?: Array<{ text?: string; onPress?: () => void }>,
) => {}));

const restoreScanSuccessState = vi.hoisted(() => ({
    loginSpy: vi.fn(async () => ({ kind: 'completed' as const })),
    trackAccountRestoredSpy: vi.fn(),
    trackAuthEnrollmentTransientRetrySpy: vi.fn(),
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
    pairingStartSpy: vi.fn(),
    pairingStatusSpy: vi.fn(),
    completeTrustedPairingSpy: vi.fn(async () => {}),
    authQRStartSpy: vi.fn<(keypair: QRAuthKeyPair, target: unknown, options?: EnrollmentRequestOptions) => Promise<AuthQrStartResult>>(async () => ({ ok: true })),
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
    useFeatureDecision: () => featureDecisionState.focusedDecision,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: async (input: unknown) => {
        featureDecisionState.targetProbeSpy(input);
        if (featureDecisionState.targetProbeTransientFailuresRemaining > 0) {
            featureDecisionState.targetProbeTransientFailuresRemaining -= 1;
            return { status: 'error', reason: 'network' };
        }
        if (featureDecisionState.targetProbeMode === 'identity_mismatch') {
            return {
                status: 'ready',
                serverIdentityId: 'srv_wrong_home',
                features: {
                    features: {
                        auth: {
                            pairing: {
                                desktopQrMobileScan: { enabled: true },
                            },
                        },
                    },
                },
            };
        }
        if (featureDecisionState.targetProbeMode === 'invalid_payload') {
            return { status: 'unsupported', reason: 'invalid_payload' };
        }
        return {
            status: 'ready',
            serverIdentityId: 'srv_home_b',
            features: {
                features: {
                    auth: {
                        pairing: {
                            desktopQrMobileScan: { enabled: featureDecisionState.targetEnabled },
                        },
                    },
                },
            },
        };
    },
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
    resolveServerProfileForPortableIdentity: (identity: string) => identity === 'srv_home_b'
        ? {
            kind: 'resolved',
            serverIdentityId: identity,
            profile: {
                id: 'profile-home-b',
                serverUrl: 'https://home-b.test',
                canonicalServerUrl: 'https://home-b.test',
                serverIdentityId: identity,
            },
        }
        : { kind: 'missing', serverIdentityId: identity },
    buildHomeConnectionDescriptorForProfile: (profile: { serverIdentityId: string }) => ({
        v: 1,
        homeServerIdentityId: profile.serverIdentityId,
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
    }),
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
    pairingStart: (...args: unknown[]) => restoreScanSuccessState.pairingStartSpy(...args),
    pairingStatus: (...args: unknown[]) => restoreScanSuccessState.pairingStatusSpy(...args),
}));

vi.mock('@/auth/pairing/completeTrustedHomeQrPairingRequest', () => ({
    completeTrustedHomeQrPairingRequest: (...args: unknown[]) => restoreScanSuccessState.completeTrustedPairingSpy(...args),
    InvalidTrustedHomeQrRequestError: class InvalidTrustedHomeQrRequestError extends Error {},
}));

vi.mock('@/auth/flows/qrStart', () => ({
    generateAuthKeyPair: () => ({ publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) }),
    authQRStart: (keypair: QRAuthKeyPair, target: unknown, options?: EnrollmentRequestOptions) => restoreScanSuccessState.authQRStartSpy(keypair, target, options),
}));

vi.mock('@/auth/enrollment/homeEnrollmentTransport', () => ({
    resolveHomeEnrollmentTransport: async (descriptor: {
        homeServerIdentityId: string;
        canonicalServerUrl: string;
    }) => {
        transportResolutionState.calls.push(descriptor);
        if (transportResolutionState.transientFailuresRemaining > 0) {
            transportResolutionState.transientFailuresRemaining -= 1;
            return {
                ok: false,
                homeServerIdentityId: descriptor.homeServerIdentityId,
                reason: 'iroh_transport_unavailable',
            };
        }
        return {
            ok: true,
            transport: {
                endpointUrl: descriptor.canonicalServerUrl,
                runtimeOrigin: descriptor.canonicalServerUrl,
                descriptor,
                close: async () => {},
            },
        };
    },
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
    trackAuthEnrollmentTransientRetry: restoreScanSuccessState.trackAuthEnrollmentTransientRetrySpy,
}));

const HOME_B_INVITE = {
    v: 2 as const,
    intent: 'home_device' as const,
    direction: 'trusted_home_displays' as const,
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
        featureDecisionState.focusedDecision = { state: 'enabled', blockedBy: null };
        featureDecisionState.targetEnabled = true;
        featureDecisionState.targetProbeMode = 'ready';
        featureDecisionState.targetProbeTransientFailuresRemaining = 0;
        featureDecisionState.targetProbeSpy.mockClear();
        transportResolutionState.transientFailuresRemaining = 0;
        transportResolutionState.calls = [];
        lastScannerProps = null;
        modalAlertSpy.mockClear();
        restoreScanSuccessState.loginSpy.mockClear();
        restoreScanSuccessState.trackAccountRestoredSpy.mockClear();
        restoreScanSuccessState.trackAuthEnrollmentTransientRetrySpy.mockClear();
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
        restoreScanSuccessState.authQRStartSpy.mockResolvedValue({ ok: true });
        restoreScanSuccessState.authQRWaitSpy.mockClear();
        restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({ ok: false, reason: 'cancelled' });
        restoreScanSuccessState.pairingStartSpy.mockReset();
        restoreScanSuccessState.pairingStatusSpy.mockReset();
        restoreScanSuccessState.completeTrustedPairingSpy.mockClear();
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

    it('does not let focused Home A disable scanning a feature-enabled Home B invite', async () => {
        featureDecisionState.focusedDecision = { state: 'disabled', blockedBy: 'server' };

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        const screen = await renderScreen(<RestoreScanComputerQrView />);

        expect(screen.findByProps({ 'data-testid': 'QrCodeScannerView' })).toBeTruthy();
    });

    it('fails closed against the parsed target Home when that Home disables QR enrollment', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        featureDecisionState.targetEnabled = false;

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => {
            await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
        });

        expect(restoreScanSuccessState.authQRStartSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.pairingRequestSpy).not.toHaveBeenCalled();
        expect(featureDecisionState.targetProbeSpy).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://home-b.test',
            serverId: 'srv_home_b',
        }));
        expect(modalAlertSpy).toHaveBeenCalledWith(
            'connect.scanComputerQrUnavailableTitle',
            'connect.scanComputerQrUnavailableBody',
        );
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

    it('resolves and completes a known-target requester-displayed invite through the stored Home identity', async () => {
        const requesterPublicKey = new Uint8Array(32).fill(8);
        const issuedAtMs = Date.now() - 1_000;
        const expiresAtMs = Date.now() + 120_000;
        const reverseInvite = {
            ...HOME_B_INVITE,
            direction: 'requester_displays' as const,
            pairId: 'pair-reverse-b',
            requesterPublicKeyBase64Url: encodeBase64(requesterPublicKey, 'base64url'),
            issuedAtMs,
            expiresAtMs,
        };
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        const bindingProof = computeHomeQrBindingProofV2({
            direction: reverseInvite.direction,
            qrSecret: new Uint8Array(32).fill(4),
            pairId: reverseInvite.pairId,
            homeServerIdentityId: reverseInvite.home.homeServerIdentityId,
            requesterPublicKey,
            expiresAtMs,
        });
        restoreScanSuccessState.pairingStartSpy.mockResolvedValue({
            ok: true,
            data: { pairId: reverseInvite.pairId, expiresAt: new Date(expiresAtMs).toISOString() },
        });
        restoreScanSuccessState.pairingStatusSpy.mockResolvedValue({
            ok: true,
            data: {
                state: 'requested',
                pairId: reverseInvite.pairId,
                expiresAt: new Date(expiresAtMs).toISOString(),
                requestedPublicKey: encodeBase64(requesterPublicKey),
                requestedDeviceLabel: null,
                bindingProof,
                homeServerIdentityId: reverseInvite.home.homeServerIdentityId,
            },
        });
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        const screen = await renderScreen(<RestoreScanComputerQrView />);

        await act(async () => {
            await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: reverseInvite }));
        });

        expect(restoreScanSuccessState.pairingStartSpy).toHaveBeenCalledWith(
            {
                direction: 'requester_displays',
                secretHash: expect.any(String),
                pairId: reverseInvite.pairId,
                expiresAtMs,
            },
            expect.objectContaining({
                serverId: 'profile-home-b',
                endpointUrl: 'https://home-b.test',
                descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_home_b' }),
            }),
        );
        expect(restoreScanSuccessState.completeTrustedPairingSpy).toHaveBeenCalledWith(expect.objectContaining({
            context: expect.objectContaining({
                direction: 'requester_displays',
                pairId: reverseInvite.pairId,
                expiresAtMs,
                expectedRequesterPublicKeyBase64: encodeBase64(requesterPublicKey),
            }),
        }));
        expect(restoreScanSuccessState.authQRStartSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.authQRWaitSpy).not.toHaveBeenCalled();
        expect(restoreScanSuccessState.adoptHomeProfileSpy).not.toHaveBeenCalled();
        expect(screen.findByTestId('restore-scan-confirm-code')).toBeNull();
        expect(screen.getTextContent()).not.toContain('connect.confirmCodeComparisonBody');
        expect(modalAlertSpy).toHaveBeenCalledWith('home-b.test', 'connect.requesterDeviceAddedBody');
    });

    it('retries transient initial auth and bound-request failures with the same key and proof until success', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            restoreScanSuccessState.authQRStartSpy
                .mockResolvedValueOnce({ ok: false, reason: 'transient', status: 503 })
                .mockResolvedValueOnce({ ok: true });
            restoreScanSuccessState.pairingRequestSpy
                .mockResolvedValueOnce({ ok: false, reason: 'http_error', status: 503 })
                .mockResolvedValueOnce({ ok: true, data: { state: 'requested' } });
            restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({ ok: false, reason: 'cancelled' });

            const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
            await renderScreen(<RestoreScanComputerQrView />);

            let scanPromise!: Promise<void>;
            await act(async () => {
                scanPromise = lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(restoreScanSuccessState.authQRStartSpy).toHaveBeenCalledTimes(1));
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_000);
            });
            await vi.waitFor(() => expect(restoreScanSuccessState.pairingRequestSpy).toHaveBeenCalledTimes(1));
            const firstBoundRequest = restoreScanSuccessState.pairingRequestSpy.mock.calls[0]?.[0];
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_000);
                await scanPromise;
            });

            expect(restoreScanSuccessState.authQRStartSpy).toHaveBeenCalledTimes(2);
            expect(restoreScanSuccessState.pairingRequestSpy).toHaveBeenCalledTimes(2);
            expect(restoreScanSuccessState.pairingRequestSpy.mock.calls[1]?.[0]).toEqual(firstBoundRequest);
            expect(restoreScanSuccessState.authQRWaitSpy).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('retries transient target transport and capability setup with the same parsed invite until success', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            transportResolutionState.transientFailuresRemaining = 1;
            featureDecisionState.targetProbeTransientFailuresRemaining = 1;
            restoreScanSuccessState.pairingRequestSpy.mockResolvedValue({
                ok: true,
                data: { state: 'requested' },
            });
            restoreScanSuccessState.authQRWaitSpy.mockResolvedValue({ ok: false, reason: 'cancelled' });

            const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
            await renderScreen(<RestoreScanComputerQrView />);

            let scanPromise!: Promise<void>;
            await act(async () => {
                scanPromise = lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(transportResolutionState.calls).toHaveLength(1));
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_000);
            });
            expect(transportResolutionState.calls).toHaveLength(2);
            expect(featureDecisionState.targetProbeSpy).toHaveBeenCalledTimes(1);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_000);
                await scanPromise;
            });

            expect(transportResolutionState.calls).toHaveLength(2);
            expect(transportResolutionState.calls[0]).toBe(transportResolutionState.calls[1]);
            expect(featureDecisionState.targetProbeSpy).toHaveBeenCalledTimes(2);
            expect(restoreScanSuccessState.authQRStartSpy).toHaveBeenCalledOnce();
            expect(restoreScanSuccessState.pairingRequestSpy).toHaveBeenCalledOnce();
            expect(restoreScanSuccessState.trackAuthEnrollmentTransientRetrySpy).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['identity_mismatch', 'invalid_payload'] as const)(
        'keeps a %s target capability result terminal instead of retrying setup',
        async (targetProbeMode) => {
            const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            featureDecisionState.targetProbeMode = targetProbeMode;

            const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
            await renderScreen(<RestoreScanComputerQrView />);
            await act(async () => {
                await lastScannerProps.onScan(buildHomeQrInviteDeepLink({ invite: HOME_B_INVITE }));
            });

            expect(featureDecisionState.targetProbeSpy).toHaveBeenCalledOnce();
            expect(restoreScanSuccessState.authQRStartSpy).not.toHaveBeenCalled();
            expect(restoreScanSuccessState.pairingRequestSpy).not.toHaveBeenCalled();
            expect(modalAlertSpy).toHaveBeenCalledWith(
                'connect.scanComputerQrUnavailableTitle',
                'connect.scanComputerQrUnavailableBody',
            );
        },
    );

    it('waits for automatic completion without showing a confirmation code or approval instruction', async () => {
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
        await vi.waitFor(() => expect(restoreScanSuccessState.pairingRequestSpy).toHaveBeenCalledTimes(1));
        await act(async () => {
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(screen.getTextContent()).toContain('connect.securingCredentials'));
        expect(screen.findByTestId('restore-scan-confirm-code')).toBeNull();
        expect(screen.getTextContent()).toContain('home-b.test');
        expect(screen.getTextContent()).toContain('common.home');
        expect(screen.getTextContent()).toContain('connect.requestingDeviceLabel');
        expect(screen.getTextContent()).toContain('connect.expiresAtLabel');
        expect(screen.getTextContent()).not.toContain('connect.confirmCodeComparisonBody');
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
        await vi.waitFor(() => expect(screen.getTextContent()).toContain('connect.securingCredentials'));
        expect(screen.getTextContent()).not.toContain('connect.waitingForApproval');
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
        expect(screen.findAllByTestId('restore-enrollment-cancel')).toHaveLength(0);

        await act(async () => {
            resolveWait({ ok: false, reason: 'cancelled' });
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
        await vi.waitFor(() => expect(restoreScanSuccessState.authQRWaitSpy).toHaveBeenCalledTimes(1));
        expect(screen.findAllByTestId('restore-enrollment-cancel')).toHaveLength(0);

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
