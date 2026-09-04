import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

const descriptor = Object.freeze({
    v: 1 as const,
    homeServerIdentityId: 'home-known',
    canonicalServerUrl: 'https://known-home.example.test',
    revision: 7,
    endpoints: [{ kind: 'https' as const, url: 'https://known-home.example.test' }],
});

const target = {
    descriptor,
    endpointUrl: 'https://known-home.example.test',
    runtimeOrigin: null,
    createRequest: vi.fn(),
    close: vi.fn(async () => {}),
};

const state = vi.hoisted(() => ({
    probe: vi.fn(),
    pairingStart: vi.fn(),
    pairingConsume: vi.fn(),
    authStart: vi.fn(),
    pairingRequest: vi.fn(),
    authWait: vi.fn(),
    adopt: vi.fn(),
    qrAvailable: true,
    pairingFeatureEnabled: true,
    resolveTransport: vi.fn(),
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getServerProfileById: (id: string) => id === 'known-profile'
        ? { id, serverIdentityId: descriptor.homeServerIdentityId }
        : null,
    buildHomeConnectionDescriptorForProfile: () => descriptor,
}));

vi.mock('@/auth/enrollment/homeEnrollmentTransport', () => ({
    resolveHomeEnrollmentTransport: (...args: unknown[]) => state.resolveTransport(...args),
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: (...args: unknown[]) => state.probe(...args),
}));

vi.mock('@/auth/flows/qrStart', () => ({
    authQRStart: (...args: unknown[]) => state.authStart(...args),
}));

vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingStart: (...args: unknown[]) => state.pairingStart(...args),
    pairingConsume: (...args: unknown[]) => state.pairingConsume(...args),
    pairingRequest: (...args: unknown[]) => state.pairingRequest(...args),
}));

vi.mock('@/auth/flows/qrWait', () => ({
    authQRWait: (...args: unknown[]) => state.authWait(...args),
}));

vi.mock('@/sync/domains/server/adoptHomeProfile', () => ({
    adoptHomeProfileWithCredentials: (...args: unknown[]) => state.adopt(...args),
    HomeProfileAdoptionPartialCommitError: class HomeProfileAdoptionPartialCommitError extends Error {},
}));

vi.mock('@/auth/pairing/pairingUrl', () => ({
    buildRenderableHomeQrInviteDeepLink: ({ invite }: { invite: unknown }) => state.qrAvailable
        ? { ok: true, link: 'happier:///pair?v=2&payload=opaque', invite }
        : { ok: false, reason: 'qr_unavailable', link: 'happier:///pair?v=2&payload=opaque' },
}));

vi.mock('@happier-dev/protocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
    const requesterPublicKey = new Uint8Array(32).fill(3);
    return {
        ...actual,
        createHomeQrReverseInviteV2: () => ({
            invite: {
                v: 2,
                intent: 'home_device',
                direction: 'requester_displays',
                pairId: 'pair-known',
                home: descriptor,
                qrSecretBase64Url: 'secret',
                requesterPublicKeyBase64Url: 'requester-key',
                issuedAtMs: Date.now() - 1_000,
                expiresAtMs: Date.now() + 60_000,
            },
            qrSecret: new Uint8Array(32).fill(4),
            requesterPublicKey,
            requesterSecretKey: new Uint8Array(32).fill(5),
        }),
        computeHomeQrBindingProofV2: () => 'binding-proof',
        deriveHomeQrBindingKeyV2: () => new Uint8Array(32).fill(6),
        deriveHomeQrRendezvousSecretV2: () => new Uint8Array(32).fill(7),
        readServerEnabledBit: () => state.pairingFeatureEnabled,
    };
});

