import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { upsertAccountHomeDirectoryEntry } from "@/app/accountDirectory/accountDirectoryService";
import { createHomeConnectionDescriptorContinuityStoreForServer } from "./homeConnectionDescriptorContinuity";
import {
    reserveRelocatedHomeConnectionDescriptor,
    resetHomeConnectionDescriptorRevisionOwnerForTests,
} from "./homeConnectionDescriptorPublication";

describe("relocation descriptor authority", () => {
    let harness: LightSqliteHarness | undefined;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-relocation-descriptor-",
            env: {
                HAPPIER_CANONICAL_SERVER_URL: "https://home.example.test",
                HAPPIER_PUBLIC_SERVER_URL: "https://destination.example.test",
            },
        });
    }, 120_000);
    afterAll(async () => {
        resetHomeConnectionDescriptorRevisionOwnerForTests();
        await harness?.close();
    });

    it("reserves above retained continuity and stores the exact mixed descriptor in Directory", async () => {
        const continuityStore = createHomeConnectionDescriptorContinuityStoreForServer(process.env)!;
        const first = await reserveRelocatedHomeConnectionDescriptor({
            env: process.env, continuityStore, minimumOuterRevisionExclusive: 25,
            irohEndpoint: { endpointId: "b".repeat(64) },
        });
        resetHomeConnectionDescriptorRevisionOwnerForTests();
        const descriptor = await reserveRelocatedHomeConnectionDescriptor({
            env: process.env, continuityStore, minimumOuterRevisionExclusive: 7,
            irohEndpoint: {
                endpointId: "b".repeat(64),
                relayUrls: ["https://relay.example.test"],
                directAddresses: ["192.168.1.2:4242"],
            },
        });
        expect(descriptor.revision).toBe(first.revision + 1);
        expect(descriptor.endpoints.map((endpoint) => endpoint.kind).sort()).toEqual(["https", "iroh"]);
        const account = await db.account.create({ data: { publicKey: "relocation-descriptor-account" } });
        const row = await upsertAccountHomeDirectoryEntry({
            accountId: account.id, homeServerIdentityId: descriptor.homeServerIdentityId,
            label: "Moved Home", connectionDescriptor: descriptor,
        });
        expect(row.connectionDescriptor).toEqual(descriptor);
    });

    it("reserves authorized HTTPS ingress when Iroh is unavailable, without inventing auth-origin ingress", async () => {
        const continuityStore = createHomeConnectionDescriptorContinuityStoreForServer(process.env)!;
        const descriptor = await reserveRelocatedHomeConnectionDescriptor({
            env: process.env, continuityStore, minimumOuterRevisionExclusive: 30,
            irohEndpoint: null,
        });
        expect(descriptor.revision).toBeGreaterThan(30);
        expect(descriptor.endpoints).toEqual([{ kind: "https", url: "https://destination.example.test" }]);
        await expect(reserveRelocatedHomeConnectionDescriptor({
            env: { ...process.env, HAPPIER_PUBLIC_SERVER_URL: "" },
            continuityStore, minimumOuterRevisionExclusive: 31, irohEndpoint: null,
        })).rejects.toThrow();
    });
});
