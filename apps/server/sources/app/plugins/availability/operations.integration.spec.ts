import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    ARTIFACT_PLAIN_DATA_KEY_MARKER,
    encodePlainArtifactStoredContent,
    PluginAccountCollectionContributionV1Schema,
    PluginAvailabilityReleaseReadActionOutputV1Schema,
    normalizePluginAccountCollectionContractsV1,
} from "@happier-dev/protocol";
import {
    createPackageAssetArchiveV1,
    encodePackageAssetArchiveBodyV1,
} from "@happier-dev/protocol/plugins/availability";
import {
    computePluginUiArtifactFileSetSha256DigestV1,
    computePluginUiArtifactSha256DigestV1,
    createPluginUiArtifactArchiveV1,
    encodePluginUiArtifactArchiveBodyV1,
} from "@happier-dev/protocol/plugins/ui";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createSignedAccountContentBinding } from "@/testkit/accountEncryption";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    retirePluginCollectionCandidatePreparation,
    stagePluginCollectionCandidatePreparation,
} from "@/app/plugins/data/collections/candidatePreparation";

import {
    createPluginAvailabilityOperations,
    resolveCurrentClaimablePluginMachineMaterializationTx,
} from "./operations";

const ACCOUNT_ID = "account-plugin-availability";
const MACHINE_ID = "machine-plugin-availability";
const SERVER_IDENTITY_ID = "srv_availabilityIntegration";
const PLUGIN_ID = "com.acme.fixture";
const RELEASE = { pluginId: PLUGIN_ID, version: "1.2.3" } as const;
const DISABLED_PLUGIN_ID = "com.acme.disabled";
const DISABLED_RELEASE = { pluginId: DISABLED_PLUGIN_ID, version: "1.2.3" } as const;

function releaseFacts(overrides: Record<string, unknown> = {}) {
    return {
        ref: RELEASE,
        archiveDigestSha256: `sha256:${"a".repeat(64)}`,
        normalizedManifest: {
            schemaVersion: 2,
            id: PLUGIN_ID,
            version: RELEASE.version,
            displayName: "Availability fixture",
            engines: { happier: "^1.0.0" },
            runtime: { apiVersion: 1 },
            contributes: {},
        },
        collectionContracts: [],
        uiSlots: [{
            contributionId: "hosted",
            tier: "hostedWeb",
            platform: "web",
            artifactDigest: `sha256:${"b".repeat(64)}`,
            compatibility: {
                hostUiApiVersion: "1.0.0",
            },
        }],
        packageAssetArchive: {
            archiveDigestSha256: `sha256:${"c".repeat(64)}`,
            resources: [],
        },
        ...overrides,
    };
}

function hostedArtifactLinkCompatibility(overrides: Record<string, unknown> = {}) {
    return {
        hostAppVersion: "2.0.0",
        hostUiApiVersion: "1.0.0",
        reactVersion: "19.2.0",
        platform: "web",
        channel: "store",
        nativeCapabilities: ["safe-area"],
        ...overrides,
    };
}

function createBrowserArtifactArchive() {
    const entryBytes = new TextEncoder().encode("<script type=\"module\" src=\"./assets/app.js\"></script>");
    const moduleBytes = new TextEncoder().encode("export const panel = true;");
    const files = [
        { relativePath: "hosted-web/hosted/index.html", bytes: entryBytes },
        { relativePath: "hosted-web/hosted/assets/app.js", bytes: moduleBytes },
    ];
    const graph = {
        contributionId: "hosted",
        tier: "hostedWeb" as const,
        platform: "web" as const,
        entry: "hosted-web/hosted/index.html",
        files: files.map((file) => ({
            relativePath: file.relativePath,
            digest: computePluginUiArtifactSha256DigestV1(file.bytes),
            byteSize: file.bytes.byteLength,
        })),
        digest: computePluginUiArtifactFileSetSha256DigestV1(files),
        builtWith: { bundler: "vite" as const, version: "7.0.0" },
        hostUiApiVersion: "1.0.0",
        compat: {},
    };
    const archive = createPluginUiArtifactArchiveV1({
        pluginId: PLUGIN_ID,
        artifactGraph: graph,
        files,
    });
    if (!archive) throw new Error("Expected fixture browser Artifact archive");
    return { graph, archive, moduleBytes };
}

const RETENTION_COLLECTION = {
    id: "tasks",
    schemaVersion: 1,
    rowIdField: "id",
    schema: {
        type: "object",
        properties: {
            id: { type: "string", maxLength: 256 },
            status: { type: "string", enum: ["closed", "open"] },
        },
        required: ["id", "status"],
        additionalProperties: false,
    },
    serverReadable: ["status"],
    indexes: [],
    relations: [],
} as const;

function createHostedReleaseFixture(input: Readonly<{
    version: string;
    ordinal: number;
    includeCollection?: boolean;
}>) {
    const ref = { pluginId: PLUGIN_ID, version: input.version } as const;
    const { graph, archive: uiArchive } = createBrowserArtifactArchive();
    const normalizedManifest = {
        ...releaseFacts().normalizedManifest,
        version: input.version,
        contributes: {
            ...(input.includeCollection
                ? { accountCollections: [RETENTION_COLLECTION] }
                : {}),
            resources: [{
                id: "brand-icon",
                kind: "asset",
                path: "assets/brand.png",
                contentType: "image/png",
            }],
        },
    };
    const packageAssetArchive = createPackageAssetArchiveV1({
        manifest: normalizedManifest,
        files: [{
            path: "assets/brand.png",
            bytes: new Uint8Array([137, 80, 78, input.ordinal]),
        }],
    });
    if (!packageAssetArchive) {
        throw new Error("Expected retention package Asset archive fixture");
    }
    const collectionContracts = input.includeCollection
        ? normalizePluginAccountCollectionContractsV1({
            pluginId: PLUGIN_ID,
            contributions: [
                PluginAccountCollectionContributionV1Schema.parse(RETENTION_COLLECTION),
            ],
        }).map(({ pluginId, collectionId, schemaVersion, contractDigest }) => ({
            pluginId,
            collectionId,
            schemaVersion,
            contractDigest,
        }))
        : [];
    const slot = {
        ...releaseFacts().uiSlots[0]!,
        artifactDigest: graph.digest,
    };
    return {
        ref,
        facts: releaseFacts({
            ref,
            archiveDigestSha256: `sha256:${String(input.ordinal).repeat(64)}`,
            normalizedManifest,
            collectionContracts,
            uiSlots: [slot],
            packageAssetArchive: packageAssetArchive.descriptor,
        }),
        collectionContracts,
        slot,
        uiArtifactId: `00000000-0000-4000-8000-${String(input.ordinal * 2 + 10).padStart(12, "0")}`,
        uiArtifact: {
            header: encodePlainArtifactStoredContent(uiArchive.header),
            body: encodePlainArtifactStoredContent({
                body: encodePluginUiArtifactArchiveBodyV1(uiArchive.body),
            }),
            dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
        },
        packageArtifactId: `00000000-0000-4000-8000-${String(input.ordinal * 2 + 11).padStart(12, "0")}`,
        packageArtifact: {
            header: encodePlainArtifactStoredContent(packageAssetArchive.header),
            body: encodePlainArtifactStoredContent({
                body: encodePackageAssetArchiveBodyV1(packageAssetArchive.body),
            }),
            dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
        },
    };
}

