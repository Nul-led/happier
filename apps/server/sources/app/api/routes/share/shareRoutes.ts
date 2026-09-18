import { buildSessionAccessWhere } from "@/app/session/access/sessionAccessWhere";
import { type Fastify } from "../../types";
import { db } from "@/storage/db";
import { z } from "zod";
import {
    resolveSessionAccessForOperation,
} from "@/app/session/access/sessionAccess";
import {
    deleteSessionAccessGrantInTx,
    putSessionAccessGrantInTx,
    type SessionAccessDirectShareRow,
    type SessionAccessGrantErrorCode,
} from "@/app/session/access/sessionAccessGrantService";
import {
    projectReleasedDirectShareEvent,
    scheduleReleasedDirectShareEvent,
} from "@/app/session/access/publishSessionAccessChange";
import { ACCOUNT_DISPLAY_PROFILE_SELECT, toShareUserProfile } from "@/app/account/profile/accountDisplayProfile";
import { inTx, type Tx } from "@/storage/inTx";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { tryParseDirectShareEncryptedDataKey } from "./directShareEncryptedDataKeyValidation";
import { SESSION_TRANSCRIPT_PUBLICATION_SELECT } from "@/app/session/sessionTranscriptPublicationPolicy";
import {
    createSessionMetadataPrivacyUpgradeRequiredResponse,
    isSessionMetadataPrivacyUpgradeRequiredError,
    projectSessionMetadataForRecipient,
    readSessionMetadataOwnerAccountMode,
} from "@/app/session/metadata/sessionMetadataRecipientProjection";
import {
    enforceCurrentAccountStoredContentCompatibilityForHttpRequest,
    readAccountStoredContentCompatibilityForHttpRequest,
} from "@/app/clientCompatibility/accountStoredContentCompatibility";
import {
    ReleasedDirectSessionShareCreateRequestV1Schema,
    ReleasedDirectSessionShareDeleteResponseV1Schema,
    ReleasedDirectSessionSharePatchRequestV1Schema,
    ReleasedDirectSessionShareResponseV1Schema,
    ReleasedDirectSessionSharesResponseV1Schema,
    ReleasedDirectSessionShareV1Schema,
    SESSION_METADATA_LAYOUT_VERSION_V1,
    type ReleasedDirectSessionShareV1,
} from "@happier-dev/protocol";
import { readSessionAccessAuthenticationFromRequest } from "@/app/session/access/sessionAccessAuthentication";

/**
 * Released direct-sharing API.
 *
 * These routes are compatibility adapters: they parse the released Account-only
 * request shapes, delegate every access decision and every write to the canonical
 * Session access grant service, and project the released response and socket event.
 * They must not regain a mutation path, an access decision, or a direct Prisma write.
 */

async function projectReleasedShareResponse(
    tx: Tx,
    share: SessionAccessDirectShareRow,
): Promise<ReleasedDirectSessionShareV1> {
    const sharedWithUser = await tx.account.findUniqueOrThrow({
        where: { id: share.sharedWithUserId },
        select: ACCOUNT_DISPLAY_PROFILE_SELECT,
    });
    return ReleasedDirectSessionShareV1Schema.parse({
        id: share.id,
        sharedWithUser: toShareUserProfile(sharedWithUser),
        accessLevel: share.accessLevel,
        canApprovePermissions: share.canApprovePermissions,
        createdAt: share.createdAt.getTime(),
        updatedAt: share.updatedAt.getTime(),
    });
}

/**
 * Map canonical outcomes onto the exact released status/body pairs.
 *
 * `subject_ineligible` keeps the released "friends" wording because a released
 * client renders it verbatim. The canonical eligibility rule now also accepts a
 * current shared-Team colleague, so this body is only reached when neither source
 * applies.
 */
const RELEASED_ERROR_RESPONSE: Readonly<
    Record<SessionAccessGrantErrorCode, Readonly<{ status: number; body: Readonly<Record<string, string>> }>>
