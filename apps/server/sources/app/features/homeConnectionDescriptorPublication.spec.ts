import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeIrohEndpointState } from "@/app/iroh/homeIrohEndpoint";

const mocks = vi.hoisted(() => ({
    getHomeIrohEndpointState: vi.fn(),
    readCachedServerIdentityIdForHotPath: vi.fn(),
    resolveConfiguredPublicServerUrl: vi.fn(),
}));

// Genuine boundaries only: the native Iroh carrier owner, the storage-backed
// identity cache, and the filesystem/config-backed public-ingress owner.
vi.mock("@/app/iroh/homeIrohEndpoint", () => ({
    getHomeIrohEndpointState: mocks.getHomeIrohEndpointState,
}));
vi.mock("@/app/serverIdentity/serverIdentity", () => ({
    getOrCreateServerIdentityId: vi.fn(),
    readCachedServerIdentityIdForHotPath: mocks.readCachedServerIdentityIdForHotPath,
}));
vi.mock("@/app/serverUrls/effectiveServerUrls", () => ({
    resolveConfiguredCanonicalServerUrl: vi.fn(),
    resolveConfiguredPublicServerUrl: mocks.resolveConfiguredPublicServerUrl,
}));

import {
    composeHomeConnectionDescriptor,
    readPublishedHomeConnectionDescriptor,
    readRedemptionHomeConnectionDescriptor,
    resetHomeConnectionDescriptorRevisionOwnerForTests,
    type HomeDescriptorPublicationFacts,
} from "./homeConnectionDescriptorPublication";

const irohSnapshot = {
    homeServerIdentityId: "srv_home",
    canonicalServerUrl: "https://home.example.test",
    revision: 7,
    endpoint: {
        endpointId: "a".repeat(64),
        relayUrls: ["https://relay.example.test"],
        directAddresses: ["192.168.1.10:4242"],
    },
} as NonNullable<HomeIrohEndpointState["snapshot"]>;

const activeIroh = (): HomeIrohEndpointState => ({ status: "active", snapshot: irohSnapshot, failureReason: null });
const inactiveIroh = (): HomeIrohEndpointState => ({ status: "not-composed", snapshot: null, failureReason: null });

function facts(overrides: Partial<HomeDescriptorPublicationFacts> = {}): HomeDescriptorPublicationFacts {
    return {
        homeServerIdentityId: "srv_home",
        canonicalServerUrl: "https://home.example.test",
        publicServerUrl: null,
        minimumOuterRevisionExclusive: null,
        iroh: inactiveIroh(),
        ...overrides,
    };
}

