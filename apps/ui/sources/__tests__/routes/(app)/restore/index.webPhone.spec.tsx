import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import {
    installRestoreRouteCommonModuleMocks,
} from './restoreRouteTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const restoreRouteIngressState = vi.hoisted(() => ({
    pairingLink: null as string | null,
    scannerProps: null as Record<string, unknown> | null,
}));

installRestoreRouteCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (options: {
                    web?: unknown;
                    default?: unknown;
                    ios?: unknown;
                    android?: unknown;
                }) => options?.web ?? options?.default ?? options?.ios ?? options?.android,
            },
            Dimensions: {
                get: () => ({ width: 360, height: 800, scale: 2, fontScale: 1 }),
            },
            useWindowDimensions: () => ({ width: 360, height: 800, scale: 2, fontScale: 1 }),
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            params: restoreRouteIngressState.pairingLink
                ? { pairingLink: restoreRouteIngressState.pairingLink }
                : {},
        }).module;
    },
});

vi.mock('@/utils/platform/platform', () => ({
    isRunningOnMac: () => false,
}));

vi.mock('@/utils/platform/responsive', () => ({
    useDeviceType: () => 'phone',
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'enabled' }),
}));

vi.mock('@/utils/platform/qrScannerSupport', () => ({
    isWebQrScannerSupported: () => true,
    canUseCurrentDeviceQrScanner: () => true,
}));

vi.mock('@/components/account/restore/RestoreQrView', () => ({
    RestoreQrView: () => React.createElement('div', { 'data-testid': 'RestoreQrView' }),
}));

vi.mock('@/components/account/restore/RestoreScanComputerQrView', () => ({
    RestoreScanComputerQrView: (props: Record<string, unknown>) => {
        restoreRouteIngressState.scannerProps = props;
        return React.createElement('div', { 'data-testid': 'RestoreScanComputerQrView' });
    },
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    restoreRouteIngressState.pairingLink = null;
    restoreRouteIngressState.scannerProps = null;
});

describe('/restore (web phone)', () => {
    it('defaults to the scan-desktop restore flow on phone-sized web', async () => {
        vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' } as any);

        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/restore/index');

        const screen = await renderScreen(<Screen />);
        await flushHookEffects();
        const scanner = screen.findAllByProps({ 'data-testid': 'RestoreScanComputerQrView' });
        expect(scanner).toHaveLength(1);
    });

    it('passes a routed V2 link unchanged to the embedded restore owner', async () => {
        restoreRouteIngressState.pairingLink = 'happier:///pair?v=2&payload=opaque';
        vi.doMock('expo-router', async () => {
            const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
            return createExpoRouterMock({
                params: { pairingLink: restoreRouteIngressState.pairingLink! },
            }).module;
        });
        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/restore/index');

        await renderScreen(<Screen />);

        expect(restoreRouteIngressState.scannerProps?.initialPairingLink).toBe(
            restoreRouteIngressState.pairingLink,
        );
    });

    it('disables the wizard Back action while the joining enrollment is past its commit boundary', async () => {
        vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' } as any);
        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/restore/index');

        const screen = await renderScreen(<Screen />);
        await act(async () => {
            const setNavigationLocked = restoreRouteIngressState.scannerProps?.onNavigationLockChange;
            expect(setNavigationLocked).toBeInstanceOf(Function);
            (setNavigationLocked as (locked: boolean) => void)(true);
        });

        expect(screen.findByTestId('restore-wizard-back')?.props.disabled).toBe(true);
    });
});