describe("plugin Availability operations", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-plugin-availability-",
            initAuth: false,
            initEncrypt: true,
            initFiles: false,
        });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.automationEventSourceCatalogStatus.deleteMany(),
            () => db.automationEventSourceStatus.deleteMany(),
            () => db.automationTrigger.deleteMany(),
            () => db.automation.deleteMany(),
            () => db.automationEventCatalogState.deleteMany(),
            () => db.pluginCollectionCandidatePreparationStage.deleteMany(),
            () => db.pluginCollectionIndexEntry.deleteMany(),
            () => db.pluginCollectionProjection.deleteMany(),
            () => db.pluginCollectionRelation.deleteMany(),
            () => db.pluginCollectionRow.deleteMany(),
            () => db.pluginCollectionIndexState.deleteMany(),
            () => db.pluginMachineMaterialization.deleteMany(),
            () => db.accountPluginUiArtifact.deleteMany(),
            () => db.accountPluginRelease.deleteMany(),
            () => db.accountPluginIntent.deleteMany(),
            () => db.artifact.deleteMany(),
            () => db.pluginCollectionContract.deleteMany(),
            () => db.machine.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    async function seedAccountAndMachine(options: Readonly<{
        encryptionMode?: "plain" | "e2ee";
    }> = {}) {
        const encryptionMode = options.encryptionMode ?? "plain";
        await db.account.create({
            data: {
                id: ACCOUNT_ID,
                ...(encryptionMode === "e2ee"
                    ? createSignedAccountContentBinding()
                    : { publicKey: null }),
                encryptionMode,
            },
        });
        await db.machine.create({
            data: {
                id: MACHINE_ID,
                accountId: ACCOUNT_ID,
                metadata: "{}",
                installationId: "machine-installation-availability",
            },
        });
    }

    function operations() {
        return createPluginAvailabilityOperations({
            resolveHostingCapability: () => ({
                enabled: true,
                maxArtifactBytes: 1024 * 1024,
                maxAccountBytes: 4 * 1024 * 1024,
            }),
            resolveServerIdentityId: async () => SERVER_IDENTITY_ID,
        });
    }

    async function publishHostedRelease(
        service: ReturnType<typeof operations>,
        fixture: ReturnType<typeof createHostedReleaseFixture>,
    ) {
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: fixture.facts, sourceClass: "registryPackage" },
        });
    }

    async function selectHostedRelease(
        service: ReturnType<typeof operations>,
        fixture: ReturnType<typeof createHostedReleaseFixture>,
        expectedRevision: string | null,
    ) {
        await service.setIntent({
            accountId: ACCOUNT_ID,
            input: {
                pluginId: PLUGIN_ID,
                desiredVersion: fixture.ref.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: fixture.collectionContracts,
                expectedRevision,
            },
        });
    }

    async function hostReleaseArchives(
        service: ReturnType<typeof operations>,
        fixture: ReturnType<typeof createHostedReleaseFixture>,
    ) {
        await service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: fixture.ref,
                slot: fixture.slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: fixture.uiArtifactId,
                artifact: fixture.uiArtifact,
            },
        });
        await service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: fixture.ref,
                artifactId: fixture.packageArtifactId,
                artifact: fixture.packageArtifact,
            },
        });
    }

    it("uses the operator-owned hosting capability when no test override is supplied", async () => {
        await seedAccountAndMachine();
        const defaultOperations = createPluginAvailabilityOperations({
            resolveServerIdentityId: async () => SERVER_IDENTITY_ID,
        });

        await expect(defaultOperations.readIntent({
            accountId: ACCOUNT_ID,
            input: { pluginId: PLUGIN_ID },
        })).resolves.toMatchObject({ hostingCapability: { enabled: false } });

        harness.resetEnv({
            HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__ENABLED: "1",
            HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: "1024",
            HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: "4096",
        });
        const configuredOperations = createPluginAvailabilityOperations({
            resolveServerIdentityId: async () => SERVER_IDENTITY_ID,
        });

        await expect(configuredOperations.readIntent({
            accountId: ACCOUNT_ID,
            input: { pluginId: PLUGIN_ID },
        })).resolves.toMatchObject({
            hostingCapability: {
                enabled: true,
                maxArtifactBytes: 1024,
                maxAccountBytes: 4096,
            },
        });
    });

    it("binds one pluginId@version to immutable verified facts and rejects a same-version conflict", async () => {
        await seedAccountAndMachine();
        const service = operations();

        await expect(service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: releaseFacts(), sourceClass: "registryPackage" },
        })).resolves.toMatchObject({ outcome: "created", facts: { ref: RELEASE } });
        await expect(service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: releaseFacts(), sourceClass: "versionedArchive" },
        })).resolves.toMatchObject({ outcome: "rejoined", facts: { ref: RELEASE } });
        await expect(service.publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({ archiveDigestSha256: `sha256:${"c".repeat(64)}` }),
                sourceClass: "registryPackage",
            },
        })).rejects.toMatchObject({
            code: "plugin_release_content_conflict",
        });
        await expect(db.accountPluginRelease.count({ where: { accountId: ACCOUNT_ID } })).resolves.toBe(1);
    });

    it("reads exact immutable facts for an unselected release with the current Availability cursor", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const target = { pluginId: PLUGIN_ID, version: "2.0.0" } as const;
        const facts = releaseFacts({
            ref: target,
            archiveDigestSha256: `sha256:${"d".repeat(64)}`,
            normalizedManifest: {
                ...releaseFacts().normalizedManifest,
                version: target.version,
            },
        });

        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts, sourceClass: "bundledFirstParty" },
        });
        await expect(db.accountPluginIntent.count({ where: { accountId: ACCOUNT_ID } })).resolves.toBe(0);

        const account = await db.account.findUnique({
            where: { id: ACCOUNT_ID },
            select: { seq: true },
        });
        if (!account) throw new Error("Expected seeded Account");

        const expected = PluginAvailabilityReleaseReadActionOutputV1Schema.parse({
            availabilityCursor: account.seq,
            facts,
        });
        await expect(service.readRelease({
            accountId: ACCOUNT_ID,
            input: { release: target },
        })).resolves.toEqual(expected);
        await expect(service.readRelease({
            accountId: ACCOUNT_ID,
            input: { release: { pluginId: PLUGIN_ID, version: "9.9.9" } },
        })).rejects.toMatchObject({ code: "plugin_release_not_found" });
    });

    it("materializes immutable Data contracts from the admitted manifest before Availability stores its refs", async () => {
        await seedAccountAndMachine();
        const collection = {
            id: "tasks",
            schemaVersion: 1,
            rowIdField: "id",
            schema: {
                type: "object",
                properties: {
                    id: { type: "string", maxLength: 256 },
                    status: { type: "string", enum: ["closed", "open"] },
                },
                required: ["id", "status"],
                additionalProperties: false,
            },
            serverReadable: ["status"],
            indexes: [{ id: "by-status", fields: [{ field: "status", direction: "asc" }] }],
            uiQueries: [{
                id: "open",
                indexId: "by-status",
                parameters: {
                    status: { kind: "string", maxUtf8Bytes: 16, enum: ["closed", "open"] },
                },
                prefix: [{ kind: "parameter", parameterId: "status" }],
                order: "asc",
                pageSize: 20,
                projectedFields: ["status"],
            }],
            relations: [],
        } as const;
        const normalizedManifest = {
            ...releaseFacts().normalizedManifest,
            contributes: { accountCollections: [collection] },
        };
        const collectionContracts = normalizePluginAccountCollectionContractsV1({
            pluginId: PLUGIN_ID,
            contributions: [PluginAccountCollectionContributionV1Schema.parse(collection)],
        }).map(({ pluginId, collectionId, schemaVersion, contractDigest }) => ({
            pluginId,
            collectionId,
            schemaVersion,
            contractDigest,
        }));

        await expect(operations().publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({ normalizedManifest, collectionContracts }),
                sourceClass: "registryPackage",
            },
        })).resolves.toMatchObject({ outcome: "created" });
        await expect(db.pluginCollectionContract.findFirst({
            where: {
                pluginId: PLUGIN_ID,
                collectionId: "tasks",
                schemaVersion: 1,
                contractDigest: collectionContracts[0]!.contractDigest,
            },
            select: {
                normalizedSchema: true,
                privacyProjection: true,
            },
        })).resolves.toMatchObject({
            normalizedSchema: expect.objectContaining({ type: "object" }),
            privacyProjection: expect.objectContaining({
                rowIdField: "id",
                uiQueries: [expect.objectContaining({ id: "open" })],
            }),
        });
    });

    it("keeps an intent unset until Data confirms the selected release writer contracts, then uses its exact revision CAS", async () => {
        await seedAccountAndMachine();
        const collection = {
            id: "tasks",
            schemaVersion: 1,
            rowIdField: "id",
            schema: {
                type: "object",
                properties: {
                    id: { type: "string", maxLength: 256 },
                    status: { type: "string", enum: ["closed", "open"] },
                },
                required: ["id", "status"],
                additionalProperties: false,
            },
            serverReadable: ["status"],
            indexes: [{ id: "by-status", fields: [{ field: "status", direction: "asc" }] }],
            relations: [],
        } as const;
        const normalizedManifest = {
            ...releaseFacts().normalizedManifest,
            contributes: { accountCollections: [collection] },
        };
        const collectionContracts = normalizePluginAccountCollectionContractsV1({
            pluginId: PLUGIN_ID,
            contributions: [PluginAccountCollectionContributionV1Schema.parse(collection)],
        }).map(({ pluginId, collectionId, schemaVersion, contractDigest }) => ({
            pluginId,
            collectionId,
            schemaVersion,
            contractDigest,
        }));
        const service = operations();

        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({ normalizedManifest, collectionContracts }),
                sourceClass: "registryPackage",
            },
        });
        const contract = await db.pluginCollectionContract.findFirstOrThrow({
            where: {
                pluginId: PLUGIN_ID,
                collectionId: "tasks",
                schemaVersion: 1,
                contractDigest: collectionContracts[0]!.contractDigest,
            },
            select: { id: true },
        });
        await db.pluginCollectionRow.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                collectionId: "tasks",
                rowId: "existing-task",
                schemaVersion: 1,
                revision: 1,
                contractId: contract.id,
                contractDigest: collectionContracts[0]!.contractDigest,
                contentEnvelope: { t: "plain", v: {} },
            },
        });

        const input = {
            pluginId: PLUGIN_ID,
            desiredVersion: RELEASE.version,
            enabled: true,
            offlineUiHosting: "disabled" as const,
            writableCollections: collectionContracts,
            expectedRevision: null,
        };
        await expect(service.setIntent({ accountId: ACCOUNT_ID, input }))
            .rejects.toMatchObject({
                code: "plugin_intent_writable_collections_not_ready",
            });
        await expect(db.accountPluginIntent.count({
            where: { accountId: ACCOUNT_ID, pluginId: PLUGIN_ID },
        })).resolves.toBe(0);

        await db.pluginCollectionIndexState.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                collectionId: "tasks",
                indexId: "by-status",
                contractId: contract.id,
                contractDigest: collectionContracts[0]!.contractDigest,
                buildState: "ready",
                indexedThroughRevision: 1,
            },
        });
        await expect(service.setIntent({ accountId: ACCOUNT_ID, input }))
            .resolves.toMatchObject({
                intent: {
                    pluginId: PLUGIN_ID,
                    desiredVersion: RELEASE.version,
                    writableCollections: collectionContracts,
                    revision: "0",
                },
            });
        await expect(service.setIntent({
            accountId: ACCOUNT_ID,
            input: { ...input, enabled: false },
        })).rejects.toMatchObject({ code: "plugin_intent_revision_conflict" });
        await expect(service.setIntent({
            accountId: ACCOUNT_ID,
            input: { ...input, enabled: false, expectedRevision: "0" },
        })).resolves.toMatchObject({
            intent: { enabled: false, revision: "1" },
        });
    });

    it("promotes exactly one complete candidate generation inside the intent CAS and rolls back a partial candidate", async () => {
        await seedAccountAndMachine();
        const sourceCollection = {
            id: "tasks",
            schemaVersion: 1,
            rowIdField: "id",
            schema: {
                type: "object",
                properties: {
                    id: { type: "string", maxLength: 256 },
                    status: { type: "string", enum: ["closed", "open"] },
                },
                required: ["id", "status"],
                additionalProperties: false,
            },
            serverReadable: ["id", "status"],
            indexes: [{ id: "by-status", fields: [{ field: "status", direction: "asc" }] }],
            relations: [],
        } as const;
        const targetCollection = {
            ...sourceCollection,
            schemaVersion: 2,
            schema: {
                type: "object" as const,
                properties: {
                    ...sourceCollection.schema.properties,
                    title: { type: "string", maxLength: 256 },
                },
                required: ["id", "status", "title"],
                additionalProperties: false,
            },
            serverReadable: ["id", "status", "title"],
            readableSchemaVersions: [1],
            migrations: [{
                id: "upgrade-tasks-v1-to-v2",
                fromSchemaVersion: 1,
                toSchemaVersion: 2,
            }],
        } as const;
        const sourceManifest = {
            ...releaseFacts().normalizedManifest,
            version: RELEASE.version,
            contributes: { accountCollections: [sourceCollection] },
        };
        const targetRelease = { pluginId: PLUGIN_ID, version: "2.0.0" } as const;
        const targetManifest = {
            ...sourceManifest,
            version: targetRelease.version,
            contributes: { accountCollections: [targetCollection] },
        };
        const sourceContracts = normalizePluginAccountCollectionContractsV1({
            pluginId: PLUGIN_ID,
            contributions: [PluginAccountCollectionContributionV1Schema.parse(sourceCollection)],
        }).map(({ pluginId, collectionId, schemaVersion, contractDigest }) => ({
            pluginId,
            collectionId,
            schemaVersion,
            contractDigest,
        }));
        const targetContracts = normalizePluginAccountCollectionContractsV1({
            pluginId: PLUGIN_ID,
            contributions: [PluginAccountCollectionContributionV1Schema.parse(targetCollection)],
        }).map(({ pluginId, collectionId, schemaVersion, contractDigest }) => ({
            pluginId,
            collectionId,
            schemaVersion,
            contractDigest,
        }));
        const source = sourceContracts[0];
        const target = targetContracts[0];
        if (!source || !target) throw new Error("Expected source and target collection contracts.");
        const service = operations();
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({ normalizedManifest: sourceManifest, collectionContracts: sourceContracts }),
                sourceClass: "registryPackage",
            },
        });
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({
                    ref: targetRelease,
                    archiveDigestSha256: `sha256:${"b".repeat(64)}`,
                    normalizedManifest: targetManifest,
                    collectionContracts: targetContracts,
                }),
                sourceClass: "registryPackage",
            },
        });
        await service.setIntent({
            accountId: ACCOUNT_ID,
            input: {
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "disabled",
                writableCollections: sourceContracts,
                expectedRevision: null,
            },
        });
        const sourceContract = await db.pluginCollectionContract.findFirstOrThrow({
            where: {
                pluginId: PLUGIN_ID,
                collectionId: "tasks",
                schemaVersion: source.schemaVersion,
                contractDigest: source.contractDigest,
            },
            select: { id: true },
        });
        const sourceRows = await Promise.all(["task-a", "task-b"].map(async (rowId) => {
            const row = await db.pluginCollectionRow.create({
                data: {
                    accountId: ACCOUNT_ID,
                    pluginId: PLUGIN_ID,
                    collectionId: "tasks",
                    rowId,
                    schemaVersion: source.schemaVersion,
                    revision: 1,
                    contractId: sourceContract.id,
                    contractDigest: source.contractDigest,
                    contentEnvelope: { t: "plain", v: {} },
                },
                select: { id: true, rowId: true },
            });
            await db.pluginCollectionProjection.createMany({
                data: [
                    { fieldId: "id", typedEncodedValue: JSON.stringify(rowId) },
                    { fieldId: "status", typedEncodedValue: JSON.stringify("open") },
                ].map((projection) => ({
                    ...projection,
                    rowDbId: row.id,
                    accountId: ACCOUNT_ID,
                    pluginId: PLUGIN_ID,
                    collectionId: "tasks",
                    rowId,
                    rowRevision: 1,
                })),
            });
            return row;
        }));
        const binding = {
            source,
            target,
            candidate: { releaseVersion: targetRelease.version, artifactDigest: `sha256:${"a".repeat(64)}` },
        } as const;
        await stagePluginCollectionCandidatePreparation({
            accountId: ACCOUNT_ID,
            request: {
                binding,
                items: [{
                    source: { rowId: sourceRows[0]!.rowId, revision: 1 },
                    target: {
                        content: { t: "plain", v: {} },
                        projection: { id: sourceRows[0]!.rowId, status: "open", title: "A" },
                    },
                }],
            },
        });

        // A stale caller must lose to Availability's currentness contract
        // before Data evaluates whether this incomplete candidate is ready.
        await expect(service.setIntent({
            accountId: ACCOUNT_ID,
            input: {
                pluginId: PLUGIN_ID,
                desiredVersion: targetRelease.version,
                enabled: true,
                offlineUiHosting: "disabled",
                writableCollections: targetContracts,
                expectedRevision: "1",
            },
        })).rejects.toMatchObject({ code: "plugin_intent_revision_conflict" });

        await expect(service.setIntent({
            accountId: ACCOUNT_ID,
            input: {
                pluginId: PLUGIN_ID,
                desiredVersion: targetRelease.version,
                enabled: true,
                offlineUiHosting: "disabled",
                writableCollections: targetContracts,
                expectedRevision: "0",
            },
        })).rejects.toMatchObject({ code: "plugin_intent_writable_collections_not_ready" });
        await expect(db.pluginCollectionRow.findMany({
            where: { accountId: ACCOUNT_ID },
            orderBy: { rowId: "asc" },
            select: { rowId: true, schemaVersion: true, revision: true, contractDigest: true },
        })).resolves.toEqual([
            { rowId: "task-a", schemaVersion: 1, revision: 1, contractDigest: source.contractDigest },
            { rowId: "task-b", schemaVersion: 1, revision: 1, contractDigest: source.contractDigest },
        ]);

        await stagePluginCollectionCandidatePreparation({
            accountId: ACCOUNT_ID,
            request: {
                binding,
                items: [{
                    source: { rowId: sourceRows[1]!.rowId, revision: 1 },
                    target: {
                        content: { t: "plain", v: {} },
                        projection: { id: sourceRows[1]!.rowId, status: "open", title: "B" },
                    },
                }],
            },
        });
        const replacedBinding = {
            ...binding,
            candidate: { ...binding.candidate, artifactDigest: `sha256:${"b".repeat(64)}` },
        } as const;
        for (const row of sourceRows) {
            await stagePluginCollectionCandidatePreparation({
                accountId: ACCOUNT_ID,
                request: {
                    binding: replacedBinding,
                    items: [{
                        source: { rowId: row.rowId, revision: 1 },
                        target: {
                            content: { t: "plain", v: {} },
                            projection: {
                                id: row.rowId,
                                status: "open",
                                title: row.rowId === "task-a" ? "A replacement" : "B replacement",
                            },
                        },
                    }],
                },
            });
        }
        await expect(service.setIntent({
            accountId: ACCOUNT_ID,
            input: {
                pluginId: PLUGIN_ID,
                desiredVersion: targetRelease.version,
                enabled: true,
                offlineUiHosting: "disabled",
                writableCollections: targetContracts,
                expectedRevision: "0",
            },
        })).rejects.toMatchObject({ code: "plugin_intent_writable_collections_not_ready" });
        await expect(db.pluginCollectionRow.findMany({
            where: { accountId: ACCOUNT_ID },
            orderBy: { rowId: "asc" },
            select: { schemaVersion: true, revision: true },
        })).resolves.toEqual([
            { schemaVersion: 1, revision: 1 },
            { schemaVersion: 1, revision: 1 },
        ]);
        await retirePluginCollectionCandidatePreparation({
            accountId: ACCOUNT_ID,
            request: { binding: replacedBinding },
        });
        await expect(service.setIntent({
            accountId: ACCOUNT_ID,
            input: {
                pluginId: PLUGIN_ID,
                desiredVersion: targetRelease.version,
                enabled: true,
                offlineUiHosting: "disabled",
                writableCollections: targetContracts,
                expectedRevision: "0",
            },
        })).resolves.toMatchObject({
            intent: { desiredVersion: targetRelease.version, writableCollections: targetContracts, revision: "1" },
        });
        await expect(db.pluginCollectionRow.findMany({
            where: { accountId: ACCOUNT_ID },
            orderBy: { rowId: "asc" },
            select: { rowId: true, schemaVersion: true, revision: true, contractDigest: true, projections: {
                orderBy: { fieldId: "asc" },
                select: { fieldId: true, typedEncodedValue: true, rowRevision: true },
            } },
        })).resolves.toEqual([
            {
                rowId: "task-a",
                schemaVersion: 2,
                revision: 2,
                contractDigest: target.contractDigest,
                projections: [
                    { fieldId: "id", typedEncodedValue: "\"task-a\"", rowRevision: 2 },
                    { fieldId: "status", typedEncodedValue: "\"open\"", rowRevision: 2 },
                    { fieldId: "title", typedEncodedValue: "\"A\"", rowRevision: 2 },
                ],
            },
            {
                rowId: "task-b",
                schemaVersion: 2,
                revision: 2,
                contractDigest: target.contractDigest,
                projections: [
                    { fieldId: "id", typedEncodedValue: "\"task-b\"", rowRevision: 2 },
                    { fieldId: "status", typedEncodedValue: "\"open\"", rowRevision: 2 },
                    { fieldId: "title", typedEncodedValue: "\"B\"", rowRevision: 2 },
                ],
            },
        ]);
        await expect(db.pluginCollectionCandidatePreparationStage.count({
            where: { accountId: ACCOUNT_ID },
        })).resolves.toBe(0);
    });

    it.each(["plain", "e2ee"] as const)(
        "lists selected Account intent identities in sorted order without fabricating a machine materialization for a %s Account",
        async (encryptionMode) => {
            await seedAccountAndMachine({ encryptionMode });
            const service = operations();
            await service.publishRelease({
                accountId: ACCOUNT_ID,
                input: { facts: releaseFacts(), sourceClass: "registryPackage" },
            });
            await service.publishRelease({
                accountId: ACCOUNT_ID,
                input: {
                    facts: releaseFacts({
                        ref: DISABLED_RELEASE,
                        normalizedManifest: {
                            ...releaseFacts().normalizedManifest,
                            id: DISABLED_PLUGIN_ID,
                        },
                    }),
                    sourceClass: "registryPackage",
                },
            });
            await service.setIntent({
                accountId: ACCOUNT_ID,
                input: {
                    pluginId: PLUGIN_ID,
                    desiredVersion: RELEASE.version,
                    enabled: true,
                    offlineUiHosting: "disabled",
                    writableCollections: [],
                    expectedRevision: null,
                },
            });
            await service.setIntent({
                accountId: ACCOUNT_ID,
                input: {
                    pluginId: DISABLED_PLUGIN_ID,
                    desiredVersion: DISABLED_RELEASE.version,
                    enabled: false,
                    offlineUiHosting: "disabled",
                    writableCollections: [],
                    expectedRevision: null,
                },
            });
            await service.setIntent({
                accountId: ACCOUNT_ID,
                input: {
                    pluginId: "com.acme.unselected",
                    desiredVersion: null,
                    enabled: false,
                    offlineUiHosting: "disabled",
                    writableCollections: [],
                    expectedRevision: null,
                },
            });

            const discovery = await service.listIntentIds({
                accountId: ACCOUNT_ID,
                input: {},
            });
            const materializations = await service.readMaterializations({
                accountId: ACCOUNT_ID,
                input: {},
            });
            const account = await db.account.findUniqueOrThrow({
                where: { id: ACCOUNT_ID },
                select: { seq: true },
            });

            expect(discovery).toEqual({
                availabilityCursor: account.seq,
                pluginIds: [DISABLED_PLUGIN_ID, PLUGIN_ID],
            });
            expect(materializations.snapshots).toEqual([]);
        },
    );

    it("fails closed instead of paginating when selected Account intent discovery exceeds its bounded response", async () => {
        await seedAccountAndMachine();
        await db.accountPluginIntent.createMany({
            data: Array.from({ length: 201 }, (_, index) => ({
                accountId: ACCOUNT_ID,
                pluginId: `com.acme.intent-limit-${String(index).padStart(3, "0")}`,
                desiredVersion: "1.2.3",
                enabled: false,
                offlineUiHosting: "disabled",
                writableCollections: [],
            })),
        });

        await expect(operations().listIntentIds({
            accountId: ACCOUNT_ID,
            input: {},
        })).rejects.toMatchObject({
            code: "plugin_availability_intent_discovery_limit_exceeded",
        });
    });

    it("replaces only a newer complete machine inventory and retains the high-watermark for an accepted empty snapshot", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const materialization = {
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId: MACHINE_ID,
            materializationId: "install-epoch-1",
            pluginId: PLUGIN_ID,
            version: RELEASE.version,
            sourceClass: "registryPackage" as const,
            portableRelease: true,
            uiArtifacts: [],
            enabled: true,
            trustState: "trusted" as const,
            observedAt: 1_700_000_000_000,
        };
        const first = {
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId: MACHINE_ID,
            revision: 1,
            materializations: [materialization],
        };

        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: { snapshot: first },
        })).resolves.toMatchObject({ outcome: "replaced" });
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: { snapshot: first },
        })).resolves.toMatchObject({ outcome: "rejoined" });
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: {
                snapshot: {
                    ...first,
                    revision: 1,
                    materializations: [{ ...materialization, version: "1.2.4" }],
                },
            },
        })).rejects.toMatchObject({
            code: "plugin_materialization_snapshot_conflict",
        });
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: {
                snapshot: {
                    serverIdentityId: SERVER_IDENTITY_ID,
                    machineId: MACHINE_ID,
                    revision: 2,
                    materializations: [],
                },
            },
        })).resolves.toMatchObject({ outcome: "replaced" });

        await expect(db.machine.findUnique({
            where: { id: MACHINE_ID },
            select: { pluginMaterializationRevision: true },
        })).resolves.toEqual({ pluginMaterializationRevision: BigInt(2) });
        await expect(db.pluginMachineMaterialization.count({ where: { accountId: ACCOUNT_ID } })).resolves.toBe(0);
    });

    it("deletes source and catalog status only for a materialization removed by an accepted snapshot replacement", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const removedMaterializationId = "install-epoch-removed";
        const retainedMaterializationId = "install-epoch-retained";
        const materialization = (input: Readonly<{
            materializationId: string;
            pluginId: string;
        }>) => ({
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId: MACHINE_ID,
            materializationId: input.materializationId,
            pluginId: input.pluginId,
            version: RELEASE.version,
            sourceClass: "registryPackage" as const,
            portableRelease: true,
            uiArtifacts: [],
            enabled: true,
            trustState: "trusted" as const,
            observedAt: 1_700_000_000_000,
        });
        const removed = materialization({
            materializationId: removedMaterializationId,
            pluginId: PLUGIN_ID,
        });
        const retained = materialization({
            materializationId: retainedMaterializationId,
            pluginId: DISABLED_PLUGIN_ID,
        });
        await service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: {
                snapshot: {
                    serverIdentityId: SERVER_IDENTITY_ID,
                    machineId: MACHINE_ID,
                    revision: 1,
                    materializations: [removed, retained],
                },
            },
        });

        const triggerIds = ["removed-materialization-trigger", "retained-materialization-trigger"];
        await db.automation.create({
            data: {
                id: "materialization-status-automation",
                accountId: ACCOUNT_ID,
                name: "Materialization status lifecycle",
                enabled: true,
                targetType: "new_session",
                templateCiphertext: "{}",
                templateVersion: 1,
                triggers: {
                    create: triggerIds.map((id, index) => ({
                        id,
                        kind: "pluginEvent" as const,
                        enabled: true,
                        revision: 0,
                        eventPluginId: index === 0 ? PLUGIN_ID : DISABLED_PLUGIN_ID,
                        eventLocalId: "fixture-event",
                        sourceSelectorId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                        sourceContractVersion: 1,
                        observationTransport: "checkpointedPull" as const,
                        watcherMachineId: MACHINE_ID,
                        watcherMachineInstallationId: "machine-installation-availability",
                        watcherPluginId: index === 0 ? PLUGIN_ID : DISABLED_PLUGIN_ID,
                        watcherMaterializationId: index === 0
                            ? removedMaterializationId
                            : retainedMaterializationId,
                        definitionEnvelope: "{}",
                    })),
                },
            },
        });
        for (const [index, materializationId] of [
            removedMaterializationId,
            retainedMaterializationId,
        ].entries()) {
            const eventPluginId = index === 0 ? PLUGIN_ID : DISABLED_PLUGIN_ID;
            await db.automationEventSourceStatus.create({
                data: {
                    triggerId: triggerIds[index]!,
                    eventPluginId,
                    eventLocalId: "fixture-event",
                    sourceSelectorId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                    triggerRevision: 0,
                    reporterMachineId: MACHINE_ID,
                    reporterMachineInstallationId: "machine-installation-availability",
                    reporterMaterializationId: materializationId,
                    reporterImmutableGenerationId: `generation-${index}`,
                    state: "observing",
                },
            });
            await db.automationEventSourceCatalogStatus.create({
                data: {
                    accountId: ACCOUNT_ID,
                    eventPluginId,
                    reporterMachineId: MACHINE_ID,
                    reporterMachineInstallationId: "machine-installation-availability",
                    reporterMaterializationId: materializationId,
                    reporterImmutableGenerationId: `generation-${index}`,
                    scopeKey: "checkpointedPull",
                    observedRevision: 1n,
                    adoptedRevision: 1n,
                    state: "current",
                    reportedAt: new Date(),
                },
            });
        }

        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: {
                snapshot: {
                    serverIdentityId: SERVER_IDENTITY_ID,
                    machineId: MACHINE_ID,
                    revision: 2,
                    materializations: [retained],
                },
            },
        })).resolves.toMatchObject({ outcome: "replaced" });

        await expect(db.automationEventSourceStatus.findMany({
            select: { reporterMaterializationId: true },
        })).resolves.toEqual([{ reporterMaterializationId: retainedMaterializationId }]);
        await expect(db.automationEventSourceCatalogStatus.findMany({
            select: { reporterMaterializationId: true },
        })).resolves.toEqual([{ reporterMaterializationId: retainedMaterializationId }]);
    });

    it("refuses a machine inventory published by another machine or under another server identity", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const materialization = {
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId: MACHINE_ID,
            materializationId: "install-epoch-1",
            pluginId: PLUGIN_ID,
            version: RELEASE.version,
            sourceClass: "registryPackage" as const,
            portableRelease: true,
            uiArtifacts: [],
            enabled: true,
            trustState: "trusted" as const,
            observedAt: 1_700_000_000_000,
        };
        const snapshot = {
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId: MACHINE_ID,
            revision: 1,
            materializations: [materialization],
        };

        // A machine may only report its own inventory; the authenticated
        // publisher, not the body, decides whose inventory this is.
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: "machine-availability-other",
            input: { snapshot },
        })).rejects.toMatchObject({ code: "plugin_materialization_machine_mismatch" });

        // A server alias change cannot be absorbed silently: portable identity
        // is the server's own, never the reporter's claim.
        const aliasedServerIdentityId = "srv_availabilityAlias000001";
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: {
                snapshot: {
                    ...snapshot,
                    serverIdentityId: aliasedServerIdentityId,
                    materializations: [{ ...materialization, serverIdentityId: aliasedServerIdentityId }],
                },
            },
        })).rejects.toMatchObject({ code: "plugin_materialization_server_identity_mismatch" });

        await expect(db.pluginMachineMaterialization.count()).resolves.toBe(0);
        await expect(db.machine.findUnique({
            where: { id: MACHINE_ID },
            select: { pluginMaterializationRevision: true },
        })).resolves.toEqual({ pluginMaterializationRevision: null });

        // Positive twin: the identical inventory from its own machine under the
        // server's own identity is accepted.
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: { snapshot },
        })).resolves.toMatchObject({ outcome: "replaced" });
        await expect(db.pluginMachineMaterialization.count()).resolves.toBe(1);
    });

    it("refuses an inventory body that names a sibling machine of the same Account", async () => {
        await seedAccountAndMachine();
        const SIBLING_MACHINE_ID = "machine-plugin-availability-sibling";
        await db.machine.create({
            data: {
                id: SIBLING_MACHINE_ID,
                accountId: ACCOUNT_ID,
                metadata: "{}",
                installationId: "machine-installation-availability-sibling",
            },
        });
        const service = operations();
        const materializationFor = (machineId: string) => ({
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId,
            materializationId: `install-epoch-${machineId}`,
            pluginId: PLUGIN_ID,
            version: RELEASE.version,
            sourceClass: "registryPackage" as const,
            portableRelease: true,
            uiArtifacts: [],
            enabled: true,
            trustState: "trusted" as const,
            observedAt: 1_700_000_000_000,
        });
        const snapshotFor = (machineId: string) => ({
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId,
            revision: 1,
            materializations: [materializationFor(machineId)],
        });

        // The publisher is a real machine of this Account, so the in-transaction
        // ownership lookup cannot catch this: only the body/publisher comparison
        // stops one machine from writing another machine's installation epochs.
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: { snapshot: snapshotFor(SIBLING_MACHINE_ID) },
        })).rejects.toMatchObject({ code: "plugin_materialization_machine_mismatch" });
        await expect(db.pluginMachineMaterialization.count()).resolves.toBe(0);
        await expect(db.machine.findUnique({
            where: { id: MACHINE_ID },
            select: { pluginMaterializationRevision: true },
        })).resolves.toEqual({ pluginMaterializationRevision: null });
        await expect(db.machine.findUnique({
            where: { id: SIBLING_MACHINE_ID },
            select: { pluginMaterializationRevision: true },
        })).resolves.toEqual({ pluginMaterializationRevision: null });

        // Positive twin: each machine may still publish its own inventory, and
        // one machine's report never disturbs the sibling's rows or watermark.
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: SIBLING_MACHINE_ID,
            input: { snapshot: snapshotFor(SIBLING_MACHINE_ID) },
        })).resolves.toMatchObject({ outcome: "replaced" });
        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: { snapshot: snapshotFor(MACHINE_ID) },
        })).resolves.toMatchObject({ outcome: "replaced" });
        await expect(db.pluginMachineMaterialization.count({
            where: { machineId: SIBLING_MACHINE_ID },
        })).resolves.toBe(1);
        await expect(db.pluginMachineMaterialization.count({
            where: { machineId: MACHINE_ID },
        })).resolves.toBe(1);
    });

    it("retains conflicting portable materialization evidence so currentness can reject it visibly", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const facts = releaseFacts();
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts, sourceClass: "registryPackage" },
        });
        const materialization = {
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId: MACHINE_ID,
            materializationId: "install-epoch-1",
            pluginId: PLUGIN_ID,
            version: RELEASE.version,
            sourceClass: "registryPackage" as const,
            portableRelease: true,
            archiveDigestSha256: facts.archiveDigestSha256,
            uiArtifacts: facts.uiSlots.map(({ compatibility: _compatibility, ...slot }) => slot),
            enabled: true,
            trustState: "trusted" as const,
            observedAt: 1_700_000_000_000,
        };

        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: {
                snapshot: {
                    serverIdentityId: SERVER_IDENTITY_ID,
                    machineId: MACHINE_ID,
                    revision: 1,
                    materializations: [{
                        ...materialization,
                        archiveDigestSha256: `sha256:${"c".repeat(64)}`,
                    }],
                },
            },
        })).resolves.toMatchObject({ outcome: "replaced" });
        await expect(db.pluginMachineMaterialization.count({ where: { accountId: ACCOUNT_ID } })).resolves.toBe(1);
        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
                machineId: MACHINE_ID,
                machineInstallationId: "machine-installation-availability",
                materializationId: "install-epoch-1",
            })
        ))).resolves.toEqual({ kind: "notCurrent" });

        await expect(service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: {
                snapshot: {
                    serverIdentityId: SERVER_IDENTITY_ID,
                    machineId: MACHINE_ID,
                    revision: 2,
                    materializations: [materialization],
                },
            },
        })).resolves.toMatchObject({ outcome: "replaced" });
        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                machineInstallationId: "machine-installation-availability",
                materializationId: materialization.materializationId,
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
            })
        ))).resolves.toMatchObject({
            kind: "current",
            materialization: {
                materializationId: materialization.materializationId,
            },
        });
        const read = await service.readMaterializations({ accountId: ACCOUNT_ID, input: {} });
        expect(read).toMatchObject({
            snapshots: [expect.objectContaining({
                revision: 2,
                materializations: [expect.objectContaining({
                    materializationId: materialization.materializationId,
                })],
            })],
        });
        expect(read.snapshots[0]?.materializations[0]).not.toHaveProperty("releaseFacts");
        await expect(db.pluginMachineMaterialization.count({ where: { accountId: ACCOUNT_ID } })).resolves.toBe(1);
    });

    it("admits only the exact current, trusted materialization tuple through one transaction-local owner", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const facts = releaseFacts();
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts, sourceClass: "registryPackage" },
        });
        const snapshot = {
            serverIdentityId: SERVER_IDENTITY_ID,
            machineId: MACHINE_ID,
            revision: 1,
            materializations: [{
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                materializationId: "install-epoch-1",
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
                sourceClass: "registryPackage" as const,
                portableRelease: true,
                archiveDigestSha256: facts.archiveDigestSha256,
                uiArtifacts: facts.uiSlots.map(({ compatibility: _compatibility, ...slot }) => slot),
                enabled: true,
                trustState: "trusted" as const,
                observedAt: 1_700_000_000_000,
            }],
        };
        await service.reportMaterializations({
            accountId: ACCOUNT_ID,
            publisherMachineId: MACHINE_ID,
            input: { snapshot },
        });

        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                machineInstallationId: "machine-installation-availability",
                materializationId: "install-epoch-1",
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
            })
        ))).resolves.toMatchObject({
            kind: "current",
            materialization: {
                materializationId: "install-epoch-1",
                trustState: "trusted",
            },
        });
        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                machineInstallationId: "machine-installation-availability",
                materializationId: "install-epoch-1",
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
                requiredMachineOperationCapability: "pluginWebhookClaim",
            })
        ))).resolves.toEqual({ kind: "notCurrent" });

        await db.machine.update({
            where: { accountId_id: { accountId: ACCOUNT_ID, id: MACHINE_ID } },
            data: {
                operationProtocolCapabilities: {
                    pluginWebhookClaim: { protocolVersions: [1] },
                },
                operationProtocolCapabilitiesRevision: 1,
            },
        });
        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                machineInstallationId: "machine-installation-availability",
                materializationId: "install-epoch-1",
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
                requiredMachineOperationCapability: "pluginWebhookClaim",
            })
        ))).resolves.toMatchObject({
            kind: "current",
            materialization: { materializationId: "install-epoch-1" },
        });
        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                machineInstallationId: "machine-installation-availability",
                materializationId: "install-epoch-1",
                pluginId: PLUGIN_ID,
                version: "1.2.4",
            })
        ))).resolves.toEqual({ kind: "notCurrent" });
        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                machineInstallationId: "stale-machine-installation",
                materializationId: "install-epoch-1",
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
            })
        ))).resolves.toEqual({ kind: "notCurrent" });
        await db.machine.update({
            where: { accountId_id: { accountId: ACCOUNT_ID, id: MACHINE_ID } },
            data: { revokedAt: new Date() },
        });
        await expect(inTx(async (tx) => (
            await resolveCurrentClaimablePluginMachineMaterializationTx({
                tx,
                accountId: ACCOUNT_ID,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: MACHINE_ID,
                machineInstallationId: "machine-installation-availability",
                materializationId: "install-epoch-1",
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
            })
        ))).resolves.toEqual({ kind: "notCurrent" });
    });

    it("publishes and reads one mode-correct generic Artifact through a portable slot plus transient link compatibility", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const { graph, archive } = createBrowserArtifactArchive();
        const slot = {
            ...releaseFacts().uiSlots[0]!,
            artifactDigest: graph.digest,
        };
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({ uiSlots: [slot] }),
                sourceClass: "registryPackage",
            },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        const artifactId = "00000000-0000-4000-8000-000000000001";
        const hostCompatibility = hostedArtifactLinkCompatibility();
        const artifact = {
            header: encodePlainArtifactStoredContent(archive.header),
            body: encodePlainArtifactStoredContent({
                body: encodePluginUiArtifactArchiveBodyV1(archive.body),
            }),
            dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
        };

        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility,
                artifactId,
                artifact: {
                    ...artifact,
                    body: encodePlainArtifactStoredContent({ body: "malformed archive" }),
                },
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_invalid_content" });
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(0);
        await expect(db.artifact.count()).resolves.toBe(0);

        const published = await service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility,
                artifactId,
                artifact,
            },
        });

        expect(published).toMatchObject({
            outcome: "created",
            link: {
                release: RELEASE,
                artifactId,
                compatibility: hostCompatibility,
            },
        });
        await expect(service.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
            },
        })).resolves.toMatchObject({
            link: {
                artifactId,
                compatibility: hostCompatibility,
            },
            artifact: {
                header: artifact.header,
                body: artifact.body,
            },
        });
        await expect(service.readIntent({
            accountId: ACCOUNT_ID,
            input: { pluginId: PLUGIN_ID },
        })).resolves.toMatchObject({
            release: { uiSlots: [slot] },
            uiArtifacts: [{
                release: RELEASE,
                artifactId,
                compatibility: hostCompatibility,
            }],
        });
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(1);
        await expect(db.artifact.count()).resolves.toBe(1);
        await expect(db.accountChange.findMany({
            where: { accountId: ACCOUNT_ID },
            select: { kind: true, entityId: true },
        })).resolves.toEqual([{
            kind: "pluginDomain",
            entityId: `pluginDomain/${PLUGIN_ID}/availability`,
        }]);
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility({ hostUiApiVersion: "2.0.0" }),
                artifactId: "00000000-0000-4000-8000-000000000003",
                artifact,
            },
        })).rejects.toMatchObject({ code: "plugin_release_content_conflict" });
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility,
                artifactId,
                artifact,
            },
        })).resolves.toMatchObject({ outcome: "rejoined", link: { artifactId } });
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: false,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility,
                artifactId: "00000000-0000-4000-8000-000000000002",
                artifact,
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_client_upgrade_required" });
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility,
                artifactId: "00000000-0000-4000-8000-000000000002",
                artifact: {
                    header: Buffer.from([1, 2, 3]).toString("base64"),
                    body: Buffer.from([4, 5, 6]).toString("base64"),
                    dataEncryptionKey: Buffer.from([7, 8, 9]).toString("base64"),
                },
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_conflict" });
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility,
                artifactId: "00000000-0000-4000-8000-000000000002",
                artifact,
            },
        })).resolves.toMatchObject({ outcome: "rejoined", link: { artifactId } });
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility,
                artifactId,
                artifact: {
                    ...artifact,
                    // Same valid logical archive, deliberately encoded with
                    // different stored header bytes: rejoin is byte-exact.
                    header: encodePlainArtifactStoredContent({
                        artifactGraph: archive.header.artifactGraph,
                        title: archive.header.title,
                        kind: archive.header.kind,
                        v: archive.header.v,
                    }),
                },
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_conflict" });
        await expect(db.artifact.count()).resolves.toBe(1);

        await db.accountPluginIntent.update({
            where: {
                accountId_pluginId: {
                    accountId: ACCOUNT_ID,
                    pluginId: PLUGIN_ID,
                },
            },
            data: {
                enabled: false,
                offlineUiHosting: "disabled",
            },
        });
        const exactReadInput = {
            release: RELEASE,
            contributionId: slot.contributionId,
            tier: slot.tier,
            platform: slot.platform,
        } as const;
        await expect(service.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: exactReadInput,
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_hosting_not_opted_in" });
        await expect(service.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                ...exactReadInput,
                purpose: "candidatePreparation",
                expectedArtifactDigest: slot.artifactDigest,
            },
        })).resolves.toMatchObject({
            link: {
                release: RELEASE,
                contributionId: slot.contributionId,
                artifactId,
                artifactDigest: slot.artifactDigest,
            },
        });
        await expect(service.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                ...exactReadInput,
                purpose: "candidatePreparation",
                expectedArtifactDigest: `sha256:${"f".repeat(64)}`,
            },
        })).rejects.toMatchObject({ code: "plugin_release_content_conflict" });
    });

    it("refuses hosted publish and exact read while the operator has not enabled Artifact hosting", async () => {
        await seedAccountAndMachine();
        const hostingEnabled = operations();
        const { graph, archive } = createBrowserArtifactArchive();
        const slot = {
            ...releaseFacts().uiSlots[0]!,
            artifactDigest: graph.digest,
        };
        const hostingDisabled = createPluginAvailabilityOperations({
            resolveHostingCapability: () => ({ enabled: false }),
            resolveServerIdentityId: async () => SERVER_IDENTITY_ID,
        });
        await hostingEnabled.publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({ uiSlots: [slot] }),
                sourceClass: "registryPackage",
            },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        const artifactId = "00000000-0000-4000-8000-000000000009";
        const publishInput = {
            release: RELEASE,
            slot,
            hostCompatibility: hostedArtifactLinkCompatibility(),
            artifactId,
            artifact: {
                header: encodePlainArtifactStoredContent(archive.header),
                body: encodePlainArtifactStoredContent({
                    body: encodePluginUiArtifactArchiveBodyV1(archive.body),
                }),
                dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
            },
        } as const;

        // Present-user hosting intent is enabled; only the operator capability is off.
        await expect(hostingDisabled.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: publishInput,
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_hosting_unsupported" });
        await expect(db.artifact.count()).resolves.toBe(0);
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(0);

        // Positive twin: the identical envelope commits once the operator supports hosting.
        await expect(hostingEnabled.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: publishInput,
        })).resolves.toMatchObject({ outcome: "created", link: { artifactId } });

        const exactReadInput = {
            release: RELEASE,
            contributionId: slot.contributionId,
            tier: slot.tier,
            platform: slot.platform,
        } as const;
        await expect(hostingEnabled.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: exactReadInput,
        })).resolves.toMatchObject({ link: { artifactId } });
        // A committed archive stays behind the same typed unsupported result.
        await expect(hostingDisabled.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: exactReadInput,
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_hosting_unsupported" });
    });

    it("keeps an E2EE UI archive opaque to Availability while exact qualified read and removal use the generic Artifact owner", async () => {
        await seedAccountAndMachine({ encryptionMode: "e2ee" });
        const service = operations();
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: releaseFacts(), sourceClass: "registryPackage" },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        const slot = releaseFacts().uiSlots[0]!;
        const artifact = {
            header: Buffer.from([1, 2, 3]).toString("base64"),
            body: Buffer.from([4, 5, 6]).toString("base64"),
            dataEncryptionKey: Buffer.from([7, 8, 9]).toString("base64"),
        };

        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: "00000000-0000-4000-8000-000000000003",
                artifact,
            },
        })).resolves.toMatchObject({ outcome: "created" });
        await expect(service.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
            },
        })).resolves.toMatchObject({ artifact });
        // Same-ID replay is byte-exact. A fresh publication identity rejoins
        // the classified slot even when the client reseals equivalent bytes.
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: "00000000-0000-4000-8000-000000000003",
                artifact,
            },
        })).resolves.toMatchObject({
            outcome: "rejoined",
            link: { artifactId: "00000000-0000-4000-8000-000000000003" },
        });
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: "00000000-0000-4000-8000-000000000004",
                artifact: {
                    header: Buffer.from([11, 12, 13]).toString("base64"),
                    body: Buffer.from([14, 15, 16]).toString("base64"),
                    dataEncryptionKey: Buffer.from([17, 18, 19]).toString("base64"),
                },
            },
        })).resolves.toMatchObject({
            outcome: "rejoined",
            link: { artifactId: "00000000-0000-4000-8000-000000000003" },
        });
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: "00000000-0000-4000-8000-000000000003",
                artifact: {
                    ...artifact,
                    body: Buffer.from([4, 5, 7]).toString("base64"),
                },
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_conflict" });
        await expect(db.artifact.count()).resolves.toBe(1);
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(1);
        await expect(service.removeUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
            },
        })).resolves.toMatchObject({ removed: true });
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(0);
        await expect(db.artifact.count()).resolves.toBe(0);
        await expect(service.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_not_found" });
    });

    it.each([false, true])("rejects an Artifact id already owned outside the qualified UI slot (occupied: %s)", async (occupied) => {
        await seedAccountAndMachine();
        const service = operations();
        const { graph, archive } = createBrowserArtifactArchive();
        const slot = { ...releaseFacts().uiSlots[0]!, artifactDigest: graph.digest };
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: releaseFacts({ uiSlots: [slot] }), sourceClass: "registryPackage" },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        const artifactId = "00000000-0000-4000-8000-000000000019";
        await db.artifact.create({
            data: {
                id: artifactId,
                accountId: ACCOUNT_ID,
                header: Buffer.from([1]),
                headerVersion: 1,
                body: Buffer.from([2]),
                bodyVersion: 1,
                dataEncryptionKey: Buffer.from([3]),
                seq: 0,
            },
        });
        if (occupied) {
            await service.publishUiArtifact({
                accountId: ACCOUNT_ID,
                supportsCurrentStoredContentProtocol: true,
                input: {
                    release: RELEASE,
                    slot,
                    hostCompatibility: hostedArtifactLinkCompatibility(),
                    artifactId: "00000000-0000-4000-8000-000000000020",
                    artifact: {
                        header: encodePlainArtifactStoredContent(archive.header),
                        body: encodePlainArtifactStoredContent({ body: encodePluginUiArtifactArchiveBodyV1(archive.body) }),
                        dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                    },
                },
            });
        }
        await expect(service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId,
                artifact: {
                    header: encodePlainArtifactStoredContent(archive.header),
                    body: encodePlainArtifactStoredContent({
                        body: encodePluginUiArtifactArchiveBodyV1(archive.body),
                    }),
                    dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                },
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_conflict" });
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(occupied ? 1 : 0);
        await expect(db.artifact.count()).resolves.toBe(occupied ? 2 : 1);
    });

    it.each([false, true])("rechecks current hosting intent when recovering a slot uniqueness race (withdrawn: %s)", async (withdrawn) => {
        await seedAccountAndMachine();
        const service = operations();
        const fixture = createHostedReleaseFixture({ version: RELEASE.version, ordinal: 1 });
        await publishHostedRelease(service, fixture);
        await selectHostedRelease(service, fixture, null);
        const request = {
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: fixture.ref,
                slot: fixture.slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: fixture.uiArtifactId,
                artifact: fixture.uiArtifact,
            },
        };
        // Inject the database's losing-writer outcome after another real
        // transaction commits the winner; internal Availability logic is real.
        const runTransaction = db.$transaction;
        const losingTransaction = vi.fn(runTransaction).mockImplementationOnce(async () => {
            await service.publishUiArtifact(request);
            if (withdrawn) {
                await db.accountPluginIntent.update({
                    where: { accountId_pluginId: { accountId: ACCOUNT_ID, pluginId: PLUGIN_ID } },
                    data: { offlineUiHosting: "disabled" },
                });
            }
            throw Object.assign(new Error("Unique slot conflict"), { code: "P2002" });
        });
        // The DB adapter's generic overloads are lost by Vitest's mock type.
        db.$transaction = losingTransaction as unknown as typeof db.$transaction;
        try {
            const retry = service.publishUiArtifact({
                ...request,
                input: { ...request.input, artifactId: "00000000-0000-4000-8000-000000000099" },
            });
            if (withdrawn) {
                await expect(retry).rejects.toMatchObject({ code: "plugin_ui_artifact_hosting_not_opted_in" });
            } else {
                await expect(retry).resolves.toMatchObject({ outcome: "rejoined", link: { artifactId: fixture.uiArtifactId } });
            }
            await expect(db.artifact.count()).resolves.toBe(1);
            await expect(db.accountPluginUiArtifact.count()).resolves.toBe(1);
        } finally {
            db.$transaction = runTransaction;
        }
    });

    it("publishes and rereads the exact release-declared package Asset archive through one protected Artifact link", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const manifest = {
            schemaVersion: 2,
            id: PLUGIN_ID,
            version: RELEASE.version,
            displayName: "Availability fixture",
            engines: { happier: "^1.0.0" },
            runtime: { apiVersion: 1 },
            contributes: {
                resources: [{
                    id: "brand-icon",
                    kind: "asset",
                    path: "assets/brand.png",
                    contentType: "image/png",
                }],
            },
        };
        const archive = createPackageAssetArchiveV1({
            manifest,
            files: [{
                path: "assets/brand.png",
                bytes: new Uint8Array([137, 80, 78, 71]),
            }],
        });
        if (!archive) throw new Error("Expected package Asset archive fixture");
        const facts = releaseFacts({
            normalizedManifest: manifest,
            packageAssetArchive: archive.descriptor,
        });
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts, sourceClass: "registryPackage" },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        const artifactId = "00000000-0000-4000-8000-000000000004";
        const artifact = {
            header: encodePlainArtifactStoredContent(archive.header),
            body: encodePlainArtifactStoredContent({
                body: encodePackageAssetArchiveBodyV1(archive.body),
            }),
            dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
        };
        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: { release: RELEASE, artifactId, artifact },
        })).resolves.toMatchObject({
            outcome: "created",
            link: {
                release: RELEASE,
                artifactId,
                descriptor: archive.descriptor,
            },
        });
        await expect(service.readPackageAsset({
            accountId: ACCOUNT_ID,
            input: { release: RELEASE },
        })).resolves.toMatchObject({
            link: {
                release: RELEASE,
                artifactId,
                descriptor: archive.descriptor,
            },
            artifact,
        });
        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: { release: RELEASE, artifactId, artifact },
        })).resolves.toMatchObject({ outcome: "rejoined" });
        // A fresh publisher rejoins the immutable release link without
        // repointing it or persisting another Artifact.
        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                artifactId: "00000000-0000-4000-8000-000000000005",
                artifact,
            },
        })).resolves.toMatchObject({ outcome: "rejoined", link: { artifactId } });
        expect(await db.artifact.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);
        await expect(service.readIntent({ accountId: ACCOUNT_ID, input: { pluginId: PLUGIN_ID } }))
            .resolves.toMatchObject({ packageAssets: [{ release: RELEASE, artifactId, descriptor: archive.descriptor }] });
        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                artifactId: "00000000-0000-4000-8000-000000000005",
                artifact: { ...artifact, body: encodePlainArtifactStoredContent({ body: "different bytes" }) },
            },
        })).rejects.toMatchObject({ code: "plugin_package_asset_invalid_content" });
        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                artifactId,
                artifact: {
                    ...artifact,
                    body: encodePlainArtifactStoredContent({ body: "different bytes" }),
                },
            },
        })).rejects.toMatchObject({ code: "plugin_package_asset_conflict" });

        await db.accountPluginIntent.update({
            where: { accountId_pluginId: { accountId: ACCOUNT_ID, pluginId: PLUGIN_ID } },
            data: { enabled: false },
        });
        await expect(service.readPackageAsset({
            accountId: ACCOUNT_ID,
            input: { release: RELEASE },
        })).rejects.toMatchObject({
            code: "plugin_package_asset_hosting_not_opted_in",
        });
        await expect(service.removePackageAsset({ accountId: "another-account", input: { release: RELEASE } }))
            .rejects.toMatchObject({ code: "plugin_package_asset_not_found" });
        await expect(service.removePackageAsset({ accountId: ACCOUNT_ID, input: { release: RELEASE } }))
            .resolves.toMatchObject({ removed: true, link: { artifactId } });
        expect(await db.artifact.count({ where: { accountId: ACCOUNT_ID } })).toBe(0);
        expect(await db.accountPluginRelease.findFirst({ where: { accountId: ACCOUNT_ID } }))
            .toMatchObject({ packageAssetArtifactId: null });
    });

    it("keeps package Asset archive bytes opaque for E2EE Accounts while currentness remains server-owned", async () => {
        await seedAccountAndMachine({ encryptionMode: "e2ee" });
        const service = operations();
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: releaseFacts(), sourceClass: "registryPackage" },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        const artifact = {
            header: Buffer.from([1, 2, 3]).toString("base64"),
            body: Buffer.from([4, 5, 6]).toString("base64"),
            dataEncryptionKey: Buffer.from([7, 8, 9]).toString("base64"),
        };

        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                artifactId: "00000000-0000-4000-8000-000000000005",
                artifact,
            },
        })).resolves.toMatchObject({ outcome: "created" });
        await expect(service.readPackageAsset({
            accountId: ACCOUNT_ID,
            input: { release: RELEASE },
        })).resolves.toMatchObject({ artifact });
        const freshArtifact = {
            header: Buffer.from([11, 12, 13]).toString("base64"),
            body: Buffer.from([14, 15, 16]).toString("base64"),
            dataEncryptionKey: Buffer.from([17, 18, 19]).toString("base64"),
        };
        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: { release: RELEASE, artifactId: "00000000-0000-4000-8000-000000000006", artifact: freshArtifact },
        })).resolves.toMatchObject({ outcome: "rejoined", link: { artifactId: "00000000-0000-4000-8000-000000000005" } });
        expect(await db.artifact.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);
        await expect(service.readPackageAsset({ accountId: ACCOUNT_ID, input: { release: RELEASE } }))
            .resolves.toMatchObject({ artifact });
        await expect(service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                artifactId: "00000000-0000-4000-8000-000000000006",
                artifact: {
                    header: encodePlainArtifactStoredContent({ title: "wrong mode" }),
                    body: encodePlainArtifactStoredContent({ body: "wrong mode" }),
                    dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                },
            },
        })).rejects.toMatchObject({ code: "plugin_package_asset_conflict" });
    });

    it("keeps unchanged-Collection release metadata while retaining hosted archives only for selected and prior across A -> B -> C", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const fixtures = ["1.0.0", "2.0.0", "3.0.0"].map((version, index) => (
            createHostedReleaseFixture({
                version,
                ordinal: index + 1,
                includeCollection: true,
            })
        ));
        for (const [index, fixture] of fixtures.entries()) {
            await publishHostedRelease(service, fixture);
            if (index === 0) {
                const contract = await db.pluginCollectionContract.findFirstOrThrow({
                    where: {
                        pluginId: PLUGIN_ID,
                        collectionId: "tasks",
                        schemaVersion: 1,
                        contractDigest: fixture.collectionContracts[0]!.contractDigest,
                    },
                    select: { id: true },
                });
                await db.pluginCollectionRow.create({
                    data: {
                        accountId: ACCOUNT_ID,
                        pluginId: PLUGIN_ID,
                        collectionId: "tasks",
                        rowId: "retained-task",
                        schemaVersion: 1,
                        revision: 1,
                        contractId: contract.id,
                        contractDigest: fixture.collectionContracts[0]!.contractDigest,
                        contentEnvelope: {
                            t: "plain",
                            v: { id: "retained-task", status: "open" },
                        },
                    },
                });
            }
            await selectHostedRelease(
                service,
                fixture,
                index === 0 ? null : String(index - 1),
            );
            await hostReleaseArchives(service, fixture);
        }

        await expect(db.accountPluginRelease.findMany({
            where: { accountId: ACCOUNT_ID, pluginId: PLUGIN_ID },
            select: {
                version: true,
                packageAssetArtifactId: true,
                uiArtifacts: { select: { artifactId: true } },
            },
            orderBy: { version: "asc" },
        })).resolves.toEqual([
            { version: "1.0.0", packageAssetArtifactId: null, uiArtifacts: [] },
            {
                version: "2.0.0",
                packageAssetArtifactId: fixtures[1]!.packageArtifactId,
                uiArtifacts: [{ artifactId: fixtures[1]!.uiArtifactId }],
            },
            {
                version: "3.0.0",
                packageAssetArtifactId: fixtures[2]!.packageArtifactId,
                uiArtifacts: [{ artifactId: fixtures[2]!.uiArtifactId }],
            },
        ]);
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(2);
        await expect(db.artifact.count({ where: { accountId: ACCOUNT_ID } })).resolves.toBe(4);
    });

    it("prunes hosted archives independently of nonmonotonic release creation order", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const fixtures = new Map(
            ["2.0.0", "1.0.0", "3.0.0"].map((version, index) => {
                const fixture = createHostedReleaseFixture({
                    version,
                    ordinal: index + 4,
                });
                return [version, fixture] as const;
            }),
        );
        for (const fixture of fixtures.values()) {
            await publishHostedRelease(service, fixture);
        }
        for (const [index, version] of ["1.0.0", "2.0.0", "3.0.0"].entries()) {
            const fixture = fixtures.get(version);
            if (!fixture) throw new Error(`Missing ${version} fixture`);
            await selectHostedRelease(
                service,
                fixture,
                index === 0 ? null : String(index - 1),
            );
            await hostReleaseArchives(service, fixture);
        }

        const first = fixtures.get("1.0.0")!;
        const second = fixtures.get("2.0.0")!;
        const third = fixtures.get("3.0.0")!;
        await expect(db.accountPluginRelease.findMany({
            where: { accountId: ACCOUNT_ID, pluginId: PLUGIN_ID },
            select: {
                version: true,
                packageAssetArtifactId: true,
                uiArtifacts: { select: { artifactId: true } },
            },
            orderBy: { version: "asc" },
        })).resolves.toEqual([
            { version: "1.0.0", packageAssetArtifactId: null, uiArtifacts: [] },
            {
                version: "2.0.0",
                packageAssetArtifactId: second.packageArtifactId,
                uiArtifacts: [{ artifactId: second.uiArtifactId }],
            },
            {
                version: "3.0.0",
                packageAssetArtifactId: third.packageArtifactId,
                uiArtifacts: [{ artifactId: third.uiArtifactId }],
            },
        ]);
        await expect(db.artifact.findMany({
            where: { accountId: ACCOUNT_ID },
            select: { id: true },
            orderBy: { id: "asc" },
        })).resolves.toEqual([
            second.uiArtifactId,
            second.packageArtifactId,
            third.uiArtifactId,
            third.packageArtifactId,
        ].sort().map((id) => ({ id })));
        expect(first.uiArtifactId).not.toBe(second.uiArtifactId);
    });

    it("retains immutable release facts after archive pruning so an old coordinate can only rejoin", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const fixtures = [1, 2, 3].map((ordinal) => createHostedReleaseFixture({
            version: `${ordinal}.0.0`,
            ordinal: ordinal + 3,
        }));
        for (const [index, fixture] of fixtures.entries()) {
            await publishHostedRelease(service, fixture);
            await selectHostedRelease(service, fixture, index === 0 ? null : String(index - 1));
            await hostReleaseArchives(service, fixture);
        }

        const first = fixtures[0]!;
        await expect(service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: first.facts, sourceClass: "registryPackage" },
        })).resolves.toMatchObject({ outcome: "rejoined" });
        const changedFirst = createHostedReleaseFixture({ version: "1.0.0", ordinal: 9 });
        await expect(service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts: changedFirst.facts, sourceClass: "registryPackage" },
        })).rejects.toMatchObject({ code: "plugin_release_content_conflict" });
    });

    it("does not prune retained archives after the persisted Account mode stops matching their marker", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const fixtures = [1, 2, 3].map((ordinal) => createHostedReleaseFixture({
            version: `${ordinal}.0.0`,
            ordinal,
        }));
        for (const [index, fixture] of fixtures.entries()) {
            await publishHostedRelease(service, fixture);
            if (index < 2) {
                await selectHostedRelease(
                    service,
                    fixture,
                    index === 0 ? null : "0",
                );
                await hostReleaseArchives(service, fixture);
            }
        }
        await db.account.update({
            where: { id: ACCOUNT_ID },
            data: {
                encryptionMode: "e2ee",
                ...createSignedAccountContentBinding(),
            },
        });

        await expect(selectHostedRelease(service, fixtures[2]!, "1"))
            .rejects.toMatchObject({
                code: "plugin_package_asset_invalid_content",
            });

        await expect(db.accountPluginIntent.findUnique({
            where: {
                accountId_pluginId: {
                    accountId: ACCOUNT_ID,
                    pluginId: PLUGIN_ID,
                },
            },
            select: { desiredVersion: true, revision: true },
        })).resolves.toMatchObject({ desiredVersion: "2.0.0", revision: BigInt(1) });
        await expect(db.artifact.count({ where: { accountId: ACCOUNT_ID } }))
            .resolves.toBe(4);
        await expect(db.accountPluginUiArtifact.count()).resolves.toBe(2);
    });

    it("rejects qualified hosted reads when stored Artifact representation disagrees with Account mode", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const fixture = createHostedReleaseFixture({ version: "1.0.0", ordinal: 4 });
        await publishHostedRelease(service, fixture);
        await selectHostedRelease(service, fixture, null);
        await hostReleaseArchives(service, fixture);

        await db.artifact.updateMany({
            where: {
                accountId: ACCOUNT_ID,
                id: { in: [fixture.uiArtifactId, fixture.packageArtifactId] },
            },
            data: { dataEncryptionKey: Buffer.from([1, 2, 3]) },
        });

        const slot = fixture.facts.uiSlots[0]!;
        await expect(service.readUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                release: fixture.ref,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_invalid_content" });
        await expect(service.readPackageAsset({
            accountId: ACCOUNT_ID,
            input: { release: fixture.ref },
        })).rejects.toMatchObject({ code: "plugin_package_asset_invalid_content" });
    });

    it("keeps qualified links and Artifact content when removal finds a persisted mode mismatch", async () => {
        await seedAccountAndMachine({ encryptionMode: "e2ee" });
        const service = operations();
        const facts = releaseFacts();
        const slot = facts.uiSlots[0]!;
        const uiArtifactId = "00000000-0000-4000-8000-000000000081";
        const packageArtifactId = "00000000-0000-4000-8000-000000000082";
        const encryptedArtifact = {
            header: Buffer.from([1, 2, 3]).toString("base64"),
            body: Buffer.from([4, 5, 6]).toString("base64"),
            dataEncryptionKey: Buffer.from([7, 8, 9]).toString("base64"),
        };
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: { facts, sourceClass: "registryPackage" },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        await service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: uiArtifactId,
                artifact: encryptedArtifact,
            },
        });
        await service.publishPackageAsset({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                artifactId: packageArtifactId,
                artifact: encryptedArtifact,
            },
        });
        await db.artifact.updateMany({
            where: { id: { in: [uiArtifactId, packageArtifactId] } },
            data: {
                dataEncryptionKey: Buffer.from(
                    ARTIFACT_PLAIN_DATA_KEY_MARKER,
                    "base64",
                ),
            },
        });

        await expect(service.removePackageAsset({
            accountId: ACCOUNT_ID,
            input: { release: RELEASE },
        })).rejects.toMatchObject({ code: "plugin_package_asset_invalid_content" });
        await expect(service.removeUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
            },
        })).rejects.toMatchObject({ code: "plugin_ui_artifact_invalid_content" });

        const retainedArtifacts = await db.artifact.findMany({
            where: { id: { in: [uiArtifactId, packageArtifactId] } },
            select: { id: true, header: true, body: true },
            orderBy: { id: "asc" },
        });
        expect(retainedArtifacts).toHaveLength(2);
        expect(retainedArtifacts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: uiArtifactId,
                header: Buffer.from([1, 2, 3]),
                body: Buffer.from([4, 5, 6]),
            }),
            expect.objectContaining({
                id: packageArtifactId,
                header: Buffer.from([1, 2, 3]),
                body: Buffer.from([4, 5, 6]),
            }),
        ]));
        await expect(db.accountPluginUiArtifact.count({
            where: { artifactId: uiArtifactId },
        })).resolves.toBe(1);
        await expect(db.accountPluginRelease.findFirst({
            where: { accountId: ACCOUNT_ID, pluginId: PLUGIN_ID },
            select: { packageAssetArtifactId: true },
        })).resolves.toMatchObject({
            packageAssetArtifactId: packageArtifactId,
        });
    });

    it("keeps the captured prior-version archives when a later intent mutation stays on the selected version", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const first = createHostedReleaseFixture({ version: "1.0.0", ordinal: 7 });
        const second = createHostedReleaseFixture({ version: "2.0.0", ordinal: 8 });

        await publishHostedRelease(service, first);
        await selectHostedRelease(service, first, null);
        await hostReleaseArchives(service, first);
        await publishHostedRelease(service, second);
        await selectHostedRelease(service, second, "0");
        await hostReleaseArchives(service, second);

        await service.setIntent({
            accountId: ACCOUNT_ID,
            input: {
                pluginId: PLUGIN_ID,
                desiredVersion: second.ref.version,
                enabled: false,
                offlineUiHosting: "enabled",
                writableCollections: second.collectionContracts,
                expectedRevision: "1",
            },
        });

        await expect(db.accountPluginRelease.findMany({
            where: { accountId: ACCOUNT_ID, pluginId: PLUGIN_ID },
            select: {
                version: true,
                packageAssetArtifactId: true,
                uiArtifacts: { select: { artifactId: true } },
            },
            orderBy: { version: "asc" },
        })).resolves.toEqual([
            {
                version: first.ref.version,
                packageAssetArtifactId: first.packageArtifactId,
                uiArtifacts: [{ artifactId: first.uiArtifactId }],
            },
            {
                version: second.ref.version,
                packageAssetArtifactId: second.packageArtifactId,
                uiArtifacts: [{ artifactId: second.uiArtifactId }],
            },
        ]);
    });

    it("fails closed for a selected pre-feature release without an immutable package Asset descriptor", async () => {
        await seedAccountAndMachine();
        const service = operations();
        const legacyFacts = releaseFacts();
        await db.accountPluginRelease.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                version: RELEASE.version,
                archiveDigestSha256: legacyFacts.archiveDigestSha256,
                normalizedManifest: legacyFacts.normalizedManifest,
                collectionContracts: legacyFacts.collectionContracts,
                uiSlots: legacyFacts.uiSlots,
                packageAssetArchive: null,
            },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });

        await expect(service.readIntent({
            accountId: ACCOUNT_ID,
            input: { pluginId: PLUGIN_ID },
        })).resolves.toMatchObject({
            release: null,
            uiArtifacts: [],
        });
        await expect(service.readPackageAsset({
            accountId: ACCOUNT_ID,
            input: { release: RELEASE },
        })).rejects.toMatchObject({
            code: "plugin_package_asset_not_found",
        });
    });

    it("issues a browser frame only for the current plain exact Artifact graph", async () => {
        await seedAccountAndMachine();
        harness.resetEnv({
            HAPPIER_PLUGIN_UI_ARTIFACT_BROWSER_ORIGIN: "https://artifacts.happier.test",
            HAPPIER_WEBAPP_URL: "https://app.happier.test/base",
        });
        const service = operations();
        const { graph, archive, moduleBytes } = createBrowserArtifactArchive();
        const slot = {
            ...releaseFacts().uiSlots[0]!,
            artifactDigest: graph.digest,
        };
        await service.publishRelease({
            accountId: ACCOUNT_ID,
            input: {
                facts: releaseFacts({ uiSlots: [slot] }),
                sourceClass: "registryPackage",
            },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: ACCOUNT_ID,
                pluginId: PLUGIN_ID,
                desiredVersion: RELEASE.version,
                enabled: true,
                offlineUiHosting: "enabled",
                writableCollections: [],
                revision: BigInt(1),
            },
        });
        await service.publishUiArtifact({
            accountId: ACCOUNT_ID,
            supportsCurrentStoredContentProtocol: true,
            input: {
                release: RELEASE,
                slot,
                hostCompatibility: hostedArtifactLinkCompatibility(),
                artifactId: "00000000-0000-4000-8000-000000000004",
                artifact: {
                    header: encodePlainArtifactStoredContent(archive.header),
                    body: encodePlainArtifactStoredContent({
                        body: encodePluginUiArtifactArchiveBodyV1(archive.body),
                    }),
                    dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                },
            },
        });

        const issued = await service.issueBrowserArtifactFrame({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
                expectedArtifactDigest: graph.digest,
            },
        });
        expect(issued).toMatchObject({
            url: expect.stringMatching(/^https:\/\/artifacts\.happier\.test\/v1\/plugins\/availability\/ui-artifacts\/browser\/hwb1\./u),
            expiresAt: expect.any(Number),
        });
        const capability = new URL(issued.url).pathname
            .split("/")
            .filter(Boolean)
            .pop();
        if (!capability) throw new Error("Expected browser Artifact capability path");

        const served = await service.readBrowserArtifactFrame({
            capability,
            requestPath: "assets/app.js",
            request: {
                protocol: "https",
                host: "artifacts.happier.test",
            },
        });
        expect(new TextDecoder().decode(served.bytes)).toBe(
            new TextDecoder().decode(moduleBytes),
        );
        expect(served).toMatchObject({
            contentType: "text/javascript; charset=utf-8",
            headers: expect.objectContaining({
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
            }),
        });

        await service.removeUiArtifact({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
            },
        });
        await expect(service.readBrowserArtifactFrame({
            capability,
            requestPath: "assets/app.js",
            request: {
                protocol: "https",
                host: "artifacts.happier.test",
            },
        })).rejects.toMatchObject({
            code: "plugin_ui_artifact_not_found",
        });
    });

    it("returns the exact typed browser-unavailable result for an E2EE Account before opening archive bytes", async () => {
        await seedAccountAndMachine({ encryptionMode: "e2ee" });
        const service = operations();
        const slot = releaseFacts().uiSlots[0]!;

        await expect(service.issueBrowserArtifactFrame({
            accountId: ACCOUNT_ID,
            input: {
                release: RELEASE,
                contributionId: slot.contributionId,
                tier: slot.tier,
                platform: slot.platform,
                expectedArtifactDigest: slot.artifactDigest,
            },
        })).rejects.toMatchObject({
            code: "plugin_ui_artifact_browser_e2ee_unavailable",
        });
    });
});
