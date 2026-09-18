import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import {
    installRestoreScanComputerQrViewCommonModuleMocks,
    resetRestoreScanComputerQrViewCommonModuleMockState,
    restoreScanComputerQrViewModuleState,
} from './restoreScanComputerQrViewTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

installRestoreScanComputerQrViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            ScrollView: 'ScrollView',
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'ios',
                select: (options: any) => options?.ios ?? options?.default ?? options?.web ?? options?.android,
            },
        });
    },
});

vi.mock('expo-constants', () => ({
    default: { deviceName: 'Test iPhone' },
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'enabled' }),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ login: vi.fn(async () => {}), refreshFromActiveServer: vi.fn(async () => {}) }),
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerUrl: () => 'https://lan.example.test:53288',
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    normalizeServerUrl: (s: string) => s,
    upsertActivateAndSwitchServer: vi.fn(async () => {}),
}));

vi.mock('@/auth/pairing/pairingUrl', () => ({
    classifyLegacyPairingDeepLink: () => ({ kind: 'legacy_pairing_update_required' }),
    parseHomeQrInviteDeepLink: () => null,
}));

vi.mock('@/auth/flows/qrStart', () => ({
    generateAuthKeyPair: () => ({ publicKey: new Uint8Array([1]), secretKey: new Uint8Array([2]) }),
    authQRStart: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/auth/flows/qrWait', () => ({
    authQRWait: vi.fn(async () => null),
}));

vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingConsume: vi.fn(async () => ({ ok: true })),
    pairingRequest: vi.fn(async () => ({ ok: false, reason: 'not_found', status: 404 })),
}));

vi.mock('@/encryption/base64', () => ({
    encodeBase64: () => 'x',
}));

vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => React.createElement('div', { 'data-testid': 'QrCodeScannerView' }, props.footer),
}));

describe('RestoreScanComputerQrView (embedded navigation)', () => {
    it('uses the embedded callback for “Show QR instead” rather than pushing the /restore/show-qr route', async () => {
        vi.resetModules();
        resetRestoreScanComputerQrViewCommonModuleMockState();

        const onShowQrInstead = vi.fn();
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        let tree!: renderer.ReactTestRenderer;
        try {
            await act(async () => {
                tree = renderer.create(
                    <RestoreScanComputerQrView
                        entryIntent="add_home"
                        embedded
                        onShowQrInstead={onShowQrInstead}
                    />,
                );
            });

            const button = tree.root.findByProps({ testID: 'restore-show-qr-instead' });
            await act(async () => {
                await button.props.action();
            });

            expect(onShowQrInstead).toHaveBeenCalledTimes(1);
            expect(restoreScanComputerQrViewModuleState.routerPushSpy).not.toHaveBeenCalled();
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });
});
