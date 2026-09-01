import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExpoRouterMock, renderScreen } from '@/dev/testkit';

const descriptor = Object.freeze({
    v: 1 as const,
    homeServerIdentityId: 'known-home',
    canonicalServerUrl: 'https://known-home.example.test',
    revision: 1,
    endpoints: [{ kind: 'https' as const, url: 'https://known-home.example.test' }],
});

const state = vi.hoisted(() => ({
    presentation: { phase: 'generating' } as Record<string, unknown>,
    canCancel: true,
    cancel: vi.fn(),
    start: vi.fn(async () => {}),
    copy: vi.fn(async () => true),
    preventRemove: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});

const routerMock = createExpoRouterMock({ params: {} });
vi.mock('expo-router', () => routerMock.module);

vi.mock('@react-navigation/native', () => ({
    usePreventRemove: (locked: boolean) => state.preventRemove(locked),
}));

vi.mock('@/hooks/auth/useReversePairingSession', () => ({
    useReversePairingSession: () => ({
        presentation: state.presentation,
        canCancel: state.canCancel,
        cancel: state.cancel,
        start: state.start,
    }),
}));

vi.mock('@/utils/ui/clipboard', () => ({
    setClipboardStringSafe: (value: string) => state.copy(value),
}));

vi.mock('@/components/qr/QRCode', () => ({ QRCode: 'QRCode' }));
vi.mock('@/components/ui/buttons/RoundButton', () => ({ RoundButton: 'RoundButton' }));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({ ActivitySpinner: 'ActivitySpinner' }));
vi.mock('@/utils/platform/qrScannerSupport', () => ({ canUseCurrentDeviceQrScanner: () => true }));
vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({ getReadyServerFeatures: vi.fn(async () => null) }));
vi.mock('@/utils/system/fireAndForget', () => ({ fireAndForget: (promise: Promise<unknown>) => void promise }));
vi.mock('@/auth/providers/registry', () => ({ getAuthProvider: () => null }));

describe('RestoreQrView known-target requester QR', () => {
    beforeEach(() => {
        state.presentation = {
            phase: 'ready',
            invite: {},
            link: 'happier:///pair?v=2&payload=opaque-secret',
            qrAvailable: true,
            descriptor,
        };
        state.canCancel = true;
        state.cancel.mockClear();
        state.start.mockClear();
        state.copy.mockClear();
        state.preventRemove.mockClear();
    });

    afterEach(() => vi.clearAllMocks());

    it('renders the exact known-target requester QR with no code or approval controls', async () => {
        const { RestoreQrView } = await import('./RestoreQrView');
        const screen = await renderScreen(<RestoreQrView embedded />);

        expect(screen.findByTestId('restore-requester-qr')?.findByType('QRCode').props.data)
            .toBe('happier:///pair?v=2&payload=opaque-secret');
        expect(screen.getTextContent()).toContain('known-home.example.test');
        expect(screen.findByTestId('restore-scan-confirm-code')).toBeNull();
        expect(screen.findByTestId('restore-approve')).toBeNull();
        expect(screen.findByTestId('restore-reject')).toBeNull();
    });

    it('keeps the secret-bearing link behind explicit warned disclosure, then copies the exact value', async () => {
        const { RestoreQrView } = await import('./RestoreQrView');
        const screen = await renderScreen(<RestoreQrView embedded />);

        expect(screen.getTextContent()).toContain(
            'Anyone with this temporary link can add a device before it expires. Share it only with your own device.',
        );
        expect(screen.findByTestId('restore-requester-link-value')).toBeNull();
        expect(screen.findByTestId('restore-copy-requester-link')).toBeNull();

        await act(async () => screen.findByTestId('restore-show-requester-link')?.props.onPress());
        expect(screen.findByTestId('restore-requester-link-value')?.props.children)
            .toBe('happier:///pair?v=2&payload=opaque-secret');
        await act(async () => screen.findByTestId('restore-copy-requester-link')?.props.action());
        expect(state.copy).toHaveBeenCalledWith('happier:///pair?v=2&payload=opaque-secret');
    });

    it('keeps the exact live link row when only QR encoding is unavailable', async () => {
        state.presentation = { ...state.presentation, qrAvailable: false };
        const { RestoreQrView } = await import('./RestoreQrView');
        const screen = await renderScreen(<RestoreQrView embedded />);

        expect(screen.findByTestId('restore-requester-qr')?.findAllByType('QRCode')).toHaveLength(0);
        expect(screen.getTextContent()).toContain("This invite carries extra connection details, so it can't be shown as a QR code.");
        await act(async () => screen.findByTestId('restore-show-requester-link')?.props.onPress());
        expect(screen.findByTestId('restore-requester-link-value')?.props.children)
            .toBe('happier:///pair?v=2&payload=opaque-secret');
    });

    it('locks route removal and hides destructive navigation after the requester claim', async () => {
        state.presentation = { phase: 'connecting', descriptor, expiresAtMs: Date.now() + 60_000 };
        state.canCancel = false;
        const onBack = vi.fn();
        const onOpenScanQr = vi.fn();
        const onNavigationLockChange = vi.fn();
        const { RestoreQrView } = await import('./RestoreQrView');
        const screen = await renderScreen(
            <RestoreQrView
                embedded
                onBack={onBack}
                onOpenScanQr={onOpenScanQr}
                onNavigationLockChange={onNavigationLockChange}
            />,
        );

        expect(state.preventRemove).toHaveBeenLastCalledWith(true);
        expect(onNavigationLockChange).toHaveBeenCalledWith(true);
        expect(screen.findByTestId('restore-requester-cancel')).toBeNull();
        expect(screen.findByTestId('restore-open-scan-qr')).toBeNull();
        expect(screen.findByTestId('restore-open-manual')).toBeNull();
    });

    it('routes the embedded scanner action through its owner before any claim exists', async () => {
        const onOpenScanQr = vi.fn();
        const { RestoreQrView } = await import('./RestoreQrView');
        const screen = await renderScreen(<RestoreQrView embedded onOpenScanQr={onOpenScanQr} />);

        await act(async () => screen.findByTestId('restore-open-scan-qr')?.props.onPress());
        expect(onOpenScanQr).toHaveBeenCalledOnce();
    });
});
