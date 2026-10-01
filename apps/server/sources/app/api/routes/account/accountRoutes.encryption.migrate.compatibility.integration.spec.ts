import Fastify from "fastify";
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import {
    serializerCompiler,
    validatorCompiler,
    ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
    ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER,
    CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
    sealPluginCollectionPrivatePayloadV1,
} from "@happier-dev/protocol";

import { enableErrorHandlers } from "@/app/api/utils/enableErrorHandlers";
import {
    captureAccountStoredContentCompatibilityForHttpRequest,
} from "@/app/clientCompatibility/accountStoredContentCompatibility";
import { deriveAccountEncryptionMigrationKeyFingerprints } from "@/app/encryption/accountEncryptionTransition";
import {
    materializePluginCollectionContractsFromManifestTx,
} from "@/app/plugins/data/collections/contracts";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import {
    createLightSqliteHarness,
    type LightSqliteHarness,
} from "@/testkit/lightSqliteHarness";
import { createSignedAccountContentBinding } from "@/testkit/accountEncryption";
import { registerAccountEncryptionMigrateRoutes } from "./registerAccountEncryptionMigrateRoutes";

// Exact request shape observed in ../0.2 at
// 17ba05df68d4d3d4cad1c1241b58e63805db37ed, account/encryptionMigrate.ts.
// The supported upgrade retains its data, with all components updated together.
const PREDECESSOR_REQUEST = {
    toMode: "plain",
    expectedSettingsVersion: 0,
    settingsContent: null,
    connectedServices: { action: "assert_empty" },
    automations: { action: "assert_empty" },
} as const;

const COLLECTION_BLOCKER_PLUGIN_ID = "compat.predecessor-live-collection";
const COLLECTION_BLOCKER_COLLECTION_ID = "private-items";

const COLLECTION_BLOCKER_MANIFEST = {
    schemaVersion: 2,
    id: COLLECTION_BLOCKER_PLUGIN_ID,
    version: "1.0.0",
    displayName: "Predecessor compatibility Collection fixture",
    engines: { happier: "^1.0.0" },
    runtime: { apiVersion: 1 },
    contributes: {
        accountCollections: [{
            id: COLLECTION_BLOCKER_COLLECTION_ID,
            schemaVersion: 1,
            schema: {
                type: "object",
                properties: {
                    id: { type: "string", maxLength: 256 },
                    status: { type: "string", enum: ["open", "closed"] },
                },
                required: ["id", "status"],
                additionalProperties: false,
            },
            serverReadable: ["status"],
            indexes: [],
        }],
    },
} as const;

async function createLiveCollectionBlocker(accountId: string) {
    const [ref] = await inTx(async (tx) => (
        await materializePluginCollectionContractsFromManifestTx({
            tx,
            manifest: COLLECTION_BLOCKER_MANIFEST,
        })
    ));
    if (!ref) throw new Error("Expected a fixture Collection contract.");
    const contract = await db.pluginCollectionContract.findFirstOrThrow({
        where: {
            pluginId: ref.pluginId,
            collectionId: ref.collectionId,
            schemaVersion: ref.schemaVersion,
            contractDigest: ref.contractDigest,
        },
        select: { id: true, contractDigest: true },
    });
    const row = await db.pluginCollectionRow.create({
        data: {
            accountId,
            pluginId: COLLECTION_BLOCKER_PLUGIN_ID,
            collectionId: COLLECTION_BLOCKER_COLLECTION_ID,
            rowId: "private-row",
            schemaVersion: 1,
            revision: 7,
            contractId: contract.id,
            contractDigest: contract.contractDigest,
            contentEnvelope: {
                t: "encrypted",
                c: sealPluginCollectionPrivatePayloadV1({
                    material: {
                        type: "legacy",
                        secret: new Uint8Array(32).fill(19),
                    },
                    payload: { privateNote: "predecessor collection" },
                    randomBytes: (length) =>
                        new Uint8Array(length).fill(23),
                }),
            },
        },
    });
    await db.pluginCollectionProjection.create({
        data: {
            rowDbId: row.id,
            accountId,
            pluginId: COLLECTION_BLOCKER_PLUGIN_ID,
            collectionId: COLLECTION_BLOCKER_COLLECTION_ID,
            rowId: "private-row",
            fieldId: "status",
            typedEncodedValue: JSON.stringify("open"),
            rowRevision: 7,
        },
    });
    return row;
}

