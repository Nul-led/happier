import { randomBytes } from "node:crypto";
import {
    HOME_LOGIN_APPROVALS_HTTP_PATH_V1,
    HOME_LOGIN_APPROVAL_DECISION_HTTP_PATH_V1,
    HomeDeviceApprovalDecisionRequestV1Schema,
    HomeDeviceApprovalDecisionResponseV1Schema,
    HomeDeviceApprovalListV1Schema,
} from "@happier-dev/protocol";
import { resolveHomeDeviceApprovalRequiredFromEnv } from "@happier-dev/cli-common/firstPartyRuntime/personalHome/configuration";
import { z } from "zod";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import type { Fastify } from "../../types";
import { requirePresentUser, PresentUserRequiredResponseSchema } from "@/app/api/utils/requirePresentUser";
import { resolvePairingAuthPolicyFromEnv } from "./pairingAuthPolicy";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { recordAuthEnrollmentOutcome } from "@/app/monitoring/metrics/authMetrics";
import { cleanupExpiredAuthPairingSessions } from "@/app/retention/rules/authPairingSessionRetentionRule";
import type { HomeApprovalGate } from "@/app/auth/homeApprovalGateContract";

export type { HomeApprovalGate } from "@/app/auth/homeApprovalGateContract";

/** Home-local approval gate. It stores pending state in the existing pairing-session owner. */
export function createHomeApprovalGate(env: NodeJS.ProcessEnv = process.env): HomeApprovalGate {
    const policy = resolvePairingAuthPolicyFromEnv(env);
    return {
        async evaluate(input) {
            if (!resolveHomeDeviceApprovalRequiredFromEnv(env)) return { kind: "allowed" };
            const now = new Date();
            const assertionExpiresAtMs = input.assertionExpiresAtMs ?? Number.MAX_SAFE_INTEGER;
            if (!Number.isSafeInteger(assertionExpiresAtMs) || assertionExpiresAtMs <= now.getTime()) {
                return { kind: "expired" };
            }
            if (input.approvalId) {
                const row = await db.authPairingSession.findUnique({ where: { id: input.approvalId } });
                if (!row) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_target" });
                    return { kind: "invalid" };
                }
                if (row.accountId !== input.accountId) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_target" });
                    return { kind: "invalid" };
                }
                if (row.flow !== "account_assertion") {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_binding" });
                    return { kind: "invalid" };
                }
                if (
                    row.requestedPublicKey !== input.requesterBoxPublicKeyBase64
                    || row.requestedBindingProof !== input.approvalBindingProof
                    || row.requesterIssuerServerIdentityId !== input.issuerServerIdentityId
                    || row.requesterIssuerSubjectId !== input.issuerSubjectId
                ) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_binding" });
                    return { kind: "invalid" };
                }
                if (row.expiresAt <= now || assertionExpiresAtMs <= now.getTime()) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "expired" });
                    return { kind: "expired" };
                }
                if (row.approvalStatus === "pending") {
                    return {
                        kind: "approval_required",
                        request: {
                            approvalId: row.id,
                            deviceLabel: row.requestedDeviceLabel ?? null,
                            expiresAtMs: row.expiresAt.getTime(),
                        },
                    };
                }
                if (row.approvalStatus === "rejected") {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "rejected" });
                    return { kind: "rejected" };
                }
                if (row.approvalStatus !== "approved") {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_binding" });
                    return { kind: "invalid" };
                }
                return {
                    kind: "allowed",
                    approvedRequest: {
                        approvalId: row.id,
                        bindingProof: input.approvalBindingProof,
                    },
                };
            }

            await cleanupExpiredAuthPairingSessions({
                now,
                accountId: input.accountId,
                flow: "account_assertion",
            }).catch(() => {});
            return inTx(async (tx) => {
                const existing = await tx.authPairingSession.findFirst({
                    where: {
                        accountId: input.accountId,
                        flow: "account_assertion",
                        approvalStatus: "pending",
                        expiresAt: { gt: now },
                        requestedPublicKey: input.requesterBoxPublicKeyBase64,
                        requestedBindingProof: input.approvalBindingProof,
                        requesterIssuerServerIdentityId: input.issuerServerIdentityId,
                        requesterIssuerSubjectId: input.issuerSubjectId,
                    },
                    orderBy: { createdAt: "desc" },
                });
                if (existing) {
                    const effectiveExpiresAtMs = Math.min(existing.expiresAt.getTime(), assertionExpiresAtMs);
                    if (effectiveExpiresAtMs < existing.expiresAt.getTime()) {
                        await tx.authPairingSession.updateMany({
                            where: { id: existing.id, approvalStatus: "pending", expiresAt: existing.expiresAt },
                            data: { expiresAt: new Date(effectiveExpiresAtMs) },
                        });
                    }
                    return {
                        kind: "approval_required" as const,
                        request: {
                            approvalId: existing.id,
                            deviceLabel: existing.requestedDeviceLabel ?? null,
                            expiresAtMs: effectiveExpiresAtMs,
                        },
                    };
                }

                const expiresAt = new Date(Math.min(
                    now.getTime() + policy.ttlMs,
                    assertionExpiresAtMs,
                ));
                const row = await tx.authPairingSession.create({
                    data: {
                        accountId: input.accountId,
                        secretHash: randomBytes(32).toString("base64url"),
                        requestedPublicKey: input.requesterBoxPublicKeyBase64,
                        requestedBindingProof: input.approvalBindingProof,
                        requestedDeviceLabel: input.deviceLabel,
                        requestedAt: now,
                        expiresAt,
                        flow: "account_assertion",
                        requesterIssuerServerIdentityId: input.issuerServerIdentityId,
                        requesterIssuerSubjectId: input.issuerSubjectId,
                        approvalStatus: "pending",
                    },
                    select: { id: true, expiresAt: true, requestedDeviceLabel: true },
                });
                return {
                    kind: "approval_required" as const,
                    request: {
                        approvalId: row.id,
                        deviceLabel: row.requestedDeviceLabel ?? null,
                        expiresAtMs: row.expiresAt.getTime(),
                    },
                };
            });
        },
    };
}

