import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import tweetnacl from "tweetnacl";
import { signAccountContentKeyBindingV1 } from "@happier-dev/protocol";

import {
    createQualifiedConnectedAccountGroupDigest,
    createQualifiedConnectedAccountServiceDigest,
} from "@/app/api/routes/connect/qualifiedConnectedAccounts/identity";
import { listProviderDescriptorsInTx } from "@/app/auth/providers/identityProviderCatalog";
import { encryptString } from "@/modules/encrypt";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { readRunnerBrokerReadinessProjectionInTx } from "./runnerBrokerReadinessAuthorization";

const endpointId = "a".repeat(64);
const managedEnv = { HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test" };
const managedOidcConfig = {
    v: 1,
    kind: "oidc",
    issuer: "https://id.example.test",
    clientId: "happier",
    clientAuthenticationMethod: "client_secret_post",
    scopes: "openid profile email",
    httpTimeoutSeconds: 30,
    claims: { login: "preferred_username", email: "email", groups: "groups" },
    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
    fetchUserInfo: true,
    storeRefreshToken: false,
    ui: { buttonColor: null, iconHint: "oidc" },
} as const;

describe("Runner Team credential readiness authorization", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "runner-team-credential-readiness-",
            initAuth: false,
            initEncrypt: true,
            env: {
                HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
            },
        });
    }, 180_000);

    afterAll(async () => { await harness?.close(); });

    it("uses only the activation snapshot for restricted Team readiness and rechecks its currentness", async () => {
        const creatorSigningKey = tweetnacl.sign.keyPair();
        const creatorContentKey = tweetnacl.box.keyPair();
        const creator = await db.account.create({
            data: {
                encryptionMode: "e2ee",
                publicKey: Buffer.from(creatorSigningKey.publicKey).toString("hex"),
                contentPublicKey: new Uint8Array(creatorContentKey.publicKey),
                contentPublicKeySig: signAccountContentKeyBindingV1({
                    accountSigningSecretKey: creatorSigningKey.secretKey,
                    contentPublicKey: creatorContentKey.publicKey,
                }),
            },
        });
        const custodian = await db.account.create({ data: { encryptionMode: "plain" } });
        const activation = await db.ephemeralRunnerActivation.create({ data: {
            id: randomUUID(),
            creatorAccountId: creator.id,
            creatorTokenEpoch: creator.tokenEpoch,
            draftId: randomUUID(),
            sessionId: randomUUID(),
            machineId: randomUUID(),
            state: "pending",
            workspacePolicy: "choose_on_endpoint",
            activationExpiresAt: null,
            homeServerIdentityId: "srv_runner_readiness",
            activationSigningPublicKey: "activation-public-key",
            authoringCommitment: "authoring-commitment",
            artifact: {},
            endpointFactsRecipient: { mode: "plain", creatorAccountId: creator.id },
        } });
        const team = await db.team.create({ data: {
            name: "Restricted Runner resource",
            authenticationPolicy: {
                v: 1,
                mode: "restricted",
                accepted: [{ kind: "home_method", methodId: "key_challenge" }],
            },
        } });
        const [creatorMembership] = await Promise.all([
            db.teamMembership.create({ data: { teamId: team.id, accountId: creator.id, role: "member" } }),
            db.teamMembership.create({ data: { teamId: team.id, accountId: custodian.id, role: "member" } }),
        ]);
        const service = { pluginId: "runner.readiness", localId: "source" };
        const groupId = "runner-readiness-pool";
        const pool = await db.connectedServiceAuthGroup.create({ data: {
            accountId: custodian.id,
            groupId,
            servicePluginId: service.pluginId,
            serviceLocalId: service.localId,
            qualifiedServiceDigest: createQualifiedConnectedAccountServiceDigest(service),
            qualifiedGroupDigest: createQualifiedConnectedAccountGroupDigest({ service, groupId }),
            policyJson: "{}",
        } });
        const machine = await db.machine.create({ data: {
            id: `runner-readiness-broker-${custodian.id}`,
            accountId: custodian.id,
            metadata: "{}",
            kind: "persistent",
            operationProtocolCapabilities: {
                providerBrokerIngress: { protocolVersions: [1] },
                irohMachineEndpoint: { protocolVersions: [1], endpointId },
            },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const resource = await db.teamCredentialResource.create({ data: {
            teamId: team.id,
            custodianAccountId: custodian.id,
            displayName: "Restricted source",
            disclosureCeiling: "brokered_only",
            sessionUsePolicy: "personal_allowed",
            sourceBindingJson: JSON.stringify({
                v: 1,
                kind: "connected_pool",
                target: { kind: "group", service, groupId },
                poolIncarnation: pool.id,
            }),
            brokerMachineId: machine.id,
            memberGrants: { create: {
                teamMembershipId: creatorMembership.id,
                deliveryMode: "brokered",
            } },
        } });

        const projection = await inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: {
                v: 1,
                resourceId: resource.id,
                brokerMachineId: machine.id,
                revision: resource.revision,
                application: {
                    agentTargetKey: "agent:happier.agent.codex/codex",
                    implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
                    endpointTemplateId: "responses",
                    protocol: "openai-responses",
                },
                sourceRevision: "source-revision-1",
            },
        }));

        expect(projection).toBeNull();

        await db.ephemeralRunnerActivation.update({
            where: { id: activation.id },
            data: { authenticationEvidence: {
                v: 1,
                evidence: [{ kind: "home_method", methodId: "key_challenge" }],
            } },
        });
        await expect(inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: {
                v: 1,
                resourceId: resource.id,
                brokerMachineId: machine.id,
                revision: resource.revision,
                application: {
                    agentTargetKey: "agent:happier.agent.codex/codex",
                    implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
                    endpointTemplateId: "responses",
                    protocol: "openai-responses",
                },
                sourceRevision: "source-revision-1",
            },
        }))).resolves.toMatchObject({ readiness: { kind: "available" } });

        // A Pool placement is a broker location for a Runner too: the exact member
        // frozen into the activation's binding keeps its already reviewed target,
        // because Pool membership governs future selection and is never an
        // ongoing ACL for an established one.
        const brokerPool = await db.machinePool.create({ data: {
            id: randomUUID(),
            accountId: custodian.id,
            name: "Runner broker pool",
            members: { create: { machineId: machine.id, priorityTier: 0, enabled: true } },
        } });
        await db.teamCredentialResource.update({
            where: { id: resource.id },
            data: { brokerMachineId: null, brokerPoolId: brokerPool.id },
        });
        const poolSelection = {
            v: 1 as const,
            resourceId: resource.id,
            revision: resource.revision,
            application: {
                agentTargetKey: "agent:happier.agent.codex/codex",
                implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
                endpointTemplateId: "responses",
                protocol: "openai-responses" as const,
            },
            sourceRevision: "source-revision-1",
        };
        await expect(inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: { ...poolSelection, brokerMachineId: machine.id },
        }))).resolves.toMatchObject({ readiness: { kind: "available" } });
        const outsider = await db.machine.create({ data: {
            id: `outsider-${randomUUID()}`,
            accountId: custodian.id,
            metadata: "{}",
            kind: "persistent",
            operationProtocolCapabilities: {
                providerBrokerIngress: { protocolVersions: [1] },
                irohMachineEndpoint: { protocolVersions: [1], endpointId: "d".repeat(64) },
            },
            operationProtocolCapabilitiesRevision: 1,
        } });
        // Disabling the member the activation already froze does not revoke it.
        await db.machinePoolMember.updateMany({
            where: { poolId: brokerPool.id, machineId: machine.id },
            data: { enabled: false },
        });
        await expect(inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: { ...poolSelection, brokerMachineId: machine.id },
        }))).resolves.toMatchObject({ readiness: { kind: "available" } });
        // Current Machine authority is still revalidated for that same target.
        await db.machine.update({ where: { id: machine.id }, data: { revokedAt: new Date() } });
        await expect(inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: { ...poolSelection, brokerMachineId: machine.id },
        }))).resolves.toBeNull();
        await db.machine.update({ where: { id: machine.id }, data: { revokedAt: null } });
        await db.machinePoolMember.updateMany({
            where: { poolId: brokerPool.id, machineId: machine.id },
            data: { enabled: true },
        });
        await db.teamCredentialResource.update({
            where: { id: resource.id },
            data: { brokerMachineId: machine.id, brokerPoolId: null },
        });
        // An exact placement still names its one Machine: a different Machine of
        // the same custodian is refused however eligible it is.
        await expect(inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: { ...poolSelection, brokerMachineId: outsider.id },
        }))).resolves.toBeNull();

        await db.ephemeralRunnerActivation.update({
            where: { id: activation.id },
            data: { authenticationEvidence: {
                v: 1,
                evidence: [{ kind: "home_method", methodId: "email_password" }],
            } },
        });
        await expect(inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: {
                v: 1,
                resourceId: resource.id,
                brokerMachineId: machine.id,
                revision: resource.revision,
                application: {
                    agentTargetKey: "agent:happier.agent.codex/codex",
                    implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
                    endpointTemplateId: "responses",
                    protocol: "openai-responses",
                },
                sourceRevision: "source-revision-1",
            },
        }))).resolves.toBeNull();

        await db.ephemeralRunnerActivation.update({
            where: { id: activation.id },
            data: { authenticationEvidence: {
                v: 1,
                evidence: [{ kind: "home_method", methodId: "key_challenge" }],
            } },
        });
        await db.account.update({ where: { id: creator.id }, data: { tokenEpoch: { increment: 1 } } });
        await expect(inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId: activation.id,
            env: harness.envBase,
            selection: {
                v: 1,
                resourceId: resource.id,
                brokerMachineId: machine.id,
                revision: resource.revision,
                application: {
                    agentTargetKey: "agent:happier.agent.codex/codex",
                    implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
                    endpointTemplateId: "responses",
                    protocol: "openai-responses",
                },
                sourceRevision: "source-revision-1",
            },
        }))).resolves.toBeNull();
    });

    it("revalidates a Runner activation's provider identity, connection, and runtime revision without qualifying a sibling activation", async () => {
        const creator = await db.account.create({ data: { encryptionMode: "plain" } });
        const custodian = await db.account.create({ data: { encryptionMode: "plain" } });
        const team = await db.team.create({ data: { name: "Provider-qualified Runner" } });
        const teamProviderPolicy = {
            v: 1,
            allowedTeamProviderKinds: ["oidc"],
            teamJitAllowed: false,
            approvedGitHubEnterpriseOrigins: [],
        };
        await db.homeGovernancePolicy.upsert({
            where: { id: "home" },
            create: {
                id: "home",
                teamProviderPolicy,
            },
            update: {
                teamProviderPolicy,
            },
        });
        const provider = await db.identityProviderInstance.create({ data: {
            ownerTeamId: team.id,
            kind: "oidc",
            displayName: "Runner identity",
            enabled: true,
            firstEnabledAt: new Date("2026-09-12T00:00:00.000Z"),
            config: managedOidcConfig,
        } });
        await db.identityProviderInstance.update({
            where: { id: provider.id },
            data: { encryptedSecrets: encryptString(
                ["storage", "identity_provider_instance", provider.id, "oidc", "secrets", "v1"],
                JSON.stringify({ v: 1, kind: "oidc", clientSecret: "secret" }),
            ) },
        });
        const connection = await db.teamIdentityConnection.create({ data: {
            teamId: team.id,
            providerInstanceId: provider.id,
            externalReference: { v: 1, kind: "oidc" },
            settings: {
                v: 1,
                kind: "oidc",
                allowedUsers: [],
                allowedEmailDomains: [],
                groupsAny: [],
                groupsAll: [],
            },
            enabled: true,
            firstEnabledAt: new Date("2026-09-12T00:00:00.000Z"),
        } });
        const descriptor = await inTx(async (tx) => (await listProviderDescriptorsInTx(
            tx,
            managedEnv,
            { kind: "team", teamId: team.id },
        )).find((candidate) => candidate.reference.id === provider.id));
        if (!descriptor) throw new Error("Expected current Team identity provider descriptor");
        await db.identityProviderInstance.update({
            where: { id: provider.id },
            data: {
                lastSuccessfulTestAt: new Date("2026-09-12T00:01:00.000Z"),
                lastSuccessfulTestRuntimeFingerprint: descriptor.reference.runtimeFingerprint,
                lastSuccessfulTestSecurityRevision: provider.securityRevision,
            },
        });
        await db.team.update({ where: { id: team.id }, data: { authenticationPolicy: {
            v: 1,
            mode: "restricted",
            accepted: [{ kind: "team_connection", connectionId: connection.id }],
        } } });
        const identity = await db.accountIdentity.create({ data: {
            accountId: creator.id,
            provider: provider.id,
            providerUserId: "runner-subject",
        } });
        const [creatorMembership] = await Promise.all([
            db.teamMembership.create({ data: { teamId: team.id, accountId: creator.id, role: "member" } }),
            db.teamMembership.create({ data: { teamId: team.id, accountId: custodian.id, role: "member" } }),
        ]);
        const service = { pluginId: "runner.provider-readiness", localId: "source" };
        const groupId = `runner-provider-${randomUUID()}`;
        const pool = await db.connectedServiceAuthGroup.create({ data: {
            accountId: custodian.id,
            groupId,
            servicePluginId: service.pluginId,
            serviceLocalId: service.localId,
            qualifiedServiceDigest: createQualifiedConnectedAccountServiceDigest(service),
            qualifiedGroupDigest: createQualifiedConnectedAccountGroupDigest({ service, groupId }),
            policyJson: "{}",
        } });
        const machine = await db.machine.create({ data: {
            id: `runner-provider-broker-${custodian.id}`,
            accountId: custodian.id,
            metadata: "{}",
            kind: "persistent",
            operationProtocolCapabilities: {
                providerBrokerIngress: { protocolVersions: [1] },
                irohMachineEndpoint: { protocolVersions: [1], endpointId },
            },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const resource = await db.teamCredentialResource.create({ data: {
            teamId: team.id,
            custodianAccountId: custodian.id,
            displayName: "Provider-qualified source",
            disclosureCeiling: "brokered_only",
            sessionUsePolicy: "personal_allowed",
            sourceBindingJson: JSON.stringify({
                v: 1,
                kind: "connected_pool",
                target: { kind: "group", service, groupId },
                poolIncarnation: pool.id,
            }),
            brokerMachineId: machine.id,
            memberGrants: { create: {
                teamMembershipId: creatorMembership.id,
                deliveryMode: "brokered",
            } },
        } });
        const selection = {
            v: 1 as const,
            resourceId: resource.id,
            brokerMachineId: machine.id,
            revision: resource.revision,
            application: {
                agentTargetKey: "agent:happier.agent.codex/codex",
                implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
                endpointTemplateId: "responses",
                protocol: "openai-responses" as const,
            },
            sourceRevision: "source-revision-1",
        };
        const evidence = {
            kind: "provider" as const,
            providerId: provider.id,
            identityId: identity.id,
            runtimeFingerprint: descriptor.reference.runtimeFingerprint,
            teamConnectionId: connection.id,
        };
        const activationData = {
            creatorAccountId: creator.id,
            creatorTokenEpoch: creator.tokenEpoch,
            draftId: randomUUID(),
            sessionId: randomUUID(),
            machineId: randomUUID(),
            state: "pending",
            workspacePolicy: "choose_on_endpoint",
            activationExpiresAt: null,
            homeServerIdentityId: "srv_runner_provider_readiness",
            activationSigningPublicKey: "activation-public-key",
            authoringCommitment: "authoring-commitment",
            artifact: {},
            endpointFactsRecipient: { mode: "plain", creatorAccountId: creator.id },
        } as const;
        const activation = await db.ephemeralRunnerActivation.create({ data: {
            id: randomUUID(),
            ...activationData,
            authenticationEvidence: { v: 1, evidence: [evidence] },
        } });
        const sibling = await db.ephemeralRunnerActivation.create({ data: {
            id: randomUUID(),
            ...activationData,
            draftId: randomUUID(),
            sessionId: randomUUID(),
            machineId: randomUUID(),
            authenticationEvidence: null,
        } });
        const read = (activationId: string) => inTx(tx => readRunnerBrokerReadinessProjectionInTx(tx, {
            activationId,
            env: { ...harness.envBase, ...managedEnv },
            selection,
        }));

        await expect(read(activation.id)).resolves.toMatchObject({ readiness: { kind: "available" } });
        await expect(read(sibling.id)).resolves.toBeNull();

        await db.identityProviderInstance.update({
            where: { id: provider.id },
            data: { securityRevision: { increment: 1 } },
        });
        await expect(read(activation.id)).resolves.toBeNull();
        await db.identityProviderInstance.update({
            where: { id: provider.id },
            data: { securityRevision: provider.securityRevision },
        });
        await expect(read(activation.id)).resolves.toMatchObject({ readiness: { kind: "available" } });

        await db.teamIdentityConnection.update({ where: { id: connection.id }, data: { enabled: false } });
        await expect(read(activation.id)).resolves.toBeNull();
        await db.teamIdentityConnection.update({ where: { id: connection.id }, data: { enabled: true } });
        await expect(read(activation.id)).resolves.toMatchObject({ readiness: { kind: "available" } });

        await db.accountIdentity.delete({ where: { id: identity.id } });
        await expect(read(activation.id)).resolves.toBeNull();
    });
});
