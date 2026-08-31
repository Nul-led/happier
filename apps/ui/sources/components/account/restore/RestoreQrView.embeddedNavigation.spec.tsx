import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QRAuthKeyPair } from '@/auth/flows/qrStart';
import type { AuthCredentials, ServerCredentialLookupOptions } from '@/auth/storage/tokenStorage';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createModalModuleMock } from '@/dev/testkit/mocks/modal';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { lightTheme } from '@/theme';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
type AdoptHomeProfileInput = Parameters<
    (typeof import('@/sync/domains/server/serverProfiles'))['adoptHomeProfile']
>[0];
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        ScrollView: 'ScrollView',
        ActivityIndicator: 'ActivityIndicator',
        Platform: { OS: 'web', select: (spec: Record<string, unknown>) => spec.web ?? spec.default },
    });
});

const expoRouterMock = createExpoRouterMock({
    params: {},
    router: {
        push: vi.fn(),
        back: vi.fn(),
    },
});

vi.mock('expo-router', () => expoRouterMock.module);

const restoreQrViewState = vi.hoisted(() => ({
    loginSpy: vi.fn(async () => ({ kind: 'completed' as const })),
    authQRWaitSpy: vi.fn<(keypair: QRAuthKeyPair, target: unknown, options?: { shouldCancel?: () => boolean }) => Promise<unknown>>(async (
        _keypair,
        _target,
        _options,
    ) => await new Promise(() => {})),
    trackAccountRestoredSpy: vi.fn(),
    setCredentialsForServerUrlSpy: vi.fn<(
        serverUrl: string,
        options: ServerCredentialLookupOptions,
        credentials: AuthCredentials,
    ) => Promise<boolean>>(async () => true),
    adoptHomeProfileSpy: vi.fn<(input: AdoptHomeProfileInput) => Promise<{
        id: string;
        serverUrl: string;
        serverIdentityId: string;
    }>>(async () => ({
        id: 'profile-home-b',
        serverUrl: 'https://home-b.test',
        serverIdentityId: 'srv_home_b',
    })),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ loginWithCredentials: restoreQrViewState.loginSpy }),
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'profile-home-b', serverUrl: 'https://home-b.test', generation: 1 }),
    getServerProfileById: () => ({
        id: 'profile-home-b',
        serverUrl: 'https://home-b.test',
        canonicalServerUrl: 'https://home-b.test',
        serverIdentityId: 'srv_home_b',
    }),
    adoptHomeProfile: (input: AdoptHomeProfileInput) => restoreQrViewState.adoptHomeProfileSpy(input),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        setCredentialsForServerUrl: (
            serverUrl: string,
            options: ServerCredentialLookupOptions,
            credentials: AuthCredentials,
        ) => restoreQrViewState.setCredentialsForServerUrlSpy(serverUrl, options, credentials),
    },
}));

vi.mock('@/auth/flows/qrStart', () => ({
    generateAuthKeyPair: () => ({ publicKey: new Uint8Array([1]), secretKey: new Uint8Array([2]) }),
    authQRStart: vi.fn(async () => true),
}));

vi.mock('@/auth/flows/qrWait', () => ({
    authQRWait: restoreQrViewState.authQRWaitSpy,
}));

vi.mock('@/auth/pairing/accountConnectUrl', () => ({
    buildAccountConnectDeepLink: () => 'happier:///account?v=1',
}));

vi.mock('@/encryption/base64', () => ({
    encodeBase64: () => 'encoded',
}));

const modalMock = createModalModuleMock();
vi.mock('@/modal', () => modalMock.module);

const textMock = createTextModuleMock({ translate: (key: string) => key });
vi.mock('@/text', () => textMock);

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: lightTheme,
    });
});

vi.mock('@/components/qr/QRCode', () => ({
    QRCode: (props: Record<string, unknown>) => React.createElement('QRCode', props),
}));

vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: vi.fn(async () => null),
}));

vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>) => {
        void promise;
    },
}));

vi.mock('@/auth/providers/registry', () => ({
    getAuthProvider: () => null,
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
}));

vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: 'RoundButton',
}));

vi.mock('@/utils/platform/qrScannerSupport', () => ({
    canUseCurrentDeviceQrScanner: () => true,
}));

vi.mock('@/track', () => ({
    trackAccountRestored: restoreQrViewState.trackAccountRestoredSpy,
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('RestoreQrView (embedded navigation)', () => {
    it('does not issue or poll the retired reverse account QR', async () => {
        vi.resetModules();
        const { RestoreQrView } = await import('./RestoreQrView');

        let tree!: renderer.ReactTestRenderer;
        try {
            await act(async () => {
                tree = renderer.create(<RestoreQrView embedded />);
            });
            await act(async () => {});

            expect(restoreQrViewState.authQRWaitSpy).not.toHaveBeenCalled();
            expect(tree.root.findByProps({ children: 'connect.legacyAccountQrUnavailable' })).toBeTruthy();
        } finally {
            act(() => {
                tree?.unmount();
            });
        }

    });

    it('renders an explicit scan action when an embedded scanner callback is available', async () => {
        vi.resetModules();
        const onOpenScanQr = vi.fn();
        const { RestoreQrView } = await import('./RestoreQrView');

        let tree!: renderer.ReactTestRenderer;
        try {
            await act(async () => {
                tree = renderer.create(<RestoreQrView embedded onOpenScanQr={onOpenScanQr} />);
            });

            const button = tree.root.findByProps({ testID: 'restore-open-scan-qr' });
            expect(button).toBeTruthy();

            await act(async () => {
                button.props.onPress();
            });

            expect(onOpenScanQr).toHaveBeenCalledTimes(1);
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });

    it('does not render the retired unbound account QR writer', async () => {
        vi.resetModules();
        const { RestoreQrView } = await import('./RestoreQrView');

        let tree!: renderer.ReactTestRenderer;
        try {
            await act(async () => {
                tree = renderer.create(<RestoreQrView embedded />);
            });
            await act(async () => {});

            expect(tree.root.findAllByType('QRCode')).toHaveLength(0);
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });

    it('does not adopt a Home or write credentials from the retired reverse flow', async () => {
        vi.resetModules();
        restoreQrViewState.authQRWaitSpy.mockResolvedValueOnce({
            ok: true,
            credentials: { token: 'tok_qr' },
            homeServerIdentityId: 'srv_home_b',
        });
        const onBack = vi.fn();
        const { RestoreQrView } = await import('./RestoreQrView');

        let tree!: renderer.ReactTestRenderer;
        try {
            await act(async () => {
                tree = renderer.create(<RestoreQrView embedded onBack={onBack} />);
            });
            await act(async () => {});

            expect(restoreQrViewState.loginSpy).not.toHaveBeenCalled();
            expect(restoreQrViewState.adoptHomeProfileSpy).not.toHaveBeenCalled();
            expect(restoreQrViewState.setCredentialsForServerUrlSpy).not.toHaveBeenCalled();
            expect(restoreQrViewState.trackAccountRestoredSpy).not.toHaveBeenCalled();
            expect(onBack).not.toHaveBeenCalled();
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });
});
