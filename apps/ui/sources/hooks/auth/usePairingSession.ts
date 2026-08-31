import * as React from 'react';

import { createPairingSecret } from '@/auth/pairing/pairingSecret';
import { buildHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getCachedServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import {
    buildHomeConnectionDescriptorForProfile,
    getServerProfileById,
} from '@/sync/domains/server/serverProfiles';
import { isRuntimeActive } from '@/utils/runtime/isRuntimeActive';
import {
    pairingStart,
    pairingStatus,
    type PairingStatus,
    type PairingCallTarget,
} from '@/sync/api/account/apiPairingAuth';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import {
    deriveHomeQrRendezvousVerifierV2,
} from '@happier-dev/protocol';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';

const PAIRING_STATUS_POLL_INTERVAL_MS = 1_000;

type StartPairingResult = { ok: true } | { ok: false; status: number };

export type PairingApprovalContext = Readonly<{
    pairId: string;
    target: PairingCallTarget;
    qrSecret: Uint8Array;
    issuedAtMs: number;
    expiresAtMs: number;
}>;

/**
 * Desktop/web pairing session lifecycle:
 * - start: generate secret + POST /v1/auth/pairing/start
 * - poll: GET /v1/auth/pairing/status until phone requests
 * - approve: handled by caller via existing auth account link flow
 */
export function usePairingSession(params: Readonly<{ enabled: boolean; isAuthenticated: boolean }>): Readonly<{
    deepLink: string | null;
    status: PairingStatus | null;
    approvalContext: PairingApprovalContext | null;
    isExpired: boolean;
    isStarting: boolean;
    startPairing: () => Promise<StartPairingResult>;
    clearSession: () => void;
}> {
    const enabled = params.enabled;
    const isAuthenticated = params.isAuthenticated;

    const [pairId, setPairId] = React.useState<string | null>(null);
    const [status, setStatus] = React.useState<PairingStatus | null>(null);
    const [deepLink, setDeepLink] = React.useState<string | null>(null);
    const [target, setTarget] = React.useState<PairingCallTarget | null>(null);
    const [approvalContext, setApprovalContext] = React.useState<PairingApprovalContext | null>(null);
    const [isExpired, setIsExpired] = React.useState(false);
    const [isStarting, setIsStarting] = React.useState(false);
    const isStartingRef = React.useRef(false);
    const startGenerationRef = React.useRef(0);
    const targetRef = React.useRef<PairingCallTarget | null>(null);

    const clearSession = React.useCallback(() => {
        startGenerationRef.current += 1;
        isStartingRef.current = false;
        const retainedTarget = targetRef.current;
        targetRef.current = null;
        void retainedTarget?.close().catch(() => {});
        setPairId(null);
        setStatus(null);
        setDeepLink(null);
        setTarget(null);
        setApprovalContext(null);
        setIsExpired(false);
        setIsStarting(false);
    }, []);

    React.useEffect(() => () => {
        startGenerationRef.current += 1;
        isStartingRef.current = false;
        const retainedTarget = targetRef.current;
        targetRef.current = null;
        void retainedTarget?.close().catch(() => {});
    }, []);

    React.useEffect(() => {
        if (enabled && isAuthenticated) return;
        clearSession();
    }, [clearSession, enabled, isAuthenticated]);

    const startPairing = React.useCallback(async () => {
        if (!enabled || !isAuthenticated) {
            return { ok: false, status: 401 } as const;
        }
        if (isStartingRef.current) {
            return { ok: false, status: 409 } as const;
        }

        const startGeneration = startGenerationRef.current + 1;
        startGenerationRef.current = startGeneration;
        const isCurrentStart = () => startGenerationRef.current === startGeneration;
        isStartingRef.current = true;
        const previousTarget = targetRef.current;
        targetRef.current = null;
        await previousTarget?.close().catch(() => {});
        if (!isCurrentStart()) return { ok: false, status: 409 } as const;
        setIsStarting(true);
        setIsExpired(false);
        setStatus(null);
        setDeepLink(null);
        setTarget(null);
        setApprovalContext(null);
        setPairId(null);

        let acquiredTarget: PairingCallTarget | null = null;
        try {
            const active = getActiveServerSnapshot();
            const cached = getCachedServerFeaturesSnapshot({ serverId: active.serverId });
            const observedHomeServerIdentityId = cached?.status === 'ready'
                ? String(cached.serverIdentityId ?? '').trim()
                : '';
            const profile = getServerProfileById(active.serverId);
            const descriptor = profile
                ? buildHomeConnectionDescriptorForProfile(profile)
                : null;
            if (
                !descriptor
                || !observedHomeServerIdentityId
                || descriptor.homeServerIdentityId !== observedHomeServerIdentityId
            ) {
                return { ok: false, status: 412 } as const;
            }
            const transportResolution = await resolveHomeEnrollmentTransport(descriptor, {
                runtimeOrigin: active.runtimeOrigin,
                runtimeCarrier: active.carrier,
            });
            if (!transportResolution.ok) return { ok: false, status: 412 } as const;
            const immutableTarget: PairingCallTarget = {
                ...transportResolution.transport,
                serverId: active.serverId,
            };
            acquiredTarget = immutableTarget;
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;

            const { secret: qrSecretBase64Url } = await createPairingSecret();
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;
            const qrSecret = decodeBase64(qrSecretBase64Url, 'base64url');
            const secretHash = encodeBase64(deriveHomeQrRendezvousVerifierV2(qrSecret), 'base64url');
            const issuedAtMs = Date.now();
            const started = await pairingStart({ secretHash }, immutableTarget);
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;
            if (!started.ok) {
                return { ok: false, status: started.status } as const;
            }

            const data = started.data;
            const expiresAtMs = Date.parse(data.expiresAt);
            if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= issuedAtMs) {
                return { ok: false, status: 502 } as const;
            }

            const link = buildHomeQrInviteDeepLink({
                invite: {
                    v: 2,
                    intent: 'home_device',
                    pairId: data.pairId,
                    home: descriptor,
                    qrSecretBase64Url,
                    issuedAtMs,
                    expiresAtMs,
                },
            });

            setPairId(data.pairId);
            targetRef.current = immutableTarget;
            setTarget(immutableTarget);
            setApprovalContext({
                pairId: data.pairId,
                target: immutableTarget,
                qrSecret,
                issuedAtMs,
                expiresAtMs,
            });
            setDeepLink(link);
            setStatus({ state: 'pending', pairId: data.pairId, expiresAt: data.expiresAt });
            return { ok: true } as const;
        } catch {
            if (!isCurrentStart()) return { ok: false, status: 409 } as const;
            return { ok: false, status: 500 } as const;
        } finally {
            if (acquiredTarget && targetRef.current !== acquiredTarget) {
                await acquiredTarget.close().catch(() => {});
            }
            if (isCurrentStart()) {
                setIsStarting(false);
                isStartingRef.current = false;
            }
        }
    }, [enabled, isAuthenticated]);

    React.useEffect(() => {
        if (!enabled || !isAuthenticated) return;
        if (!pairId || !target) return;
        let cancelled = false;
        let nextPoll: ReturnType<typeof setTimeout> | null = null;

        const scheduleNextPoll = () => {
            if (cancelled) return;
            nextPoll = setTimeout(() => {
                nextPoll = null;
                void poll();
            }, PAIRING_STATUS_POLL_INTERVAL_MS);
        };

        const poll = async () => {
            if (cancelled) return;
            if (!isRuntimeActive()) {
                scheduleNextPoll();
                return;
            }
            let shouldContinue = true;
            try {
                const res = await pairingStatus({ pairId }, target);
                if (!res.ok) {
                    if (res.reason === 'not_found') {
                        if (!cancelled) {
                            shouldContinue = false;
                            setIsExpired(true);
                            setStatus(null);
                            setDeepLink(null);
                            setPairId(null);
                            setTarget(null);
                            setApprovalContext(null);
                            if (targetRef.current === target) {
                                targetRef.current = null;
                                void target.close().catch(() => {});
                            }
                        }
                    }
                    return;
                }
                if (!cancelled) {
                    setIsExpired(false);
                    setStatus(res.data);
                }
            } catch {
                // ignore
            } finally {
                if (shouldContinue) scheduleNextPoll();
            }
        };

        void poll();

        return () => {
            cancelled = true;
            if (nextPoll) clearTimeout(nextPoll);
        };
    }, [enabled, isAuthenticated, pairId, target]);

    return { deepLink, status, approvalContext, isExpired, isStarting, startPairing, clearSession };
}
