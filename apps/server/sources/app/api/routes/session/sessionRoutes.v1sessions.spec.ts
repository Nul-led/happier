import { beforeEach, describe, expect, it, vi } from "vitest";
import tweetnacl from "tweetnacl";
import {
    signAccountContentKeyBindingV1,
    CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
} from "@happier-dev/protocol";

import {
    accountFindUnique,
    createSessionAccessProjectionRelations,
    createSessionRouteTestBuilder,
    resetSessionRouteMocks,
    sessionFindMany,
    sessionShareFindMany,
} from "./sessionRoutes.testkit";
import { DEFAULT_SESSION_ROLLBACK_ELIGIBLE_TURN_RELATION_LIMIT } from "@/app/session/listing/readLimits";

const OWNER_METADATA_CIPHERTEXT =
    "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==";
const OWNER_METADATA_ENVELOPE = {
    t: "encrypted",
    c: OWNER_METADATA_CIPHERTEXT,
} as const;
const LEGACY_ACCOUNT_STORED_CONTENT_COMPATIBILITY = {
    supportsCurrentProtocol: false,
    outcome: "legacy-protocol-too-old",
    declaration: { v: 1 as const, protocolVersion: 1 },
    upgradeRequired: {
        error: "client-upgrade-required",
        requirement: {
            v: 1 as const,
            kind: "account-stored-content" as const,
            minimumProtocolVersion:
                CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
        },
    },
} as const;

function createE2eeAccountFixture() {
    const signing = tweetnacl.sign.keyPair();
    const content = tweetnacl.box.keyPair();
    return {
        encryptionMode: "e2ee" as const,
        publicKey: Buffer.from(signing.publicKey).toString("hex"),
        contentPublicKey: new Uint8Array(content.publicKey),
        contentPublicKeySig: new Uint8Array(
            signAccountContentKeyBindingV1({
                accountSigningSecretKey: signing.secretKey,
                contentPublicKey: content.publicKey,
            }),
        ),
    };
}

function v1ListSessionRow(
    id: string,
    updatedAtMs: number,
    overrides: Readonly<Record<string, unknown>> = {},
) {
    const updatedAt = new Date(updatedAtMs);
    const accountId = typeof overrides.accountId === "string"
        ? overrides.accountId
        : "u1";
    const metadataLayoutVersion = typeof overrides.metadataLayoutVersion === "number"
        ? overrides.metadataLayoutVersion
        : 1;
    const encryptionMode = overrides.encryptionMode === "plain"
        ? "plain"
        : "e2ee";
    return {
        ...createSessionAccessProjectionRelations(),
        id,
        seq: 1,
        accountId,
        currentStorageState: "hosted",
        acceptedThroughServerSeq: null,
        materializationPublicationId: null,
        materializedThroughSourceAt: null,
        publishedThroughServerSeq: null,
        createdAt: updatedAt,
        updatedAt,
        meaningfulActivityAt: updatedAt,
        archivedAt: null,
        encryptionMode,
        metadata: "{}",
        metadataVersion: 1,
        metadataLayoutVersion,
        ownerMetadata:
            Object.prototype.hasOwnProperty.call(overrides, "ownerMetadata")
                ? overrides.ownerMetadata
                : JSON.stringify(OWNER_METADATA_ENVELOPE),
        agentState: null,
        agentStateVersion: 0,
        lastViewedSessionSeq: 0,
        responsibleAccountId: null,
        pendingPermissionRequestCount: 0,
        pendingUserActionRequestCount: 0,
        pendingRequestObservedAt: null,
        latestTurnId: null,
        latestTurnStatus: null,
        latestTurnStatusObservedAt: null,
        lastRuntimeIssue: null,
        latestReadyEventSeq: null,
        turns: [],
        dataEncryptionKey: null,
        dataKeyEnvelopes: [],
        pendingCount: 0,
        pendingBlockedCount: 0,
        pendingVersion: 0,
        active: false,
        lastActiveAt: updatedAt,
        accountReadStates: accountId === "u1"
            ? [{ accountId: "u1", lastViewedSessionSeq: 0, unreadSince: null }]
            : [],
        accountFollows: [],
        sessionPins: [],
        sessionAttentionStandings: [],
        shares: accountId === "u1"
            ? []
            : [{
                id: `${id}-direct-grant`,
                sharedWithUserId: "u1",
                accessLevel: "view",
                canApprovePermissions: false,
            }],
        ...overrides,
    };
}