describe('useReversePairingSession', () => {
    beforeEach(() => {
        state.qrAvailable = true;
        state.pairingFeatureEnabled = true;
        state.resolveTransport.mockReset();
        state.resolveTransport.mockResolvedValue({ ok: true, transport: target });
        target.close.mockClear();
        state.probe.mockReset();
        state.probe.mockResolvedValue({
            status: 'ready',
            serverIdentityId: descriptor.homeServerIdentityId,
            features: {},
        });
        state.authStart.mockReset();
        state.authStart.mockResolvedValue({ ok: true });
        state.pairingStart.mockReset();
        state.pairingStart.mockImplementation(async (params: { pairId: string; expiresAtMs: number }) => ({
            ok: true,
            data: { pairId: params.pairId, expiresAt: new Date(params.expiresAtMs).toISOString() },
        }));
        state.pairingConsume.mockReset();
        state.pairingConsume.mockResolvedValue({ ok: true });
        state.pairingRequest.mockReset();
        state.pairingRequest.mockResolvedValue({ ok: true, data: { state: 'requested' } });
        state.authWait.mockReset();
        state.authWait.mockResolvedValue({
            ok: true,
            credentials: { token: 'known-home-token' },
            homeServerIdentityId: descriptor.homeServerIdentityId,
        });
        state.adopt.mockReset();
        state.adopt.mockResolvedValue({ id: 'known-profile' });
    });

    it('owns and aborts target verification from the beginning of the generation', async () => {
        let observedSignal: AbortSignal | null = null;
        state.probe.mockImplementation((_input: { signal: AbortSignal }) => {
            observedSignal = _input.signal;
            return new Promise(() => {});
        });

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(observedSignal).not.toBeNull());

        await hook.unmount();

        expect(observedSignal?.aborted).toBe(true);
        expect(target.close).toHaveBeenCalledOnce();
    });

    it('does not acquire a carrier without an explicit known target profile', async () => {
        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: null }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('invalid'));
        expect(state.resolveTransport).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('does not create a requester invite when the exact Home lacks bound QR v2', async () => {
        state.pairingFeatureEnabled = false;
        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('update_required'));
        expect(state.authStart).not.toHaveBeenCalled();
        expect(state.pairingStart).not.toHaveBeenCalled();
        expect(state.pairingRequest).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('preserves an immutable pair-id conflict without creating the account request', async () => {
        state.pairingStart.mockResolvedValueOnce({ ok: false, reason: 'pair_id_conflict', status: 409 });

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('invalid'));

        expect(state.authStart).not.toHaveBeenCalled();
        expect(state.pairingRequest).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('prevents destructive cancellation after the bound requester claim is accepted', async () => {
        let resolveWait!: (value: { ok: false; reason: 'cancelled' }) => void;
        state.authWait.mockImplementation(() => new Promise((resolve) => {
            resolveWait = resolve;
        }));

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('connecting'));

        expect(hook.getCurrent().canCancel).toBe(false);

        await act(async () => resolveWait({ ok: false, reason: 'cancelled' }));
        await hook.unmount();
    });

    it('uses one exact known HTTPS target through claim, polling, and non-focusing adoption', async () => {
        let resolveWait!: (value: {
            ok: true;
            credentials: { token: string };
            homeServerIdentityId: string;
        }) => void;
        state.authWait.mockImplementation(() => new Promise((resolve) => {
            resolveWait = resolve;
        }));

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('connecting'));

        // A focus change after claim cannot retarget the immutable run.
        await act(async () => resolveWait({
            ok: true,
            credentials: { token: 'known-home-token' },
            homeServerIdentityId: descriptor.homeServerIdentityId,
        }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('succeeded'));

        expect(state.pairingRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                pairId: 'pair-known',
                homeServerIdentityId: descriptor.homeServerIdentityId,
                expiresAtMs: expect.any(Number),
                bindingProof: 'binding-proof',
            }),
            expect.objectContaining({
                endpointUrl: descriptor.canonicalServerUrl,
                descriptor,
                serverId: 'known-profile',
            }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(state.adopt).toHaveBeenCalledWith(expect.objectContaining({
            descriptor,
            credentials: { token: 'known-home-token' },
            source: 'qr',
            preserveUserLabel: true,
        }));
        expect(hook.getCurrent().presentation).toEqual({
            phase: 'succeeded',
            descriptor,
            profileId: 'known-profile',
        });
        await hook.unmount();
    });

    it('keeps an oversized valid invite live as an exact warned link without a QR image', async () => {
        state.qrAvailable = false;
        state.pairingRequest.mockImplementation(() => new Promise(() => {}));

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('ready'));

        expect(hook.getCurrent().presentation).toMatchObject({
            phase: 'ready',
            qrAvailable: false,
            link: 'happier:///pair?v=2&payload=opaque',
            descriptor,
        });
        expect(hook.getCurrent().canCancel).toBe(true);
        await hook.unmount();
    });

    it('cancels the one pre-claim attempt without allowing it to continue', async () => {
        state.qrAvailable = false;
        let requestSignal: AbortSignal | null = null;
        state.pairingRequest.mockImplementation((_params, _target, options: { signal: AbortSignal }) => {
            requestSignal = options.signal;
            return new Promise(() => {});
        });

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().canCancel).toBe(true));

        await act(async () => hook.getCurrent().cancel());

        expect(requestSignal?.aborted).toBe(true);
        expect(state.pairingConsume).toHaveBeenCalledWith(
            { pairId: 'pair-known', intent: 'cancel' },
            expect.objectContaining({ serverId: 'known-profile' }),
        );
        expect(target.close).toHaveBeenCalledOnce();
        expect(hook.getCurrent().presentation).toEqual({
            phase: 'retryable_error',
            descriptor,
            partialCommit: null,
        });
        expect(state.authWait).not.toHaveBeenCalled();

        await act(async () => {
            void hook.getCurrent().start();
            for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
        });
        expect(hook.getCurrent().presentation.phase).toBe('ready');
        await hook.unmount();
    });

    it('retries the initial bound claim with the same authority before expiry', async () => {
        vi.useFakeTimers();
        try {
            state.pairingRequest
                .mockResolvedValueOnce({ ok: false, status: 503 })
                .mockResolvedValueOnce({ ok: true, data: { state: 'requested' } });
            state.authWait.mockImplementation(() => new Promise(() => {}));

            const { useReversePairingSession } = await import('./useReversePairingSession');
            const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
            await act(async () => {
                await vi.runAllTimersAsync();
            });

            expect(state.pairingRequest).toHaveBeenCalledTimes(2);
            expect(state.pairingRequest.mock.calls[1]?.[0]).toEqual(state.pairingRequest.mock.calls[0]?.[0]);
            expect(hook.getCurrent().presentation.phase).toBe('connecting');
            await hook.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it('treats post-start not_found as terminal instead of retrying', async () => {
        state.pairingRequest.mockResolvedValueOnce({ ok: false, reason: 'not_found', status: 404 });

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('invalid'));

        expect(state.pairingRequest).toHaveBeenCalledOnce();
        await hook.unmount();
    });

    it('distinguishes the canonical target-qualified adoption partial commit', async () => {
        const { HomeProfileAdoptionPartialCommitError } = await import('@/sync/domains/server/adoptHomeProfile');
        const partialCommit = new HomeProfileAdoptionPartialCommitError();
        Object.assign(partialCommit, {
            adoptionError: new Error('profile adoption failed'),
            canonicalServerUrl: descriptor.canonicalServerUrl,
            serverIdentityId: descriptor.homeServerIdentityId,
            rollbackOutcome: { kind: 'not_applied', reason: 'ownership_changed' },
        });
        state.adopt.mockRejectedValueOnce(partialCommit);

        const { useReversePairingSession } = await import('./useReversePairingSession');
        const hook = await renderHook(() => useReversePairingSession({ enabled: true, targetProfileId: 'known-profile' }));
        await vi.waitFor(() => expect(hook.getCurrent().presentation.phase).toBe('retryable_error'));

        expect(hook.getCurrent().presentation).toMatchObject({
            phase: 'retryable_error',
            descriptor,
            partialCommit: {
                canonicalServerUrl: descriptor.canonicalServerUrl,
                serverIdentityId: descriptor.homeServerIdentityId,
                rollbackOutcome: { kind: 'not_applied', reason: 'ownership_changed' },
            },
        });
        await hook.unmount();
    });
});