const IDENTITY_BLOCKER_PLUGIN_ID = "compat.identity-live-collection";

const IDENTITY_BLOCKER_MANIFEST = {
    ...COLLECTION_BLOCKER_MANIFEST,
    id: IDENTITY_BLOCKER_PLUGIN_ID,
    contributes: {
        accountCollections: [{
            ...COLLECTION_BLOCKER_MANIFEST.contributes.accountCollections[0],
            // A mode-derived row address the platform cannot recompute. It
            // reaches the terminal identity refusal instead of the zero-limit
            // one, so it proves both arms name the same blocking domain.
            identityFields: ["id"],
        }],
    },
} as const;

async function createLiveIdentityCollectionBlocker(accountId: string) {
    const [ref] = await inTx(async (tx) => (
        await materializePluginCollectionContractsFromManifestTx({
            tx,
            manifest: IDENTITY_BLOCKER_MANIFEST,
        })
    ));
    if (!ref) throw new Error("Expected a fixture Collection contract.");
    const contract = await db.pluginCollectionContract.findFirstOrThrow({
        where: {
            pluginId: ref.pluginId,
            collectionId: ref.collectionId,
            schemaVersion: ref.schemaVersion,
            contractDigest: ref.contractDigest,
        },
        select: { id: true, contractDigest: true },
    });
    return await db.pluginCollectionRow.create({
        data: {
            accountId,
            pluginId: IDENTITY_BLOCKER_PLUGIN_ID,
            collectionId: COLLECTION_BLOCKER_COLLECTION_ID,
            rowId: "identity-row",
            schemaVersion: 1,
            revision: 3,
            contractId: contract.id,
            contractDigest: contract.contractDigest,
            contentEnvelope: {
                t: "encrypted",
                c: sealPluginCollectionPrivatePayloadV1({
                    material: {
                        type: "legacy",
                        secret: new Uint8Array(32).fill(37),
                    },
                    payload: { privateNote: "identity collection" },
                    randomBytes: (length) =>
                        new Uint8Array(length).fill(41),
                }),
            },
        },
    });
}

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // Narrow boundary fixture: this app installs the production decorations below.
    const typed =
        app.withTypeProvider<ZodTypeProvider>() as any;
    typed.decorate(
        "authenticate",
        async (
            request: {
                headers: Record<string, unknown>;
                userId?: string;
                authAuthority?: "present_user";
                authTokenKind?: "account";
            },
            reply: {
                code: (status: number) => {
                    send: (body: unknown) => unknown;
                };
            },
        ) => {
            const accountId =
                request.headers["x-test-user-id"];
            if (
                typeof accountId !== "string"
                || accountId.length === 0
            ) {
                return reply
                    .code(401)
                    .send({ error: "Unauthorized" });
            }
            request.userId = accountId;
            request.authAuthority = "present_user";
            request.authTokenKind = "account";
            captureAccountStoredContentCompatibilityForHttpRequest(
                request as any,
            );
        },
    );
    enableErrorHandlers(typed);
    registerAccountEncryptionMigrateRoutes(typed);
    return typed;
}