describe("sessionRoutes v1 sessions snapshot", () => {
    beforeEach(() => {
        resetSessionRouteMocks();
        accountFindUnique.mockReset();
        accountFindUnique.mockResolvedValue(
            createE2eeAccountFixture(),
        );
        sessionFindMany.mockReset();
        sessionShareFindMany.mockReset();
    });

    it("GET /v1/sessions returns pendingCount + pendingVersion for owned sessions", async () => {
        sessionFindMany.mockResolvedValue([
            v1ListSessionRow("s1", 1, {
                metadata: "m1",
                metadataLayoutVersion: 0,
                ownerMetadata: null,
                pendingCount: 2,
                pendingVersion: 7,
                active: true,
            }),
        ]);
        sessionShareFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { response: res } = await route.invoke();

        expect(sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({
                turns: expect.objectContaining({ take: DEFAULT_SESSION_ROLLBACK_ELIGIBLE_TURN_RELATION_LIMIT }),
            }),
        }));
        expect(sessionShareFindMany).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({
                session: expect.objectContaining({
                    select: expect.objectContaining({
                        turns: expect.objectContaining({ take: DEFAULT_SESSION_ROLLBACK_ELIGIBLE_TURN_RELATION_LIMIT }),
                    }),
                }),
            }),
        }));
        expect(res).toEqual({
            sessions: [
                expect.objectContaining({
                    id: "s1",
                    pendingCount: 2,
                    pendingVersion: 7,
                }),
            ],
        });
        expect(accountFindUnique).not.toHaveBeenCalled();
    });

    it("reads Account currentness only for emitted layout-one owners", async () => {
        sessionFindMany.mockResolvedValue([
            v1ListSessionRow("owned-layout-one-omitted", 1),
        ]);
        const sharedRows = Array.from({ length: 150 }, (_, index) => ({
            accessLevel: "view",
            canApprovePermissions: false,
            encryptedDataKey: null,
            sharedByUserId: "owner",
            sharedByUser: {},
            session: v1ListSessionRow(
                `shared-${index}`,
                1_000 + index,
                { accountId: "owner" },
            ),
        }));
        sessionShareFindMany.mockResolvedValue(sharedRows);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { reply, response } = await route.invoke();

        expect(reply.statusCode).toBe(200);
        const emitted = (response as { sessions: Array<{ id: string }> }).sessions;
        expect(emitted).toHaveLength(150);
        expect(emitted.map((session) => session.id)).not.toContain(
            "owned-layout-one-omitted",
        );
        expect(accountFindUnique).toHaveBeenCalledTimes(1);
        expect(accountFindUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "owner" },
        }));
    });

    it("does not require current stored-content support for a layout-one candidate omitted from the emitted 150", async () => {
        sessionFindMany.mockResolvedValue(
            Array.from({ length: 150 }, (_, index) =>
                v1ListSessionRow(
                    `legacy-visible-owned-${index}`,
                    1_000 + index,
                    {
                        metadataLayoutVersion: 0,
                        ownerMetadata: null,
                    },
                )),
        );
        sessionShareFindMany.mockResolvedValue([{
            accessLevel: "view",
            canApprovePermissions: false,
            encryptedDataKey: null,
            sharedByUserId: "owner",
            sharedByUser: {},
            session: v1ListSessionRow(
                "layout-one-shared-candidate",
                1,
                { accountId: "owner" },
            ),
        }]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { reply, response } = await route.invoke({
            accountStoredContentCompatibility:
                LEGACY_ACCOUNT_STORED_CONTENT_COMPATIBILITY,
        });

        expect(reply.statusCode).toBe(200);
        const emitted = (response as { sessions: Array<{ id: string }> }).sessions;
        expect(emitted).toHaveLength(150);
        expect(emitted.map((session) => session.id)).not.toContain(
            "layout-one-shared-candidate",
        );
        expect(accountFindUnique).not.toHaveBeenCalled();
    });

    it("omits an incompatible emitted row without rejecting a compatible released page", async () => {
        const compatible = v1ListSessionRow("compatible-layout-zero", 2_000, {
                metadataLayoutVersion: 0,
                ownerMetadata: null,
            });
        sessionFindMany.mockImplementation(async (query) => {
            const filtersLegacyRows = (query.where?.AND ?? []).some((clause: unknown) =>
                (clause as { metadataLayoutVersion?: unknown })?.metadataLayoutVersion !== undefined);
            return filtersLegacyRows
                ? [compatible]
                : [compatible, v1ListSessionRow("incompatible-layout-one", 1_000)];
        });
        sessionShareFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { reply, response } = await route.invoke({
            accountStoredContentCompatibility:
                LEGACY_ACCOUNT_STORED_CONTENT_COMPATIBILITY,
        });

        expect(reply.statusCode).toBe(200);
        expect((response as { sessions: Array<{ id: string }> }).sessions)
            .toEqual([expect.objectContaining({ id: "compatible-layout-zero" })]);
        expect(sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                AND: expect.arrayContaining([
                    { metadataLayoutVersion: { not: 1 } },
                ]),
            }),
        }));
        expect(accountFindUnique).not.toHaveBeenCalled();
    });

    it("reads Account currentness exactly once when emitted rows include owned layout one", async () => {
        sessionFindMany.mockResolvedValue([
            v1ListSessionRow("owned-layout-one-newer", 2_000),
            v1ListSessionRow("owned-layout-one-older", 1_999),
        ]);
        sessionShareFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { reply, response } = await route.invoke();

        expect(reply.statusCode).toBe(200);
        expect(response).toEqual({
            sessions: [
                expect.objectContaining({ id: "owned-layout-one-newer" }),
                expect.objectContaining({ id: "owned-layout-one-older" }),
            ],
        });
        expect(accountFindUnique).toHaveBeenCalledTimes(1);
    });

    it("GET /v1/sessions returns materialized turn observed timestamps for owned sessions", async () => {
        sessionFindMany.mockResolvedValue([
            v1ListSessionRow("s1", 1, {
                metadata: "m1",
                metadataLayoutVersion: 0,
                ownerMetadata: null,
                active: true,
                latestTurnId: "turn-1",
                latestTurnStatus: "in_progress",
                latestTurnStatusObservedAt: BigInt(1234),
            }),
        ]);
        sessionShareFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { response: res } = await route.invoke();

        expect(res).toEqual({
            sessions: [
                expect.objectContaining({
                    id: "s1",
                    latestTurnStatus: "in_progress",
                    latestTurnStatusObservedAt: 1234,
                    transcriptShareable: true,
                }),
            ],
        });
    });

    it("GET /v1/sessions omits all owner-only fields from a layout-one shared row", async () => {
        const now = new Date(1);
        sessionFindMany.mockResolvedValue([]);
        sessionShareFindMany.mockResolvedValue([
            {
                accessLevel: "edit",
                canApprovePermissions: true,
                encryptedDataKey: Buffer.from([1, 2, 3]),
                sharedByUserId: "owner",
                sharedByUser: {},
                session: v1ListSessionRow("s2", now.getTime(), {
                    accountId: "owner",
                    seq: 2,
                    metadata: "m2",
                    metadataLayoutVersion: 1,
                    ownerMetadata: JSON.stringify(OWNER_METADATA_ENVELOPE),
                    agentState: "full-owner-agent-state",
                    agentStateVersion: 8,
                    pendingCount: 9,
                    pendingVersion: 10,
                    active: true,
                }),
            },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { response: res } = await route.invoke();

        expect(res).toEqual({
            sessions: [
                expect.objectContaining({
                    id: "s2",
                    pendingCount: 9,
                    pendingVersion: 10,
                    metadata: "m2",
                    metadataLayoutVersion: 1,
                    transcriptShareable: true,
                }),
            ],
        });
        const session = (res as { sessions: unknown[] }).sessions[0];
        expect(session).not.toHaveProperty("ownerMetadata");
        expect(session).toMatchObject({
            agentState: null,
            agentStateVersion: 8,
        });
    });

    it("GET /v1/sessions omits one unmigrated layout-zero share and keeps the rest of the page", async () => {
        const now = new Date(1);
        sessionFindMany.mockResolvedValue([
            v1ListSessionRow("owned-current", now.getTime(), { active: true }),
        ]);
        sessionShareFindMany.mockResolvedValue([
            {
                accessLevel: "view",
                canApprovePermissions: false,
                encryptedDataKey: null,
                sharedByUserId: "owner",
                sharedByUser: {},
                session: v1ListSessionRow("legacy-shared", now.getTime(), {
                    seq: 2,
                    accountId: "owner",
                    metadata: "legacy-whole-bag",
                    ownerMetadata: null,
                    metadataLayoutVersion: 0,
                    agentState: "legacy-owner-state",
                    agentStateVersion: 8,
                    active: true,
                }),
            },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { reply, response: res } = await route.invoke();

        // One unmigrated historical share degrades per row: the reader's other rows
        // stay usable and the refusal stays visible through the count instead of
        // silently shrinking the page.
        expect(reply.statusCode).toBe(200);
        const payload = res as {
            sessions: ReadonlyArray<{ id: string }>;
            metadataUpgradeRequiredCount?: number;
        };
        expect(payload.sessions.map((session) => session.id)).toEqual(["owned-current"]);
        expect(payload.metadataUpgradeRequiredCount).toBe(1);
        expect(sessionShareFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                select: expect.objectContaining({
                    session: expect.objectContaining({
                        select: expect.objectContaining({ accountId: true }),
                    }),
                }),
            }),
        );
    });

    it("refills equal-recency shared snapshots without repeating an offset boundary row", async () => {
        const shareAt = (index: number, publicationId: string) => {
            const observedAt = 10_000;
            return {
                accessLevel: "view",
                canApprovePermissions: false,
                encryptedDataKey: null,
                sharedByUserId: "owner",
                sharedByUser: {},
                session: v1ListSessionRow(`shared-${index}`, observedAt, {
                    accountId: "owner",
                    seq: 1,
                    currentStorageState: "snapshot_complete",
                    acceptedThroughServerSeq: null,
                    materializationPublicationId: publicationId,
                    materializedThroughSourceAt: BigInt(observedAt),
                    publishedThroughServerSeq: 1,
                    encryptionMode: "plain",
                    metadata: JSON.stringify({ v: 1 }),
                }),
            };
        };
        const malformed = shareAt(0, " ");
        const admitted = Array.from({ length: 149 }, (_, index) =>
            shareAt(index + 1, `publication-${index + 1}`));
        const boundary = shareAt(150, "publication-150");

        sessionFindMany.mockResolvedValue([]);
        sessionShareFindMany.mockImplementation(async (args) => {
            const storageState = args.where?.session?.AND?.[0]?.currentStorageState;
            if (storageState === "hosted") return [];
            if (args.skip !== 150) return [malformed, ...admitted];
            const hasStableTieBreaker = Array.isArray(args.orderBy)
                && args.orderBy[1]?.session?.id === "desc";
            return hasStableTieBreaker ? [boundary] : [admitted.at(-1)!];
        });

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
        const { response } = await route.invoke();
        const sessions = (response as { sessions: Array<{ id: string }> }).sessions;

        expect(sessions).toHaveLength(150);
        expect(sessions.map((session) => session.id)).toContain("shared-150");
        expect(sessionShareFindMany).toHaveBeenCalledWith(expect.objectContaining({
            orderBy: [
                { session: { materializedThroughSourceAt: "desc" } },
                { session: { id: "desc" } },
            ],
            skip: 150,
            take: 1,
        }));
    });

    it.each(["machine_only", "server_partial"] as const)(
        "GET /v1/sessions omits a shared session while transcript storage is %s",
        async (currentStorageState) => {
            const now = new Date(1);
            sessionFindMany.mockResolvedValue([]);
            sessionShareFindMany.mockResolvedValue([{
                accessLevel: "view",
                canApprovePermissions: false,
                encryptedDataKey: Buffer.from([1]),
                sharedByUserId: "owner",
                sharedByUser: {},
                session: v1ListSessionRow("shared-external", now.getTime(), {
                    accountId: "owner",
                    seq: 1,
                    currentStorageState,
                    acceptedThroughServerSeq: currentStorageState === "server_partial" ? 1 : null,
                    materializationPublicationId: null,
                    materializedThroughSourceAt: null,
                    publishedThroughServerSeq: null,
                    metadata: "m",
                }),
            }]);

            const route = await createSessionRouteTestBuilder("GET", "/v1/sessions");
            const { response } = await route.invoke();

            expect(sessionShareFindMany).toHaveBeenCalledTimes(2);
            expect(sessionShareFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
                orderBy: [
                    { session: { updatedAt: "desc" } },
                    { session: { id: "desc" } },
                ],
                take: 150,
                where: {
                    sharedWithUserId: "u1",
                    session: expect.objectContaining({
                        archivedAt: null,
                        AND: expect.arrayContaining([{ currentStorageState: "hosted" }]),
                    }),
                },
            }));
            expect(sessionShareFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
                orderBy: [
                    { session: { materializedThroughSourceAt: "desc" } },
                    { session: { id: "desc" } },
                ],
                take: 150,
                where: {
                    sharedWithUserId: "u1",
                    session: expect.objectContaining({
                        archivedAt: null,
                        AND: expect.arrayContaining([expect.objectContaining({
                            currentStorageState: "snapshot_complete",
                            materializationPublicationId: { not: "" },
                            materializedThroughSourceAt: {
                                gte: 0,
                                lte: BigInt(Number.MAX_SAFE_INTEGER),
                            },
                            publishedThroughServerSeq: expect.objectContaining({ gte: 0 }),
                        })]),
                    }),
                },
            }));
            expect(response).toEqual({ sessions: [] });
        },
    );

});
