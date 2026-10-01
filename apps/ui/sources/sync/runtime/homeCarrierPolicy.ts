import {
    acquireHomeCarrierByPolicy,
    createOwnedHomeCarrierRelease,
    drainRetainedHomeCarrierReleases,
    resolveHomeCarrierPreferredTransport,
    type HomeApplicationCarrierEligibility,
    type HomeCarrierAcquisitionMode,
} from '@happier-dev/cli-common/homeEnrollment';
import { classifyIrohHomeCarrierFailure, IrohError } from '@happier-dev/iroh-native';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import { readRegisteredStorageState } from '@/sync/domains/state/storageStateReaderBridge';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import {
    acquireBrowserIrohHomeCarrier,
    resolveBrowserIrohHomeCarrierEligibility,
    type BrowserIrohHomeCarrier,
    type BrowserIrohHomeCarrierRequest,
} from '@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier';
import { resolveBrowserIrohHostDecision } from '@/sync/runtime/browserIroh/hostEligibility';
import { acquireIrohHomeRuntimeOrigin } from '@/sync/runtime/nativeIrohTunnels/runtime';
import type {
    IrohHomeRuntimeOriginLease,
    IrohHomeTunnelAcquireInput,
    IrohHomeTunnelVerification,
} from '@/sync/runtime/nativeIrohTunnels/types';

export { createOwnedHomeCarrierRelease, drainRetainedHomeCarrierReleases };

export type AcquiredHomeCarrier =
    | Readonly<{ kind: 'browser_iroh'; carrier: BrowserIrohHomeCarrier; release: () => Promise<void> }>
    | Readonly<{ kind: 'native_iroh'; lease: IrohHomeRuntimeOriginLease; release: () => Promise<void> }>
    | Readonly<{ kind: 'https'; runtimeOrigin: string }>
    | Readonly<{ kind: 'unavailable'; error: unknown }>
    | Readonly<{ kind: 'fail_closed'; error: unknown; fallbackAllowed: boolean }>;

export type HomeCarrierAcquisitionInput = Readonly<{
    mode: HomeCarrierAcquisitionMode;
    applicationCarrierEligibility?: HomeApplicationCarrierEligibility;
    descriptor: HomeConnectionDescriptorV1;
    verification: IrohHomeTunnelVerification;
    credentials?: AuthCredentials;
    acquireNative?: (input: IrohHomeTunnelAcquireInput) => Promise<IrohHomeRuntimeOriginLease>;
}>;

/** The device-local setting is authoritative even for callers that request automatic selection. */
export function readHomeApplicationCarrierEligibility(): HomeApplicationCarrierEligibility {
    return readRegisteredStorageState()?.localSettings?.homeApplicationCarrierEligibility ?? 'automatic';
}

type UiIrohCarrierValue =
    | Readonly<{ kind: 'browser'; carrier: BrowserIrohHomeCarrier }>
    | Readonly<{ kind: 'native'; lease: IrohHomeRuntimeOriginLease }>;

function browserRequestFor(input: HomeCarrierAcquisitionInput): BrowserIrohHomeCarrierRequest {
    const endpoint = input.descriptor.endpoints.find((candidate) => candidate.kind === 'iroh');
    if (!endpoint) throw new IrohError('unavailable', 'Home descriptor declares no Iroh endpoint');
    return input.verification.kind === 'enrollment'
        ? {
            purpose: 'enrollment', homeServerIdentityId: input.descriptor.homeServerIdentityId,
            endpoint, canonicalServerUrl: input.descriptor.canonicalServerUrl,
        }
        : {
            purpose: 'authenticated_home', credentials: input.credentials ?? { token: input.verification.token },
            homeServerIdentityId: input.descriptor.homeServerIdentityId,
            endpoint, canonicalServerUrl: input.descriptor.canonicalServerUrl,
        };
}

/** UI platform adapter for the one owner-neutral carrier selection/recovery policy. */
export async function acquireEligibleHomeCarrier(input: HomeCarrierAcquisitionInput): Promise<AcquiredHomeCarrier> {
    const result = await acquireHomeCarrierByPolicy<UiIrohCarrierValue>({
        mode: input.mode,
        applicationCarrierEligibility: readHomeApplicationCarrierEligibility() === 'standard_only'
            ? 'standard_only'
            : input.applicationCarrierEligibility ?? 'automatic',
        descriptor: input.descriptor,
        preferredTransport: resolveHomeCarrierPreferredTransport(input.descriptor),
        classifyFailure: classifyIrohHomeCarrierFailure,
        acquireIroh: async ({ endpoint }) => {
            const browserHost = resolveBrowserIrohHostDecision();
            if (browserHost.eligible) {
                const request = browserRequestFor(input);
                const eligibility = resolveBrowserIrohHomeCarrierEligibility(request, browserHost);
                if (!eligibility.eligible) {
                    throw new IrohError(
                        eligibility.reason === 'relays_missing' ? 'unavailable' : 'invalid_descriptor',
                        `Browser Iroh Home carrier ineligible: ${eligibility.reason}`,
                    );
                }
                const carrier = await acquireBrowserIrohHomeCarrier(request);
                return {
                    homeServerIdentityId: carrier.homeServerIdentityId,
                    endpointId: carrier.endpointId,
                    status: 'ready', release: carrier.release,
                    value: { kind: 'browser', carrier },
                };
            }
            if (browserHost.reason !== 'not_web' && browserHost.reason !== 'desktop_host') {
                throw new IrohError('unavailable', `Browser Iroh Home carrier unavailable: ${browserHost.reason}`);
            }
            const lease = await (input.acquireNative ?? acquireIrohHomeRuntimeOrigin)({
                homeServerIdentityId: input.descriptor.homeServerIdentityId,
                endpoint,
                canonicalServerUrl: input.descriptor.canonicalServerUrl,
                verification: input.verification,
            });
            return {
                homeServerIdentityId: lease.homeServerIdentityId,
                endpointId: lease.endpointId,
                status: lease.status === 'ready' ? 'ready' : 'degraded', release: lease.release,
                value: { kind: 'native', lease },
            };
        },
    });

    if (result.kind !== 'iroh') return result;
    if (result.carrier.value.kind === 'browser') {
        const carrier = { ...result.carrier.value.carrier, release: result.release };
        return { kind: 'browser_iroh', carrier, release: result.release };
    }
    const lease = { ...result.carrier.value.lease, release: result.release };
    return { kind: 'native_iroh', lease, release: result.release };
}
