import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installScanRouteCommonModuleMocks,
} from './scanRouteTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerBackSpy = vi.fn();
const routerReplaceSpy = vi.fn();
const routerPushSpy = vi.fn();
const processAccountAuthUrlSpy = vi.fn(async (_url: string) => true);
const processTerminalAuthUrlSpy = vi.fn(async (_url: string) => true);
const promptSpy = vi.fn(async (..._args: unknown[]) => null as string | null);
const alertAsyncSpy = vi.fn(async (..._args: unknown[]) => undefined);
let lastAccountConnectOptions: any = null;
let lastTerminalConnectOptions: any = null;

vi.mock('@/hooks/auth/useConnectAccount', () => ({
    useConnectAccount: (opts?: any) => {
        lastAccountConnectOptions = opts ?? null;
        return { processAuthUrl: processAccountAuthUrlSpy, isLoading: false };
    },
}));

vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: (opts?: any) => {
        lastTerminalConnectOptions = opts ?? null;
        return { processAuthUrl: processTerminalAuthUrlSpy, isLoading: false };
    },
}));

let lastScannerProps: any = null;
vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => {
        lastScannerProps = props;
        // The real view renders `footer` in the granted, denied and unavailable
        // branches alike; rendering it here keeps the camera-denial paste path
        // reachable from these route tests.
        return React.createElement('QrCodeScannerView', props, props.footer);
    },
}));

vi.mock('@/components/onboarding/ui/WizardModalShell', () => ({
    WizardModalShell: (props: any) => React.createElement('WizardModalShell', props, props.children),
}));

installScanRouteCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                back: routerBackSpy,
                replace: routerReplaceSpy,
                push: routerPushSpy,
                canGoBack: () => false,
            },
        }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                prompt: (...args: unknown[]) => promptSpy(...args),
                alertAsync: (...args: unknown[]) => alertAsyncSpy(...args),
            },
        }).module;
    },
});

