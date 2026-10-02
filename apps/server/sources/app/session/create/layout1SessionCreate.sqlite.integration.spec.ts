import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import tweetnacl from "tweetnacl";
import { randomUUID } from "node:crypto";
import {
    sealEncryptedDataKeyEnvelopeV1,
    signAccountContentKeyBindingV1,
    type SessionInitialAccessMaterializedV1,
} from "@happier-dev/protocol";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { materializeWorkflowAcceptedSnapshotFixture } from "@/testkit/workflowAcceptedSnapshot";
import { eventRouter } from "@/app/events/eventRouter";
import { publishSessionArchiveTransition } from "@/app/session/archive/publishSessionArchiveTransition";
import { createQualifiedConnectedAccountGroupDigest, createQualifiedConnectedAccountServiceDigest } from "@/app/api/routes/connect/qualifiedConnectedAccounts/identity";

import { createFreshBoundLayout1SessionInTx as createFreshBoundLayout1SessionWithAuthenticationInTx } from "./createFreshBoundLayout1Session";
import { createLegacyLayout0SessionInTx } from "./createLegacyLayout0Session";
import {
    createOrRejoinLayout1SessionByTagInTx as createOrRejoinLayout1SessionByTagWithAuthenticationInTx,
    rejoinLayout1SessionByTagInTx,
} from "./createOrRejoinLayout1SessionByTag";
import {
    prepareLayout1SessionCreate,
    type FreshBoundLayout1SessionCreateRejection,
    type PreparedLayout1SessionCreate,
} from "./prepareLayout1SessionCreate";
import type { Layout1SessionCreateOutcome } from "./layout1SessionRowWrite";
import { admitWorkflowRun } from "@/app/workflows/workflowRunService";
import { fetchAutomationAccountCurrentnessWitnessTx } from "@/app/automations/automationAccountCurrentness";
import {
    sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
    serializeWorkflowStoredContentEnvelopeV1,
} from "@happier-dev/protocol/workflows";

const PLAIN_OWNER_METADATA = { t: "plain", v: { v: 1 } } as const;
const ENCRYPTED_OWNER_METADATA = {
    t: "encrypted",
    c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==",
} as const;
const TEST_AUTHENTICATION = {
    env: process.env,
    authority: "present_user",
    authenticationEvidence: [],
} as const;

async function createOrRejoinLayout1SessionByTagInTx(
    tx: Parameters<typeof createOrRejoinLayout1SessionByTagWithAuthenticationInTx>[0],
    prepared: Parameters<typeof createOrRejoinLayout1SessionByTagWithAuthenticationInTx>[1],
) {
    return createOrRejoinLayout1SessionByTagWithAuthenticationInTx(tx, prepared, TEST_AUTHENTICATION);
}

async function createFreshBoundLayout1SessionInTx(
    tx: Parameters<typeof createFreshBoundLayout1SessionWithAuthenticationInTx>[0],
    params: Omit<Parameters<typeof createFreshBoundLayout1SessionWithAuthenticationInTx>[1], "authentication">,
) {
    return createFreshBoundLayout1SessionWithAuthenticationInTx(tx, {
        ...params,
        authentication: TEST_AUTHENTICATION,
    });
}

