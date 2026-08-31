import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { buildHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { encodeBase64 } from '@/encryption/base64';
import { useScannedAuthUrlProcessor } from './useScannedAuthUrlProcessor';

const processorTestState = vi.hoisted(() => ({
    routerPush: vi.fn(),
    accountProcess: vi.fn(async () => true),
    terminalProcess: vi.fn(async () => true),
}));

vi.mock('expo-router', () => createExpoRouterMock({
    router: { push: processorTestState.routerPush },
}).module);

vi.mock('@/hooks/auth/useConnectAccount', () => ({
    useConnectAccount: () => ({
        processAuthUrl: processorTestState.accountProcess,
        isLoading: false,
    }),
}));

vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: () => ({
        processAuthUrl: processorTestState.terminalProcess,
        isLoading: false,
    }),
}));

describe('useScannedAuthUrlProcessor', () => {
    it('routes V2 Home input to the restore owner instead of the reverse account processor', async () => {
        processorTestState.routerPush.mockClear();
        processorTestState.accountProcess.mockClear();
        processorTestState.terminalProcess.mockClear();
        const rawLink = buildHomeQrInviteDeepLink({
            invite: {
                v: 2,
                intent: 'home_device',
                pairId: 'pair-generic-account-scan',
                home: {
                    v: 1,
                    homeServerIdentityId: 'srv_home_b',
                    canonicalServerUrl: 'https://home-b.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                },
                qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(10), 'base64url'),
                issuedAtMs: Date.now(),
                expiresAtMs: Date.now() + 60_000,
            },
        });
        const hook = await renderHook(() => useScannedAuthUrlProcessor({ allowedUrlKind: 'account' }));

        let result = false;
        await act(async () => {
            result = await hook.getCurrent().processAuthUrl(rawLink);
        });

        expect(result).toBe(true);
        expect(processorTestState.routerPush).toHaveBeenCalledWith(
            `/restore?pairingLink=${encodeURIComponent(rawLink)}`,
        );
        expect(processorTestState.accountProcess).not.toHaveBeenCalled();
        expect(processorTestState.terminalProcess).not.toHaveBeenCalled();
    });
});
