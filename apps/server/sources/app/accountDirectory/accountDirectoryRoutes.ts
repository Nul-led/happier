import type { FastifyError, FastifyReply } from "fastify";
import { type Fastify } from "@/app/api/types";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { requirePresentUser, PresentUserRequiredResponseSchema } from "@/app/api/utils/requirePresentUser";
import { auth } from "@/app/auth/auth";
import { createHomeApprovalGate } from "@/app/api/routes/auth/homeApprovalGate";
import {
    accountDirectoryProtocolErrorResponse,
} from "./accountDirectoryErrors";
import {
    AccountDirectoryHomePutRequestSchema,
    AccountDirectoryHomePutResponseV1Schema,
    AccountDirectoryHomeDeleteParamsV1Schema,
    AccountDirectoryHomeDeleteRequestV1Schema,
    AccountDirectoryHomeDeleteResponseV1Schema,
    AccountDirectoryHomesResponseV1Schema,
    AccountDirectoryLinkPutRequestSchema,
    AccountDirectoryLinkPutResponseV1Schema,
    AccountDirectoryLinkDeleteParamsV1Schema,
    AccountDirectoryLinkDeleteRequestV1Schema,
    AccountDirectoryLinkDeleteResponseV1Schema,
    AccountDirectoryMeResponseSchema,
    AccountDirectoryPreferredRequestSchema,
    AccountDirectoryPreferredHomePatchResponseV1Schema,
    HomeLoginAssertionRequestSchema,
    HomeLoginAssertionV1Schema,
    HomeLoginRedemptionRequestV1Schema,
    HomeLoginRedemptionResponseV1Schema,
    HomeLoginRedemptionApprovalRequiredV1Schema,
    AccountDirectoryRouteErrorResponseV1Schema,
} from "./accountDirectorySchemas";
import {
    deleteAccountDirectoryLink,
    deleteAccountHomeDirectoryEntry,
    listAccountHomeDirectory,
    mintAccountHomeLoginAssertion,
    readAccountDirectoryMe,
    redeemHomeLoginAssertion,
    setPreferredAccountHome,
    upsertAccountDirectoryLink,
    upsertAccountHomeDirectoryEntry,
} from "./accountDirectoryService";

function sendAccountDirectoryError(reply: FastifyReply, error: unknown): void {
    // One internal→protocol mapping owned by the domain errors owner; the
    // strict response schemas reject anything it does not emit.
    const mapped = accountDirectoryProtocolErrorResponse(error);
    if (!mapped) throw error;
    reply.code(mapped.statusCode).send(mapped.body);
}

function accountDirectoryRouteErrorHandler(
    error: FastifyError,
    _request: unknown,
    reply: FastifyReply,
): void {
    sendAccountDirectoryError(reply, error);
}

const ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES = {
    400: AccountDirectoryRouteErrorResponseV1Schema,
    429: AccountDirectoryRouteErrorResponseV1Schema,
} as const;

export function registerAccountDirectoryRoutes(app: Fastify): void {
    app.get("/v1/account-directory/me", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate],
        config: { allowAccountDirectoryToken: true, rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.read") },
        schema: { response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: AccountDirectoryMeResponseSchema, 403: AccountDirectoryRouteErrorResponseV1Schema, 404: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            return reply.send(await readAccountDirectoryMe(request.userId));
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });

    app.get("/v1/account-directory/homes", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate],
        config: { allowAccountDirectoryToken: true, rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.read") },
        schema: { response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: AccountDirectoryHomesResponseV1Schema, 403: AccountDirectoryRouteErrorResponseV1Schema, 404: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            return reply.send(await listAccountHomeDirectory(request.userId));
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });

    app.put("/v1/account-directory/homes/:homeServerIdentityId", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate],
        config: { allowAccountDirectoryToken: true, rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.mutate") },
        schema: { params: AccountDirectoryHomeDeleteParamsV1Schema, body: AccountDirectoryHomePutRequestSchema, response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: AccountDirectoryHomePutResponseV1Schema, 403: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            return reply.send(await upsertAccountHomeDirectoryEntry({
                accountId: request.userId,
                homeServerIdentityId: request.params.homeServerIdentityId,
                label: request.body.label,
                connectionDescriptor: request.body.connectionDescriptor,
            }));
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });

    app.delete("/v1/account-directory/homes/:homeServerIdentityId", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate],
        config: { allowAccountDirectoryToken: true, rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.mutate") },
        schema: { params: AccountDirectoryHomeDeleteParamsV1Schema, body: AccountDirectoryHomeDeleteRequestV1Schema, response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: AccountDirectoryHomeDeleteResponseV1Schema, 403: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            await deleteAccountHomeDirectoryEntry({ accountId: request.userId, homeServerIdentityId: request.params.homeServerIdentityId });
            const directory = await listAccountHomeDirectory(request.userId);
            return reply.send({
                v: 1,
                deleted: true,
                homeServerIdentityId: request.params.homeServerIdentityId,
                preferredHomeServerIdentityId: directory.preferredHomeServerIdentityId,
            });
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });

    app.patch("/v1/account-directory/homes/preferred", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate],
        config: { allowAccountDirectoryToken: true, rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.mutate") },
        schema: { body: AccountDirectoryPreferredRequestSchema, response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: AccountDirectoryPreferredHomePatchResponseV1Schema, 403: AccountDirectoryRouteErrorResponseV1Schema, 404: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            return reply.send(await setPreferredAccountHome({ accountId: request.userId, homeServerIdentityId: request.body.homeServerIdentityId }));
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });

    app.post("/v1/account-directory/homes/:homeServerIdentityId/login-assertion", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate],
        config: { allowAccountDirectoryToken: true, rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.assertionMint") },
        schema: { params: AccountDirectoryHomeDeleteParamsV1Schema, body: HomeLoginAssertionRequestSchema, response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: HomeLoginAssertionV1Schema, 403: AccountDirectoryRouteErrorResponseV1Schema, 404: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            if (request.body.homeServerIdentityId !== request.params.homeServerIdentityId) {
                return reply.code(400).send({ error: "invalid_request" });
            }
            return reply.send(await mintAccountHomeLoginAssertion({
                accountId: request.userId,
                homeServerIdentityId: request.params.homeServerIdentityId,
                clientBoxPublicKeyBase64: request.body.clientBoxPublicKeyBase64,
            }));
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });
}