> = Object.freeze({
    invalid_request: { status: 400, body: { error: "Invalid encryptedDataKey" } },
    data_key_not_required: { status: 400, body: { error: "Invalid encryptedDataKey" } },
    recipient_envelope_required: { status: 400, body: { error: "encryptedDataKey required" } },
    recipient_key_unavailable: { status: 400, body: { error: "Recipient key unavailable" } },
    session_access_transcript_not_shareable: {
        status: 409,
        body: {
            error: "Session transcript is not shareable",
            code: "session_transcript_not_shareable",
        },
    },
    session_access_forbidden: { status: 403, body: { error: "Forbidden" } },
    session_access_authentication_required: { status: 403, body: { error: "Forbidden" } },
    session_access_authentication_unavailable: {
        status: 503,
        body: { error: "session_access_authentication_unavailable" },
    },
    session_access_session_not_found: { status: 404, body: { error: "Session not found" } },
    session_access_subject_not_found: { status: 404, body: { error: "User not found" } },
    session_access_subject_ineligible: { status: 403, body: { error: "Can only share with friends" } },
    session_access_owner_grant_invalid: { status: 400, body: { error: "Cannot share with the session owner" } },
    session_access_self_grant_invalid: { status: 400, body: { error: "Cannot share with yourself" } },
    session_access_permission_delegation_forbidden: { status: 403, body: { error: "Forbidden" } },
    session_access_permission_delegation_requires_edit: {
        status: 400,
        body: { error: "Permission approvals require edit or admin access" },
    },
    session_access_team_policy_required: {
        status: 409,
        body: { error: "Team policy requires this access" },
    },
    session_access_external_sharing_requires_team_admin: {
        status: 403,
        body: { error: "Forbidden" },
    },
    session_access_external_sharing_disabled: {
        status: 403,
        body: { error: "Forbidden" },
    },
    // Unreachable from this adapter, which parses the released bytes before
    // delegating. It is mapped to the released malformed-key body so the total
    // mapping never has to invent a status at runtime.
    session_access_invalid_recipient_envelope: {
        status: 400,
        body: { error: "Invalid encryptedDataKey" },
    },
});

type ReleasedShareCapability = "manageAccess";

/**
 * Preserve the canonical authentication continuation at the released adapter.
 *
 * A boolean capability helper is sufficient for callers whose only public answer
 * is allowed/forbidden. These routes also need to distinguish a currently
 * unavailable accepted authentication method from an available method that this
 * credential has not satisfied, so they project the canonical operation decision
 * without interpreting Team policy themselves. Only `manageAccess` is preflighted:
 * permission-delegation admission depends on the effective before/after capability
 * transition and remains exclusively owned by the transaction-bound grant writer.
 */
async function resolveReleasedShareCapability(
    accountId: string,
    sessionId: string,
    authentication: ReturnType<typeof readSessionAccessAuthenticationFromRequest>,
    capability: ReleasedShareCapability,
): Promise<
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; response: (typeof RELEASED_ERROR_RESPONSE)[SessionAccessGrantErrorCode] }>
> {
    const decision = await resolveSessionAccessForOperation(db, {
        accountId,
        sessionId,
        authentication,
        capability,
    });
    if (decision.status === "allowed" && decision.access.capabilities[capability]) {
        return { ok: true };
    }
    const error: SessionAccessGrantErrorCode = decision.status === "authentication_unavailable"
        ? "session_access_authentication_unavailable"
        : decision.status === "authentication_required"
            ? "session_access_authentication_required"
            : "session_access_forbidden";
    return { ok: false, response: RELEASED_ERROR_RESPONSE[error] };
}

/** Released create semantics: an omitted flag retains an existing delegation. */
async function readStoredDelegation(
    tx: Tx,
    sessionId: string,
    recipientAccountId: string,
): Promise<boolean> {
    const existing = await tx.sessionShare.findUnique({
        where: { sessionId_sharedWithUserId: { sessionId, sharedWithUserId: recipientAccountId } },
        select: { canApprovePermissions: true },
    });
    return existing?.canApprovePermissions ?? false;
}