describe("home connection descriptor publication owner", () => {
    beforeEach(() => {
        resetHomeConnectionDescriptorRevisionOwnerForTests();
        vi.clearAllMocks();
    });

    it("never infers an HTTPS ingress endpoint from the canonical auth origin alone", () => {
        // Canonical auth origin is HTTPS, but no explicit ingress fact and no
        // Iroh endpoint exist: publishing an endpoint here would fabricate
        // ingress that the Home never observed.
        expect(composeHomeConnectionDescriptor(facts())).toBeUndefined();
    });

    it("publishes an HTTPS-only descriptor from the explicit ingress fact with a first monotonic revision", () => {
        const descriptor = composeHomeConnectionDescriptor(facts({
            publicServerUrl: "https://ingress.example.test",
        }));
        expect(descriptor).toEqual({
            v: 1,
            homeServerIdentityId: "srv_home",
            canonicalServerUrl: "https://home.example.test",
            revision: 1,
            endpoints: [{ kind: "https", url: "https://ingress.example.test" }],
        });
    });

    it("rejects non-HTTPS ingress facts and invalid ingress URLs instead of publishing them", () => {
        expect(composeHomeConnectionDescriptor(facts({ publicServerUrl: "http://127.0.0.1:3005" }))).toBeUndefined();
        expect(composeHomeConnectionDescriptor(facts({ publicServerUrl: "not a url" }))).toBeUndefined();
    });

    it("publishes an Iroh-only descriptor from the endpoint lifecycle and consumes its persistent revision", () => {
        const descriptor = composeHomeConnectionDescriptor(facts({
            canonicalServerUrl: "http://127.0.0.1:43123",
            iroh: activeIroh(),
        }));
        expect(descriptor).toEqual({
            v: 1,
            homeServerIdentityId: "srv_home",
            canonicalServerUrl: "https://home.example.test",
            revision: 7,
            endpoints: [{
                kind: "iroh",
                endpointId: "a".repeat(64),
                relayUrls: ["https://relay.example.test"],
                directAddresses: ["192.168.1.10:4242"],
            }],
        });
    });

    it("includes both endpoints when actual HTTPS ingress and the Iroh endpoint are available", () => {
        const descriptor = composeHomeConnectionDescriptor(facts({
            publicServerUrl: "https://ingress.example.test",
            iroh: activeIroh(),
        }));
        expect(descriptor?.endpoints).toEqual([
            { kind: "https", url: "https://ingress.example.test" },
            {
                kind: "iroh",
                endpointId: "a".repeat(64),
                relayUrls: ["https://relay.example.test"],
                directAddresses: ["192.168.1.10:4242"],
            },
        ]);
        expect(descriptor?.revision).toBe(7);
    });

    it("keeps the in-process revision monotonic across effective endpoint-set changes while the process runs", () => {
        // First HTTPS-only publication.
        const first = composeHomeConnectionDescriptor(facts({ publicServerUrl: "https://ingress.example.test" }));
        expect(first?.revision).toBe(1);
        // Focused repeated-read stability: unchanged content returns the
        // identical publication, revision included.
        const repeat = composeHomeConnectionDescriptor(facts({ publicServerUrl: "https://ingress.example.test" }));
        expect(repeat?.revision).toBe(1);
        expect(repeat).toEqual(first);
        // The Iroh lifecycle joins: the persistent producer revision (3,
        // durable across restarts via endpoint continuity) beats the
        // in-process floor and the set changed.
        expect(composeHomeConnectionDescriptor(facts({
            publicServerUrl: "https://ingress.example.test",
            iroh: { status: "active", snapshot: { ...irohSnapshot, revision: 3 }, failureReason: null },
        }))?.revision).toBe(3);
        // Iroh drops: the set changed again, so the owner increments past the
        // last published revision instead of reusing a stale one.
        expect(composeHomeConnectionDescriptor(facts({ publicServerUrl: "https://ingress.example.test" }))?.revision).toBe(4);
    });

    it("never regresses within the process even when the producer revision goes backwards", () => {
        expect(composeHomeConnectionDescriptor(facts({
            iroh: { status: "active", snapshot: { ...irohSnapshot, revision: 8 }, failureReason: null },
        }))?.revision).toBe(8);
        // A stale producer snapshot (older continuity revision, same endpoint
        // content) must not move the published revision backwards.
        expect(composeHomeConnectionDescriptor(facts({
            iroh: { status: "active", snapshot: { ...irohSnapshot, revision: 2 }, failureReason: null },
        }))?.revision).toBe(8);
    });

    it("honors the explicit connectivity revision floor for freshly materialized Homes", () => {
        const descriptor = composeHomeConnectionDescriptor(facts({
            homeServerIdentityId: "srv_moved",
            canonicalServerUrl: "https://moved.example.test",
            publicServerUrl: "https://moved.example.test",
            minimumOuterRevisionExclusive: 9,
        }));
        expect(descriptor?.revision).toBe(10);
    });

    it("projects the public descriptor without private direct-address hints", async () => {
        mocks.getHomeIrohEndpointState.mockResolvedValue(activeIroh());
        mocks.readCachedServerIdentityIdForHotPath.mockReturnValue("srv_home");
        mocks.resolveConfiguredPublicServerUrl.mockReturnValue(null);

        const descriptor = await readPublishedHomeConnectionDescriptor({} as NodeJS.ProcessEnv);
        expect(descriptor?.endpoints).toEqual([{
            kind: "iroh",
            endpointId: "a".repeat(64),
            relayUrls: ["https://relay.example.test"],
        }]);
        expect(JSON.stringify(descriptor)).not.toContain("192.168.1.10:4242");
    });

    it("projects the redemption descriptor with the endpoint facts enrollment needs", async () => {
        mocks.getHomeIrohEndpointState.mockResolvedValue(activeIroh());
        mocks.readCachedServerIdentityIdForHotPath.mockReturnValue("srv_home");
        mocks.resolveConfiguredPublicServerUrl.mockReturnValue("https://ingress.example.test");

        const descriptor = await readRedemptionHomeConnectionDescriptor({} as NodeJS.ProcessEnv);
        expect(descriptor?.endpoints).toEqual([
            { kind: "https", url: "https://ingress.example.test" },
            {
                kind: "iroh",
                endpointId: "a".repeat(64),
                relayUrls: ["https://relay.example.test"],
                directAddresses: ["192.168.1.10:4242"],
            },
        ]);
    });
});
