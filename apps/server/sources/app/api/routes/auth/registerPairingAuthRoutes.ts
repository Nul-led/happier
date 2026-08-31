import { z } from "zod";
import tweetnacl from "tweetnacl";
import * as privacyKit from "privacy-kit";
import { verifyHomeQrRendezvousSecretV2 } from "@happier-dev/protocol";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createServerFeatureGatedRouteApp } from "@/app/features/catalog/serverFeatureGate";
import { readCachedServerIdentityIdForHotPath } from "@/app/serverIdentity/serverIdentity";
import { PresentUserRequiredResponseSchema, requirePresentUser } from "@/app/api/utils/requirePresentUser";
import { type Fastify } from "../../types";
import { resolvePairingAuthPolicyFromEnv } from "./pairingAuthPolicy";
import {
    pairingAuthRateLimitConsumePerUser,
    pairingAuthRateLimitRequestPerIp,
    pairingAuthRateLimitStartPerUser,
    pairingAuthRateLimitStatusPerUser,
} from "./pairingAuthRateLimits";

const EXPIRED_PAIRING_CLEANUP_BATCH_SIZE = 100;
const BASE64URL_32_BYTES_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function decodeCanonicalBase64Url32(value: string): Uint8Array<ArrayBuffer> | null {
    if (!BASE64URL_32_BYTES_PATTERN.test(value)) return null;
    try {
        const decoded = privacyKit.decodeBase64(value, "base64url");
        const canonical = privacyKit.encodeBase64(decoded, "base64url").replace(/=+$/u, "");
        return decoded.length === 32 && canonical === value ? decoded : null;
    } catch {
        return null;
    }
}

function sanitizeDeviceLabel(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim().replace(/\s+/gu, " ");
    return trimmed ? trimmed.slice(0, 120) : null;
}

async function cleanupExpiredDirectQrPairings(now: Date): Promise<void> {
    const expiredRows = await db.authPairingSession.findMany({
        where: { flow: "direct_qr", expiresAt: { lte: now } },
        orderBy: { expiresAt: "asc" },
        take: EXPIRED_PAIRING_CLEANUP_BATCH_SIZE,
        select: { id: true },
    });
    if (expiredRows.length === 0) return;
    await db.authPairingSession.deleteMany({
        where: { id: { in: expiredRows.map((row) => row.id) }, flow: "direct_qr" },
    });
}

const canonicalBase64Url32 = z.string().refine((value) => decodeCanonicalBase64Url32(value) !== null);
const notFound = z.object({ error: z.literal("not_found") }).strict();
const serverIdentityUnavailable = z.object({ error: z.literal("server_identity_unavailable") }).strict();

