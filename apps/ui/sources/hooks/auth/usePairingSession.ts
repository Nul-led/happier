import * as React from 'react';

import { AccountCompletionError } from '@/auth/flows/accountCompletion';
import { ENROLLMENT_POLL_IDLE_DELAY_MS, enrollmentPollingBackoffMs } from '@/auth/enrollment/enrollmentPollingBackoff';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import { createPairingSecret } from '@/auth/pairing/pairingSecret';
import { buildRenderableHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { completeTrustedHomeQrPairingRequest, InvalidTrustedHomeQrRequestError } from '@/auth/pairing/completeTrustedHomeQrPairingRequest';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { pairingConsume, pairingStart, pairingStatus, type PairingCallTarget, type PairingStatus } from '@/sync/api/account/apiPairingAuth';
import { getCachedServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { buildHomeConnectionDescriptorForProfile, getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { isRuntimeActive } from '@/utils/runtime/isRuntimeActive';
import { deriveHomeQrRendezvousVerifierV2 } from '@happier-dev/protocol';

type StartPairingResult =
    | { ok: true }
    | { ok: false; status: number; reason?: 'invalid_invite' };
type CancelPairingResult = { ok: true } | { ok: false; status: number };

export type PairingContext = Readonly<{
    pairId: string;
    target: PairingCallTarget;
    issuedAtMs: number;
    expiresAtMs: number;
}>;

type PairingSecretContext = PairingContext & Readonly<{ qrSecret: Uint8Array }>;

export type PairingCompletionState = 'idle' | 'pending' | 'verifying' | 'adding' | 'retrying' | 'completed' | 'invalid_request' | 'completion_failed' | 'expired';

export type PairingPresentation =
    | Readonly<{ phase: 'generating' }>
    | Readonly<{ phase: 'ready'; deepLink: string; context: PairingContext; qrAvailable: boolean }>
    | Readonly<{ phase: 'verifying' | 'adding' | 'retryable_error' | 'succeeded'; context: PairingContext; requestedDeviceLabel: string | null }>
    | Readonly<{ phase: 'expired'; context: PairingContext }>
    | Readonly<{ phase: 'invalid_request' }>;

/** Owns one direct-QR lifecycle from invite creation through automatic bound completion. */
export function usePairingSession(params: Readonly<{ enabled: boolean; isAuthenticated: boolean }>): Readonly<{
    deepLink: string | null;
    status: PairingStatus | null;
    pairingContext: PairingContext | null;
    completionState: PairingCompletionState;
    presentation: PairingPresentation;
    isExpired: boolean;
    isStarting: boolean;
    startPairing: () => Promise<StartPairingResult>;
    cancelPairing: () => Promise<CancelPairingResult>;
    clearSession: () => void;
}> {
    const { enabled, isAuthenticated } = params;
    const [pairId, setPairId] = React.useState<string | null>(null);
    const [status, setStatus] = React.useState<PairingStatus | null>(null);
    const [deepLink, setDeepLink] = React.useState<string | null>(null);
    const [target, setTarget] = React.useState<PairingCallTarget | null>(null);
    const [pairingContext, setPairingContext] = React.useState<PairingContext | null>(null);
    const [completionState, setCompletionState] = React.useState<PairingCompletionState>('idle');
    const [qrAvailable, setQrAvailable] = React.useState(true);
    const [requestedDeviceLabel, setRequestedDeviceLabel] = React.useState<string | null>(null);
    const [isStarting, setIsStarting] = React.useState(false);
    const isStartingRef = React.useRef(false);
    const startGenerationRef = React.useRef(0);
    const targetRef = React.useRef<PairingCallTarget | null>(null);
    const secretContextRef = React.useRef<PairingSecretContext | null>(null);
    const completionStartedRef = React.useRef(false);
    const cancelIntentRef = React.useRef(false);
    const inFlightRequestKeyRef = React.useRef<string | null>(null);
    const completedRequestKeyRef = React.useRef<string | null>(null);

    const closeActiveTarget = React.useCallback(() => {
        const retainedTarget = targetRef.current;
        targetRef.current = null;
        void retainedTarget?.close().catch(() => {});
    }, []);

    const retireActiveSession = React.useCallback((preserveDisplayContext: boolean) => {
        closeActiveTarget();
        secretContextRef.current = null;
        inFlightRequestKeyRef.current = null;
        setPairId(null);
        setStatus(null);
        setDeepLink(null);
        setQrAvailable(true);
        setTarget(null);
        if (!preserveDisplayContext) {
            setRequestedDeviceLabel(null);
            setPairingContext(null);
        }
    }, [closeActiveTarget]);

    const clearSession = React.useCallback(() => {
        startGenerationRef.current += 1;
        isStartingRef.current = false;
        completionStartedRef.current = false;
        cancelIntentRef.current = false;
        completedRequestKeyRef.current = null;
        retireActiveSession(false);
        setCompletionState('idle');
        setIsStarting(false);
    }, [retireActiveSession]);

    React.useEffect(() => () => {
        startGenerationRef.current += 1;
        secretContextRef.current = null;
        closeActiveTarget();
    }, [closeActiveTarget]);

    React.useEffect(() => {
        if (enabled && isAuthenticated) return;
        clearSession();
    }, [clearSession, enabled, isAuthenticated]);

    const startPairing = React.useCallback(async () => {
        if (!enabled || !isAuthenticated) return { ok: false, status: 401 } as const;
        if (isStartingRef.current) return { ok: false, status: 409 } as const;
        const startGeneration = startGenerationRef.current + 1;
        startGenerationRef.current = startGeneration;
        const isCurrentStart = () => startGenerationRef.current === startGeneration;
        isStartingRef.current = true;
        completionStartedRef.current = false;
        cancelIntentRef.current = false;
        completedRequestKeyRef.current = null;
        secretContextRef.current = null;
        const previousTarget = targetRef.current;
        targetRef.current = null;
        await previousTarget?.close().catch(() => {});
        if (!isCurrentStart()) return { ok: false, status: 409 } as const;
        setIsStarting(true);
        setCompletionState('idle');
        setStatus(null);
        setDeepLink(null);
        setQrAvailable(true);
        setTarget(null);
        setPairingContext(null);
        setPairId(null);
        setRequestedDeviceLabel(null);

        let acquiredTarget: PairingCallTarget | null = null;
        try {
            const active = getActiveServerSnapshot();
            const cached = getCachedServerFeaturesSnapshot({ serverId: active.serverId });
            const observedIdentity = cached?.status === 'ready' ? String(cached.serverIdentityId ?? '').trim() : '';
            const profile = getServerProfileById(active.serverId);
            const descriptor = profile ? buildHomeConnectionDescriptorForProfile(profile) : null;
            if (!descriptor || !observedIdentity || descriptor.homeServerIdentityId !== observedIdentity) {
                return { ok: false, status: 412 } as const;
            }
            const transportResolution = await resolveHomeEnrollmentTransport(descriptor, {
                runtimeOrigin: active.runtimeOrigin,
                runtimeCarrier: active.carrier,
            });
            if (!transportResolution.ok) return { ok: false, status: 412 } as const;
            const immutableTarget: PairingCallTarget = { ...transportResolution.transport, serverId: active.serverId };
            acquiredTarget = immutableTarget;
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;
            const { secret: qrSecretBase64Url } = await createPairingSecret();
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;
            const qrSecret = decodeBase64(qrSecretBase64Url, 'base64url');
            const secretHash = encodeBase64(deriveHomeQrRendezvousVerifierV2(qrSecret), 'base64url');
            const started = await pairingStart({ direction: 'trusted_home_displays', secretHash }, immutableTarget);
            const issuedAtMs = Date.now();
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;
            if (!started.ok) return { ok: false, status: started.status } as const;
            const expiresAtMs = Date.parse(started.data.expiresAt);
            if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= issuedAtMs) return { ok: false, status: 502 } as const;
            const context: PairingSecretContext = { pairId: started.data.pairId, target: immutableTarget, qrSecret, issuedAtMs, expiresAtMs };
            const renderableInvite = buildRenderableHomeQrInviteDeepLink({ invite: {
                v: 2,
                intent: 'home_device',
                direction: 'trusted_home_displays',
                pairId: context.pairId,
                home: descriptor,
                qrSecretBase64Url,
                issuedAtMs,
                expiresAtMs,
            } });
            if (!renderableInvite.ok && renderableInvite.reason === 'invalid_invite') {
                await pairingConsume({ pairId: context.pairId, intent: 'cancel' }, immutableTarget).catch(() => null);
                if (!isCurrentStart()) return { ok: false, status: 409 } as const;
                setCompletionState('completion_failed');
                return { ok: false, status: 422, reason: 'invalid_invite' } as const;
            }
            // Lane-05 A6: a valid invite over real QR encoder capacity keeps the
            // pairing live with the exact secret-bearing link behind the existing
            // disclosure; only the QR image is unavailable.
            targetRef.current = immutableTarget;
            secretContextRef.current = context;
            setPairId(context.pairId);
            setTarget(immutableTarget);
            setPairingContext({ pairId: context.pairId, target: immutableTarget, issuedAtMs, expiresAtMs });
            setQrAvailable(renderableInvite.ok);
            setDeepLink(renderableInvite.link);
            setStatus({ state: 'pending', pairId: context.pairId, expiresAt: started.data.expiresAt });
            setCompletionState('pending');
            return { ok: true } as const;
        } catch {
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;
            return { ok: false, status: 500 } as const;
        } finally {
            if (acquiredTarget && targetRef.current !== acquiredTarget) await acquiredTarget.close().catch(() => {});
            if (isCurrentStart()) {
                setIsStarting(false);
                isStartingRef.current = false;
            }
        }
    }, [closeActiveTarget, enabled, isAuthenticated]);

    const cancelPairing = React.useCallback(async (): Promise<CancelPairingResult> => {
        const context = secretContextRef.current;
        if (!context || completionStartedRef.current || completionState !== 'pending') return { ok: false, status: 409 };
        cancelIntentRef.current = true;
        const cancelled = await pairingConsume({ pairId: context.pairId, intent: 'cancel' }, context.target);
        if (!cancelled.ok) {
            cancelIntentRef.current = false;
            return { ok: false, status: cancelled.status };
        }
        clearSession();
        return { ok: true };
    }, [clearSession, completionState]);

    React.useEffect(() => {
        if (!enabled || !isAuthenticated || !pairId || !target) return;
        let cancelled = false;
        const lifecycleController = new AbortController();
        let nextPoll: ReturnType<typeof setTimeout> | null = null;
        let statusTransientFailures = 0;
        let completionTransientFailures = 0;
        const isCurrent = () => !cancelled
            && !lifecycleController.signal.aborted
            && secretContextRef.current?.pairId === pairId
            && targetRef.current === target;
        const expireSession = () => {
            if (!isCurrent()) return;
            completionStartedRef.current = true;
            retireActiveSession(true);
            setCompletionState('expired');
        };
        const scheduleNextPoll = (requestedDelayMs: number) => {
            if (!isCurrent()) return;
            const context = secretContextRef.current;
            if (!context) return;
            const remainingMs = context.expiresAtMs - Date.now();
            if (remainingMs <= 0) {
                expireSession();
                return;
            }
            const delayMs = Math.min(requestedDelayMs, remainingMs);
            nextPoll = setTimeout(() => {
                nextPoll = null;
                if (Date.now() >= context.expiresAtMs) {
                    expireSession();
                    return;
                }
                void poll();
            }, delayMs);
        };
        const rejectInvalidRequest = async () => {
            completionStartedRef.current = true;
            await pairingConsume({ pairId, intent: 'reject' }, target).catch(() => null);
            if (!isCurrent()) return;
            retireActiveSession(false);
            setCompletionState('invalid_request');
        };
        const poll = async () => {
            if (!isCurrent()) return;
            const activeContext = secretContextRef.current;
            if (!activeContext || Date.now() >= activeContext.expiresAtMs) {
                expireSession();
                return;
            }
            if (!isRuntimeActive()) {
                scheduleNextPoll(ENROLLMENT_POLL_IDLE_DELAY_MS);
                return;
            }
            let shouldContinue = true;
            let nextDelayMs = ENROLLMENT_POLL_IDLE_DELAY_MS;
            try {
                const result = await pairingStatus({ pairId }, target);
                if (!isCurrent()) return;
                if (!result.ok) {
                    if (result.reason === 'not_found') {
                        shouldContinue = false;
                        expireSession();
                    } else if (result.reason === 'http_error'
                        && (result.status === 0 || result.status === 408 || result.status === 429 || result.status >= 500)) {
                        statusTransientFailures += 1;
                        nextDelayMs = enrollmentPollingBackoffMs(statusTransientFailures);
                    } else {
                        shouldContinue = false;
                        await rejectInvalidRequest();
                    }
                    return;
                }
                setStatus(result.data);
                if (result.data.state === 'pending') {
                    statusTransientFailures = 0;
                    return;
                }
                statusTransientFailures = 0;
                if (cancelIntentRef.current) return;
                const context = secretContextRef.current;
                if (!context) {
                    shouldContinue = false;
                    await rejectInvalidRequest();
                    return;
                }
                if (!isCurrent()) return;
                const requestKey = [context.pairId, context.target.descriptor.homeServerIdentityId, context.expiresAtMs, result.data.requestedPublicKey, result.data.bindingProof].join(':');
                if (completedRequestKeyRef.current === requestKey) {
                    shouldContinue = false;
                    return;
                }
                if (inFlightRequestKeyRef.current === requestKey) return;
                completionStartedRef.current = true;
                inFlightRequestKeyRef.current = requestKey;
                setDeepLink(null);
                setRequestedDeviceLabel(result.data.requestedDeviceLabel);
                setCompletionState('verifying');
                try {
                    setCompletionState('adding');
                    await completeTrustedHomeQrPairingRequest({
                        context: {
                            direction: 'trusted_home_displays',
                            pairId: context.pairId,
                            target: context.target,
                            qrSecret: context.qrSecret,
                            issuedAtMs: context.issuedAtMs,
                            expiresAtMs: context.expiresAtMs,
                        },
                        status: result.data,
                        signal: lifecycleController.signal,
                    });
                    if (!isCurrent()) return;
                    completedRequestKeyRef.current = requestKey;
                    completionTransientFailures = 0;
                    shouldContinue = false;
                    retireActiveSession(true);
                    setCompletionState('completed');
                } catch (error) {
                    if (isCurrent() && error instanceof AccountCompletionError && error.retryable) {
                        completionTransientFailures += 1;
                        nextDelayMs = enrollmentPollingBackoffMs(completionTransientFailures);
                        setCompletionState('retrying');
                    } else if (isCurrent() && error instanceof InvalidTrustedHomeQrRequestError) {
                        shouldContinue = false;
                        await rejectInvalidRequest();
                    } else if (isCurrent()) {
                        shouldContinue = false;
                        retireActiveSession(false);
                        setCompletionState('completion_failed');
                    }
                } finally {
                    if (inFlightRequestKeyRef.current === requestKey) inFlightRequestKeyRef.current = null;
                }
            } catch {
                if (isCurrent()) {
                    statusTransientFailures += 1;
                    nextDelayMs = enrollmentPollingBackoffMs(statusTransientFailures);
                }
            } finally {
                if (shouldContinue && isCurrent()) scheduleNextPoll(nextDelayMs);
            }
        };
        void poll();
        return () => {
            cancelled = true;
            lifecycleController.abort();
            if (nextPoll) clearTimeout(nextPoll);
        };
    }, [enabled, isAuthenticated, pairId, retireActiveSession, target]);

    const presentation = React.useMemo<PairingPresentation>(() => {
        if (completionState === 'expired' && pairingContext) return { phase: 'expired', context: pairingContext };
        if (completionState === 'invalid_request' || completionState === 'completion_failed') {
            return { phase: 'invalid_request' };
        }
        if (pairingContext) {
            if (completionState === 'verifying') return { phase: 'verifying', context: pairingContext, requestedDeviceLabel };
            if (completionState === 'adding') return { phase: 'adding', context: pairingContext, requestedDeviceLabel };
            if (completionState === 'retrying') return { phase: 'retryable_error', context: pairingContext, requestedDeviceLabel };
            if (completionState === 'completed') return { phase: 'succeeded', context: pairingContext, requestedDeviceLabel };
            if (completionState === 'pending' && deepLink) {
                return { phase: 'ready', deepLink, context: pairingContext, qrAvailable };
            }
        }
        return { phase: 'generating' };
    }, [completionState, deepLink, pairingContext, qrAvailable, requestedDeviceLabel]);

    return {
        deepLink,
        status,
        pairingContext,
        completionState,
        presentation,
        isExpired: completionState === 'expired',
        isStarting,
        startPairing,
        cancelPairing,
        clearSession,
    };
}
