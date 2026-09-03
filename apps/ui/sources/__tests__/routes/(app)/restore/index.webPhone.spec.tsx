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
    params: {} as Readonly<Record<string, string | string[]>>,
    scannerProps: null as Record<string, unknown> | null,
    replaceSpy: vi.fn(),
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
            router: {
                back: vi.fn(),
                push: vi.fn(),
                replace: restoreRouteIngressState.replaceSpy,
                canGoBack: () => false,
            },
            params: () => restoreRouteIngressState.params,
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
    restoreRouteIngressState.params = {};
    restoreRouteIngressState.scannerProps = null;
    restoreRouteIngressState.replaceSpy.mockClear();
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
        expect(restoreRouteIngressState.scannerProps?.entryIntent).toBe('enter_home');
    });

    it('passes a routed V2 link unchanged to the embedded restore owner under its routed intent', async () => {
        const pairingLink = 'happier:///pair?v=2&payload=opaque';
        restoreRouteIngressState.params = { pairingLink, entryIntent: 'add_home' };
        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/restore/index');

        await renderScreen(<Screen />);

        expect(restoreRouteIngressState.scannerProps?.initialPairingLink).toBe(
            pairingLink,
        );
        expect(restoreRouteIngressState.scannerProps?.entryIntent).toBe('add_home');
    });

    it.each(['missing', 'malformed'] as const)(
        'refuses to consume a routed V2 link whose entry intent is %s',
        async (intentCase) => {
            const pairingLink = 'happier:///pair?v=2&payload=opaque';
            restoreRouteIngressState.params = intentCase === 'missing'
                ? { pairingLink }
                : { pairingLink, entryIntent: 'focus_home' };
            vi.resetModules();
            const { default: Screen } = await import('@/app/(app)/restore/index');

            const screen = await renderScreen(<Screen />);

            expect(restoreRouteIngressState.scannerProps).toBeNull();
            expect(screen.findAllByProps({ 'data-testid': 'RestoreQrView' })).toHaveLength(1);
        },
    );

    it('passes the closed add-home intent to the scanner and presents truthful navigation', async () => {
        vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' } as any);
        restoreRouteIngressState.params = { entryIntent: 'add_home' };
        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/restore/index');

        const screen = await renderScreen(<Screen />);

        expect(restoreRouteIngressState.scannerProps?.entryIntent).toBe('add_home');
        expect(screen.getTextContent()).toContain('setupOnboarding.addHomeTitle');
        expect(screen.getTextContent()).toContain('setupOnboarding.addHomeSubtitle');

        screen.pressByTestId('restore-wizard-back');
        expect(restoreRouteIngressState.replaceSpy).toHaveBeenCalledWith('/settings/account');
    });

    it('fails a malformed intent safely to the explicit welcome flow', async () => {
        vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' } as any);
        restoreRouteIngressState.params = { entryIntent: 'focus_home' };
        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/restore/index');

        const screen = await renderScreen(<Screen />);

        expect(restoreRouteIngressState.scannerProps?.entryIntent).toBe('enter_home');
        expect(screen.getTextContent()).toContain('setupOnboarding.authRestoreTitle');
        expect(screen.getTextContent()).toContain('setupOnboarding.authRestoreSubtitle');
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