export function registerPairingAuthRoutes(app: Fastify): void {
    const gated = createServerFeatureGatedRouteApp(app, "auth.pairing.desktopQrMobileScan");
    const policy = resolvePairingAuthPolicyFromEnv(process.env);

    const startBody = z.object({ secretHash: canonicalBase64Url32 }).strict();
    const startResponse = z.object({ pairId: z.string(), expiresAt: z.string() }).strict();
    gated.post(
        "/v1/auth/pairing/start",
        {
            config: { rateLimit: pairingAuthRateLimitStartPerUser() },
            preHandler: [app.authenticate, requirePresentUser],
            schema: {
                body: startBody,
                response: { 200: startResponse, 403: PresentUserRequiredResponseSchema },
            },
        },
        async (request, reply) => {
            const now = new Date();
            await cleanupExpiredDirectQrPairings(now).catch(() => {});

            const expiresAt = new Date(now.getTime() + policy.ttlMs);
            const row = await db.authPairingSession.create({
                data: {
                    accountId: request.userId,
                    secretHash: String(request.body.secretHash),
                    expiresAt,
                    flow: "direct_qr",
                },
                select: { id: true, expiresAt: true },
            });
            return reply.send({ pairId: row.id, expiresAt: row.expiresAt.toISOString() });
        },
    );

    const requestBody = z.object({
        pairId: z.string().min(1).max(128),
        secret: canonicalBase64Url32,
        publicKey: z.string().min(1).max(256),
        bindingProof: canonicalBase64Url32,
        homeServerIdentityId: z.string().trim().min(1).max(128),
        expiresAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        deviceLabel: z.string().max(256).optional(),
    }).strict();
    const requestOk = z.object({ state: z.literal("requested") }).strict();
    const invalidKey = z.object({ error: z.literal("Invalid public key") }).strict();
    const alreadyRequested = z.object({ error: z.literal("already_requested") }).strict();
    const wrongHome = z.object({ error: z.literal("wrong_home") }).strict();
    const wrongExpiry = z.object({ error: z.literal("wrong_expiry") }).strict();

    gated.post(
        "/v1/auth/pairing/request",
        {
            config: { rateLimit: pairingAuthRateLimitRequestPerIp() },
            schema: {
                body: requestBody,
                response: {
                    200: requestOk,
                    401: invalidKey,
                    403: z.union([wrongHome, wrongExpiry]),
                    404: notFound,
                    409: alreadyRequested,
                    503: serverIdentityUnavailable,
                },
            },
        },
        async (request, reply) => {
            const localHomeServerIdentityId = readCachedServerIdentityIdForHotPath(process.env);
            if (!localHomeServerIdentityId) {
                return reply.code(503).send({ error: "server_identity_unavailable" });
            }
            if (request.body.homeServerIdentityId !== localHomeServerIdentityId) {
                return reply.code(403).send({ error: "wrong_home" });
            }

            const publicKeyRaw = String(request.body.publicKey);
            let publicKeyBytes: Uint8Array<ArrayBuffer>;
            try {
                publicKeyBytes = privacyKit.decodeBase64(publicKeyRaw);
            } catch {
                return reply.code(401).send({ error: "Invalid public key" });
            }
            if (
                publicKeyBytes.length !== tweetnacl.box.publicKeyLength
                || privacyKit.encodeBase64(publicKeyBytes) !== publicKeyRaw
            ) {
                return reply.code(401).send({ error: "Invalid public key" });
            }

            const pairId = String(request.body.pairId);
            const session = await db.authPairingSession.findFirst({
                where: { id: pairId, flow: "direct_qr" },
            });
            if (!session) return reply.code(404).send({ error: "not_found" });

            const now = new Date();
            if (session.expiresAt.getTime() <= now.getTime()) {
                await db.authPairingSession.deleteMany({ where: { id: session.id, flow: "direct_qr" } }).catch(() => {});
                return reply.code(404).send({ error: "not_found" });
            }
            if (session.expiresAt.getTime() !== request.body.expiresAtMs) {
                return reply.code(403).send({ error: "wrong_expiry" });
            }

            const rendezvousSecret = decodeCanonicalBase64Url32(String(request.body.secret));
            const rendezvousVerifier = decodeCanonicalBase64Url32(session.secretHash);
            if (
                !rendezvousSecret
                || !rendezvousVerifier
                || !verifyHomeQrRendezvousSecretV2(rendezvousSecret, rendezvousVerifier)
            ) {
                return reply.code(404).send({ error: "not_found" });
            }

            const bindingProof = String(request.body.bindingProof);
            const deviceLabel = sanitizeDeviceLabel(request.body.deviceLabel);
            const updated = await db.authPairingSession.updateMany({
                where: {
                    id: session.id,
                    flow: "direct_qr",
                    expiresAt: { gt: now },
                    requestedPublicKey: null,
                    requestedBindingProof: null,
                },
                data: {
                    requestedPublicKey: publicKeyRaw,
                    requestedBindingProof: bindingProof,
                    requestedDeviceLabel: deviceLabel,
                    requestedAt: now,
                },
            });
            if (updated.count === 1) return reply.send({ state: "requested" });

            const existing = await db.authPairingSession.findFirst({
                where: { id: session.id, flow: "direct_qr", expiresAt: { gt: now } },
                select: { requestedPublicKey: true, requestedBindingProof: true },
            });
            if (!existing) return reply.code(404).send({ error: "not_found" });
            if (
                existing.requestedPublicKey === publicKeyRaw
                && existing.requestedBindingProof === bindingProof
            ) {
                return reply.send({ state: "requested" });
            }
            return reply.code(409).send({ error: "already_requested" });
        },
    );

    const statusQuery = z.object({ pairId: z.string().min(1).max(128) }).strict();
    const statusPending = z.object({
        state: z.literal("pending"),
        pairId: z.string(),
        expiresAt: z.string(),
    }).strict();
    const statusRequested = z.object({
        state: z.literal("requested"),
        pairId: z.string(),
        expiresAt: z.string(),
        homeServerIdentityId: z.string(),
        requestedPublicKey: z.string(),
        bindingProof: canonicalBase64Url32,
        requestedDeviceLabel: z.string().nullable(),
    }).strict();
    gated.get(
        "/v1/auth/pairing/status",
        {
            config: { rateLimit: pairingAuthRateLimitStatusPerUser() },
            preHandler: [app.authenticate, requirePresentUser],
            schema: {
                querystring: statusQuery,
                response: {
                    200: z.union([statusPending, statusRequested]),
                    403: PresentUserRequiredResponseSchema,
                    404: notFound,
                    503: serverIdentityUnavailable,
                },
            },
        },
        async (request, reply) => {
            const pairId = String(request.query.pairId);
            const session = await db.authPairingSession.findFirst({
                where: { id: pairId, flow: "direct_qr", accountId: request.userId },
            });
            if (!session) return reply.code(404).send({ error: "not_found" });

            const now = new Date();
            if (session.expiresAt.getTime() <= now.getTime()) {
                await db.authPairingSession.deleteMany({ where: { id: session.id, flow: "direct_qr" } }).catch(() => {});
                return reply.code(404).send({ error: "not_found" });
            }
            if (!session.requestedPublicKey && !session.requestedBindingProof) {
                return reply.send({ state: "pending", pairId: session.id, expiresAt: session.expiresAt.toISOString() });
            }
            if (!session.requestedPublicKey || !session.requestedBindingProof) {
                return reply.code(404).send({ error: "not_found" });
            }

            const localHomeServerIdentityId = readCachedServerIdentityIdForHotPath(process.env);
            if (!localHomeServerIdentityId) {
                return reply.code(503).send({ error: "server_identity_unavailable" });
            }
            return reply.send({
                state: "requested",
                pairId: session.id,
                expiresAt: session.expiresAt.toISOString(),
                homeServerIdentityId: localHomeServerIdentityId,
                requestedPublicKey: session.requestedPublicKey,
                bindingProof: session.requestedBindingProof,
                requestedDeviceLabel: session.requestedDeviceLabel ?? null,
            });
        },
    );

    const consumePairId = z.string().min(1).max(128);
    const consumeBody = z.union([
        z.object({ pairId: consumePairId }).strict(),
        z.object({ pairId: consumePairId, intent: z.enum(["reject", "cancel"]) }).strict(),
    ]);
    const consumeOk = z.object({ success: z.literal(true) }).strict();
    const alreadyDecided = z.object({ error: z.literal("already_decided") }).strict();
    gated.post(
        "/v1/auth/pairing/consume",
        {
            config: { rateLimit: pairingAuthRateLimitConsumePerUser() },
            preHandler: [app.authenticate, requirePresentUser],
            schema: {
                body: consumeBody,
                response: {
                    200: consumeOk,
                    403: PresentUserRequiredResponseSchema,
                    404: notFound,
                    409: alreadyDecided,
                },
            },
        },
        async (request, reply) => {
            const now = new Date();
            const pairId = String(request.body.pairId);
            if (!("intent" in request.body)) {
                const deleted = await db.authPairingSession.deleteMany({
                    where: {
                        id: pairId,
                        accountId: request.userId,
                        flow: "direct_qr",
                        expiresAt: { gt: now },
                        OR: [
                            {
                                approvalStatus: null,
                                requestedPublicKey: null,
                                requestedBindingProof: null,
                            },
                            {
                                approvalStatus: "approved",
                                decidedAt: { not: null },
                            },
                        ],
                    },
                });
                if (deleted.count === 1) return reply.send({ success: true });
                await db.authPairingSession.deleteMany({
                    where: { id: pairId, accountId: request.userId, flow: "direct_qr", expiresAt: { lte: now } },
                }).catch(() => {});
                return reply.code(404).send({ error: "not_found" });
            }
            const intent = request.body.intent;

            const outcome = await inTx(async (tx) => {
                let row = await tx.authPairingSession.findFirst({
                    where: {
                        id: pairId,
                        accountId: request.userId,
                        flow: "direct_qr",
                        expiresAt: { gt: now },
                    },
                    select: {
                        id: true,
                        requestedPublicKey: true,
                        requestedBindingProof: true,
                        approvalStatus: true,
                    },
                });
                if (!row) return "not_found" as const;
                if (row.approvalStatus === "rejected") return "success" as const;
                if (row.approvalStatus === "approved") return "already_decided" as const;
                if (
                    intent === "cancel"
                    && row.requestedPublicKey === null
                    && row.requestedBindingProof === null
                ) {
                    const deleted = await tx.authPairingSession.deleteMany({
                        where: {
                            id: row.id,
                            accountId: request.userId,
                            flow: "direct_qr",
                            expiresAt: { gt: now },
                            approvalStatus: null,
                            requestedPublicKey: null,
                            requestedBindingProof: null,
                        },
                    });
                    if (deleted.count === 1) return "success" as const;
                    row = await tx.authPairingSession.findFirst({
                        where: {
                            id: pairId,
                            accountId: request.userId,
                            flow: "direct_qr",
                            expiresAt: { gt: now },
                        },
                        select: {
                            id: true,
                            requestedPublicKey: true,
                            requestedBindingProof: true,
                            approvalStatus: true,
                        },
                    });
                    if (!row) return "not_found" as const;
                    if (row.approvalStatus === "rejected") return "success" as const;
                    if (row.approvalStatus === "approved") return "already_decided" as const;
                }
                if (row.requestedPublicKey === null || row.requestedBindingProof === null) return "not_found" as const;
                const rejected = await tx.authPairingSession.updateMany({
                    where: {
                        id: row.id,
                        approvalStatus: null,
                        requestedPublicKey: row.requestedPublicKey,
                        requestedBindingProof: row.requestedBindingProof,
                    },
                    data: { approvalStatus: "rejected", decidedAt: now },
                });
                if (rejected.count === 1) return "success" as const;
                const raced = await tx.authPairingSession.findUnique({
                    where: { id: row.id },
                    select: { approvalStatus: true },
                });
                if (raced?.approvalStatus === "rejected") return "success" as const;
                return raced?.approvalStatus === "approved" ? "already_decided" as const : "not_found" as const;
            });
            if (outcome === "success") return reply.send({ success: true });
            if (outcome === "already_decided") {
                return reply.code(409).send({ error: "already_decided" });
            }
            await db.authPairingSession.deleteMany({
                where: { id: pairId, accountId: request.userId, flow: "direct_qr", expiresAt: { lte: now } },
            }).catch(() => {});
            return reply.code(404).send({ error: "not_found" });
        },
    );
}
