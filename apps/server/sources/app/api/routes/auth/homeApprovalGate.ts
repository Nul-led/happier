import { randomBytes } from "node:crypto";
import { HomeDeviceApprovalListV1Schema } from "@happier-dev/protocol";
import { z } from "zod";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import type { Fastify } from "../../types";
import { requirePresentUser } from "@/app/api/utils/requirePresentUser";
import { resolvePairingAuthPolicyFromEnv } from "./pairingAuthPolicy";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { recordAuthEnrollmentOutcome } from "@/app/monitoring/metrics/authMetrics";

export type HomeApprovalGate = {
    evaluate(input: {
        accountId: string;
        issuerServerIdentityId: string;
        issuerSubjectId: string;
        requesterBoxPublicKeyBase64: string;
        deviceLabel: string | null;
        approvalId?: string;
    }): Promise<
        | { kind: "allowed" }
        | { kind: "approval_required"; request: { approvalId: string; deviceLabel: string | null; expiresAtMs: number } }
        | { kind: "rejected" | "expired" | "already_decided" }
    >;
};

function approvalEnabled(env: NodeJS.ProcessEnv): boolean {
    return env.HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED === "1";
}

const EXPIRED_ASSERTION_CLEANUP_LIMIT = 32;

/** Home-local approval gate. It stores pending state in the existing pairing-session owner. */
export function createHomeApprovalGate(env: NodeJS.ProcessEnv = process.env): HomeApprovalGate {
    const policy = resolvePairingAuthPolicyFromEnv(env);
    return {
        async evaluate(input) {
            if (!approvalEnabled(env)) return { kind: "allowed" };
            const now = new Date();
            if (input.approvalId) {
                const row = await db.authPairingSession.findUnique({ where: { id: input.approvalId } });
                if (!row) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "rejected" });
                    return { kind: "rejected" };
                }
                if (row.accountId !== input.accountId) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_target" });
                    return { kind: "rejected" };
                }
                if (row.flow !== "account_assertion") {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_binding" });
                    return { kind: "rejected" };
                }
                if (row.expiresAt <= now) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "expired" });
                    return { kind: "expired" };
                }
                if (
                    row.requestedPublicKey !== input.requesterBoxPublicKeyBase64
                    || row.requesterIssuerServerIdentityId !== input.issuerServerIdentityId
                    || row.requesterIssuerSubjectId !== input.issuerSubjectId
                ) {
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "wrong_binding" });
                    return { kind: "rejected" };
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
                    recordAuthEnrollmentOutcome({ flow: "home_approval", outcome: "rejected" });
                    return { kind: "rejected" };
                }
                return { kind: "allowed" };
            }

            return inTx(async (tx) => {
                const expired = await tx.authPairingSession.findMany({
                    where: {
                        accountId: input.accountId,
                        flow: "account_assertion",
                        expiresAt: { lt: now },
                    },
                    orderBy: { expiresAt: "asc" },
                    take: EXPIRED_ASSERTION_CLEANUP_LIMIT,
                    select: { id: true },
                });
                if (expired.length > 0) {
                    await tx.authPairingSession.deleteMany({
                        where: { id: { in: expired.map((row) => row.id) } },
                    });
                }

                const existing = await tx.authPairingSession.findFirst({
                    where: {
                        accountId: input.accountId,
                        flow: "account_assertion",
                        approvalStatus: "pending",
                        expiresAt: { gt: now },
                        requestedPublicKey: input.requesterBoxPublicKeyBase64,
                        requesterIssuerServerIdentityId: input.issuerServerIdentityId,
                        requesterIssuerSubjectId: input.issuerSubjectId,
                    },
                    orderBy: { createdAt: "desc" },
                });
                if (existing) {
                    return {
                        kind: "approval_required" as const,
                        request: {
                            approvalId: existing.id,
                            deviceLabel: existing.requestedDeviceLabel ?? null,
                            expiresAtMs: existing.expiresAt.getTime(),
                        },
                    };
                }

                const expiresAt = new Date(now.getTime() + policy.ttlMs);
                const row = await tx.authPairingSession.create({
                    data: {
                        accountId: input.accountId,
                        secretHash: randomBytes(32).toString("base64url"),
                        requestedPublicKey: input.requesterBoxPublicKeyBase64,
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
const ApprovalDecisionRequestSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
const ApprovalDecisionResponseSchema = z.object({
    status: z.enum(["approved", "rejected", "already_decided"]),
}).strict();
const ApprovalNotFoundResponseSchema = z.object({ error: z.literal("not_found") }).strict();
/** Authenticated Home-owner approval handlers for the existing pairing owner. */
export function registerHomeLoginApprovalRoutes(app: Fastify): void {
    app.get("/v1/auth/home-login/approvals", {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.homeApproval.list") },
        preHandler: [app.authenticate, requirePresentUser],
        schema: { response: { 200: HomeDeviceApprovalListV1Schema } },
    }, async (request, reply) => {
        const now = new Date();
        const rows = await db.authPairingSession.findMany({
            where: {
                accountId: request.userId,
                flow: "account_assertion",
                approvalStatus: "pending",
                expiresAt: { gt: now },
                requestedPublicKey: { not: null },
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
    app.post("/v1/auth/home-login/approvals/:approvalId/decision", {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.homeApproval.decision") },
        preHandler: [app.authenticate, requirePresentUser],
        schema: {
            params: ApprovalIdParamsSchema,
            body: ApprovalDecisionRequestSchema,
            response: { 200: ApprovalDecisionResponseSchema, 404: ApprovalNotFoundResponseSchema },
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
