import * as React from 'react';
import { DirectHomeQrCompletionError, startDirectHomeQrLifecycle, type DirectHomeQrStartResult } from '@happier-dev/cli-common/homeEnrollment';
import { AccountCompletionError } from '@/auth/flows/accountCompletion';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import { buildRenderableHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { createPairingSecret } from '@/auth/pairing/pairingSecret';
import { completeTrustedHomeQrPairingRequest, InvalidTrustedHomeQrRequestError } from '@/auth/pairing/completeTrustedHomeQrPairingRequest';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';
import { pairingConsume, pairingStart, pairingStatus, type PairingCallTarget, type PairingStatus } from '@/sync/api/account/apiPairingAuth';
import {
    FOREGROUND_FEATURE_PROBE_WAIT_BUDGET_MS,
    getServerFeaturesSnapshot,
    observeAuthenticatedServerFeaturesFresh,
} from '@/sync/api/capabilities/serverFeaturesClient';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import {
    buildHomeConnectionDescriptorForProfile,
    getServerProfileById,
    reconcileServerProfileHomeConnectionDescriptor,
} from '@/sync/domains/server/serverProfiles';
import { isRuntimeActive } from '@/utils/runtime/isRuntimeActive';

type StartPairingResult = { ok: true } | { ok: false; status: number; reason?: 'invalid_invite' | 'update_required' };
type CancelPairingResult = { ok: true } | { ok: false; status: number };
export type PairingContext = Readonly<{ pairId: string; target: PairingCallTarget; issuedAtMs: number; expiresAtMs: number }>;
export type PairingCompletionState = 'idle' | 'pending' | 'adding' | 'retrying' | 'completed' | 'invalid_request' | 'completion_failed' | 'expired' | 'update_required';
export type PairingPresentation =
    | Readonly<{ phase: 'generating' }>
    | Readonly<{ phase: 'ready'; deepLink: string; context: PairingContext; qrAvailable: boolean }>
    | Readonly<{ phase: 'adding' | 'retryable_error' | 'succeeded'; context: PairingContext; requestedDeviceLabel: string | null }>
    | Readonly<{ phase: 'expired'; context: PairingContext }>
    | Readonly<{ phase: 'invalid_request' | 'update_required' }>;
type StartedLifecycle = Extract<DirectHomeQrStartResult, { kind: 'started' }>;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(done, ms);
        function done() { signal.removeEventListener('abort', abort); resolve(); }
        function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); }
        signal.addEventListener('abort', abort, { once: true });
    });
}

/**
 * React presentation adapter over the shared client-neutral direct Home QR lifecycle.
 *
 * `targetProfileId` names the saved Home this QR enrols a device into. It defaults to
 * the focused Home; a different saved Home is paired without changing focus, and only
 * the focused Home's own runtime lease (Iroh or a leased loopback origin) can be used
 * as transport, so a background Home is reached through its published descriptor.
 */
