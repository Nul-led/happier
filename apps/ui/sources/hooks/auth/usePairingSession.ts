import * as React from 'react';
import { DirectHomeQrCompletionError, startDirectHomeQrLifecycle, type DirectHomeQrStartResult } from '@happier-dev/cli-common/homeEnrollment';
import { AccountCompletionError } from '@/auth/flows/accountCompletion';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import { buildRenderableHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { createPairingSecret } from '@/auth/pairing/pairingSecret';
import { completeTrustedHomeQrPairingRequest, InvalidTrustedHomeQrRequestError } from '@/auth/pairing/completeTrustedHomeQrPairingRequest';
import { decodeBase64 } from '@/encryption/base64';
import { pairingConsume, pairingStart, pairingStatus, type PairingCallTarget, type PairingStatus } from '@/sync/api/account/apiPairingAuth';
import { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { buildHomeConnectionDescriptorForProfile, getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { isRuntimeActive } from '@/utils/runtime/isRuntimeActive';

type StartPairingResult = { ok: true } | { ok: false; status: number; reason?: 'invalid_invite' | 'update_required' };
type CancelPairingResult = { ok: true } | { ok: false; status: number };
export type PairingContext = Readonly<{ pairId: string; target: PairingCallTarget; issuedAtMs: number; expiresAtMs: number }>;
export type PairingCompletionState = 'idle' | 'pending' | 'adding' | 'retrying' | 'completed' | 'invalid_request' | 'completion_failed' | 'expired';
export type PairingPresentation =
    | Readonly<{ phase: 'generating' }>
    | Readonly<{ phase: 'ready'; deepLink: string; context: PairingContext; qrAvailable: boolean }>
    | Readonly<{ phase: 'adding' | 'retryable_error' | 'succeeded'; context: PairingContext; requestedDeviceLabel: string | null }>
    | Readonly<{ phase: 'expired'; context: PairingContext }>
    | Readonly<{ phase: 'invalid_request' }>;
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

/** React presentation adapter over the shared client-neutral direct Home QR lifecycle. */
export function usePairingSession(params: Readonly<{ enabled: boolean; isAuthenticated: boolean }>): Readonly<{
    deepLink: string | null; status: PairingStatus | null; pairingContext: PairingContext | null;
    completionState: PairingCompletionState; presentation: PairingPresentation; isExpired: boolean; isStarting: boolean;
    startPairing: () => Promise<StartPairingResult>; cancelPairing: () => Promise<CancelPairingResult>; clearSession: () => void;
}> {
    const { enabled, isAuthenticated } = params;
    const [status, setStatus] = React.useState<PairingStatus | null>(null);
    const [deepLink, setDeepLink] = React.useState<string | null>(null);
    const [pairingContext, setPairingContext] = React.useState<PairingContext | null>(null);
    const [completionState, setCompletionState] = React.useState<PairingCompletionState>('idle');
    const [qrAvailable, setQrAvailable] = React.useState(true);
    const [requestedDeviceLabel, setRequestedDeviceLabel] = React.useState<string | null>(null);
    const [isStarting, setIsStarting] = React.useState(false);
    const isStartingRef = React.useRef(false);
    const generationRef = React.useRef(0);
    const activeRef = React.useRef<Readonly<{ lifecycle: StartedLifecycle; context: PairingContext }> | null>(null);

    const resetPresentation = React.useCallback((preserveContext: boolean) => {
        setStatus(null); setDeepLink(null); setQrAvailable(true);
        if (!preserveContext) { setPairingContext(null); setRequestedDeviceLabel(null); }
    }, []);
    const clearSession = React.useCallback(() => {
        generationRef.current += 1; isStartingRef.current = false;
        const active = activeRef.current; activeRef.current = null; void active?.lifecycle.cancel();
        resetPresentation(false); setCompletionState('idle'); setIsStarting(false);
    }, [resetPresentation]);
    React.useEffect(() => () => { generationRef.current += 1; const active = activeRef.current; activeRef.current = null; void active?.lifecycle.cancel(); }, []);
    React.useEffect(() => { if (!(enabled && isAuthenticated)) clearSession(); }, [clearSession, enabled, isAuthenticated]);

    const startPairing = React.useCallback(async (): Promise<StartPairingResult> => {
        if (!enabled || !isAuthenticated) return { ok: false, status: 401 };
        if (isStartingRef.current) return { ok: false, status: 409 };
        const generation = ++generationRef.current;
        const isCurrent = () => generationRef.current === generation;
        const previous = activeRef.current; activeRef.current = null; await previous?.lifecycle.cancel();
        if (!isCurrent()) return { ok: false, status: 409 };
        isStartingRef.current = true; setIsStarting(true); setCompletionState('idle'); resetPresentation(false);
        let target: PairingCallTarget | null = null;
        let lifecycleOwnsTarget = false;
        try {
            const active = getActiveServerSnapshot();
            const snapshot = await getServerFeaturesSnapshot({ serverId: active.serverId });
            if (!isCurrent()) return { ok: false, status: 409 };
            if (snapshot.status === 'unsupported') {
                setCompletionState('completion_failed');
                return { ok: false, status: 426, reason: 'update_required' };
            }
            if (snapshot.status !== 'ready') { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            const observedIdentity = String(snapshot.serverIdentityId ?? '').trim();
            const profile = getServerProfileById(active.serverId);
            const descriptor = profile ? buildHomeConnectionDescriptorForProfile(profile) : null;
            if (!descriptor || !observedIdentity || descriptor.homeServerIdentityId !== observedIdentity) { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            const transport = await resolveHomeEnrollmentTransport(descriptor, { runtimeOrigin: active.runtimeOrigin, runtimeCarrier: active.carrier });
            if (!transport.ok) { setCompletionState('completion_failed'); return { ok: false, status: 412 }; }
            target = { ...transport.transport, serverId: active.serverId };
            if (!isCurrent()) return { ok: false, status: 409 };
            const immutableTarget = target;
            const started = await startDirectHomeQrLifecycle({
                features: snapshot.features,
                descriptor,
                adapters: {
                    randomBytes: async () => decodeBase64((await createPairingSecret()).secret, 'base64url'),
                    now: Date.now,
                    start: async (body) => {
                        const result = await pairingStart(body, immutableTarget);
                        return result.ok ? { ok: true, pairId: result.data.pairId, expiresAt: result.data.expiresAt } : { ok: false, status: result.status };
                    },
                    poll: async ({ pairId, signal, timeoutMs }) => {
                        if (!isRuntimeActive()) return { ok: true, status: { state: 'pending', pairId, expiresAt: new Date(Date.now() + timeoutMs).toISOString() } };
                        const result = await pairingStatus({ pairId }, immutableTarget, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
                        if (result.ok) { if (isCurrent()) setStatus(result.data); return { ok: true, status: result.data }; }
                        if (result.reason === 'not_found') return { ok: false, reason: 'not_found', status: result.status };
                        if (result.reason === 'http_error' && (result.status === 0 || result.status === 408 || result.status === 429 || result.status >= 500)) return { ok: false, reason: 'transient', status: result.status };
                        return { ok: false, reason: 'invalid', status: result.status };
                    },
                    consume: async ({ pairId, intent, signal, timeoutMs }) => ({
                        ok: (await pairingConsume(
                            { pairId, intent },
                            immutableTarget,
                            { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) },
                        )).ok,
                    }),
                    complete: async ({ context, status: requested, signal }) => {
                        if (isCurrent()) { setDeepLink(null); setRequestedDeviceLabel(requested.requestedDeviceLabel); setCompletionState('adding'); }
                        try { return await completeTrustedHomeQrPairingRequest({ context: { ...context, target: immutableTarget }, status: requested, signal }); }
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
            if (started.kind === 'update_required') { setCompletionState('completion_failed'); return { ok: false, status: 426, reason: 'update_required' }; }
            if (started.kind === 'failed') {
                setCompletionState('completion_failed');
                return { ok: false, status: started.status, ...(started.reason === 'invalid_invite' ? { reason: 'invalid_invite' as const } : {}) };
            }
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
        } catch { if (isCurrent()) setCompletionState('completion_failed'); return { ok: false, status: 500 }; }
        finally {
            if (target && !lifecycleOwnsTarget) await target.close().catch(() => {});
            if (isCurrent()) { isStartingRef.current = false; setIsStarting(false); }
        }
    }, [enabled, isAuthenticated, resetPresentation]);

    const cancelPairing = React.useCallback(async (): Promise<CancelPairingResult> => {
        const active = activeRef.current;
        if (!active || completionState !== 'pending') return { ok: false, status: 409 };
        const result = await active.lifecycle.cancel();
        if (!result.ok) return { ok: false, status: 500 };
        clearSession(); return { ok: true };
    }, [clearSession, completionState]);

    const presentation = React.useMemo<PairingPresentation>(() => {
        if (completionState === 'expired' && pairingContext) return { phase: 'expired', context: pairingContext };
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
