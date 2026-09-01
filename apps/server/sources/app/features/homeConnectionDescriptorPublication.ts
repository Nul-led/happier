import {
    HomeConnectionDescriptorV1Schema,
    HomeConnectionEndpointV1Schema,
    type HomeConnectionDescriptorV1,
    type HomeConnectionEndpointV1,
} from "@happier-dev/protocol";
import {
    getHomeIrohEndpointState,
    type HomeIrohEndpointState,
} from "@/app/iroh/homeIrohEndpoint";
import { readCachedServerIdentityIdForHotPath } from "@/app/serverIdentity/serverIdentity";
import {
    resolveConfiguredCanonicalServerUrl,
    resolveConfiguredPublicServerUrl,
} from "@/app/serverUrls/effectiveServerUrls";

/**
 * Canonical owner of the current Home transport descriptor composition.
 *
 * It consumes only explicit transport facts and never infers them:
 * - the stable canonical authentication origin (`resolveConfiguredCanonicalServerUrl`),
 * - the explicitly configured public server URL (`resolveConfiguredPublicServerUrl`)
 *   — an HTTPS endpoint is published only when this explicit ingress fact
 *   exists and is HTTPS, never merely because the canonical auth origin is an
 *   HTTPS URL,
 * - the current Iroh endpoint lifecycle (`getHomeIrohEndpointState`), included
 *   only while that owner reports an active endpoint,
 * - an optional revision fact from the connectivity owner. While the Iroh
 *   lifecycle is active, its persistent continuity revision (durable across
 *   restarts) is the revision source. When no producer revision exists (for
 *   example HTTPS-only publications), this module applies an in-process
 *   guard that prevents regression only within the running process;
 *   cross-restart monotonicity for producer-less publications has no durable
 *   owner in this tree yet (missing Lane 06 persistent outer-revision
 *   producer — reported, not simulated here).
 *
 * Two projections are derived from one composition: the public projection
 * (features payload) redacts direct-address hints, and the redemption
 * projection (assertion redemption) preserves every endpoint fact enrollment
 * needs. There is no second descriptor builder or transport resolver.
 */

export type HomeDescriptorPublicationFacts = Readonly<{
    homeServerIdentityId: string | null;
    canonicalServerUrl: string | undefined;
    /** Explicitly configured public server URL (actual ingress fact); null means none. */
    publicServerUrl: string | null;
    /** Explicit outer-revision floor published by the connectivity owner, when present. */
    minimumOuterRevisionExclusive: number | null;
    iroh: HomeIrohEndpointState;
}>;

type RevisionOwnerState = Readonly<{
    revision: number;
    contentKey: string;
}>;

let revisionOwner: RevisionOwnerState | null = null;

/** Test-only reset of the in-process monotonic revision owner. */
export function resetHomeConnectionDescriptorRevisionOwnerForTests(): void {
    revisionOwner = null;
}

/**
 * In-process monotonic guard. A persistent producer revision is consumed
 * as-is when it advances; without one, revisions increment from the last
 * value published in this process. Effective endpoint-set changes always
 * publish a strictly greater revision, and no input can move the revision
 * backwards within the process lifetime. This guard is deliberately not
 * claimed to survive restarts without a durable producer.
 */
function nextMonotonicOuterRevision(params: Readonly<{
    contentKey: string;
    producerRevision: number | null;
    minimumOuterRevisionExclusive: number | null;
}>): number {
    const lastRevision = revisionOwner?.revision ?? 0;
    const contentChanged = revisionOwner?.contentKey !== params.contentKey;
    let revision: number;
    if (params.producerRevision !== null) {
      // Persistent producer fact (Iroh endpoint continuity): consumed as-is
      // when it advances, never allowed to move backwards.
      revision = Math.max(params.producerRevision, lastRevision);
    } else if (revisionOwner === null || contentChanged) {
      // Initial publication or an effective endpoint-set change increments;
      // stable repeated reads keep the same revision.
      revision = lastRevision + 1;
    } else {
      revision = lastRevision;
    }
    const floor = params.minimumOuterRevisionExclusive ?? 0;
    if (revision <= floor) revision = floor + 1;
    if (contentChanged && revision <= lastRevision) revision = lastRevision + 1;
    return revision;
}

function httpsEndpointFromIngress(publicServerUrl: string | null): HomeConnectionEndpointV1 | null {
    if (!publicServerUrl) return null;
    try {
        if (new URL(publicServerUrl).protocol !== "https:") return null;
    } catch {
        return null;
    }
    // An ingress URL is a full application-origin candidate; the strict
    // endpoint schema (bounded, HTTPS-or-loopback-HTTP, no query/credentials)
    // is the only admittance path.
    const parsed = HomeConnectionEndpointV1Schema.safeParse({ kind: "https", url: publicServerUrl });
    return parsed.success ? parsed.data : null;
}

