import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
    AIBackendProfileSchema,
    DEFAULT_PROVIDER_SETTINGS_V1,
    formatSharedSavedSecretRefV1,
    promotePersonalSavedSecretReference,
    ProviderSettingsV1Schema,
    SavedSecretResourceMaterialsResponseV1Schema,
    SharedSavedSecretListOutputV1Schema,
    VoiceCredentialBindingIdentityV1Schema,
} from "@happier-dev/protocol";
import { createAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import {
    createSavedSecretResourceInTx,
    promoteSavedSecretResourceInTx,
} from "@/app/account/savedSecrets/savedSecretResourceService";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { registerSavedSecretResourceRoutes } from "./registerSavedSecretResourceRoutes";
import type { FastifyRequest } from "fastify";

async function importCliTestModule<T>(specifier: string): Promise<T> {
    // This composition deliberately crosses the server/CLI workspace boundary.
    // Keep server compilation rooted locally while Vitest loads the real consumers.
    return import(specifier) as Promise<T>;
}

describe("Saved Secret material route (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-saved-secret-material-route-",
            env: { HAPPIER_FEATURE_TEAMS__ENABLED: "1" },
            initEncrypt: true,
        });
    }, 180_000);

    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.savedSecretResourceKeyEnvelope.deleteMany(),
            () => db.savedSecretGroupGrant.deleteMany(),
            () => db.savedSecretTeamGrant.deleteMany(),
            () => db.savedSecretAccountGrant.deleteMany(),
            () => db.savedSecretResource.deleteMany(),
            () => db.accountSettingsSnapshot.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    afterAll(async () => harness.close());

    it("projects the exact resource id through the authenticated HTTP schema", async () => {
        const owner = await db.account.create({
            data: { encryptionMode: "plain" },
            select: { id: true },
        });
        const resourceId = "resource_route_identity";
        const created = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId,
            displayName: "Shared API key",
            kind: "apiKey",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared API key", kind: "apiKey", value: "provider-secret" },
            },
        }));
        expect(created.ok).toBe(true);

        const app = createAuthenticatedTestApp();
        registerSavedSecretResourceRoutes(app);
        await app.ready();

        try {
            const response = await app.inject({
                method: "GET",
                url: "/v1/account/saved-secrets/resources/materials",
                headers: { "x-test-user-id": owner.id },
            });
            expect(response.statusCode).toBe(200);
            const parsed = SavedSecretResourceMaterialsResponseV1Schema.parse(response.json());
            expect(parsed.resources).toEqual([
                expect.objectContaining({
                    resourceId,
                    entry: expect.objectContaining({ ref: formatSharedSavedSecretRefV1(resourceId) }),
                }),
            ]);
        } finally {
            await app.close();
        }
    });

    it("returns owner-repairable and recipient-safe corrupt rows without blanking healthy catalog siblings", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const recipient = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_route_healthy_sibling",
            displayName: "Healthy sibling",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Healthy sibling", kind: "token", value: "healthy-secret" },
            },
            accountGrants: [recipient.id],
        }));
        const malformedResourceId = ` ${"malformed-route-id".repeat(10)}`;
        await db.savedSecretResource.create({
            data: {
                id: malformedResourceId,
                ownerAccountId: owner.id,
                displayName: "Unsafe retained metadata",
                kind: "token",
                encryptionMode: "plain",
                revision: 4,
                storedContent: "malformed-at-rest-container",
                accountGrants: {
                    create: { accountId: recipient.id, createdByAccountId: owner.id },
                },
            },
        });

        const app = createAuthenticatedTestApp();
        registerSavedSecretResourceRoutes(app);
        await app.ready();
        try {
            for (const [accountId, relationship] of [[recipient.id, "recipient"], [owner.id, "owner"]] as const) {
                const listResponse = await app.inject({
                    method: "GET",
                    url: "/v1/account/saved-secrets/resources",
                    headers: { "x-test-user-id": accountId },
                });
                expect(listResponse.statusCode).toBe(200);
                const list = SharedSavedSecretListOutputV1Schema.parse(listResponse.json());
                expect(list.resources).toHaveLength(2);
                const corruptListRow = list.resources.find((row) => row.materialStatus === "resource_corrupt");
                expect(corruptListRow).toEqual(relationship === "owner"
                    ? {
                        materialStatus: "resource_corrupt",
                        relationship: "owner",
                        repair: {
                            kind: "delete_resource",
                            resourceId: malformedResourceId,
                            expectedRevision: 4,
                        },
                    }
                    : { materialStatus: "resource_corrupt", relationship: "recipient", repair: null });

                const materialsResponse = await app.inject({
                    method: "GET",
                    url: "/v1/account/saved-secrets/resources/materials",
                    headers: { "x-test-user-id": accountId },
                });
                expect(materialsResponse.statusCode).toBe(200);
                const materials = SavedSecretResourceMaterialsResponseV1Schema.parse(materialsResponse.json());
                expect(materials.resources).toHaveLength(2);
                const corruptMaterial = materials.resources.find((row) => row.entry.materialStatus === "resource_corrupt");
                expect(corruptMaterial).toEqual({ entry: corruptListRow });
                if (relationship === "recipient") {
                    expect(JSON.stringify(corruptMaterial)).not.toContain(malformedResourceId);
                    expect(JSON.stringify(corruptMaterial)).not.toContain("Unsafe retained metadata");
                }
            }

            const deleteResponse = await app.inject({
                method: "POST",
                url: "/v1/account/saved-secrets/resources/delete",
                headers: { "x-test-user-id": owner.id },
                payload: { resourceId: malformedResourceId, expectedRevision: 4 },
            });
            expect(deleteResponse.statusCode).toBe(200);
            expect(await db.savedSecretResource.findUnique({ where: { id: malformedResourceId } })).toBeNull();
        } finally {
            await app.close();
        }
    });

    it("promotes one Saved Secret, publishes its AccountChange, hydrates it over HTTP, and serves real CLI consumers", async () => {
        const token = "saved-secret-composed-token";
        const resourceId = "resource_promoted_composed";
        const sharedRef = formatSharedSavedSecretRefV1(resourceId);
        const personalSecretId = "personal_secret_before_promotion";
        const voiceContribution = { pluginId: "happier.voice.test", localId: "speech" } as const;
        const personalSettings = {
            secrets: [{
                id: personalSecretId,
                name: "Promoted API key",
                kind: "apiKey",
                encryptedValue: { _isSecretValue: true, value: "shared-provider-secret" },
                createdAt: 1,
                updatedAt: 7,
            }],
            secretBindingsByProfileId: {
                shared: { SHARED_API_KEY: personalSecretId },
            },
            providerSettingsV1: ProviderSettingsV1Schema.parse({
                ...DEFAULT_PROVIDER_SETTINGS_V1,
                connections: [{
                    v: 1,
                    id: "pc_shared",
                    source: { kind: "contribution", contributionKey: "happier.provider.test/main" },
                    role: "default",
                    displayName: "Shared Provider",
                    displayNameMode: "automatic",
                    revision: 0,
                    createdAt: 1,
                    updatedAt: 1,
                }],
                secretBindingsByConnectionId: {
                    pc_shared: { account: { apiKey: personalSecretId }, byMachineId: {} },
                },
            }),
            voiceSettingsV1: {
                credentialBindings: [{
                    contribution: voiceContribution,
                    credentialSlotId: "api_key",
                    credentialSource: { kind: "savedSecret" },
                    credentialBindings: { account: { api_key: personalSecretId } },
                }],
            },
        };
        const promotedSettings = promotePersonalSavedSecretReference(personalSettings, {
            secretId: personalSecretId,
            expectedUpdatedAt: 7,
            sharedSecretRef: sharedRef,
        }).settings;
        const owner = await db.account.create({
            data: {
                encryptionMode: "plain",
                settingsVersion: 1,
                settings: JSON.stringify({ t: "plain", v: personalSettings }),
            },
            select: { id: true },
        });
        const promoted = await inTx((tx) => promoteSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId,
            displayName: "Promoted API key",
            kind: "apiKey",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Promoted API key", kind: "apiKey", value: "shared-provider-secret" },
            },
            expectedSettingsVersion: 1,
            nextSettings: { t: "plain", v: promotedSettings },
        }));
        expect(promoted).toEqual({ ok: true, value: { resourceId, settingsVersion: 2 } });
        await expect(db.accountChange.findFirst({
            where: { kind: "savedSecretResource", entityId: resourceId },
            select: { accountId: true },
        })).resolves.toEqual({ accountId: owner.id });

        const app = createAuthenticatedTestApp();
        app.addHook("onRequest", async (request: FastifyRequest) => {
            request.headers["x-test-user-id"] = owner.id;
        });
        registerSavedSecretResourceRoutes(app);
        await app.listen({ host: "127.0.0.1", port: 0 });

        const activeSnapshot = await importCliTestModule<{
            setActiveAccountSettingsSnapshot(input: unknown): void;
            getActiveAccountSettingsSnapshot(): Readonly<{
                settings: Readonly<Record<string, unknown>>;
                savedSecretResources?: readonly unknown[];
            }> | null;
            resetActiveAccountSettingsSnapshotForTests(): void;
        }>("../../../../../../cli/src/settings/accountSettings/activeAccountSettingsSnapshot");
        try {
            const address = app.server.address();
            if (!address || typeof address === "string") throw new Error("expected TCP test address");
            const { resolveAccountSettingsScopeKeyForToken } = await importCliTestModule<{
                resolveAccountSettingsScopeKeyForToken(token: string): string;
            }>("../../../../../../cli/src/settings/accountSettings/accountSettingsScopeKey");
            const { runWithServerHttpBaseUrl } = await importCliTestModule<{
                runWithServerHttpBaseUrl<T>(baseUrl: string, operation: () => Promise<T>): Promise<T>;
            }>("../../../../../../cli/src/api/client/serverHttpBaseUrl");
            const { hydrateSavedSecretCatalog } = await importCliTestModule<{
                hydrateSavedSecretCatalog(input: Readonly<{ token: string }>): Promise<void>;
            }>("../../../../../../cli/src/settings/secrets/hydrateSavedSecretCatalog");

            activeSnapshot.setActiveAccountSettingsSnapshot({
                source: "network",
                scopeKey: resolveAccountSettingsScopeKeyForToken(token),
                settingsVersion: 2,
                loadedAtMs: 1,
                settingsSecretsReadKeys: [],
                settings: promotedSettings,
            });
            await runWithServerHttpBaseUrl(`http://127.0.0.1:${address.port}`, async () => {
                await hydrateSavedSecretCatalog({ token });
            });
            const snapshot = activeSnapshot.getActiveAccountSettingsSnapshot();
            expect(snapshot?.savedSecretResources).toHaveLength(1);
            if (!snapshot) throw new Error("expected hydrated Account snapshot");

            const { createSavedSecretMaterializerV1 } = await importCliTestModule<{
                createSavedSecretMaterializerV1(input: Readonly<{
                    accountSettings: unknown;
                    settingsSecretsReadKeys: readonly Uint8Array[];
                }>): Readonly<{
                    inspect(ref: string): Readonly<{ status: string; fingerprint?: string }>;
                }>;
            }>("../../../../../../cli/src/settings/secrets/savedSecretCatalog");
            const materializer = createSavedSecretMaterializerV1({
                accountSettings: snapshot.settings,
                settingsSecretsReadKeys: [],
            });
            const inspected = materializer.inspect(sharedRef);
            expect(inspected.status).toBe("ready");
            if (!inspected.fingerprint) throw new Error("expected hydrated material fingerprint");

            const { resolveForegroundProfileSavedSecretEnvironment } = await importCliTestModule<{
                resolveForegroundProfileSavedSecretEnvironment(input: unknown): Readonly<Record<string, string>>;
            }>("../../../../../../cli/src/daemon/agentRuntime/resolveForegroundProfileSavedSecretEnvironment");
            const profile = AIBackendProfileSchema.parse({
                id: "shared",
                name: "Shared",
                envVarRequirements: [{ name: "SHARED_API_KEY", kind: "secret", required: true }],
                environmentVariables: [],
                defaultPermissionModeByTargetKey: {},
                compatibilityByTargetKey: {},
                isBuiltIn: false,
                createdAt: 1,
                updatedAt: 1,
                version: "1.0.0",
            });
            expect(resolveForegroundProfileSavedSecretEnvironment({
                profile,
                accountSettings: snapshot.settings,
                settingsSecretsReadKeys: [],
                foregroundSatisfiedSecretRequirementNames: [],
            })).toEqual({ SHARED_API_KEY: "shared-provider-secret" });

            const { resolveMcpValueRefPlaintext } = await importCliTestModule<{
                resolveMcpValueRefPlaintext(input: unknown): string | null;
            }>("../../../../../../cli/src/mcp/servers/resolveMcpValueRefPlaintext");
            expect(resolveMcpValueRefPlaintext({
                valueRef: { t: "savedSecret", secretId: sharedRef },
                savedSecretsById: new Map(),
                savedSecretMaterializer: materializer,
                settingsSecretsKey: null,
                processEnv: {},
            })).toBe("shared-provider-secret");

            const { materializeConfiguredAcpEnvironment } = await importCliTestModule<{
                materializeConfiguredAcpEnvironment(input: unknown): Record<string, string>;
            }>("../../../../../../cli/src/agent/acp/catalog/configured/materializeEnvironment");
            expect(materializeConfiguredAcpEnvironment({
                backend: { env: { ACP_TOKEN: { t: "savedSecret", secretId: sharedRef } } },
                accountSettings: snapshot.settings,
                credentials: { token, encryption: null },
                processEnv: {},
            })).toEqual({ ACP_TOKEN: "shared-provider-secret" });

            const provider = await importCliTestModule<{
                resolveProviderCredentialReference(input: unknown): Readonly<{
                    ok: boolean;
                    reference?: unknown;
                }>;
                resolveProviderCredentialPlaintext(input: unknown): unknown;
            }>("../../../../../../cli/src/providers/spawn/credentials");
            const providerReference = provider.resolveProviderCredentialReference({
                providerSettings: snapshot.settings.providerSettingsV1,
                accountSettings: snapshot.settings,
                connectionId: "pc_shared",
                machineId: "machine",
                credentialSlotId: "apiKey",
                required: true,
            });
            expect(providerReference).toMatchObject({
                ok: true,
                reference: { kind: "apiKey", secretId: sharedRef },
            });
            if (!providerReference.ok || !providerReference.reference) throw new Error("expected Provider credential reference");
            expect(provider.resolveProviderCredentialPlaintext({
                reference: providerReference.reference,
                accountSettings: snapshot.settings,
                settingsSecretsReadKeys: [],
                connectionId: "connection",
                machineId: "machine",
            })).toEqual({ ok: true, credential: { kind: "apiKey", value: "shared-provider-secret" } });

            const { createActiveAccountSettingsConnectedAccountSecrets } = await importCliTestModule<{
                createActiveAccountSettingsConnectedAccountSecrets(): Readonly<{
                    has(ref: string): Promise<boolean>;
                    read(ref: string): Promise<string | null>;
                }>;
            }>("../../../../../../cli/src/daemon/connectedServices/qualifiedConnectedAccountDaemonPersistence");
            const connectedSecrets = createActiveAccountSettingsConnectedAccountSecrets();
            await expect(connectedSecrets.has(sharedRef)).resolves.toBe(true);
            await expect(connectedSecrets.read(sharedRef)).resolves.toBe("shared-provider-secret");

            const { createVoiceCredentialResolver } = await importCliTestModule<{
                createVoiceCredentialResolver(input: Readonly<{ machineId: string | null }>): Readonly<{
                    withSecret<T>(input: Readonly<{ identity: unknown; use(secret: string): Promise<T> }>): Promise<T>;
                }>;
            }>("../../../../../../cli/src/daemon/voice/credentials/resolver");
            const voiceIdentity = VoiceCredentialBindingIdentityV1Schema.parse({
                contribution: voiceContribution,
                credentialSlotId: "api_key",
                purpose: { consumer: voiceContribution, purpose: "voice.client-auth" },
            });
            await expect(createVoiceCredentialResolver({ machineId: null }).withSecret({
                identity: voiceIdentity,
                use: async (secret: string) => secret,
            })).resolves.toBe("shared-provider-secret");
        } finally {
            activeSnapshot.resetActiveAccountSettingsSnapshotForTests();
            await app.close();
        }
    });
});
