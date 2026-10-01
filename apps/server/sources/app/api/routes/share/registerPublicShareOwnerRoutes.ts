import { type Fastify } from "../../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { assertSessionCapabilityInTx, resolveSessionAccessForOperation } from "@/app/session/access/sessionAccess";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import {
    eventRouter,
    buildPublicShareCreatedUpdate,
    buildPublicShareUpdatedUpdate,
    buildPublicShareDeletedUpdate,
} from "@/app/events/eventRouter";
import { createHash, timingSafeEqual } from "crypto";
import { afterTx, inTx } from "@/storage/inTx";
import { markAccountChanged } from "@/app/changes/markAccountChanged";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { tryParseEncryptedDataKeyV0 } from "./encryptedDataKeyValidation";
import {
    isSessionTranscriptShareable,
    SESSION_TRANSCRIPT_PUBLICATION_SELECT,
} from "@/app/session/sessionTranscriptPublicationPolicy";
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
import { SESSION_METADATA_LAYOUT_VERSION_V1 } from "@happier-dev/protocol";
import { enforceSessionPublicLinkExternalSharingPolicyInTx } from "@/app/session/access/sessionAccessExternalSharingPolicy";
import { isPublicSessionShareActive } from "@/app/share/publicSessionSharePublication";
import { readSessionAccessAuthenticationFromRequest } from "@/app/session/access/sessionAccessAuthentication";
import { removeUnsafeSessionFollowEdgesForAccessChangeInTx } from "@/app/session/follow/sessionFollowEdgeService";
import { removeUnsafeSessionReportsToEdgesForAccessChangeInTx } from "@/app/session/relations/sessionReportsToService";

function equalBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
    if (left === null || right === null) return left === right;
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function equalDates(left: Date | null, right: Date | null): boolean {
    if (left === null || right === null) return left === right;
    return left.getTime() === right.getTime();
}

