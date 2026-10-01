/**
 * The browser Home carrier runtime (Lane 06 amendment A7.3).
 *
 * One tab holds one endpoint client — a lease on the single SharedWorker
 * endpoint that A7.2 established — and one lease per adopted Home. This module
 * turns that lease into the two facilities the existing production owners need:
 * a request function `serverFetch` can hand an already-composed request to, and
 * a `WebSocket` factory the existing Socket.IO/Engine.IO owner can construct a
 * socket from. It adds no transport policy of its own.
 *
 * What it deliberately does not do: resolve a target, decide a carrier, verify
 * reachability, authenticate, retry, or reconnect. The exact EndpointId and
 * relay set come from the caller's canonical Home descriptor; identity is
 * proven by the stream owner before any application byte; reachability and
 * authentication stay with the existing reachability supervisor; reconnection
 * stays with Socket.IO. Duplicating any of those here would create the second
 * decision-maker the amendment forbids.
 */

import { createOwnedHomeCarrierRelease } from '@happier-dev/cli-common/homeEnrollment';

import {
    resolvePackagedBrowserIrohEndpointClient,
    type BrowserIrohEndpointClient,
    type BrowserIrohLease,
    type BrowserIrohStream,
} from '../endpointClient';
import { createBrowserIrohHomeHttpRequester } from '../homeTunnelHttp';
import type { BrowserIrohHostDecision } from '../hostEligibility';
import { createIrohHomeTransportDiagnosticsPublisher } from '@/sync/runtime/irohHomeTransportDiagnostics';
import {
    createInitialIrohHomeTransportDiagnostics,
    projectIrohHomeTransportDiagnosticsEvent,
    projectIrohHomeTransportDiagnosticsFailure,
    projectIrohHomeTransportDiagnosticsReady,
} from '@/sync/runtime/nativeIrohTunnels/diagnostics';
import { createBrowserIrohHomeTunnelWebSocketFactory } from './homeTunnelWebSocket';
import type {
    BrowserIrohHomeCarrier,
    BrowserIrohHomeCarrierRequest,
} from './browserHomeCarrier';
import { resolveBrowserIrohHomeCarrierEligibility } from './browserHomeCarrier';

export type BrowserIrohHomeCarrierOwner = Readonly<{
    acquire: (input: BrowserIrohHomeCarrierRequest) => Promise<BrowserIrohHomeCarrier>;
}>;

export class BrowserIrohHomeCarrierIneligibleError extends Error {
    constructor(readonly reason: string) {
        super(`Browser Iroh Home carrier is not eligible: ${reason}`);
        this.name = 'BrowserIrohHomeCarrierIneligibleError';
    }
}

function createCarrier(params: Readonly<{
    lease: BrowserIrohLease;
    homeServerIdentityId: string;
    endpointId: string;
    relayUrls: readonly string[];
}>): BrowserIrohHomeCarrier {
    const { lease, endpointId, relayUrls } = params;
    // Relay-only by construction: `unknown` until a stream proves a path, and
    // the browser boundary has no `direct` value it could ever report.
    let observedPath: 'relay' | 'unknown' = 'unknown';
    let diagnostics = createInitialIrohHomeTransportDiagnostics({
        homeServerIdentityId: params.homeServerIdentityId,
        remoteEndpointId: endpointId,
        policy: 'automatic',
        relayUrls: lease.appliedRelayUrls,
        directAddresses: [],
        atMs: Date.now(),
    });
    const diagnosticsPublisher = createIrohHomeTransportDiagnosticsPublisher({
        producerId: 'browser-home-carrier',
        leaseId: lease.leaseId,
        homeServerIdentityId: params.homeServerIdentityId,
    });
    diagnosticsPublisher.publish(diagnostics);

    const openStream = async (signal?: AbortSignal): Promise<BrowserIrohStream> => {
        try {
            const stream = await lease.openStream({
                streamKind: 'home', endpointId, relayUrls,
                ...(signal ? { signal } : {}),
            });
            observedPath = stream.observedPath;
            diagnostics = projectIrohHomeTransportDiagnosticsReady(diagnostics, {
                // The browser stream type permits relay only. Keep the explicit
                // value so a future type widening cannot silently claim direct.
                observedPath: stream.observedPath === 'relay' ? 'relay' : 'unknown',
                atMs: Date.now(),
            });
            diagnosticsPublisher.publish(diagnostics);
            return stream;
        } catch (error) {
            diagnostics = projectIrohHomeTransportDiagnosticsFailure(diagnostics, {
                code: error && typeof error === 'object' && 'code' in error
                    ? String(error.code)
                    : 'unknown',
                message: error instanceof Error ? error.message : undefined,
                atMs: Date.now(),
            });
            diagnosticsPublisher.publish(diagnostics);
            throw error;
        }
    };

    const requester = createBrowserIrohHomeHttpRequester({
        openStream,
        expectedRemoteEndpointId: endpointId,
    });
    const webSocketFactory = createBrowserIrohHomeTunnelWebSocketFactory({
        endpointId,
        openStream,
    });

    const releaseLease = createOwnedHomeCarrierRelease(async () => {
        await lease.release();
        diagnostics = projectIrohHomeTransportDiagnosticsEvent(diagnostics, {
            type: 'closed',
            atMs: Date.now(),
        });
        diagnosticsPublisher.release(diagnostics);
    });

    return {
        leaseId: lease.leaseId,
        homeServerIdentityId: params.homeServerIdentityId,
        endpointId,
        appliedRelayUrls: lease.appliedRelayUrls,
        readObservedPath: () => observedPath,
        request: async (url, init) => (await requester(url, init)).response,
        createWebSocket: (uri) => webSocketFactory(uri),
        release: releaseLease,
    };
}

/**
 * `hostDecision` is injected so a test can describe a browser without
 * pretending to be one. It stays inside the owner rather than being left to
 * callers: acquisition must fail closed on a desktop or native host even if a
 * caller forgets to ask.
 */
export function createBrowserIrohHomeCarrierOwner(params: Readonly<{
    resolveEndpointClient: () => BrowserIrohEndpointClient;
    hostDecision?: () => BrowserIrohHostDecision;
}>): BrowserIrohHomeCarrierOwner {
    // One client per tab: the SharedWorker (and its endpoint) is constructed on
    // the first acquisition and never a second time.
    let client: BrowserIrohEndpointClient | null = null;

    return {
        acquire: async (input) => {
            const eligibility = params.hostDecision
                ? resolveBrowserIrohHomeCarrierEligibility(input, params.hostDecision())
                : resolveBrowserIrohHomeCarrierEligibility(input);
            if (!eligibility.eligible) {
                throw new BrowserIrohHomeCarrierIneligibleError(eligibility.reason);
            }
            client ??= params.resolveEndpointClient();
            const lease = await client.acquireLease(eligibility.relayUrls);
            return createCarrier({
                lease,
                homeServerIdentityId: input.homeServerIdentityId.trim(),
                endpointId: eligibility.endpointId,
                relayUrls: eligibility.relayUrls,
            });
        },
    };
}

let singletonOwner: BrowserIrohHomeCarrierOwner | null = null;

export function browserIrohHomeCarrierOwner(): BrowserIrohHomeCarrierOwner {
    singletonOwner ??= createBrowserIrohHomeCarrierOwner({
        // The tab's one packaged endpoint client (Lane 06): shared with machine
        // transfer operations, connected lazily by the accessor on first use,
        // and never closed by a carrier release.
        resolveEndpointClient: resolvePackagedBrowserIrohEndpointClient,
    });
    return singletonOwner;
}