export function registerAccountDirectoryLinkRoutes(app: Fastify): void {
    app.put("/v1/account/directory-links/:issuerServerIdentityId", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate, requirePresentUser],
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.mutate") },
        schema: { params: AccountDirectoryLinkDeleteParamsV1Schema, body: AccountDirectoryLinkPutRequestSchema, response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: AccountDirectoryLinkPutResponseV1Schema, 403: PresentUserRequiredResponseSchema, 409: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            if (request.body.issuerServerIdentityId !== request.params.issuerServerIdentityId) {
                return reply.code(400).send({ error: "invalid_request" });
            }
            const { issuerServerIdentityId: _issuerServerIdentityId, ...linkBody } = request.body;
            await upsertAccountDirectoryLink({
                accountId: request.userId,
                issuerServerIdentityId: request.params.issuerServerIdentityId,
                ...linkBody,
            });
            return reply.send({
                v: 1,
                issuerServerIdentityId: request.body.issuerServerIdentityId,
                issuerSubjectId: request.body.issuerSubjectId,
                issuerSigningKeyId: request.body.issuerSigningKeyId,
                issuerSigningPublicKeyBase64Url: request.body.issuerSigningPublicKeyBase64Url,
            });
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });

    app.delete("/v1/account/directory-links/:issuerServerIdentityId", {
        errorHandler: accountDirectoryRouteErrorHandler,
        preHandler: [app.authenticate, requirePresentUser],
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.mutate") },
        schema: { params: AccountDirectoryLinkDeleteParamsV1Schema, body: AccountDirectoryLinkDeleteRequestV1Schema, response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: AccountDirectoryLinkDeleteResponseV1Schema, 403: PresentUserRequiredResponseSchema } },
    }, async (request, reply) => {
        try {
            await deleteAccountDirectoryLink({ accountId: request.userId, issuerServerIdentityId: request.params.issuerServerIdentityId });
            return reply.send({ v: 1, deleted: true, issuerServerIdentityId: request.params.issuerServerIdentityId });
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });
}

export function registerHomeLoginRoute(app: Fastify): void {
    const homeApprovalGate = createHomeApprovalGate(process.env);
    app.post("/v1/auth/home-login", {
        errorHandler: accountDirectoryRouteErrorHandler,
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "accountDirectory.assertionRedeem") },
        schema: { body: HomeLoginRedemptionRequestV1Schema, response: { ...ACCOUNT_DIRECTORY_BOUNDARY_ERROR_RESPONSES, 200: HomeLoginRedemptionResponseV1Schema, 202: HomeLoginRedemptionApprovalRequiredV1Schema, 401: AccountDirectoryRouteErrorResponseV1Schema, 503: AccountDirectoryRouteErrorResponseV1Schema } },
    }, async (request, reply) => {
        try {
            await auth.init();
            const body = request.body;
            const result = await redeemHomeLoginAssertion({
                assertion: body.assertion,
                ...(body.approvalId ? { approvalId: body.approvalId } : {}),
                homeApprovalGate,
                issueHomeToken: async (tx, accountId) => await auth.createTokenInTx(
                    tx,
                    accountId,
                    undefined,
                    { kind: "account", authority: "present_user" },
                ),
            });
            return "outcome" in result && result.outcome === "approval_required"
                ? reply.code(202).send(result)
                : reply.send(result);
        } catch (error) {
            return sendAccountDirectoryError(reply, error);
        }
    });
}
