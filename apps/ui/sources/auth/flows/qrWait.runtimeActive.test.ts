import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { generateAuthKeyPair } from './qrStart';
import { authQRWait } from './qrWait';

const appState = vi.hoisted(() => ({ currentState: 'background' as string }));
const endpointFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: () => endpointFetchMock,
    serverFetch: vi.fn(),
}));

vi.mock('@/utils/runtime/isRuntimeActive', () => ({
    isRuntimeActive: () => appState.currentState === 'active',
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                Platform: { OS: 'web' },
                AppState: {
                    get currentState() {
                        return appState.currentState;
                    },
                },
            }
    );
});

describe('authQRWait runtime active gating', () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    afterEach(() => {
        endpointFetchMock.mockReset();
        appState.currentState = 'background';
        vi.useRealTimers();
    });

    it('does not poll the explicit endpoint while the runtime is inactive (background/hidden)', async () => {
        appState.currentState = 'background';
        vi.useFakeTimers();

        const keypair = generateAuthKeyPair();
        const issuedAtMs = Date.now();
        const expiresAtMs = issuedAtMs + 5_000;
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://home-b.test',
            revision: 1,
            endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
        };
        const outPromise = authQRWait(keypair, {
            descriptor,
            canonicalServerUrl: descriptor.canonicalServerUrl,
            homeServerIdentityId: descriptor.homeServerIdentityId,
            endpointUrl: descriptor.canonicalServerUrl,
            runtimeOrigin: descriptor.canonicalServerUrl,
            carrier: 'https',
            createRequest: () => endpointFetchMock,
            close: async () => {},
        }, {
            v2Context: {
                pairId: 'pair-background',
                homeServerIdentityId: descriptor.homeServerIdentityId,
                bindingSecret: new Uint8Array(32).fill(7),
                bindingProof: 'proof',
                issuedAtMs,
                expiresAtMs,
            },
        });

        await vi.advanceTimersByTimeAsync(10_000);

        await expect(outPromise).resolves.toEqual({ ok: false, reason: 'expired' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(0);

        vi.useRealTimers();
    });

    it('cancels immediately while waiting for the runtime to become active', async () => {
        appState.currentState = 'background';
        vi.useFakeTimers();

        const keypair = generateAuthKeyPair();
        const issuedAtMs = Date.now();
        const expiresAtMs = issuedAtMs + 60_000;
        const controller = new AbortController();
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://home-b.test',
            revision: 1,
            endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
        };
        const outPromise = authQRWait(keypair, {
            descriptor,
            canonicalServerUrl: descriptor.canonicalServerUrl,
            homeServerIdentityId: descriptor.homeServerIdentityId,
            endpointUrl: descriptor.canonicalServerUrl,
            runtimeOrigin: descriptor.canonicalServerUrl,
            carrier: 'https',
            createRequest: () => endpointFetchMock,
            close: async () => {},
        }, {
            signal: controller.signal,
            v2Context: {
                pairId: 'pair-background-cancel',
                homeServerIdentityId: descriptor.homeServerIdentityId,
                bindingSecret: new Uint8Array(32).fill(7),
                bindingProof: 'proof',
                issuedAtMs,
                expiresAtMs,
            },
        });

        controller.abort();

        await expect(outPromise).resolves.toEqual({ ok: false, reason: 'cancelled' });
        expect(endpointFetchMock).not.toHaveBeenCalled();
    });
});