export function registerPublicShareOwnerRoutes(app: Fastify): void {
    /**
     * Create or update the public-link desired state for a Session.
     * An exact retry returns the stored state without resetting usage,
     * advancing timestamps, or publishing duplicate invalidations.
     */
    app.post('/v1/sessions/:sessionId/public-share', {
        preHandler: app.authenticate,
        config: {
            rateLimit: resolveApiHotEndpointRateLimit(process.env, "share.public.manage"),
        },
        schema: {
            params: z.object({
                sessionId: z.string()
            }),
            body: z.object({
                token: z.string().optional(), // client-generated token (required when creating or rotating)
                encryptedDataKey: z.string().optional(), // base64 encoded (required when creating or rotating)
                expiresAt: z.number().optional(), // timestamp
                maxUses: z.number().int().positive().optional(),
                isConsentRequired: z.boolean().optional() // require consent for detailed logging
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const authentication = readSessionAccessAuthenticationFromRequest(request);
        const { token, encryptedDataKey, expiresAt, maxUses, isConsentRequired } = request.body;
        const supportsCurrentProtocol =
            readAccountStoredContentCompatibilityForHttpRequest(request)
                .supportsCurrentProtocol;

        // Only owner can create public shares
        const admission = await resolveSessionAccessForOperation(db, {
            accountId: userId,
            sessionId,
            authentication,
            capability: "managePublicLink",
        });
        if (admission.status !== "allowed" || !admission.access.capabilities.managePublicLink) {
            return reply.code(403).send({ error: 'session_access_forbidden' });
        }

        const result = await inTx(async (tx) => {
            const authority = await assertSessionCapabilityInTx({ tx, accountId: userId, sessionId, capability: "managePublicLink", authentication });
            if (!authority.ok) return { type: "forbidden" as const };
            const session = await tx.session.findUnique({
                where: { id: sessionId },
                select: {
                    encryptionMode: true,
                    metadata: true,
                    metadataVersion: true,
                    metadataLayoutVersion: true,
                    ownerMetadata: true,
                    agentState: true,
                    agentStateVersion: true,
                    primaryTeamId: true,
                    ...SESSION_TRANSCRIPT_PUBLICATION_SELECT,
                },
            });
            if (!session) {
                return { type: 'error' as const, error: 'session not found' as const };
            }
            if (
                session.metadataLayoutVersion
                    === SESSION_METADATA_LAYOUT_VERSION_V1
                && !supportsCurrentProtocol
            ) {
                return { type: "client-upgrade-required" as const };
            }
            if (!isSessionTranscriptShareable(session)) {
                return {
                    type: 'publication-error' as const,
                    error: "Session transcript is not shareable" as const,
                    code: "session_transcript_not_shareable" as const,
                };
            }
            try {
                const ownerAccountMode = session.metadataLayoutVersion
                    === SESSION_METADATA_LAYOUT_VERSION_V1
                    ? await readSessionMetadataOwnerAccountMode(
                        tx,
                        session.accountId,
                    )
                    : undefined;
                projectSessionMetadataForRecipient({
                    session,
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
            const sessionEncryptionMode: "e2ee" | "plain" = session.encryptionMode === "plain" ? "plain" : "e2ee";

            const existing = await tx.publicSessionShare.findUnique({
                where: { sessionId }
            });

            const nextExpiresAt = expiresAt === undefined ? null : new Date(expiresAt);
            const suppliedTokenHash = typeof token === 'string' && token.length > 0
                ? createHash('sha256').update(token, 'utf8').digest()
                : null;
            const shouldRotateToken = suppliedTokenHash !== null
                && (existing === null || !equalBytes(existing.tokenHash, suppliedTokenHash));
            const externalPolicyError = await enforceSessionPublicLinkExternalSharingPolicyInTx(tx, {
                actorAccountId: userId,
                primaryTeamId: session.primaryTeamId,
                previous: existing,
                next: {
                    expiresAt: nextExpiresAt,
                    maxUses: maxUses ?? null,
                    rotatesToken: shouldRotateToken,
                },
                authentication,
            });
            if (externalPolicyError) {
                return { type: "external-sharing-error" as const, error: externalPolicyError };
            }

            let publicShare;
            const isUpdate = !!existing;
            let changed = true;

            if (existing) {
                if (shouldRotateToken && sessionEncryptionMode === "e2ee" && !encryptedDataKey) {
                    return { type: 'error' as const, error: 'encryptedDataKey required when rotating token' as const };
                }
                let nextEncryptedDataKey = existing.encryptedDataKey;
                if (sessionEncryptionMode === "plain") {
                    nextEncryptedDataKey = null;
                } else if (encryptedDataKey !== undefined) {
                    const parsedEncryptedDataKey = tryParseEncryptedDataKeyV0(encryptedDataKey);
                    if (parsedEncryptedDataKey.type === "error") {
                        return parsedEncryptedDataKey;
                    }
                    nextEncryptedDataKey = parsedEncryptedDataKey.encryptedDataKey;
                }
                const nextMaxUses = maxUses ?? null;
                const nextIsConsentRequired = isConsentRequired ?? false;
                changed = shouldRotateToken
                    || !equalBytes(existing.encryptedDataKey, nextEncryptedDataKey)
                    || !equalDates(existing.expiresAt, nextExpiresAt)
                    || existing.maxUses !== nextMaxUses
                    || existing.isConsentRequired !== nextIsConsentRequired;

                publicShare = changed
                    ? await tx.publicSessionShare.update({
                        where: { sessionId },
                        data: {
                            ...(shouldRotateToken ? { tokenHash: suppliedTokenHash! } : {}),
                            encryptedDataKey: nextEncryptedDataKey,
                            expiresAt: nextExpiresAt,
                            maxUses: nextMaxUses,
                            isConsentRequired: nextIsConsentRequired,
                            ...(shouldRotateToken ? { useCount: 0 } : {}),
                        }
                    })
                    : existing;
            } else {
                if (!token) {
                    return { type: 'error' as const, error: 'token required' as const };
                }
                if (sessionEncryptionMode === "e2ee" && !encryptedDataKey) {
                    return { type: 'error' as const, error: 'encryptedDataKey required' as const };
                }
                let encryptedDataKeyBytes: Uint8Array<ArrayBuffer> | null = null;
                if (sessionEncryptionMode === "e2ee") {
                    const parsedEncryptedDataKey = tryParseEncryptedDataKeyV0(encryptedDataKey!);
                    if (parsedEncryptedDataKey.type === "error") {
                        return parsedEncryptedDataKey;
                    }
                    encryptedDataKeyBytes = parsedEncryptedDataKey.encryptedDataKey;
                }

                publicShare = await tx.publicSessionShare.create({
                    data: {
                        sessionId,
                        createdByUserId: userId,
                        tokenHash: suppliedTokenHash!,
                        encryptedDataKey: encryptedDataKeyBytes,
                        expiresAt: nextExpiresAt,
                        maxUses: maxUses ?? null,
                        isConsentRequired: isConsentRequired ?? false
                    }
                });
            }

            if (!changed) {
                return { type: 'ok' as const, publicShare };
            }

            if (isPublicSessionShareActive(publicShare)) {
                await removeUnsafeSessionFollowEdgesForAccessChangeInTx(tx, { sessionId });
                await removeUnsafeSessionReportsToEdgesForAccessChangeInTx(tx, { sessionId });
            }

            const shareCursor = await markAccountChanged(tx, { accountId: userId, kind: 'share', entityId: sessionId });
            const sessionCursor = await markAccountChanged(tx, { accountId: userId, kind: 'session', entityId: sessionId });
            const cursor = Math.max(shareCursor, sessionCursor);

            afterTx(tx, () => {
                const updatePayload = isUpdate
                    ? buildPublicShareUpdatedUpdate(publicShare, cursor, randomKeyNaked(12))
                    : buildPublicShareCreatedUpdate({ ...publicShare, token: token! }, cursor, randomKeyNaked(12));

                eventRouter.emitUpdate({
                    userId: userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'all-interested-in-session', sessionId }
                });
            });

            return { type: 'ok' as const, publicShare };
        });

        if (result.type === "forbidden") {
            return reply.code(403).send({ error: "session_access_forbidden" });
        }
        if (result.type === 'publication-error') {
            return reply.code(409).send({ error: result.error, code: result.code });
        }
        if (result.type === "external-sharing-error") {
            return reply.code(
                result.error === "session_access_authentication_unavailable"
                    ? 503
                    : result.error === "session_access_external_sharing_requires_team_admin"
                    || result.error === "session_access_external_sharing_disabled"
                    || result.error === "session_access_authentication_required"
                    ? 403
                    : 409,
            )
                .send({ error: result.error });
        }
        if (result.type === "client-upgrade-required") {
            await enforceCurrentAccountStoredContentCompatibilityForHttpRequest(
                request,
                reply,
            );
            return;
        }
        if (result.type === "privacy-error") {
            return reply.code(409).send(createSessionMetadataPrivacyUpgradeRequiredResponse());
        }
        if (result.type === 'error') {
            return reply.code(400).send({ error: result.error });
        }
        const publicShare = result.publicShare;

        return reply.send({
            publicShare: {
                id: publicShare.id,
                token: token ?? null,
                expiresAt: publicShare.expiresAt?.getTime() ?? null,
                maxUses: publicShare.maxUses,
                useCount: publicShare.useCount,
                isConsentRequired: publicShare.isConsentRequired,
                createdAt: publicShare.createdAt.getTime(),
                updatedAt: publicShare.updatedAt.getTime()
            }
        });
    });

    /**
     * Get public share info for a session
     */
    app.get('/v1/sessions/:sessionId/public-share', {
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

        // Only owner can view public share settings
        const admission = await resolveSessionAccessForOperation(db, {
            accountId: userId,
            sessionId,
            authentication,
            capability: "managePublicLink",
        });
        if (admission.status !== "allowed" || !admission.access.capabilities.managePublicLink) {
            return reply.code(403).send({ error: 'session_access_forbidden' });
        }

        const publicShare = await db.publicSessionShare.findUnique({
            where: { sessionId }
        });

        if (!publicShare) {
            return reply.send({ publicShare: null });
        }

        return reply.send({
            publicShare: {
                id: publicShare.id,
                token: null,
                expiresAt: publicShare.expiresAt?.getTime() ?? null,
                maxUses: publicShare.maxUses,
                useCount: publicShare.useCount,
                isConsentRequired: publicShare.isConsentRequired,
                createdAt: publicShare.createdAt.getTime(),
                updatedAt: publicShare.updatedAt.getTime()
            }
        });
    });

    /**
     * Delete public share (disable public link)
     */
    app.delete('/v1/sessions/:sessionId/public-share', {
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

        // Only owner can delete public share
        const admission = await resolveSessionAccessForOperation(db, {
            accountId: userId,
            sessionId,
            authentication,
            capability: "managePublicLink",
        });
        if (admission.status !== "allowed" || !admission.access.capabilities.managePublicLink) {
            return reply.code(403).send({ error: 'session_access_forbidden' });
        }

        const result = await inTx(async (tx) => {
            const authority = await assertSessionCapabilityInTx({ tx, accountId: userId, sessionId, capability: "managePublicLink", authentication });
            if (!authority.ok) return { type: "forbidden" as const };
            const existing = await tx.publicSessionShare.findUnique({
                where: { sessionId }
            });

            if (!existing) {
                return { type: "not-found" as const };
            }

            await tx.publicSessionShare.delete({
                where: { sessionId }
            });

            const shareCursor = await markAccountChanged(tx, { accountId: userId, kind: 'share', entityId: sessionId });
            const sessionCursor = await markAccountChanged(tx, { accountId: userId, kind: 'session', entityId: sessionId });
            const cursor = Math.max(shareCursor, sessionCursor);

            afterTx(tx, () => {
                const updatePayload = buildPublicShareDeletedUpdate(
                    sessionId,
                    cursor,
                    randomKeyNaked(12)
                );

                eventRouter.emitUpdate({
                    userId: userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'all-interested-in-session', sessionId }
                });
            });

            return { type: "ok" as const };
        });

        if (result.type === "forbidden") {
            return reply.code(403).send({ error: "session_access_forbidden" });
        }
        if (result.type === "not-found") {
            return reply.code(404).send({ error: 'Share not found' });
        }

        return reply.send({ success: true });
    });
}
