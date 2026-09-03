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
import { log } from "@/utils/logging/log";
import {
    createHomeConnectionDescriptorContentKey,
    homeConnectionDescriptorContentKeyCarriesIroh,
    HomeConnectionDescriptorContinuityMalformedError,
    type HomeConnectionDescriptorContinuity,
    type HomeConnectionDescriptorContinuityStore,
} from './homeConnectionDescriptorContinuity';

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
 * - the durable outer-descriptor continuity fact owned by this module. It
 *   covers the complete endpoint set, including HTTPS-only retirement. The
 *   Iroh endpoint revision is the producer revision while that carrier is
 *   active, but it is not a competing outer revision owner.
 *
 * Public and authenticated feature projections are derived from this one
 * composition. The public projection redacts direct-address hints; an
 * authenticated Home client may receive the full current descriptor. Home
 * login redemption does not carry a descriptor.
 */

export type HomeDescriptorPublicationFacts = Readonly<{
    homeServerIdentityId: string | null;
    canonicalServerUrl: string | undefined;
    /** Explicitly configured public server URL (actual ingress fact); null means none. */
    publicServerUrl: string | null;
    /** Explicit outer-revision floor published by the connectivity owner, when present. */
    minimumOuterRevisionExclusive: number | null;
    persistedOuterRevisionOwner: HomeConnectionDescriptorContinuity | null;
    iroh: HomeIrohEndpointState;
}>;

type RevisionOwnerState = Readonly<{
    revision: number;
    contentKey: string;
}>;

let revisionOwner: RevisionOwnerState | null = null;

/**
 * Durable continuity, read once per process. `unreadable` is a fail-closed
 * terminal state: a corrupt durable record must never be replaced by a fresh first
 * revision, which would silently regress every already-adopted descriptor.
 */
type ContinuityPrime =
    | Readonly<{ status: "ready"; persisted: HomeConnectionDescriptorContinuity | null }>
    | Readonly<{ status: "unreadable" }>
    | Readonly<{ status: "transient" }>;

let continuityPrime: ContinuityPrime | null = null;
let continuityPrimeInFlight: Promise<ContinuityPrime> | null = null;
let supersededLocalCandidate: Readonly<{
    contentKey: string;
    winner: HomeConnectionDescriptorContinuity;
}> | null = null;

/**
 * Non-poisoning serialization chain for the complete publication transaction:
 * endpoint observation, composition, revision allocation, durable commit,
 * in-memory commit, and projection. Serializing only file writes would let a
 * later observation allocate first and an older observation subsequently move
 * memory and disk to a higher revision carrying stale facts.
 */
let publicationTransactionChain: Promise<void> = Promise.resolve();

/** Test-only reset of the in-process monotonic revision owner. */
export function resetHomeConnectionDescriptorRevisionOwnerForTests(): void {
    revisionOwner = null;
    continuityPrime = null;
    continuityPrimeInFlight = null;
    supersededLocalCandidate = null;
    publicationTransactionChain = Promise.resolve();
}

/**
 * This module is the only producer and only reader of the persisted content
 * key, so it may inspect its own encoding to tell an endpoint-set change from
 * an unchanged republication.
 */
function contentKeyCarriesIrohEndpoint(contentKey: string | undefined): boolean {
    return homeConnectionDescriptorContentKeyCarriesIroh(contentKey);
}

/**
 * Monotonic outer revision calculation. Production primes the in-process
 * state from the durable outer continuity fact before composing a descriptor.
 * A current Iroh producer revision may raise the floor, while effective
 * endpoint-set changes always publish a strictly greater revision.
 */
