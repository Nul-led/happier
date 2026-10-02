import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { InjectedAuthProvider } from '@/auth/context/AuthContext';

const boundary = vi.hoisted(() => ({
    alertAsync: vi.fn(async () => undefined),
    back: vi.fn(),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { back: boundary.back, canGoBack: () => true } }).module;
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default } });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alertAsync: boundary.alertAsync } }).module;
});
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('expo-camera', () => ({
    CameraView: 'CameraView',
    useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));

const { ScanAuthQrScreen } = await import('./ScanAuthQrScreen');

function renderScanner() {
    return renderScreen(<InjectedAuthProvider credentials={null}><ScanAuthQrScreen
        allowedUrlKind="account"
        homeQrEntryIntent="add_home"
        fallbackHref="/"
        title="Scan"
        subtitle="Scan a Home QR"
        permissionRequiredMessage="Camera permission required"
        manualEntryTitle="Enter link"
        manualEntrySubmitText="Continue"
        testIDPrefix="auth-qr"
    /></InjectedAuthProvider>);
}

describe('ScanAuthQrScreen recovery', () => {
    beforeEach(() => {
        boundary.alertAsync.mockReset();
        boundary.alertAsync.mockResolvedValue(undefined);
        boundary.back.mockClear();
    });

    it.each(['happier-dev:///account?abc123', 'not-a-pairing-link'])(
        'pauses the camera after a declined or invalid link and resumes only on Scan again (%s)',
        async (data) => {
            const screen = await renderScanner();
            await act(async () => {
                await screen.findByTestId('auth-qr-camera')!.props.onBarcodeScanned({ data });
            });

            expect(screen.findAllHostsByTestId('auth-qr-camera')).toHaveLength(0);
            expect(screen.findByTestId('auth-qr-scan-again')).not.toBeNull();
            expect(screen.findByTestId('auth-qr-enter-url')).not.toBeNull();
            expect(boundary.back).not.toHaveBeenCalled();

            await screen.pressByTestIdAsync('auth-qr-scan-again');
            expect(screen.findAllHostsByTestId('auth-qr-camera')).toHaveLength(1);
            await act(async () => {
                await screen.findByTestId('auth-qr-camera')!.props.onBarcodeScanned({ data });
            });
            expect(screen.findAllHostsByTestId('auth-qr-camera')).toHaveLength(0);
        },
    );

    it('keeps the camera paused when processing throws and still offers recovery', async () => {
        boundary.alertAsync.mockRejectedValueOnce(new Error('presentation unavailable'));
        const screen = await renderScanner();
        await act(async () => {
            await screen.findByTestId('auth-qr-camera')!.props.onBarcodeScanned({ data: 'invalid' }).catch(() => undefined);
        });
        expect(screen.findAllHostsByTestId('auth-qr-camera')).toHaveLength(0);
        await screen.pressByTestIdAsync('auth-qr-scan-again');
        expect(screen.findAllHostsByTestId('auth-qr-camera')).toHaveLength(1);
    });
});