describe("Layout-1 Session constructor (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-layout1-session-create-",
            initAuth: false,
        });
    }, 120_000);

    afterAll(async () => {
        if (harness) await harness.close();
    });

    beforeEach(() => {
        vi.resetModules();
        harness.resetEnv({
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
        });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.automationRunAssignment.deleteMany(),
            () => db.automationRun.deleteMany(),
            () => db.automation.deleteMany(),
            () => db.session.deleteMany(),
            () => db.machine.deleteMany(),
            () => db.account.deleteMany(),
            () => db.homeSettings.deleteMany(),
        ]);
    });

    async function createPlainAccount(publicKey: string) {
        return db.account.create({
            data: { publicKey, encryptionMode: "plain" },
            select: { id: true },
        });
    }

    function prepared(params: Readonly<{
        accountId: string;
        tag: string;
        agentState?: string | null;
        accountEncryptionMode?: "plain" | "e2ee";
        dataEncryptionKey?: string | null;
        teamCredentialBindings?: import("@happier-dev/protocol/teams").SessionTeamCredentialBindingIntentListV1;
        initialAccess?: SessionInitialAccessMaterializedV1;
        originKind?: "none" | "session" | "execution_run" | "run_step";
        originSessionId?: string;
        originRunId?: string;
        workDepth?: number;
        reportsTo?: { sessionId: string };
    }>): PreparedLayout1SessionCreate {
        const accountEncryptionMode = params.accountEncryptionMode ?? "plain";
        const result = prepareLayout1SessionCreate({
            accountId: params.accountId,
            tag: params.tag,
            metadata: accountEncryptionMode === "plain"
                ? JSON.stringify({ v: 1 })
                : "opaque-shared-ciphertext",
            ownerMetadata: accountEncryptionMode === "plain"
                ? PLAIN_OWNER_METADATA
                : ENCRYPTED_OWNER_METADATA,
            agentState: params.agentState ?? null,
            dataEncryptionKey: params.dataEncryptionKey ?? null,
            requestedEncryptionMode: undefined,
            requestedStorageState: undefined,
            organizationPlacement: undefined,
            teamCredentialBindings: params.teamCredentialBindings,
            initialAccess: params.initialAccess,
            originKind: params.originKind,
            originSessionId: params.originSessionId,
            originRunId: params.originRunId,
            workDepth: params.workDepth,
            ...(params.reportsTo ? { reportsTo: params.reportsTo } : {}),
            accountEncryptionMode,
            storagePolicy: "optional",
            defaultAccountMode: "e2ee",
        });
        if (!result.ok) {
            throw new Error(`unexpected preparation rejection: ${result.rejection.reason}`);
        }
        return result.prepared;
    }

    it("atomically attaches ordinary and reserved-identity children without reattaching a rejoin", async () => {
        const owner = await createPlainAccount("pk-reports-to-create");
        const lead = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "reports-to-lead" })));
        if (lead.kind !== "created") throw new Error("Lead fixture was not created");
        const ordinary = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "reports-to-child", reportsTo: { sessionId: lead.session.id } })));
        if (ordinary.kind !== "created") throw new Error("Child was not created");
        const edge = await db.sessionReportsTo.findUniqueOrThrow({ where: { sessionId: ordinary.session.id } });
        expect(edge.leadSessionId).toBe(lead.session.id);
        // The constructor's publication/result must describe the committed row.
        expect((await db.session.findUniqueOrThrow({ where: { id: ordinary.session.id } })).updatedAt)
            .toEqual(ordinary.session.updatedAt);
        const reserved = await inTx((tx) => createFreshBoundLayout1SessionInTx(tx, {
            sessionId: "reports-to-reserved-child",
            prepared: prepared({ accountId: owner.id, tag: "reports-to-reserved", reportsTo: { sessionId: lead.session.id } }),
        }));
        expect(reserved.kind).toBe("created");
        if (reserved.kind === "created") {
            expect((await db.session.findUniqueOrThrow({ where: { id: reserved.session.id } })).updatedAt)
                .toEqual(reserved.session.updatedAt);
        }
        expect(await db.sessionReportsTo.findUnique({ where: { sessionId: "reports-to-reserved-child" } }))
            .toMatchObject({ leadSessionId: lead.session.id });
        const rejoined = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "reports-to-child", reportsTo: { sessionId: "absent-lead" } })));
        expect(rejoined.kind).toBe("rejoined");
        expect(await db.sessionReportsTo.findUniqueOrThrow({ where: { sessionId: ordinary.session.id } })).toEqual(edge);
        expect(await db.homeSettings.count()).toBe(0);
    });

    it("rolls back Session creation when the requested reportsTo lead is unreadable", async () => {
        const owner = await createPlainAccount("pk-reports-to-create-denied");
        await expect(inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "reports-to-denied", reportsTo: { sessionId: "absent-lead" } }))))
            .rejects.toMatchObject({ name: "SessionCreationReportsToError" });
        expect(await db.session.count({ where: { accountId: owner.id } })).toBe(0);
        expect(await db.sessionReportsTo.count()).toBe(0);
    });

    it("persists host-stamped origin and depth and keeps the first values on rejoin", async () => {
        const owner = await createPlainAccount("pk-origin-rejoin");
        const origin = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "origin-parent" })));
        if (origin.kind !== "created") throw new Error("Origin fixture was not created");
        const created = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "origin-child", originKind: "execution_run",
                originSessionId: origin.session.id, workDepth: 37 })));
        if (created.kind !== "created") throw new Error("Child was not created");
        const firstFacts = { originKind: "execution_run", originSessionId: origin.session.id,
            originRunId: null, workDepth: 37 };
        expect(created.session).toMatchObject(firstFacts);
        const rejoined = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "origin-child", originKind: "none", workDepth: 0 })));
        expect(rejoined.kind).toBe("rejoined");
        if (rejoined.kind === "rejoined") expect(rejoined.session).toMatchObject(firstFacts);
        expect(await db.session.findUniqueOrThrow({ where: { id: created.session.id } })).toMatchObject(firstFacts);
    });

    it("refuses an unreadable origin without inserting a child", async () => {
        const owner = await createPlainAccount("pk-origin-owner");
        const other = await createPlainAccount("pk-origin-other");
        const origin = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: other.id, tag: "private-origin" })));
        if (origin.kind !== "created") throw new Error("Origin fixture was not created");
        await expect(inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "forbidden-child", originKind: "session",
                originSessionId: origin.session.id, workDepth: 5 })))).rejects.toMatchObject({ name: "SessionCreationOriginError" });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(0);
    });

    it("refuses non-workflow Runs even when the creator owns the Automation row", async () => {
        const owner = await createPlainAccount("pk-workflow-origin-owner");
        const now = new Date();
        const automation = await db.automation.create({ data: { accountId: owner.id, name: "Ordinary automation", templateCiphertext: "{}" } });
        const ordinary = await db.automationRun.create({ data: {
            accountId: owner.id, automationId: automation.id, state: "succeeded",
            causeKind: "manual", causeOccurredAt: now, scheduledAt: now, dueAt: now,
        } });
        for (const runId of [ordinary.id, "missing-workflow-run"]) {
            await expect(inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
                prepared({ accountId: owner.id, tag: `refused-${runId}`, originKind: "run_step",
                    originRunId: runId, workDepth: 31 })))).rejects.toMatchObject({ name: "SessionCreationOriginError" });
        }
        expect(await db.session.count({ where: { accountId: owner.id } })).toBe(0);
    });

    it("accepts an admitted Workflow origin only for its owning Account", async () => {
        const owner = await createPlainAccount("pk-admitted-workflow-owner");
        const other = await createPlainAccount("pk-admitted-workflow-other");
        const machine = await db.machine.create({ data: { id: randomUUID(), accountId: owner.id, metadata: "{}" } });
        const runId = randomUUID();
        const accountCurrentness = await inTx((tx) => fetchAutomationAccountCurrentnessWitnessTx(tx, owner.id));
        if (!accountCurrentness) throw new Error("Plain Account currentness unavailable");
        const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
            mode: "plain",
            binding: { v: 1, purpose: "accepted_snapshot", accountId: owner.id, runId },
            acceptedSnapshot: await materializeWorkflowAcceptedSnapshotFixture({
                definition: { version: 1, inputs: [],
                    defaults: { agentTarget: { kind: "agent", identity: { pluginId: "happier.agent.test", localId: "test" } } },
                    blocks: [{ kind: "step", id: "step", document: { text: "Work", references: [], attachments: [] }, input: [], result: { kind: "text" } }] },
                context: { source: { kind: "inline" }, inputs: {},
                machineId: machine.id, executionTarget: { kind: "session" },
                workspaceTarget: { project: { machineId: machine.id, directory: "/repo", checkoutRootPath: "/repo" } },
                origin: { kind: "direct" },
                authorization: { principal: { kind: "host" } } },
            }),
        }));
        await admitWorkflowRun({ accountId: owner.id, runId, machineId: machine.id,
            origin: { kind: "direct" }, acceptedEnvelope, accountCurrentness });
        const child = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: owner.id, tag: "workflow-child", originKind: "run_step", originRunId: runId, workDepth: 31 })));
        if (child.kind !== "created") throw new Error("Workflow child was not created");
        expect(child.session).toMatchObject({ originKind: "run_step", originRunId: runId, workDepth: 31 });
        await expect(inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx,
            prepared({ accountId: other.id, tag: "foreign-workflow-child", originKind: "run_step", originRunId: runId, workDepth: 31 }))))
            .rejects.toMatchObject({ name: "SessionCreationOriginError" });
        expect(await db.session.count({ where: { accountId: other.id } })).toBe(0);
    });

    it("creates one canonical Layout-1 row and rejoins the same tag without rewriting its content", async () => {
        const owner = await createPlainAccount("pk-constructor-rejoin");

        const created = await inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            prepared({ accountId: owner.id, tag: "shared-tag" }),
        ));
        expect(created.kind).toBe("created");
        if (created.kind !== "created") return;
        expect(created.session).toMatchObject({
            accountId: owner.id,
            tag: "shared-tag",
            encryptionMode: "plain",
            metadataLayoutVersion: 1,
        });
        await expect(db.sessionDataKeyEnvelope.count({ where: { sessionId: created.session.id } })).resolves.toBe(0);
        expect(created.session.lastActiveAt.getTime())
            .toBe(created.session.createdAt.getTime());
        const creationChange = await db.accountChange.findUnique({
            where: { accountId_kind_entityId: { accountId: owner.id, kind: "session", entityId: created.session.id } },
        });
        expect(creationChange).toMatchObject({ sessionId: created.session.id });

        const rejoined = await inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            prepared({
                accountId: owner.id,
                tag: "shared-tag",
                agentState: JSON.stringify({ rewritten: true }),
            }),
        ));
        expect(rejoined.kind).toBe("rejoined");
        if (rejoined.kind !== "rejoined") return;
        expect(rejoined.session.id).toBe(created.session.id);
        expect(rejoined.session.agentState).toBeNull();
        if (!rejoined.session.meaningfulActivityAt || !created.session.meaningfulActivityAt) {
            throw new Error("Created and rejoined Sessions must have meaningful activity timestamps");
        }
        expect(rejoined.session.meaningfulActivityAt.getTime())
            .toBeGreaterThanOrEqual(created.session.meaningfulActivityAt.getTime());
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(1);
        const rejoinChange = await db.accountChange.findUniqueOrThrow({
            where: { accountId_kind_entityId: { accountId: owner.id, kind: "session", entityId: created.session.id } },
        });
        expect(rejoinChange.cursor).toBeGreaterThan(creationChange!.cursor);
    });

    it("rejoins without reapplying a different submitted initial-access draft", async () => {
        const owner = await createPlainAccount("pk-constructor-access-rejoin");
        const team = await db.team.create({ data: { name: "Initial access rejoin" } });
        await db.teamMembership.create({
            data: { teamId: team.id, accountId: owner.id, role: "owner" },
        });

        const created = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx, prepared({
            accountId: owner.id,
            tag: "access-rejoin",
            initialAccess: { grants: [{
                subject: { kind: "team", teamId: team.id },
                accessLevel: "view",
                canApprovePermissions: false,
            }] },
        })));
        expect(created.kind).toBe("created");
        if (created.kind !== "created") return;
        const stored = await db.sessionTeamGrant.findUniqueOrThrow({
            where: { sessionId_teamId: { sessionId: created.session.id, teamId: team.id } },
        });

        const rejoined = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx, prepared({
            accountId: owner.id,
            tag: "access-rejoin",
            initialAccess: { grants: [{
                subject: { kind: "team", teamId: team.id },
                accessLevel: "admin",
                canApprovePermissions: true,
            }] },
        })));

        expect(rejoined.kind).toBe("rejoined");
        await expect(db.sessionTeamGrant.findMany({ where: { sessionId: created.session.id } }))
            .resolves.toEqual([stored]);
    });

    it("rolls back the fresh Session when the credential-resource feature is disabled", async () => {
        const owner = await createPlainAccount("pk-constructor-binding");
        const team = await db.team.create({ data: { name: "Binding team" } });
        const resourceId = "session-binding-resource";
        await db.teamCredentialResource.create({
            data: {
                id: resourceId,
                teamId: team.id,
                custodianAccountId: owner.id,
                displayName: "Shared provider",
                disclosureCeiling: "brokered_only",
                sessionUsePolicy: "personal_allowed",
                sourceBindingJson: JSON.stringify({ v: 1, kind: "connected_pool" }),
            },
        });

        await expect(inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            prepared({
                accountId: owner.id,
                tag: "binding-session",
                teamCredentialBindings: [{
                    v: 1,
                    slot: { kind: "provider_model" },
                    resourceId,
                    expectedResourceRevision: 0,
                    deliveryMode: "brokered",
                }],
            }),
        ))).rejects.toMatchObject({ reason: "feature_disabled" });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(0);

    });

    it("rejects a mismatched Team route and commits an exact current Team credential binding with the fresh Session row", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED: "1",
        });
        const owner = await createPlainAccount("pk-constructor-binding-valid");
        const team = await db.team.create({ data: { name: "Binding team valid" } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: owner.id, role: "owner" } });
        const service = { pluginId: "example.session-binding", localId: "source" };
        const groupId = "source-pool";
        const pool = await db.connectedServiceAuthGroup.create({ data: {
            accountId: owner.id, groupId, servicePluginId: service.pluginId, serviceLocalId: service.localId,
            qualifiedServiceDigest: createQualifiedConnectedAccountServiceDigest(service),
            qualifiedGroupDigest: createQualifiedConnectedAccountGroupDigest({ service, groupId }), policyJson: "{}",
        } });
        const resourceId = "session-binding-resource-valid";
        await db.teamCredentialResource.create({ data: {
            id: resourceId, teamId: team.id, custodianAccountId: owner.id,
            displayName: "Shared provider", disclosureCeiling: "direct_allowed",
            sessionUsePolicy: "personal_allowed", allMembersDeliveryMode: "direct",
            sourceBindingJson: JSON.stringify({
                v: 1, kind: "connected_pool", target: { kind: "group", service, groupId }, poolIncarnation: pool.id,
            }),
        } });
        await expect(inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(tx, prepared({
            accountId: owner.id, tag: "binding-session-wrong-team",
            teamCredentialBindings: [{
                v: 1, slot: { kind: "provider_model" }, resourceId, expectedResourceRevision: 0,
                deliveryMode: "direct", teamId: crypto.randomUUID(),
            }],
        })))).rejects.toMatchObject({ reason: "invalid_input" });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(0);
        await expect(db.sessionTeamCredentialBinding.count()).resolves.toBe(0);

        const created = await inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(tx, prepared({
            accountId: owner.id, tag: "binding-session-valid",
            teamCredentialBindings: [{
                v: 1, slot: { kind: "provider_model" }, resourceId, expectedResourceRevision: 0,
                deliveryMode: "direct", teamId: team.id,
            }],
        })));
        expect(created.kind).toBe("created");
        if (created.kind !== "created") return;
        await expect(db.sessionTeamCredentialBinding.findUnique({
            where: {
                sessionId_slotKind_slotKey: {
                    sessionId: created.session.id,
                    slotKind: "provider_model:direct",
                    slotKey: Buffer.from(JSON.stringify(["provider_model"])),
                },
            },
        })).resolves.toMatchObject({ resourceId });
    });

    it("rolls back a Team credential binding when this credential does not satisfy the Team authentication policy", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED: "1",
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
        });
        const signing = tweetnacl.sign.keyPair();
        const content = tweetnacl.box.keyPair();
        const owner = await db.account.create({
            data: {
                publicKey: Buffer.from(signing.publicKey).toString("hex"),
                encryptionMode: "e2ee",
                contentPublicKey: new Uint8Array(content.publicKey),
                contentPublicKeySig: signAccountContentKeyBindingV1({
                    contentPublicKey: content.publicKey,
                    accountSigningSecretKey: signing.secretKey,
                }),
            },
            select: { id: true },
        });
        const team = await db.team.create({
            data: {
                name: "Restricted binding team",
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "home_method", methodId: "key_challenge" }],
                },
            },
        });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: owner.id, role: "owner" } });
        const service = { pluginId: "example.session-binding", localId: "restricted-source" };
        const groupId = "restricted-source-pool";
        const pool = await db.connectedServiceAuthGroup.create({ data: {
            accountId: owner.id, groupId, servicePluginId: service.pluginId, serviceLocalId: service.localId,
            qualifiedServiceDigest: createQualifiedConnectedAccountServiceDigest(service),
            qualifiedGroupDigest: createQualifiedConnectedAccountGroupDigest({ service, groupId }), policyJson: "{}",
        } });
        const resourceId = "session-binding-resource-restricted";
        await db.teamCredentialResource.create({ data: {
            id: resourceId, teamId: team.id, custodianAccountId: owner.id,
            displayName: "Restricted provider", disclosureCeiling: "direct_allowed",
            sessionUsePolicy: "personal_allowed", allMembersDeliveryMode: "direct",
            sourceBindingJson: JSON.stringify({
                v: 1, kind: "connected_pool", target: { kind: "group", service, groupId }, poolIncarnation: pool.id,
            }),
        } });

        const preparedRestrictedBinding = (tag: string) => prepared({
            accountId: owner.id,
            tag,
            accountEncryptionMode: "e2ee",
            dataEncryptionKey: Buffer.from(sealEncryptedDataKeyEnvelopeV1({
                dataKey: tweetnacl.randomBytes(32),
                recipientPublicKey: content.publicKey,
                randomBytes: (length) => tweetnacl.randomBytes(length),
            })).toString("base64"),
            teamCredentialBindings: [{
                v: 1,
                slot: { kind: "provider_model" },
                resourceId,
                expectedResourceRevision: 0,
                deliveryMode: "direct",
            }],
        });

        await expect(inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            preparedRestrictedBinding("binding-session-restricted"),
        ))).rejects.toMatchObject({ reason: "authentication_required" });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(0);

        const qualified = await inTx(async (tx) => createOrRejoinLayout1SessionByTagWithAuthenticationInTx(
            tx,
            preparedRestrictedBinding("binding-session-qualified"),
            {
                env: process.env,
                authority: "present_user",
                authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
            },
        ));
        expect(qualified.kind).toBe("created");

        await db.team.update({
            where: { id: team.id },
            data: { authenticationPolicy: { v: 999 } },
        });
        await expect(inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            preparedRestrictedBinding("binding-session-unavailable"),
        ))).rejects.toMatchObject({ reason: "authentication_unavailable" });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(1);
    });

    it.each(["existing", "raced_winner"] as const)(
        "restores an archived %s tag rejoin with current activity and retained Follow state",
        async (entry) => {
            const owner = await createPlainAccount(`pk-constructor-archived-${entry}`);
            const input = prepared({ accountId: owner.id, tag: `archived-${entry}` });
            const created = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx, input));
            expect(created.kind).toBe("created");
            if (created.kind !== "created") return;

            const oldActivityAt = new Date(1_000);
            await db.session.update({
                where: { id: created.session.id },
                data: {
                    active: false,
                    archivedAt: new Date(2_000),
                    meaningfulActivityAt: oldActivityAt,
                    pendingCount: 3,
                    pendingVersion: 4,
                },
            });
            await db.$executeRaw`INSERT INTO AccountSessionFollow
                (accountId, sessionId, following, notificationLevel, includeInVoice, voiceDeliveredFrontier)
                VALUES (${owner.id}, ${created.session.id}, true, 'important', true, ${JSON.stringify({ v: 1, transcriptSeq: 0, readyEventSeq: 0, agentStateVersion: 0, turn: null })})`;
            const creationChange = await db.accountChange.findUniqueOrThrow({
                where: {
                    accountId_kind_entityId: {
                        accountId: owner.id,
                        kind: "session",
                        entityId: created.session.id,
                    },
                },
            });
            const emitUpdate = vi.spyOn(eventRouter, "emitUpdate");
            const badgeTokenRead = vi.spyOn(db.accountPushToken, "findMany");
            emitUpdate.mockClear();

            const rejoined = await inTx((tx) => entry === "existing"
                ? createOrRejoinLayout1SessionByTagInTx(tx, input)
                : rejoinLayout1SessionByTagInTx(tx, input));
            expect(rejoined?.kind).toBe("rejoined");
            if (!rejoined || rejoined.kind !== "rejoined") return;

            expect(rejoined.session).toMatchObject({
                id: created.session.id,
                archivedAt: null,
                active: false,
                pendingCount: 3,
                pendingVersion: 4,
            });
            if (!rejoined.session.meaningfulActivityAt) {
                throw new Error("Restored Session must have a meaningful activity timestamp");
            }
            expect(rejoined.session.meaningfulActivityAt.getTime()).toBeGreaterThan(oldActivityAt.getTime());
            await expect(db.accountSessionFollow.findUniqueOrThrow({
                where: { accountId_sessionId: { accountId: owner.id, sessionId: created.session.id } },
                select: { following: true, includeInVoice: true, voiceDeliveredFrontier: true },
            })).resolves.toEqual({
                following: true,
                includeInVoice: true,
                voiceDeliveredFrontier: null,
            });
            const rejoinChange = await db.accountChange.findUniqueOrThrow({
                where: {
                    accountId_kind_entityId: {
                        accountId: owner.id,
                        kind: "session",
                        entityId: created.session.id,
                    },
                },
            });
            expect(rejoinChange.cursor).toBeGreaterThan(creationChange.cursor);
            expect(rejoined.publication?.badgeAttentionChanged).toBe(true);
            await publishSessionArchiveTransition(rejoined.publication!);
            expect(emitUpdate).toHaveBeenCalledWith(expect.objectContaining({
                recipientFilter: {
                    type: "all-interested-in-session",
                    sessionId: created.session.id,
                },
            }));
            expect(emitUpdate).toHaveBeenCalledWith(expect.objectContaining({
                recipientFilter: { type: "user-machine-scoped-only" },
            }));
            await vi.waitFor(() => {
                expect(badgeTokenRead).toHaveBeenCalledWith({
                    where: { accountId: { in: [owner.id] } },
                    select: { accountId: true, token: true },
                });
            });
        },
    );

    it("keeps an active unarchived tag rejoin unchanged", async () => {
        const owner = await createPlainAccount("pk-constructor-active-rejoin");
        const input = prepared({ accountId: owner.id, tag: "active-rejoin" });
        const created = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx, input));
        expect(created.kind).toBe("created");
        if (created.kind !== "created") return;
        const before = await db.session.update({
            where: { id: created.session.id },
            data: { active: true },
        });

        const rejoined = await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx, input));
        expect(rejoined.kind).toBe("rejoined");
        if (rejoined.kind !== "rejoined") return;
        expect(rejoined.session).toEqual(before);
        expect(rejoined.publication).toBeNull();
        await expect(db.session.findUniqueOrThrow({ where: { id: before.id } })).resolves.toEqual(before);
    });

    it.each(["ordinary", "fresh_bound"] as const)("%s creation rolls back when its durable change cannot be written", async (entry) => {
        const owner = await createPlainAccount(`pk-constructor-publication-${entry}`);
        await db.$executeRawUnsafe(`CREATE TRIGGER reject_session_creation_change BEFORE INSERT ON AccountChange
            WHEN NEW.kind = 'session' BEGIN SELECT RAISE(ABORT, 'test_change_write_rejected'); END`);
        try {
            const input = prepared({ accountId: owner.id, tag: "publication-failure" });
            await expect(inTx(async (tx): Promise<Layout1SessionCreateOutcome<FreshBoundLayout1SessionCreateRejection>> => {
                if (entry === "ordinary") return await createOrRejoinLayout1SessionByTagInTx(tx, input);
                return await createFreshBoundLayout1SessionInTx(tx, { prepared: input, sessionId: "reserved-publication-failure" });
            })).rejects.toThrow();
            await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(0);
            await expect(db.accountChange.count({ where: { accountId: owner.id } })).resolves.toBe(0);
            await expect(db.account.findUnique({ where: { id: owner.id }, select: { seq: true } })).resolves.toEqual({ seq: 0 });
        } finally {
            await db.$executeRawUnsafe("DROP TRIGGER reject_session_creation_change");
        }
    });

    it.each(["ordinary", "fresh_bound"] as const)(
        "%s E2EE creation rolls back its canonical owner tuple when publication fails",
        async (entry) => {
            const signing = tweetnacl.sign.keyPair();
            const content = tweetnacl.box.keyPair();
            const owner = await db.account.create({
                data: {
                    publicKey: Buffer.from(signing.publicKey).toString("hex"),
                    encryptionMode: "e2ee",
                    contentPublicKey: new Uint8Array(content.publicKey),
                    contentPublicKeySig: signAccountContentKeyBindingV1({
                        contentPublicKey: content.publicKey,
                        accountSigningSecretKey: signing.secretKey,
                    }),
                },
                select: { id: true },
            });
            await db.$executeRawUnsafe(`CREATE TRIGGER reject_e2ee_session_creation_change BEFORE INSERT ON AccountChange
                WHEN NEW.kind = 'session' BEGIN SELECT RAISE(ABORT, 'test_change_write_rejected'); END`);
            try {
                const input = prepared({
                    accountId: owner.id,
                    tag: `e2ee-publication-failure-${entry}`,
                    accountEncryptionMode: "e2ee",
                    dataEncryptionKey: Buffer.from(tweetnacl.randomBytes(32)).toString("base64"),
                });
                await expect(inTx(async (tx): Promise<Layout1SessionCreateOutcome<FreshBoundLayout1SessionCreateRejection>> => {
                    if (entry === "ordinary") return await createOrRejoinLayout1SessionByTagInTx(tx, input);
                    return await createFreshBoundLayout1SessionInTx(tx, {
                        prepared: input,
                        sessionId: "reserved-e2ee-publication-failure",
                    });
                })).rejects.toThrow();
                await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(0);
                await expect(db.sessionDataKeyEnvelope.count({
                    where: { recipientAccountId: owner.id },
                })).resolves.toBe(0);
                await expect(db.accountChange.count({ where: { accountId: owner.id } })).resolves.toBe(0);
                await expect(db.account.findUnique({
                    where: { id: owner.id },
                    select: { seq: true },
                })).resolves.toEqual({ seq: 0 });
            } finally {
                await db.$executeRawUnsafe("DROP TRIGGER reject_e2ee_session_creation_change");
            }
        },
    );

    it("refuses to rejoin a stored owner envelope that no longer matches the current Account mode", async () => {
        const owner = await createPlainAccount("pk-constructor-currentness");
        const created = await inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            prepared({ accountId: owner.id, tag: "currentness-tag" }),
        ));
        expect(created.kind).toBe("created");

        const signing = tweetnacl.sign.keyPair();
        const content = tweetnacl.box.keyPair();
        const contentPublicKeySig = signAccountContentKeyBindingV1({
            accountSigningSecretKey: signing.secretKey,
            contentPublicKey: content.publicKey,
        });
        await db.account.update({
            where: { id: owner.id },
            data: {
                publicKey: Buffer.from(signing.publicKey).toString("hex"),
                encryptionMode: "e2ee",
                contentPublicKey: new Uint8Array(content.publicKey),
                contentPublicKeySig: new Uint8Array(contentPublicKeySig),
            },
        });

        const rejoinAttempt = await inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            prepared({
                accountId: owner.id,
                tag: "currentness-tag",
                accountEncryptionMode: "e2ee",
            }),
        ));
        expect(rejoinAttempt).toEqual({
            kind: "rejected",
            rejection: { reason: "privacy-upgrade-required" },
        });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(1);
    });

    it("creates a fresh bound Session at its reserved identity", async () => {
        const owner = await createPlainAccount("pk-constructor-fresh");

        const outcome = await inTx(async (tx) => createFreshBoundLayout1SessionInTx(tx, {
            prepared: prepared({ accountId: owner.id, tag: "reserved-tag" }),
            sessionId: "reserved-session-id",
        }));

        expect(outcome.kind).toBe("created");
        if (outcome.kind !== "created") return;
        expect(outcome.session.id).toBe("reserved-session-id");
        expect(outcome.session.metadataLayoutVersion).toBe(1);
        await expect(db.session.findUniqueOrThrow({
            where: { id: "reserved-session-id" },
            select: { accountId: true, tag: true },
        })).resolves.toEqual({ accountId: owner.id, tag: "reserved-tag" });
    });

    it.each(["ordinary", "fresh_bound", "rejoin"] as const)(
        "%s creation rejects an Account suspended after request preparation",
        async (entry) => {
            const owner = await createPlainAccount(`pk-constructor-suspended-${entry}`);
            const input = prepared({ accountId: owner.id, tag: "suspended-tag" });
            if (entry === "rejoin") {
                await inTx((tx) => createOrRejoinLayout1SessionByTagInTx(tx, input));
            }
            await db.account.update({
                where: { id: owner.id },
                data: { status: "suspended" },
            });

            const outcome = await inTx(async (tx): Promise<Layout1SessionCreateOutcome<FreshBoundLayout1SessionCreateRejection>> => {
                if (entry === "ordinary") return createOrRejoinLayout1SessionByTagInTx(tx, input);
                if (entry === "rejoin") {
                    const rejoined = await rejoinLayout1SessionByTagInTx(tx, input);
                    if (!rejoined) throw new Error("expected the existing Session to remain visible");
                    return rejoined;
                }
                return createFreshBoundLayout1SessionInTx(tx, {
                    prepared: input,
                    sessionId: "suspended-reserved-session",
                });
            });

            expect(outcome).toEqual({
                kind: "rejected",
                rejection: { reason: "account-disabled" },
            });
            await expect(db.session.count({ where: { accountId: owner.id } }))
                .resolves.toBe(entry === "rejoin" ? 1 : 0);
        },
    );

    it("legacy creation rejects a creator disabled before the transaction", async () => {
        const signing = tweetnacl.sign.keyPair();
        const content = tweetnacl.box.keyPair();
        const owner = await db.account.create({
            data: {
                publicKey: Buffer.from(signing.publicKey).toString("hex"),
                encryptionMode: "e2ee",
                contentPublicKey: new Uint8Array(content.publicKey),
                contentPublicKeySig: signAccountContentKeyBindingV1({
                    contentPublicKey: content.publicKey,
                    accountSigningSecretKey: signing.secretKey,
                }),
            },
            select: { id: true },
        });
        await db.account.update({ where: { id: owner.id }, data: { status: "disabled" } });

        await expect(inTx((tx) => createLegacyLayout0SessionInTx(tx, {
            accountId: owner.id,
            tag: "legacy-disabled",
            metadata: "opaque-legacy-metadata",
            agentState: null,
            encryptionMode: "e2ee",
            requestedStorageState: undefined,
            dataEncryptionKey: new Uint8Array(32),
        }))).rejects.toMatchObject({ code: "account-disabled" });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(0);
    });

    it("never attaches a fresh bound Session to an unrelated existing tag", async () => {
        const owner = await createPlainAccount("pk-constructor-fresh-tag");
        const existing = await inTx(async (tx) => createOrRejoinLayout1SessionByTagInTx(
            tx,
            prepared({ accountId: owner.id, tag: "occupied-tag" }),
        ));
        expect(existing.kind).toBe("created");

        const outcome = await inTx(async (tx) => createFreshBoundLayout1SessionInTx(tx, {
            prepared: prepared({ accountId: owner.id, tag: "occupied-tag" }),
            sessionId: "fresh-session-id",
        }));

        expect(outcome).toEqual({
            kind: "rejected",
            rejection: { reason: "session-tag-taken" },
        });
        await expect(db.session.findUnique({
            where: { id: "fresh-session-id" },
        })).resolves.toBeNull();
    });

    it("refuses a reserved Session identity that is already used", async () => {
        const owner = await createPlainAccount("pk-constructor-fresh-id");
        await inTx(async (tx) => createFreshBoundLayout1SessionInTx(tx, {
            prepared: prepared({ accountId: owner.id, tag: "first-tag" }),
            sessionId: "taken-session-id",
        }));

        const outcome = await inTx(async (tx) => createFreshBoundLayout1SessionInTx(tx, {
            prepared: prepared({ accountId: owner.id, tag: "second-tag" }),
            sessionId: "taken-session-id",
        }));

        expect(outcome).toEqual({
            kind: "rejected",
            rejection: { reason: "session-id-taken" },
        });
        await expect(db.session.count({ where: { accountId: owner.id } })).resolves.toBe(1);
    });
});