const ApprovalIdParamsSchema = z.object({ approvalId: z.string().trim().min(1).max(256) }).strict();
const ApprovalNotFoundResponseSchema = z.object({ error: z.literal("not_found") }).strict();
/** Authenticated Home-owner approval handlers for the existing pairing owner. */
export function registerHomeLoginApprovalRoutes(app: Fastify): void {
    app.get(HOME_LOGIN_APPROVALS_HTTP_PATH_V1, {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.homeApproval.list") },
        preHandler: [app.authenticate, requirePresentUser],
        schema: { response: { 200: HomeDeviceApprovalListV1Schema, 403: PresentUserRequiredResponseSchema } },
    }, async (request, reply) => {
        const now = new Date();
        const rows = await db.authPairingSession.findMany({
            where: {
                accountId: request.userId,
                flow: "account_assertion",
                approvalStatus: "pending",
                expiresAt: { gt: now },
                requestedPublicKey: { not: null },
                requestedBindingProof: { not: null },
                requesterIssuerServerIdentityId: { not: null },
                requesterIssuerSubjectId: { not: null },
            },
            orderBy: { createdAt: "asc" },
        });
        return reply.send(rows.flatMap((row) => {
            if (
                typeof row.requestedPublicKey !== "string"
                || typeof row.requesterIssuerServerIdentityId !== "string"
                || typeof row.requesterIssuerSubjectId !== "string"
            ) return [];
            return [{
                approvalId: row.id,
                accountId: row.accountId,
                flow: "account_assertion" as const,
                requesterBoxPublicKeyBase64: row.requestedPublicKey,
                issuerServerIdentityId: row.requesterIssuerServerIdentityId,
                issuerSubjectId: row.requesterIssuerSubjectId,
                deviceLabel: row.requestedDeviceLabel ?? null,
                status: "pending" as const,
                expiresAtMs: row.expiresAt.getTime(),
                decidedAtMs: null,
            }];
        }));
    });
    app.post(HOME_LOGIN_APPROVAL_DECISION_HTTP_PATH_V1, {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.homeApproval.decision") },
        preHandler: [app.authenticate, requirePresentUser],
        schema: {
            params: ApprovalIdParamsSchema,
            body: HomeDeviceApprovalDecisionRequestV1Schema,
            response: { 200: HomeDeviceApprovalDecisionResponseV1Schema, 403: PresentUserRequiredResponseSchema, 404: ApprovalNotFoundResponseSchema },
        },
    }, async (request, reply) => {
        const approvalId = request.params.approvalId;
        const status = request.body.decision === "approve" ? "approved" : "rejected";
        const now = new Date();
        const transition = await db.authPairingSession.updateMany({
            where: {
                id: approvalId,
                accountId: request.userId,
                flow: "account_assertion",
                approvalStatus: "pending",
                expiresAt: { gt: now },
            },
            data: { approvalStatus: status, decidedAt: now },
        });
        if (transition.count === 1) {
            if (status === "rejected") {
                recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "rejected" });
            }
            return reply.send({ status });
        }

        const existing = await db.authPairingSession.findFirst({
            where: { id: approvalId, accountId: request.userId, flow: "account_assertion", expiresAt: { gt: now } },
            select: { approvalStatus: true },
        });
        if (existing?.approvalStatus === "approved" || existing?.approvalStatus === "rejected") {
            return reply.send({ status: "already_decided" });
        }
        return reply.code(404).send({ error: "not_found" });
    });
}