describe('/scan/account', () => {
    beforeEach(() => {
        routerBackSpy.mockClear();
        routerReplaceSpy.mockClear();
        routerPushSpy.mockClear();
        promptSpy.mockClear();
        alertAsyncSpy.mockClear();
        processAccountAuthUrlSpy.mockClear();
        processTerminalAuthUrlSpy.mockClear();
        lastScannerProps = null;
        lastAccountConnectOptions = null;
        lastTerminalConnectOptions = null;
    });

    it('renders the account scan wizard shell and account-specific scanner copy', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScreen(<Screen />);

        const wizard = screen.findByType('WizardModalShell' as never);
        expect(wizard.props.testID).toBe('scan-account-wizard');
        expect(wizard.props.stepIndex).toBe(0);
        expect(wizard.props.stepCount).toBe(1);
        expect(wizard.props.showSkip).toBe(false);
        expect(wizard.props.title).toBe('connect.linkNewDeviceTitle');
        expect(wizard.props.subtitle).toBe('connect.linkNewDeviceSubtitle');

        expect(lastScannerProps?.embedded).toBe(true);
        expect(lastScannerProps?.title).toBe('connect.linkNewDeviceTitle');
        expect(lastScannerProps?.subtitle).toBe('connect.linkNewDeviceSubtitle');
        expect(lastScannerProps?.permissionRequiredMessage).toBe('modals.cameraPermissionsRequiredToScanQr');
    });

    it('processes scanned account link URLs', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScreen(<Screen />);

        expect(typeof lastScannerProps?.onScan).toBe('function');

        await act(async () => {
            await lastScannerProps.onScan('happier:///account?abc123');
        });

        expect(processAccountAuthUrlSpy).toHaveBeenCalledTimes(1);
        expect(processAccountAuthUrlSpy).toHaveBeenCalledWith('happier:///account?abc123');
        expect(processTerminalAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('refuses the immutable released V1 invite with guidance and zero scan side effects', async () => {
        // Exact output from cli-v0.2.1 commit b1d15a8a9c241737d1ca9b167459901e6259173a.
        const releasedV1Link =
            'happier-dev:///pair?v=1&pairId=pid123&secret=sec_abc&server=https%3A%2F%2Fstack.example.test%2Fpath%3Fx%3D1';
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScreen(<Screen />);
        await act(async () => {
            await lastScannerProps.onScan(releasedV1Link);
        });

        expect(alertAsyncSpy).toHaveBeenCalledWith(
            'connect.updateRequiredTitle',
            'connect.legacyPairingUpdateRequiredBody',
            [
                expect.objectContaining({ text: 'connect.scanNewQr' }),
                expect.objectContaining({ text: 'common.cancel', style: 'cancel' }),
            ],
        );
        expect(processAccountAuthUrlSpy).not.toHaveBeenCalled();
        expect(processTerminalAuthUrlSpy).not.toHaveBeenCalled();
        expect(routerReplaceSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(JSON.stringify(alertAsyncSpy.mock.calls)).not.toContain('sec_abc');
    });

    it('routes a scanned V2 Home invite as an authenticated add-for-later enrollment', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { encodeBase64 } = await import('@/encryption/base64');
        const inviteLink = buildHomeQrInviteDeepLink({
            invite: {
                v: 2,
                intent: 'home_device',
                direction: 'trusted_home_displays',
                pairId: 'pair-settings-scan',
                home: {
                    v: 1,
                    homeServerIdentityId: 'srv_home_b',
                    canonicalServerUrl: 'https://home-b.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                },
                qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(11), 'base64url'),
                issuedAtMs: Date.now(),
                expiresAtMs: Date.now() + 60_000,
            },
        });
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScreen(<Screen />);
        await act(async () => {
            await lastScannerProps.onScan(inviteLink);
        });

        const route = String(routerPushSpy.mock.calls[0]?.[0] ?? '');
        expect(route).toMatch(/^\/restore\?pairingHandoff=[A-Za-z0-9_-]+&entryIntent=add_home$/u);
        expect(route).not.toContain(encodeURIComponent(inviteLink));
        expect(processAccountAuthUrlSpy).not.toHaveBeenCalled();
        expect(alertAsyncSpy).not.toHaveBeenCalled();
    });

    it('rejects scanned terminal URLs from the account scanner', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScreen(<Screen />);

        expect(typeof lastScannerProps?.onScan).toBe('function');

        await act(async () => {
            await lastScannerProps.onScan('happier://terminal?key=abc&server=https%3A%2F%2Fapi.happier.dev');
        });

        expect(alertAsyncSpy).toHaveBeenCalledTimes(1);
        expect(alertAsyncSpy).toHaveBeenCalledWith('common.error', 'modals.invalidAuthUrl', [{ text: 'common.ok' }]);
        expect(processTerminalAuthUrlSpy).not.toHaveBeenCalled();
        expect(processAccountAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('opens the canonical full-screen pairing link form instead of a modal prompt', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScreen(<Screen />);

        expect(screen.findAllByTestId('pairing-link-entry-form')).toHaveLength(0);

        await screen.pressByTestIdAsync('scan-account-enter-url');

        expect(promptSpy).not.toHaveBeenCalled();
        expect(screen.findAllByTestId('pairing-link-entry-form').length).toBeGreaterThan(0);
        expect(screen.findAllByType('QrCodeScannerView' as never)).toHaveLength(0);

        const input = screen.findHostByTestId('restore-pairing-link-input');
        expect(input?.props.placeholder).toBe('connect.accountUrlPlaceholder');
        expect(input?.props.autoFocus).toBe(true);
        expect(input?.props.accessibilityLabel).toBe('connect.enterUrlManually');
        expect(screen.getTextContent()).toContain('connect.enterUrlManually');
        expect(screen.findByTestId('restore-pairing-link-submit').props.title).toBe('common.continue');
    });

    it('submits a pasted account link through the shared scan processor', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScreen(<Screen />);
        await screen.pressByTestIdAsync('scan-account-enter-url');

        await act(async () => {
            screen.changeTextByTestId('restore-pairing-link-input', '  happier:///account?manual  ');
        });
        await act(async () => {
            await screen.findByTestId('restore-pairing-link-submit').props.action();
        });

        expect(promptSpy).not.toHaveBeenCalled();
        expect(processAccountAuthUrlSpy).toHaveBeenCalledTimes(1);
        expect(processAccountAuthUrlSpy).toHaveBeenCalledWith('happier:///account?manual');
        expect(processTerminalAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('keeps a rejected pasted draft with an inline accessible alert', async () => {
        processAccountAuthUrlSpy.mockResolvedValueOnce(false);
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScreen(<Screen />);
        await screen.pressByTestIdAsync('scan-account-enter-url');

        await act(async () => {
            screen.changeTextByTestId('restore-pairing-link-input', 'happier:///account?rejected');
        });
        await act(async () => {
            await screen.findByTestId('restore-pairing-link-submit').props.action();
        });

        const alert = screen.findHostByTestId('restore-pairing-link-error');
        expect(alert?.props.accessibilityRole).toBe('alert');
        expect(screen.findHostByTestId('restore-pairing-link-input')?.props.value)
            .toBe('happier:///account?rejected');
    });

    it('routes a pasted V2 Home invite as an authenticated add-for-later enrollment', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { encodeBase64 } = await import('@/encryption/base64');
        const inviteLink = buildHomeQrInviteDeepLink({
            invite: {
                v: 2,
                intent: 'home_device',
                direction: 'trusted_home_displays',
                pairId: 'pair-pasted-link',
                home: {
                    v: 1,
                    homeServerIdentityId: 'srv_home_b',
                    canonicalServerUrl: 'https://home-b.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                },
                qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(11), 'base64url'),
                issuedAtMs: Date.now(),
                expiresAtMs: Date.now() + 60_000,
            },
        });
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScreen(<Screen />);
        await screen.pressByTestIdAsync('scan-account-enter-url');

        await act(async () => {
            screen.changeTextByTestId('restore-pairing-link-input', inviteLink);
        });
        await act(async () => {
            await screen.findByTestId('restore-pairing-link-submit').props.action();
        });

        const route = String(routerPushSpy.mock.calls[0]?.[0] ?? '');
        expect(route).toMatch(/^\/restore\?pairingHandoff=[A-Za-z0-9_-]+&entryIntent=add_home$/u);
        expect(route).not.toContain(encodeURIComponent(inviteLink));
        expect(processAccountAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('returns to the camera from the pairing link form without leaving the route', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScreen(<Screen />);
        await screen.pressByTestIdAsync('scan-account-enter-url');
        await screen.pressByTestIdAsync('restore-pairing-link-back');

        expect(screen.findAllByTestId('pairing-link-entry-form')).toHaveLength(0);
        expect(screen.findAllByType('QrCodeScannerView' as never).length).toBeGreaterThan(0);
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(routerReplaceSpy).not.toHaveBeenCalled();
    });

    it('uses safe fallback navigation when cancelling without history', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScreen(<Screen />);

        await act(async () => {
            await lastScannerProps.onCancel();
        });

        expect(routerReplaceSpy).toHaveBeenCalledWith('/');
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('uses safe fallback navigation after a successful account link when there is no back stack', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScreen(<Screen />);

        expect(typeof lastAccountConnectOptions?.onSuccess).toBe('function');

        await act(async () => {
            await lastAccountConnectOptions.onSuccess();
        });

        expect(routerReplaceSpy).toHaveBeenCalledWith('/');
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(lastTerminalConnectOptions?.onSuccess).toBe(lastAccountConnectOptions?.onSuccess);
    });
});