export function shareRoutes(app: Fastify) {

    /**
     * Get all shares for a session (owner/admin only)
     */
    app.get('/v1/sessions/:sessionId/shares', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const authentication = readSessionAccessAuthenticationFromRequest(request);
        const preflight = await resolveReleasedShareCapability(
            userId,
            sessionId,
            authentication,
            "manageAccess",
        );
        if (!preflight.ok) {
            return reply.code(preflight.response.status).send(preflight.response.body);
        }

        const session = await inTx(async tx => tx.session.findFirst({
            where: { AND: [{ id: sessionId }, await buildSessionAccessWhere({ tx,
                accountId: userId, capability: "manageAccess", mode: "effective_access_v1",
                authentication,
            })] },
            select: {
                ...SESSION_TRANSCRIPT_PUBLICATION_SELECT,
                shares: {
                    include: {
                        sharedWithUser: {
                            select: ACCOUNT_DISPLAY_PROFILE_SELECT,
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                },
            },
        }));
        if (!session) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        return reply.send(ReleasedDirectSessionSharesResponseV1Schema.parse({
            shares: session.shares.map(share => ({
                id: share.id,
                sharedWithUser: toShareUserProfile(share.sharedWithUser),
                accessLevel: share.accessLevel,
                canApprovePermissions: share.canApprovePermissions,
                createdAt: share.createdAt.getTime(),
                updatedAt: share.updatedAt.getTime()
            }))
        }));
    });

    /**
     * Share session with a user
     */
    app.post('/v1/sessions/:sessionId/shares', {
        preHandler: app.authenticate,
        config: {
            rateLimit: resolveApiHotEndpointRateLimit(process.env, "share.session.create"),
        },
        schema: {
            params: z.object({
                sessionId: z.string()
            }),
            body: ReleasedDirectSessionShareCreateRequestV1Schema,
        }
    }, async (request, reply) => {
        const ownerId = request.userId;
        const { sessionId } = request.params;
        const { userId, accessLevel, canApprovePermissions, encryptedDataKey } = request.body;

        // The released admission order is preserved so an existing client keeps
        // receiving the same status for the same request. Every one of these
        // decisions is repeated by the canonical service inside the write
        // transaction, where it is actually authoritative.
        const authentication = readSessionAccessAuthenticationFromRequest(request);
        const sharingPreflight = await resolveReleasedShareCapability(
            ownerId,
            sessionId,
            authentication,
            "manageAccess",
        );
        if (!sharingPreflight.ok) {
            return reply.code(sharingPreflight.response.status).send(sharingPreflight.response.body);
        }
        if (canApprovePermissions === true) {
            if (accessLevel === 'view') {
                return reply.code(400).send({ error: 'Permission approvals require edit or admin access' });
            }
        }
        if (userId === ownerId) {
            return reply.code(400).send({ error: 'Cannot share with yourself' });
        }

        const supportsCurrentProtocol =
            readAccountStoredContentCompatibilityForHttpRequest(request)
                .supportsCurrentProtocol;

        const outcome = await inTx(async (tx) => {
            const currentSession = await tx.session.findUnique({
                where: { id: sessionId },
                select: {
                    id: true,
                    encryptionMode: true,
                    metadata: true,
                    metadataVersion: true,
                    metadataLayoutVersion: true,
                    ownerMetadata: true,
                    agentState: true,
                    agentStateVersion: true,
                    ...SESSION_TRANSCRIPT_PUBLICATION_SELECT,
                },
            });
            if (!currentSession) {
                return { type: "not-found" as const };
            }
            if (
                currentSession.metadataLayoutVersion
                    === SESSION_METADATA_LAYOUT_VERSION_V1
                && !supportsCurrentProtocol
            ) {
                return { type: "client-upgrade-required" as const };
            }
            try {
                const ownerAccountMode = currentSession.metadataLayoutVersion
                    === SESSION_METADATA_LAYOUT_VERSION_V1
                    ? await readSessionMetadataOwnerAccountMode(
                        tx,
                        currentSession.accountId,
                    )
                    : undefined;
                projectSessionMetadataForRecipient({
                    session: currentSession,
                    recipient: {
                        type: "shared",
                        accountId: null,
                        ownerAccountMode,
                    },
                });
            } catch (error) {
                if (isSessionMetadataPrivacyUpgradeRequiredError(error)) {
                    return { type: "privacy-error" as const };
                }
                throw error;
            }

            // The released create route requires recipient key material for an E2EE
            // Session regardless of that recipient's readiness. That rejection stays
            // here rather than in the grant service: it is this operation's released
            // contract, not a property of the access transition itself.
            let encryptedDataKeyBytes: Uint8Array<ArrayBuffer> | null = null;
            if (currentSession.encryptionMode !== "plain") {
                if (typeof encryptedDataKey !== "string" || encryptedDataKey.length === 0) {
                    return { type: "invalid-key" as const, error: "encryptedDataKey required" };
                }
                const parsed = tryParseDirectShareEncryptedDataKey(encryptedDataKey);
                if (parsed.type === "error") {
                    return { type: "invalid-key" as const, error: parsed.error };
                }
                encryptedDataKeyBytes = parsed.encryptedDataKey;
            }

            const result = await putSessionAccessGrantInTx(tx, {
                actorAccountId: ownerId,
                sessionId,
                subject: { kind: "account", accountId: userId },
                grant: {
                    accessLevel,
                    canApprovePermissions: accessLevel === "view"
                        ? false
                        : canApprovePermissions
                            ?? await readStoredDelegation(tx, sessionId, userId),
                },
                directEnvelope: { encryptedDataKey: encryptedDataKeyBytes },
                authentication,
            });
            if (!result.ok) return { type: "error" as const, error: result.error };
            if (!result.directShare) return { type: "not-found" as const };

            const sharedByUser = await tx.account.findUnique({
                where: { id: result.directShare.sharedByUserId },
                select: ACCOUNT_DISPLAY_PROFILE_SELECT,
            });
            scheduleReleasedDirectShareEvent(tx, {
                recipientAccountId: userId,
                cursor: result.effects.accountCursors.get(userId) ?? 0,
                event: projectReleasedDirectShareEvent({
                    recipientAccountId: userId,
                    effects: result.effects,
                    directShare: result.directShare,
                    directShareRemoved: false,
                }),
                sharedByUser: sharedByUser ?? null,
            });

            return {
                type: "ok" as const,
                share: await projectReleasedShareResponse(tx, result.directShare),
            };
        });

        if (outcome.type === "error") {
            const released = RELEASED_ERROR_RESPONSE[outcome.error];
            return reply.code(released.status).send(released.body);
        }
        if (outcome.type === "privacy-error") {
            return reply.code(409).send(createSessionMetadataPrivacyUpgradeRequiredResponse());
        }
        if (outcome.type === "client-upgrade-required") {
            await enforceCurrentAccountStoredContentCompatibilityForHttpRequest(request, reply);
            return;
        }
        if (outcome.type === "not-found") {
            return reply.code(404).send({ error: "Session not found" });
        }
        if (outcome.type === "invalid-key") {
            return reply.code(400).send({ error: outcome.error });
        }

        return reply.send(ReleasedDirectSessionShareResponseV1Schema.parse({ share: outcome.share }));
    });

    /**
     * Update share access level
     */
    app.patch('/v1/sessions/:sessionId/shares/:shareId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
                shareId: z.string()
            }),
            body: ReleasedDirectSessionSharePatchRequestV1Schema,
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, shareId } = request.params;
        const { accessLevel, canApprovePermissions } = request.body;

        const authentication = readSessionAccessAuthenticationFromRequest(request);
        const sharingPreflight = await resolveReleasedShareCapability(
            userId,
            sessionId,
            authentication,
            "manageAccess",
        );
        if (!sharingPreflight.ok) {
            return reply.code(sharingPreflight.response.status).send(sharingPreflight.response.body);
        }
        const outcome = await inTx(async (tx) => {
            // The released route computed the next state from a row read before the
            // transaction, so a concurrent edit could be silently overwritten with a
            // stale value. The deciding row is now read inside this transaction.
            const existing = await tx.sessionShare.findFirst({
                where: { id: shareId, sessionId },
                select: {
                    sharedWithUserId: true,
                    accessLevel: true,
                    canApprovePermissions: true,
                },
            });
            if (!existing) return { type: "not-found" as const };

            const nextAccessLevel = accessLevel ?? existing.accessLevel;
            if (canApprovePermissions === true && nextAccessLevel === 'view') {
                return {
                    type: "invalid" as const,
                    error: 'Permission approvals require edit or admin access',
                };
            }

            const result = await putSessionAccessGrantInTx(tx, {
                actorAccountId: userId,
                sessionId,
                subject: { kind: "account", accountId: existing.sharedWithUserId },
                // Released PATCH edits access without requiring recipient-key repair.
                directEnvelope: { encryptedDataKey: null },
                authentication,
                grant: {
                    accessLevel: nextAccessLevel,
                    // The released PATCH body may omit delegation. Downgrading an
                    // older delegated Edit/Admin grant must still produce the one
                    // canonical View tuple instead of retaining an impossible true.
                    canApprovePermissions: nextAccessLevel === "view"
                        ? false
                        : canApprovePermissions ?? existing.canApprovePermissions,
                },
            });
            if (!result.ok) return { type: "error" as const, error: result.error };
            if (!result.directShare) return { type: "not-found" as const };

            scheduleReleasedDirectShareEvent(tx, {
                recipientAccountId: existing.sharedWithUserId,
                cursor: result.effects.accountCursors.get(existing.sharedWithUserId) ?? 0,
                event: projectReleasedDirectShareEvent({
                    recipientAccountId: existing.sharedWithUserId,
                    effects: result.effects,
                    directShare: result.directShare,
                    directShareRemoved: false,
                }),
                sharedByUser: null,
            });

            return {
                type: "ok" as const,
                share: await projectReleasedShareResponse(tx, result.directShare),
            };
        });

        if (outcome.type === "error") {
            const released = RELEASED_ERROR_RESPONSE[outcome.error];
            return reply.code(released.status).send(released.body);
        }
        if (outcome.type === "not-found") {
            return reply.code(404).send({ error: 'Share not found' });
        }
        if (outcome.type === "invalid") {
            return reply.code(400).send({ error: outcome.error });
        }

        return reply.send(ReleasedDirectSessionShareResponseV1Schema.parse({ share: outcome.share }));
    });

    /**
     * Delete share (revoke access)
     */
    app.delete('/v1/sessions/:sessionId/shares/:shareId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
                shareId: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, shareId } = request.params;

        const authentication = readSessionAccessAuthenticationFromRequest(request);
        const preflight = await resolveReleasedShareCapability(
            userId,
            sessionId,
            authentication,
            "manageAccess",
        );
        if (!preflight.ok) {
            return reply.code(preflight.response.status).send(preflight.response.body);
        }

        const outcome = await inTx(async (tx) => {
            const existing = await tx.sessionShare.findFirst({
                where: { id: shareId, sessionId },
                select: { sharedWithUserId: true },
            });
            // The released contract answers a repeated delete with 404; the current
            // subject-keyed remove operation is the idempotent one.
            if (!existing) return { type: "not-found" as const };

            const result = await deleteSessionAccessGrantInTx(tx, {
                actorAccountId: userId,
                sessionId,
                subject: { kind: "account", accountId: existing.sharedWithUserId },
                authentication,
            });
            if (!result.ok) return { type: "error" as const, error: result.error };

            scheduleReleasedDirectShareEvent(tx, {
                recipientAccountId: existing.sharedWithUserId,
                cursor: result.effects.accountCursors.get(existing.sharedWithUserId) ?? 0,
                event: projectReleasedDirectShareEvent({
                    recipientAccountId: existing.sharedWithUserId,
                    effects: result.effects,
                    directShare: result.removedDirectShare,
                    directShareRemoved: true,
                }),
                sharedByUser: null,
            });

            return { type: "ok" as const };
        });

        if (outcome.type === "error") {
            const released = RELEASED_ERROR_RESPONSE[outcome.error];
            return reply.code(released.status).send(released.body);
        }
        if (outcome.type === "not-found") {
            return reply.code(404).send({ error: 'Share not found' });
        }

        return reply.send(ReleasedDirectSessionShareDeleteResponseV1Schema.parse({ success: true }));
    });
}