describe("Account encryption migration current wire and retained data", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix:
                "happier-account-encryption-migrate-compatibility-",
            initEncrypt: true,
        });
    }, 120_000);

    afterEach(async () => {
        harness.resetEnv();
        await db.pluginCollectionProjection.deleteMany({
            where: { pluginId: COLLECTION_BLOCKER_PLUGIN_ID },
        }).catch(() => {});
        await db.pluginCollectionRow.deleteMany({
            where: { pluginId: COLLECTION_BLOCKER_PLUGIN_ID },
        }).catch(() => {});
        await db.pluginCollectionContract.deleteMany({
            where: { pluginId: COLLECTION_BLOCKER_PLUGIN_ID },
        }).catch(() => {});
        await db.session.deleteMany().catch(() => {});
        await db.account.deleteMany().catch(() => {});
    });

    afterAll(async () => {
        await harness.close();
    });

    it("rejects the 0.2 request at ingress without changing retained layout-zero data", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__ALLOW_ACCOUNT_OPTOUT: "1",
        });
        const account = await db.account.create({
            data: {
                ...createSignedAccountContentBinding(),
                encryptionMode: "e2ee",
                settings: null,
                settingsVersion: 0,
            },
        });
        const session = await db.session.create({
            data: {
                accountId: account.id,
                tag: "retained-0.2-layout-zero",
                metadata: "retained-0.2-metadata",
                metadataVersion: 3,
                metadataLayoutVersion: 0,
                ownerMetadata: null,
                agentState: "retained-0.2-agent-state",
                agentStateVersion: 4,
            },
        });
        const app = createTestApp();
        try {
            const response = await app.inject({
                method: "POST",
                url: "/v1/account/encryption/migrate",
                headers: { "content-type": "application/json", "x-test-user-id": account.id },
                payload: PREDECESSOR_REQUEST,
            });
            expect(response.statusCode, response.body).toBe(400);
            expect(await db.account.findUniqueOrThrow({ where: { id: account.id } })).toEqual(account);
            expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
            const fingerprints = deriveAccountEncryptionMigrationKeyFingerprints(account);
            const currentResponse = await app.inject({
                method: "POST",
                url: "/v1/account/encryption/migrate",
                headers: { "content-type": "application/json", "x-test-user-id": account.id },
                payload: {
                    ...PREDECESSOR_REQUEST,
                    expectedAccountVersion: account.seq,
                    expectedSigningKeyFingerprint: fingerprints.signingKeyFingerprint,
                    expectedContentKeyFingerprint: fingerprints.contentKeyFingerprint,
                    machines: { action: "assert_empty" },
                    todos: { action: "assert_empty" },
                    artifacts: { action: "assert_empty" },
                    sessions: { action: "assert_empty" },
                    reviewComments: { action: "assert_empty" },
                    sessionOrganization: { action: "assert_empty" },
                    pets: { action: "assert_empty" },
                },
            });
            expect(currentResponse.statusCode, currentResponse.body).toBe(200);
            expect(currentResponse.json()).toMatchObject({ success: true, mode: "plain", settingsVersion: 1 });
            expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
        } finally {
            await app.close();
        }
    });

    it("names the blocking plugin Collections for a current request with a live Collection", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY:
                "optional",
            HAPPIER_FEATURE_ENCRYPTION__ALLOW_ACCOUNT_OPTOUT:
                "1",
        });
        const account = await db.account.create({
            data: {
                ...createSignedAccountContentBinding(),
                encryptionMode: "e2ee",
                settings: null,
                settingsVersion: 0,
            },
            select: {
                id: true,
                seq: true,
                publicKey: true,
                contentPublicKey: true,
            },
        });
        await createLiveCollectionBlocker(account.id);
        const before = {
            account: await db.account.findUniqueOrThrow({
                where: { id: account.id },
            }),
            collection: await db.pluginCollectionRow.findFirstOrThrow({
                where: {
                    accountId: account.id,
                    pluginId: COLLECTION_BLOCKER_PLUGIN_ID,
                },
            }),
        };
        const fingerprints = deriveAccountEncryptionMigrationKeyFingerprints(
            account,
        );
        const app = createTestApp();
        await app.ready();

        try {
            const response = await app.inject({
                method: "POST",
                url: "/v1/account/encryption/migrate",
                headers: {
                    [ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER]:
                        String(CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION),
                    "content-type": "application/json",
                    "x-test-user-id": account.id,
                },
                payload: {
                    toMode: "plain",
                    expectedAccountVersion: account.seq,
                    expectedSigningKeyFingerprint:
                        fingerprints.signingKeyFingerprint,
                    expectedContentKeyFingerprint:
                        fingerprints.contentKeyFingerprint,
                    expectedSettingsVersion: 0,
                    settingsContent: null,
                    connectedServices: { action: "assert_empty" },
                    automations: { action: "assert_empty" },
                    machines: { action: "assert_empty" },
                    todos: { action: "assert_empty" },
                    artifacts: { action: "assert_empty" },
                    sessions: { action: "assert_empty" },
                    reviewComments: { action: "assert_empty" },
                    sessionOrganization: { action: "assert_empty" },
                    pets: { action: "assert_empty" },
                },
            });

            expect(response.statusCode, response.body)
                .toBe(400);
            expect(response.json()).toEqual({
                error: "plugin_collections_not_empty",
            });
            await expect(db.account.findUniqueOrThrow({
                where: { id: account.id },
            })).resolves.toEqual(before.account);
            await expect(db.pluginCollectionRow.findFirstOrThrow({
                where: {
                    accountId: account.id,
                    pluginId: COLLECTION_BLOCKER_PLUGIN_ID,
                },
            })).resolves.toEqual(before.collection);
            await expect(db.accountChange.count({
                where: { accountId: account.id },
            })).resolves.toBe(0);
        } finally {
            await app.close();
        }
    });

    it("names the blocking plugin Collections for a live identity-bearing Collection", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY:
                "optional",
            HAPPIER_FEATURE_ENCRYPTION__ALLOW_ACCOUNT_OPTOUT:
                "1",
        });
        const account = await db.account.create({
            data: {
                ...createSignedAccountContentBinding(),
                encryptionMode: "e2ee",
                settings: null,
                settingsVersion: 0,
            },
            select: {
                id: true,
                seq: true,
                publicKey: true,
                contentPublicKey: true,
            },
        });
        await createLiveIdentityCollectionBlocker(account.id);
        const before = {
            account: await db.account.findUniqueOrThrow({
                where: { id: account.id },
            }),
            collection: await db.pluginCollectionRow.findFirstOrThrow({
                where: {
                    accountId: account.id,
                    pluginId: IDENTITY_BLOCKER_PLUGIN_ID,
                },
            }),
        };
        const fingerprints = deriveAccountEncryptionMigrationKeyFingerprints(
            account,
        );
        const app = createTestApp();
        await app.ready();

        try {
            const response = await app.inject({
                method: "POST",
                url: "/v1/account/encryption/migrate",
                headers: {
                    [ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER]:
                        String(CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION),
                    "content-type": "application/json",
                    "x-test-user-id": account.id,
                },
                payload: {
                    toMode: "plain",
                    expectedAccountVersion: account.seq,
                    expectedSigningKeyFingerprint:
                        fingerprints.signingKeyFingerprint,
                    expectedContentKeyFingerprint:
                        fingerprints.contentKeyFingerprint,
                    expectedSettingsVersion: 0,
                    settingsContent: null,
                    connectedServices: { action: "assert_empty" },
                    automations: { action: "assert_empty" },
                    machines: { action: "assert_empty" },
                    todos: { action: "assert_empty" },
                    artifacts: { action: "assert_empty" },
                    sessions: { action: "assert_empty" },
                    reviewComments: { action: "assert_empty" },
                    sessionOrganization: { action: "assert_empty" },
                    pets: { action: "assert_empty" },
                },
            });

            expect(response.statusCode, response.body)
                .toBe(400);
            expect(response.json()).toEqual({
                error: "plugin_collections_not_empty",
            });
            await expect(db.account.findUniqueOrThrow({
                where: { id: account.id },
            })).resolves.toEqual(before.account);
            await expect(db.pluginCollectionRow.findFirstOrThrow({
                where: {
                    accountId: account.id,
                    pluginId: IDENTITY_BLOCKER_PLUGIN_ID,
                },
            })).resolves.toEqual(before.collection);
            await expect(db.accountChange.count({
                where: { accountId: account.id },
            })).resolves.toBe(0);
        } finally {
            await app.close();
        }
    });
});