function nextMonotonicOuterRevision(params: Readonly<{
    contentKey: string;
    producerRevision: number | null;
    minimumOuterRevisionExclusive: number | null;
}>): number | null {
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
    return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
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
 * undefined when the Home can present no strict endpoint set.
 */
export function composeHomeConnectionDescriptor(
    facts: HomeDescriptorPublicationFacts,
): HomeConnectionDescriptorV1 | undefined {
    if (revisionOwner === null && facts.persistedOuterRevisionOwner) {
        revisionOwner = facts.persistedOuterRevisionOwner;
    }
    const iroh = facts.iroh.status === "active" && facts.iroh.snapshot ? facts.iroh.snapshot : null;
    // A fail-closed Iroh startup says nothing about the operator's intent. If
    // the last published set carried the Iroh endpoint, republishing the
    // remaining endpoints at a greater revision would make every client adopt a
    // descriptor that drops that endpoint. Publish nothing and leave the
    // already-adopted descriptor in place instead of faking a retirement.
    if (!iroh
        && facts.iroh.status === "failed"
        && contentKeyCarriesIrohEndpoint(revisionOwner?.contentKey)) {
        return undefined;
    }
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

    const contentKey = createHomeConnectionDescriptorContentKey({
        homeServerIdentityId,
        canonicalServerUrl,
        endpoints,
    });
    const revision = nextMonotonicOuterRevision({
        contentKey,
        producerRevision: iroh ? iroh.revision : null,
        minimumOuterRevisionExclusive: facts.minimumOuterRevisionExclusive,
    });
    if (revision === null) return undefined;
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

/**
 * Projects one composed descriptor for a visibility. The public projection
 * redacts direct-address hints; both require the descriptor to be bound to the
 * stable Home identity this server process advertises.
 */
function projectComposedHomeConnectionDescriptor(
    composed: HomeConnectionDescriptorV1 | undefined,
    facts: HomeDescriptorPublicationFacts,
    visibility: HomeConnectionDescriptorVisibility,
): HomeConnectionDescriptorV1 | undefined {
    if (!composed || composed.homeServerIdentityId !== facts.homeServerIdentityId) return undefined;
    if (visibility === "authenticated") return composed;
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

export type HomeConnectionDescriptorVisibility = "public" | "authenticated";

/** Public projection of the composed descriptor: direct-address hints are redacted. */
export function resolvePublishedHomeConnectionDescriptor(
    facts: HomeDescriptorPublicationFacts,
): HomeConnectionDescriptorV1 | undefined {
    return projectComposedHomeConnectionDescriptor(composeHomeConnectionDescriptor(facts), facts, "public");
}

/**
 * Authenticated current-Home projection. It preserves every canonical endpoint
 * fact, but only when the descriptor is bound to the same stable Home identity
 * advertised by this server process.
 */
export function resolveAuthenticatedHomeConnectionDescriptor(
    facts: HomeDescriptorPublicationFacts,
): HomeConnectionDescriptorV1 | undefined {
    return projectComposedHomeConnectionDescriptor(composeHomeConnectionDescriptor(facts), facts, "authenticated");
}

async function primeDescriptorContinuity(
    store: HomeConnectionDescriptorContinuityStore,
): Promise<ContinuityPrime> {
    if (continuityPrime) return continuityPrime;
    continuityPrimeInFlight ??= store.read()
        .then((persisted): ContinuityPrime => ({ status: "ready", persisted }))
        .catch((error): ContinuityPrime => {
            log(
                { module: "iroh", level: "warn", detail: error instanceof Error ? error.message : undefined },
                error instanceof HomeConnectionDescriptorContinuityMalformedError
                    ? "Home connection descriptor continuity is malformed; publishing no descriptor"
                    : "Home connection descriptor continuity is temporarily unavailable; publishing no descriptor",
            );
            return error instanceof HomeConnectionDescriptorContinuityMalformedError
                ? { status: "unreadable" }
                : { status: "transient" };
        })
        .then((prime) => {
            continuityPrimeInFlight = null;
            if (prime.status !== "transient") continuityPrime = prime;
            return prime;
        });
    return await continuityPrimeInFlight;
}

function sameContinuity(
    a: HomeConnectionDescriptorContinuity,
    b: HomeConnectionDescriptorContinuity,
): boolean {
    return a.revision === b.revision && a.contentKey === b.contentKey;
}

/**
 * The one production read path for the Home connection descriptor. It resolves
 * the current endpoint facts, primes the durable outer revision once per
 * process, and persists a changed revision before the descriptor is published.
 * Persisting first matters: handing out a revision that a restart cannot
 * reproduce would leave clients rejecting the Home's real descriptor as stale.
 */
export async function readHomeConnectionDescriptor(params: Readonly<{
    env?: NodeJS.ProcessEnv;
    continuityStore: HomeConnectionDescriptorContinuityStore;
    visibility: HomeConnectionDescriptorVisibility;
    /** Narrow injected Iroh lifecycle boundary; production reads the live owner. */
    resolveIrohEndpointState?: () => HomeIrohEndpointState | Promise<HomeIrohEndpointState>;
}>): Promise<HomeConnectionDescriptorV1 | undefined> {
    const turn = publicationTransactionChain.then(async () => {
        return await readHomeConnectionDescriptorTransaction(params);
    });
    publicationTransactionChain = turn.then(() => undefined, () => undefined);
    return await turn;
}

async function readHomeConnectionDescriptorTransaction(params: Readonly<{
    env?: NodeJS.ProcessEnv;
    continuityStore: HomeConnectionDescriptorContinuityStore;
    visibility: HomeConnectionDescriptorVisibility;
    resolveIrohEndpointState?: () => HomeIrohEndpointState | Promise<HomeIrohEndpointState>;
}>): Promise<HomeConnectionDescriptorV1 | undefined> {
    const env = params.env ?? process.env;
    const [iroh, prime] = await Promise.all([
        params.resolveIrohEndpointState ? params.resolveIrohEndpointState() : getHomeIrohEndpointState(),
        primeDescriptorContinuity(params.continuityStore),
    ]);
    if (prime.status !== "ready") return undefined;

    const facts: HomeDescriptorPublicationFacts = {
        homeServerIdentityId: readCachedServerIdentityIdForHotPath(env),
        canonicalServerUrl: resolveConfiguredCanonicalServerUrl(env),
        publicServerUrl: resolveConfiguredPublicServerUrl(env) ?? null,
        // The Iroh producer revision reaches the composer through `iroh`; an
        // explicit floor belongs to the relocation owner, not to this read.
        minimumOuterRevisionExclusive: null,
        persistedOuterRevisionOwner: prime.persisted,
        iroh,
    };
    const previouslyCommittedOwner = revisionOwner;
    const composed = composeHomeConnectionDescriptor(facts);
    const candidateOwner = composed ? revisionOwner : previouslyCommittedOwner;
    // Composition calculates against the committed frontier, but the new
    // in-memory frontier becomes visible only after its durable write lands.
    revisionOwner = previouslyCommittedOwner;
    if (composed && candidateOwner) {
        try {
            if (supersededLocalCandidate?.contentKey === candidateOwner.contentKey) {
                const current = await params.continuityStore.read();
                if (!current) return undefined;
                continuityPrime = { status: "ready", persisted: current };
                revisionOwner = current;
                if (current.contentKey !== candidateOwner.contentKey) {
                    if (!sameContinuity(current, supersededLocalCandidate.winner)) {
                        supersededLocalCandidate = {
                            contentKey: candidateOwner.contentKey,
                            winner: current,
                        };
                    }
                    return undefined;
                }
                supersededLocalCandidate = null;
                const externallyCommittedDescriptor = current.revision === composed.revision
                    ? composed
                    : { ...composed, revision: current.revision };
                return projectComposedHomeConnectionDescriptor(
                    externallyCommittedDescriptor,
                    facts,
                    params.visibility,
                );
            }
            const result = await params.continuityStore.write(candidateOwner);
            continuityPrime = { status: "ready", persisted: result.continuity };
            if (result.status === "superseded" && result.continuity.contentKey !== candidateOwner.contentKey) {
                revisionOwner = result.continuity;
                supersededLocalCandidate = {
                    contentKey: candidateOwner.contentKey,
                    winner: result.continuity,
                };
                return undefined;
            }
            revisionOwner = result.continuity;
            supersededLocalCandidate = null;
            const committedDescriptor = result.continuity.revision === composed.revision
                ? composed
                : { ...composed, revision: result.continuity.revision };
            return projectComposedHomeConnectionDescriptor(committedDescriptor, facts, params.visibility);
        } catch (error) {
            if (error instanceof HomeConnectionDescriptorContinuityMalformedError) {
                continuityPrime = { status: "unreadable" };
            }
            log(
                { module: "iroh", level: "warn", detail: error instanceof Error ? error.message : undefined },
                "Home connection descriptor continuity commit failed; publishing no descriptor",
            );
            return undefined;
        }
    }
    revisionOwner = candidateOwner;
    return projectComposedHomeConnectionDescriptor(composed, facts, params.visibility);
}