/**
 * Composes the full-fidelity current descriptor from explicit facts, or
 * undefined when the Home can present no strict endpoint set. This is the
 * redemption-grade projection: direct-address hints are preserved.
 */
export function composeHomeConnectionDescriptor(
    facts: HomeDescriptorPublicationFacts,
): HomeConnectionDescriptorV1 | undefined {
    const iroh = facts.iroh.status === "active" && facts.iroh.snapshot ? facts.iroh.snapshot : null;
    const homeServerIdentityId = iroh?.homeServerIdentityId ?? facts.homeServerIdentityId;
    if (!homeServerIdentityId) return undefined;
    const canonicalServerUrl = iroh?.canonicalServerUrl ?? facts.canonicalServerUrl;
    if (!canonicalServerUrl) return undefined;

    const endpoints: HomeConnectionEndpointV1[] = [];
    const httpsEndpoint = httpsEndpointFromIngress(facts.publicServerUrl);
    if (httpsEndpoint) endpoints.push(httpsEndpoint);
    if (iroh) {
        endpoints.push({
            kind: "iroh",
            endpointId: iroh.endpoint.endpointId,
            ...(iroh.endpoint.relayUrls ? { relayUrls: iroh.endpoint.relayUrls } : {}),
            ...(iroh.endpoint.directAddresses ? { directAddresses: iroh.endpoint.directAddresses } : {}),
        });
    }
    if (endpoints.length === 0) return undefined;

    const contentKey = JSON.stringify([homeServerIdentityId, canonicalServerUrl, endpoints]);
    const revision = nextMonotonicOuterRevision({
        contentKey,
        producerRevision: iroh ? iroh.revision : null,
        minimumOuterRevisionExclusive: facts.minimumOuterRevisionExclusive,
    });
    const parsed = HomeConnectionDescriptorV1Schema.safeParse({
        v: 1,
        homeServerIdentityId,
        canonicalServerUrl,
        revision,
        endpoints,
    });
    if (!parsed.success) return undefined;
    revisionOwner = { revision, contentKey };
    return parsed.data;
}

/** Public projection of the composed descriptor: direct-address hints are redacted. */
export function resolvePublishedHomeConnectionDescriptor(
    facts: HomeDescriptorPublicationFacts,
): HomeConnectionDescriptorV1 | undefined {
    const composed = composeHomeConnectionDescriptor(facts);
    if (!composed || composed.homeServerIdentityId !== facts.homeServerIdentityId) return undefined;
    return {
        ...composed,
        endpoints: composed.endpoints.map((endpoint) => endpoint.kind === "iroh"
            ? ({
                kind: "iroh",
                endpointId: endpoint.endpointId,
                ...(endpoint.relayUrls ? { relayUrls: endpoint.relayUrls } : {}),
            } satisfies HomeConnectionEndpointV1)
            : endpoint),
    };
}

/**
 * Authenticated current-Home projection. It preserves every canonical endpoint
 * fact, but only when the descriptor is bound to the same stable Home identity
 * advertised by this server process.
 */
export function resolveAuthenticatedHomeConnectionDescriptor(
    facts: HomeDescriptorPublicationFacts,
): HomeConnectionDescriptorV1 | undefined {
    const composed = composeHomeConnectionDescriptor(facts);
    if (!composed || composed.homeServerIdentityId !== facts.homeServerIdentityId) return undefined;
    return composed;
}

function readHomeDescriptorPublicationFacts(env: NodeJS.ProcessEnv): Promise<HomeDescriptorPublicationFacts> {
    return (async () => {
        const iroh = await getHomeIrohEndpointState();
        return {
            homeServerIdentityId: readCachedServerIdentityIdForHotPath(env),
            canonicalServerUrl: resolveConfiguredCanonicalServerUrl(env),
            publicServerUrl: resolveConfiguredPublicServerUrl(env) ?? null,
            minimumOuterRevisionExclusive: iroh.snapshot?.revision ?? null,
            iroh,
        };
    })();
}

/** Public projection read path (features payload): redacts direct-address hints. */
export async function readPublishedHomeConnectionDescriptor(
    env: NodeJS.ProcessEnv = process.env,
): Promise<HomeConnectionDescriptorV1 | undefined> {
    return resolvePublishedHomeConnectionDescriptor(await readHomeDescriptorPublicationFacts(env));
}

/**
 * Redemption projection read path (assertion redemption): preserves every
 * endpoint fact the enrolling client needs, including direct-address hints.
 */
export async function readRedemptionHomeConnectionDescriptor(
    env: NodeJS.ProcessEnv = process.env,
): Promise<HomeConnectionDescriptorV1 | undefined> {
    return composeHomeConnectionDescriptor(await readHomeDescriptorPublicationFacts(env));
}