export function usePairingSession(params: Readonly<{ enabled: boolean; isAuthenticated: boolean; targetProfileId?: string | null }>): Readonly<{
    deepLink: string | null; status: PairingStatus | null; pairingContext: PairingContext | null;
    completionState: PairingCompletionState; presentation: PairingPresentation; isExpired: boolean; isStarting: boolean;
    startPairing: () => Promise<StartPairingResult>; cancelPairing: () => Promise<CancelPairingResult>; clearSession: () => void;
}> {
    const { enabled, isAuthenticated } = params;
    const targetProfileId = params.targetProfileId?.trim() || null;
    const [status, setStatus] = React.useState<PairingStatus | null>(null);
    const [deepLink, setDeepLink] = React.useState<string | null>(null);
    const [pairingContext, setPairingContext] = React.useState<PairingContext | null>(null);
    const [completionState, setCompletionState] = React.useState<PairingCompletionState>('idle');
    const [qrAvailable, setQrAvailable] = React.useState(true);
    const [requestedDeviceLabel, setRequestedDeviceLabel] = React.useState<string | null>(null);
    const [isStarting, setIsStarting] = React.useState(false);
    const isStartingRef = React.useRef(false);
    const startingAbortRef = React.useRef<AbortController | null>(null);
    const generationRef = React.useRef(0);
    const activeRef = React.useRef<Readonly<{ lifecycle: StartedLifecycle; context: PairingContext }> | null>(null);

    const resetPresentation = React.useCallback((preserveContext: boolean) => {
        setStatus(null); setDeepLink(null); setQrAvailable(true);
        if (!preserveContext) { setPairingContext(null); setRequestedDeviceLabel(null); }
    }, []);
    const clearSession = React.useCallback(() => {
        generationRef.current += 1; isStartingRef.current = false;
        startingAbortRef.current?.abort(); startingAbortRef.current = null;
        const active = activeRef.current; activeRef.current = null; void active?.lifecycle.cancel();
        resetPresentation(false); setCompletionState('idle'); setIsStarting(false);
    }, [resetPresentation]);
    React.useEffect(() => () => {
        generationRef.current += 1;
        startingAbortRef.current?.abort();
        startingAbortRef.current = null;
        const active = activeRef.current;
        activeRef.current = null;
        void active?.lifecycle.cancel();
    }, []);
    React.useEffect(() => { if (!(enabled && isAuthenticated)) clearSession(); }, [clearSession, enabled, isAuthenticated]);

    const startPairing = React.useCallback(async (): Promise<StartPairingResult> => {
        if (!enabled || !isAuthenticated) return { ok: false, status: 401 };
        if (isStartingRef.current) return { ok: false, status: 409 };
        const generation = ++generationRef.current;
        const isCurrent = () => generationRef.current === generation;
        startingAbortRef.current?.abort();
        const startingAbort = new AbortController();
        startingAbortRef.current = startingAbort;
        const previous = activeRef.current; activeRef.current = null; await previous?.lifecycle.cancel();
        if (!isCurrent()) return { ok: false, status: 409 };
        isStartingRef.current = true; setIsStarting(true); setCompletionState('idle'); resetPresentation(false);
        let target: PairingCallTarget | null = null;
        let lifecycleOwnsTarget = false;
        let observationTransport: Awaited<ReturnType<typeof resolveHomeEnrollmentTransport>> | null = null;
        try {
            const active = getActiveServerSnapshot();
            // The focused Home's runtime lease (Iroh carrier or leased loopback origin)
            // belongs to that Home only. A different saved Home is reached through its
            // own published descriptor, never through the focused Home's transport.
            const serverId = targetProfileId ?? active.serverId;
            const usesActiveRuntime = serverId === active.serverId;
            const runtimeTransport = usesActiveRuntime
                ? { runtimeOrigin: active.runtimeOrigin, runtimeCarrier: active.carrier }
                : {};
            // A person is waiting on the QR: a Home that cannot answer promptly must
            // surface the failure instead of holding the generating state open for the
            // shared probe's full attempt bound. The shared request keeps running for
            // the consumers still waiting on it.
            const snapshot = await getServerFeaturesSnapshot({
                serverId,
                timeoutMs: FOREGROUND_FEATURE_PROBE_WAIT_BUDGET_MS,
            });
            if (!isCurrent()) return { ok: false, status: 409 };
            if (snapshot.status === 'unsupported') {
                setCompletionState('update_required');
                return { ok: false, status: 426, reason: 'update_required' };
            }
            if (snapshot.status !== 'ready') { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            const observedIdentity = String(snapshot.serverIdentityId ?? '').trim();
            const profile = getServerProfileById(serverId);
            const retainedDescriptor = profile ? buildHomeConnectionDescriptorForProfile(profile) : null;
            if (!retainedDescriptor || !observedIdentity || retainedDescriptor.homeServerIdentityId !== observedIdentity) { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            const credentials = await TokenStorage.getCredentialsForServerUrl(retainedDescriptor.canonicalServerUrl, {
                serverId: retainedDescriptor.homeServerIdentityId,
            });
            if (!credentials) { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            observationTransport = await resolveHomeEnrollmentTransport(retainedDescriptor, {
                ...runtimeTransport,
                verification: { kind: 'authenticated', token: credentials.token },
            });
            if (!observationTransport.ok) { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            const authenticatedSnapshot = await observeAuthenticatedServerFeaturesFresh({
                request: observationTransport.transport.createRequest({
                    serverId: retainedDescriptor.homeServerIdentityId,
                    credentials,
                }),
            });
            if (!isCurrent()) return { ok: false, status: 409 };
            const authenticatedIdentity = authenticatedSnapshot.status === 'ready'
                ? String(authenticatedSnapshot.serverIdentityId ?? '').trim()
                : '';
            const descriptor = authenticatedSnapshot.status === 'ready'
                ? authenticatedSnapshot.features.homeConnectionDescriptor
                : null;
            if (
                !descriptor
                || authenticatedIdentity !== retainedDescriptor.homeServerIdentityId
                || descriptor.homeServerIdentityId !== retainedDescriptor.homeServerIdentityId
            ) {
                setCompletionState('completion_failed');
                return { ok: false, status: 412 };
            }
            const reconciliation = await reconcileServerProfileHomeConnectionDescriptor({
                serverUrl: retainedDescriptor.canonicalServerUrl,
                observedServerIdentityId: authenticatedIdentity,
                descriptor,
                observation: 'exact',
            });
            if (reconciliation.kind !== 'applied' && reconciliation.kind !== 'unchanged') {
                setCompletionState('completion_failed');
                return { ok: false, status: 412 };
            }
            await observationTransport.transport.close();
            observationTransport = null;
            const transport = await resolveHomeEnrollmentTransport(descriptor, {
                ...runtimeTransport,
                verification: { kind: 'authenticated', token: credentials.token },
            });
            if (!transport.ok) { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            target = { ...transport.transport, serverId };
            if (!isCurrent()) return { ok: false, status: 409 };
            const immutableTarget = target;
            const started = await startDirectHomeQrLifecycle({
                features: authenticatedSnapshot.features,
                descriptor,
                signal: startingAbort.signal,
                adapters: {
                    randomBytes: async () => decodeBase64((await createPairingSecret()).secret, 'base64url'),
                    now: Date.now,
                    start: async ({ signal, ...body }) => {
                        const result = await pairingStart(body, immutableTarget, { signal });
                        return result.ok ? { ok: true, pairId: result.data.pairId, expiresAt: result.data.expiresAt } : { ok: false, status: result.status };
                    },
                    poll: async ({ pairId, signal, timeoutMs }) => {
                        if (!isRuntimeActive()) return { ok: false, reason: 'transient', status: 0 };
                        const result = await pairingStatus({ pairId }, immutableTarget, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
                        if (result.ok) { if (isCurrent()) setStatus(result.data); return { ok: true, status: result.data }; }
                        if (result.reason === 'not_found') return { ok: false, reason: 'not_found', status: result.status };
                        if (result.reason === 'http_error' && (result.status === 0 || result.status === 408 || result.status === 429 || result.status >= 500)) return { ok: false, reason: 'transient', status: result.status };
                        return { ok: false, reason: 'invalid', status: result.status };
                    },
                    consume: async ({ pairId, intent, signal, timeoutMs }) => {
                        const result = await pairingConsume(
                            { pairId, intent },
                            immutableTarget,
                            { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) },
                        );
                        if (result.ok) return { ok: true, outcome: 'cancelled' };
                        return result.reason === 'already_decided'
                            ? { ok: true, outcome: 'completion_won' }
                            : { ok: false };
                    },
                    complete: async ({ context, requestedDeviceLabel, requesterPublicKey, signal }) => {
                        if (isCurrent()) { setDeepLink(null); setRequestedDeviceLabel(requestedDeviceLabel); setCompletionState('adding'); }
                        try {
                            return await completeTrustedHomeQrPairingRequest({
                                context: { ...context, target: immutableTarget },
                                requesterPublicKey,
                                signal,
                            });
                        }
                        catch (error) {
                            if (error instanceof InvalidTrustedHomeQrRequestError) throw new DirectHomeQrCompletionError('invalid');
                            if (error instanceof AccountCompletionError && error.retryable) { if (isCurrent()) setCompletionState('retrying'); throw new DirectHomeQrCompletionError('retryable'); }
                            throw new DirectHomeQrCompletionError('failed');
                        }
                    },
                    buildRenderableInvite: (invite) => buildRenderableHomeQrInviteDeepLink({ invite }),
                    sleep: abortableSleep,
                    close: immutableTarget.close,
                },
            });
            lifecycleOwnsTarget = true;
            if (!isCurrent()) { if (started.kind === 'started') await started.cancel(); return { ok: false, status: 409 }; }
            if (started.kind === 'update_required') { setCompletionState('update_required'); return { ok: false, status: 426, reason: 'update_required' }; }
            if (started.kind === 'failed') {
                setCompletionState('completion_failed');
                return { ok: false, status: started.status, ...(started.reason === 'invalid_invite' ? { reason: 'invalid_invite' as const } : {}) };
            }
            if (started.kind === 'cancelled') return { ok: false, status: 409 };
            const context = { pairId: started.invite.pairId, target: immutableTarget, issuedAtMs: started.invite.issuedAtMs, expiresAtMs: started.invite.expiresAtMs };
            activeRef.current = { lifecycle: started, context };
            setPairingContext(context); setDeepLink(started.link); setQrAvailable(started.qrAvailable);
            setStatus({ state: 'pending', pairId: context.pairId, expiresAt: new Date(context.expiresAtMs).toISOString() }); setCompletionState('pending');
            void started.completion.then((outcome) => {
                if (!isCurrent() || activeRef.current?.lifecycle !== started) return;
                activeRef.current = null;
                if (outcome.kind === 'completed') { setRequestedDeviceLabel(outcome.requestedDeviceLabel); setCompletionState('completed'); }
                else if (outcome.kind === 'expired') { resetPresentation(true); setCompletionState('expired'); }
                else if (outcome.kind === 'invalid_request') { resetPresentation(false); setCompletionState('invalid_request'); }
                else if (outcome.kind === 'failed') { resetPresentation(false); setCompletionState('completion_failed'); }
            });
            return { ok: true };
        } catch {
            if (!isCurrent()) return { ok: false, status: 409 };
            setCompletionState('completion_failed');
            return { ok: false, status: 500 };
        }
        finally {
            if (startingAbortRef.current === startingAbort) startingAbortRef.current = null;
            if (observationTransport?.ok) await observationTransport.transport.close().catch(() => {});
            if (target && !lifecycleOwnsTarget) await target.close().catch(() => {});
            if (isCurrent()) { isStartingRef.current = false; setIsStarting(false); }
        }
    }, [enabled, isAuthenticated, resetPresentation, targetProfileId]);

    const cancelPairing = React.useCallback(async (): Promise<CancelPairingResult> => {
        const active = activeRef.current;
        if (!active || completionState !== 'pending') return { ok: false, status: 409 };
        const result = await active.lifecycle.cancel();
        if (!result.ok) return { ok: false, status: 500 };
        if (result.outcome === 'cancelled') clearSession();
        return { ok: true };
    }, [clearSession, completionState]);

    const presentation = React.useMemo<PairingPresentation>(() => {
        if (completionState === 'expired' && pairingContext) return { phase: 'expired', context: pairingContext };
        if (completionState === 'update_required') return { phase: 'update_required' };
        if (completionState === 'invalid_request' || completionState === 'completion_failed') return { phase: 'invalid_request' };
        if (pairingContext) {
            if (completionState === 'adding') return { phase: 'adding', context: pairingContext, requestedDeviceLabel };
            if (completionState === 'retrying') return { phase: 'retryable_error', context: pairingContext, requestedDeviceLabel };
            if (completionState === 'completed') return { phase: 'succeeded', context: pairingContext, requestedDeviceLabel };
            if (completionState === 'pending' && deepLink) return { phase: 'ready', deepLink, context: pairingContext, qrAvailable };
        }
        return { phase: 'generating' };
    }, [completionState, deepLink, pairingContext, qrAvailable, requestedDeviceLabel]);
    return { deepLink, status, pairingContext, completionState, presentation, isExpired: completionState === 'expired', isStarting, startPairing, cancelPairing, clearSession };
}
