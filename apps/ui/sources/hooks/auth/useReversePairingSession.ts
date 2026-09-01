import * as React from 'react';

import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import { authQRStart, type HomeQrEnrollmentTarget, type QRAuthKeyPair } from '@/auth/flows/qrStart';
import { authQRWait } from '@/auth/flows/qrWait';
import { buildRenderableHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { pairingRequest } from '@/sync/api/account/apiPairingAuth';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import { adoptHomeProfileWithCredentials, HomeProfileAdoptionPartialCommitError } from '@/sync/domains/server/adoptHomeProfile';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { buildHomeConnectionDescriptorForProfile, getServerProfileById } from '@/sync/domains/server/serverProfiles';
import {
    computeHomeQrBindingProofV2,
    createHomeQrReverseInviteV2,
    deriveHomeQrBindingKeyV2,
    deriveHomeQrRendezvousSecretV2,
    readServerEnabledBit,
    type HomeConnectionDescriptorV1,
    type HomeQrInviteV2,
} from '@happier-dev/protocol';
import { enrollmentPollingBackoffMs } from '@/auth/enrollment/enrollmentPollingBackoff';

const PAIRING_FEATURE_ID = 'auth.pairing.desktopQrMobileScan' as const;

export type ReversePairingPresentation =
    | Readonly<{ phase: 'generating' }>
    | Readonly<{ phase: 'ready'; invite: HomeQrInviteV2; link: string; qrAvailable: boolean; descriptor: HomeConnectionDescriptorV1 }>
    | Readonly<{ phase: 'connecting' | 'adding'; descriptor: HomeConnectionDescriptorV1; expiresAtMs: number }>
    | Readonly<{ phase: 'succeeded'; descriptor: HomeConnectionDescriptorV1 }>
    | Readonly<{ phase: 'expired' | 'invalid'; descriptor?: HomeConnectionDescriptorV1 }>
    | Readonly<{ phase: 'retryable_error'; descriptor?: HomeConnectionDescriptorV1; partialCommit: boolean }>;

type ReverseAttempt = {
    generation: number;
    controller: AbortController;
    target: HomeQrEnrollmentTarget | null;
    authorityClaimed: boolean;
};

function isTransientStatus(status: number): boolean {
    return status === 0 || status === 404 || status === 408 || status === 429 || status >= 500;
}

async function waitForRetry(expiresAtMs: number, failures: number, signal: AbortSignal): Promise<boolean> {
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0 || signal.aborted) return false;
    const delayMs = Math.min(enrollmentPollingBackoffMs(failures), remainingMs);
    return await new Promise<boolean>((resolve) => {
        const onAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve(!signal.aborted && Date.now() < expiresAtMs);
        }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/** Owns one credentialless, known-target requester-displayed QR lifecycle in memory. */
export function useReversePairingSession(params: Readonly<{ enabled: boolean }>): Readonly<{
    presentation: ReversePairingPresentation;
    canCancel: boolean;
    start: () => Promise<void>;
    cancel: () => void;
}> {
    const [presentation, setPresentation] = React.useState<ReversePairingPresentation>({ phase: 'generating' });
    const attemptRef = React.useRef<ReverseAttempt | null>(null);
    const generationRef = React.useRef(0);
    const startedRef = React.useRef(false);

    const isCurrent = React.useCallback((attempt: ReverseAttempt) => (
        attemptRef.current === attempt
        && generationRef.current === attempt.generation
        && !attempt.controller.signal.aborted
    ), []);

    const retire = React.useCallback(async (attempt: ReverseAttempt) => {
        if (attemptRef.current === attempt) attemptRef.current = null;
        await attempt.target?.close().catch(() => {});
    }, []);

    const cancel = React.useCallback(() => {
        const attempt = attemptRef.current;
        if (!attempt || attempt.authorityClaimed) return;
        generationRef.current += 1;
        attemptRef.current = null;
        attempt.controller.abort();
        void attempt.target?.close().catch(() => {});
        setPresentation({ phase: 'generating' });
    }, []);

    const start = React.useCallback(async () => {
        if (!params.enabled || attemptRef.current) return;
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        const attempt: ReverseAttempt = {
            generation,
            controller: new AbortController(),
            target: null,
            authorityClaimed: false,
        };
        attemptRef.current = attempt;
        setPresentation({ phase: 'generating' });

        try {
            // Capture the selected stored Home exactly once. Later focus changes never re-enter
            // this owner or replace the descriptor/transport held by the active attempt.
            const active = getActiveServerSnapshot();
            const profile = getServerProfileById(active.serverId);
            const descriptor = profile ? buildHomeConnectionDescriptorForProfile(profile) : null;
            if (!descriptor || profile?.serverIdentityId !== descriptor.homeServerIdentityId) {
                if (!isCurrent(attempt)) return;
                setPresentation({ phase: 'invalid' });
                return;
            }
            const transportResolution = await resolveHomeEnrollmentTransport(descriptor, {
                runtimeOrigin: active.runtimeOrigin,
                runtimeCarrier: active.carrier,
            });
            if (!isCurrent(attempt)) {
                if (transportResolution.ok) await transportResolution.transport.close().catch(() => {});
                return;
            }
            if (!transportResolution.ok) {
                setPresentation({ phase: 'retryable_error', descriptor, partialCommit: false });
                return;
            }
            const target: HomeQrEnrollmentTarget = { ...transportResolution.transport, serverId: profile.id };
            attempt.target = target;
            const featureSnapshot = await probeServerFeaturesAtUrl({
                endpointUrl: target.endpointUrl,
                runtimeOrigin: target.runtimeOrigin,
                serverId: profile.id,
                force: true,
                signal: attempt.controller.signal,
            });
            if (!isCurrent(attempt)) return;
            if (
                featureSnapshot.status !== 'ready'
                || featureSnapshot.serverIdentityId !== descriptor.homeServerIdentityId
                || readServerEnabledBit(featureSnapshot.features, PAIRING_FEATURE_ID) !== true
            ) {
                setPresentation({ phase: 'invalid', descriptor });
                return;
            }

            const material = createHomeQrReverseInviteV2({ home: descriptor, nowMs: Date.now() });
            const keypair: QRAuthKeyPair = {
                publicKey: material.requesterPublicKey,
                secretKey: material.requesterSecretKey,
            };
            const started = await authQRStart(keypair, target, { signal: attempt.controller.signal });
            if (!isCurrent(attempt)) return;
            if (!started.ok) {
                setPresentation({
                    phase: started.reason === 'transient' ? 'retryable_error' : 'invalid',
                    descriptor,
                    ...(started.reason === 'transient' ? { partialCommit: false } : {}),
                } as ReversePairingPresentation);
                return;
            }
            const renderable = buildRenderableHomeQrInviteDeepLink({ invite: material.invite });
            if (!renderable.ok && renderable.reason === 'invalid_invite') {
                setPresentation({ phase: 'invalid', descriptor });
                return;
            }
            setPresentation({
                phase: 'ready',
                invite: material.invite,
                link: renderable.link,
                qrAvailable: renderable.ok,
                descriptor,
            });

            const bindingProof = computeHomeQrBindingProofV2({
                direction: material.invite.direction,
                qrSecret: material.qrSecret,
                pairId: material.invite.pairId,
                homeServerIdentityId: descriptor.homeServerIdentityId,
                requesterPublicKey: material.requesterPublicKey,
                expiresAtMs: material.invite.expiresAtMs,
            });
            const pairingParams = {
                pairId: material.invite.pairId,
                secret: encodeBase64(deriveHomeQrRendezvousSecretV2(material.qrSecret), 'base64url'),
                publicKey: encodeBase64(material.requesterPublicKey),
                homeServerIdentityId: descriptor.homeServerIdentityId,
                expiresAtMs: material.invite.expiresAtMs,
                bindingProof,
            };
            let failures = 0;
            while (isCurrent(attempt)) {
                const request = await pairingRequest(pairingParams, target, { signal: attempt.controller.signal });
                if (!isCurrent(attempt)) return;
                if (request.ok) break;
                if (!isTransientStatus(request.status)) {
                    setPresentation({ phase: 'invalid', descriptor });
                    return;
                }
                failures += 1;
                if (!await waitForRetry(material.invite.expiresAtMs, failures, attempt.controller.signal)) {
                    if (isCurrent(attempt)) setPresentation({ phase: 'expired', descriptor });
                    return;
                }
            }
            if (!isCurrent(attempt)) return;
            // From this point the requester has claimed the immutable pairing row. Keep the
            // same in-memory owner alive through polling and credential commit; Back/cancel
            // must not abandon it and create a successor claim.
            attempt.authorityClaimed = true;
            setPresentation({ phase: 'connecting', descriptor, expiresAtMs: material.invite.expiresAtMs });
            const result = await authQRWait(keypair, target, {
                signal: attempt.controller.signal,
                expiresAtMs: material.invite.expiresAtMs,
                v2Context: {
                    direction: material.invite.direction,
                    pairId: material.invite.pairId,
                    homeServerIdentityId: descriptor.homeServerIdentityId,
                    bindingSecret: deriveHomeQrBindingKeyV2(material.qrSecret),
                    bindingProof,
                    issuedAtMs: material.invite.issuedAtMs,
                    expiresAtMs: material.invite.expiresAtMs,
                },
            });
            if (!isCurrent(attempt)) return;
            if (!result.ok) {
                setPresentation({
                    phase: result.reason === 'expired' ? 'expired' : result.reason === 'cancelled' ? 'generating' : 'invalid',
                    descriptor,
                } as ReversePairingPresentation);
                return;
            }
            setPresentation({ phase: 'adding', descriptor, expiresAtMs: material.invite.expiresAtMs });
            try {
                await adoptHomeProfileWithCredentials({
                    descriptor,
                    source: 'qr',
                    preserveUserLabel: true,
                    credentials: result.credentials,
                    shouldCancel: () => !isCurrent(attempt!),
                });
            } catch (error) {
                if (!isCurrent(attempt)) return;
                setPresentation({
                    phase: 'retryable_error',
                    descriptor,
                    partialCommit: error instanceof HomeProfileAdoptionPartialCommitError,
                });
                return;
            }
            if (isCurrent(attempt)) setPresentation({ phase: 'succeeded', descriptor });
        } catch {
            if (!isCurrent(attempt)) return;
            const currentPresentation = presentation;
            setPresentation({
                phase: 'retryable_error',
                ...('descriptor' in currentPresentation ? { descriptor: currentPresentation.descriptor } : {}),
                partialCommit: false,
            });
        } finally {
            await retire(attempt);
        }
    }, [isCurrent, params.enabled, presentation, retire]);

    React.useEffect(() => {
        if (!params.enabled || startedRef.current) return;
        startedRef.current = true;
        void start();
    }, [params.enabled, start]);

    React.useEffect(() => () => {
        const attempt = attemptRef.current;
        generationRef.current += 1;
        attemptRef.current = null;
        attempt?.controller.abort();
        void attempt?.target?.close().catch(() => {});
    }, []);

    return {
        presentation,
        canCancel: attemptRef.current !== null
            && !attemptRef.current.authorityClaimed
            && presentation.phase === 'ready',
        start,
        cancel,
    };
}
