import {
    ACCOUNT_API_TOKEN_ENCRYPTION_ACCESS_HTTP_PATH_V1,
    AccountApiTokenEncryptionAccessRequestV1Schema,
    AccountApiTokenEncryptionAccessResponseV1Schema,
    AccountApiTokenIntrospectionConnectionFailureV1Schema,
    AccountApiTokenIntrospectionSubjectFailureV1Schema,
    ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_REVOKE_ALL_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
    AccountApiTokensCreateActionInputV1Schema,
    AccountApiTokensCreateActionOutputV1Schema,
    AccountApiTokensListActionInputV1Schema,
    AccountApiTokensListActionOutputV1Schema,
    AccountApiTokensRevokeActionInputV1Schema,
    AccountApiTokensRevokeActionOutputV1Schema,
    AccountApiTokensRevokeAllActionInputV1Schema,
    AccountApiTokensRevokeAllActionOutputV1Schema,
    AccountApiTokensServerErrorV1Schema,
} from "@happier-dev/protocol";
import { z } from "zod";

import {
    auth,
    InvalidApiTokenExpiryError,
    ApiTokenOperationError,
    type ApiTokenSummary,
    type CreatedApiToken,
} from "@/app/auth/auth";
import {
    PresentUserRequiredResponseSchema,
    requirePresentUser,
} from "@/app/api/utils/requirePresentUser";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";

import { type Fastify } from "../../types";

function serializeApiTokenSummary(token: ApiTokenSummary) {
    return {
        tokenId: token.tokenId,
        label: token.label,
        displayPrefix: token.displayPrefix,
        createdAt: token.createdAt.toISOString(),
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        expiresAt: token.expiresAt?.toISOString() ?? null,
        hasEncryptionAccess: token.hasEncryptionAccess,
        hasUnattendedTeamAccess: token.hasUnattendedTeamAccess,
    };
}

function serializeCreatedApiToken(token: CreatedApiToken) {
    return {
        token: token.token,
        apiToken: {
            tokenId: token.tokenId,
            label: token.label,
            displayPrefix: token.displayPrefix,
            createdAt: token.createdAt.toISOString(),
            lastUsedAt: null,
            expiresAt: token.expiresAt?.toISOString() ?? null,
            hasEncryptionAccess: token.hasEncryptionAccess,
            hasUnattendedTeamAccess: token.hasUnattendedTeamAccess,
        },
    };
}

/**
 * Direct Settings/session transport for the current Account's API-token
 * Actions. `app.authenticate` is the canonical direct-route authority owner;
 * API-token callers are denied there by the shared default policy. The Action
 * boundary separately governs public/API and trusted-plugin admission.
 */
export function registerAccountApiTokenManagementRoutes(app: Fastify): void {
    app.post(
        ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
        {
            config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.apiTokens.mutate") },
            preHandler: [app.authenticate, requirePresentUser],
            attachValidation: true,
            schema: {
                body: AccountApiTokensCreateActionInputV1Schema,
                response: {
                    200: AccountApiTokensCreateActionOutputV1Schema,
                    400: AccountApiTokensServerErrorV1Schema,
                    403: AccountApiTokensServerErrorV1Schema,
                    409: AccountApiTokensServerErrorV1Schema,
                },
            },
        },
        async (request, reply) => {
            if (request.validationError) {
                return await reply.code(400).send({ error: "invalid_request" });
            }

            const now = new Date();
            const expiresAt = request.body.expiresAt == null
                ? null
                : new Date(request.body.expiresAt);
            try {
                if (request.body.authorizeUnattendedTeamAccess === true
                    && !request.authTokenAuthenticationEvidence?.length) {
                    return await reply.code(409).send({ error: "credential_authentication_evidence_unavailable" });
                }
                const created = await auth.createApiToken({
                    accountId: request.userId,
                    tokenId: request.body.tokenId,
                    label: request.body.label,
                    expiresAt,
                    ...(request.body.encryption ? { encryption: request.body.encryption } : {}),
                    ...(request.body.authorizeUnattendedTeamAccess === true && request.authTokenAuthenticationEvidence
                        ? { authenticationEvidence: request.authTokenAuthenticationEvidence }
                        : {}),
                }, now);
                return await reply.send(serializeCreatedApiToken(created));
            } catch (error) {
                if (error instanceof InvalidApiTokenExpiryError) {
                    return await reply.code(400).send({ error: "invalid_request" });
                }
                if (error instanceof ApiTokenOperationError && error.code === "account-disabled") {
                    return await reply.code(403).send({ error: "account-disabled" });
                }
                if (error instanceof ApiTokenOperationError && (
                    error.code === "api_token_id_conflict"
                    || error.code === "api_token_encryption_not_ready"
                    || error.code === "credential_authentication_evidence_limit"
                    || error.code === "credential_authentication_evidence_unavailable"
                )) {
                    return await reply.code(409).send({ error: error.code });
                }
                throw error;
            }
        },
    );

    app.post(ACCOUNT_API_TOKEN_ENCRYPTION_ACCESS_HTTP_PATH_V1, {
        config: {
            allowApiToken: true,
            rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.apiTokens.read"),
        },
        preHandler: app.authenticate,
        attachValidation: true,
        schema: {
            body: AccountApiTokenEncryptionAccessRequestV1Schema,
            response: {
                200: AccountApiTokenEncryptionAccessResponseV1Schema,
                400: AccountApiTokensServerErrorV1Schema,
                401: z.union([
                    AccountApiTokenIntrospectionSubjectFailureV1Schema,
                    AccountApiTokenIntrospectionConnectionFailureV1Schema,
                ]),
                403: AccountApiTokensServerErrorV1Schema,
                409: AccountApiTokensServerErrorV1Schema,
            },
        },
    }, async (request, reply) => {
        if (request.validationError) return await reply.code(400).send({ error: "invalid_request" });
        if (request.authTokenKind !== "api_token" || !request.apiTokenPrincipal) {
            return await reply.code(403).send({ error: "api_token_required" });
        }
        try {
            return await reply.send(await auth.getApiTokenEncryptionAccess(request.apiTokenPrincipal));
        } catch (error) {
            if (error instanceof ApiTokenOperationError) {
                if (error.code === "invalid_token") return await reply.code(401).send({ error: error.code });
                if (error.code === "api_token_encryption_stale" || error.code === "api_token_encryption_unavailable") {
                    return await reply.code(409).send({ error: error.code });
                }
            }
            throw error;
        }
    });

    app.post(
        ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
        {
            config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.apiTokens.read") },
            preHandler: app.authenticate,
            attachValidation: true,
            schema: {
                body: AccountApiTokensListActionInputV1Schema,
                querystring: z.object({}).strict(),
                response: {
                    200: AccountApiTokensListActionOutputV1Schema,
                    400: AccountApiTokensServerErrorV1Schema,
                    403: PresentUserRequiredResponseSchema,
                },
            },
        },
        async (request, reply) => {
            if (request.validationError) {
                return await reply.code(400).send({ error: "invalid_request" });
            }

            const tokens = await auth.listApiTokens(request.userId);
            return await reply.send({ tokens: tokens.map(serializeApiTokenSummary) });
        },
    );

    app.post(
        ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
        {
            config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.apiTokens.mutate") },
            preHandler: [app.authenticate, requirePresentUser],
            attachValidation: true,
            schema: {
                body: AccountApiTokensRevokeActionInputV1Schema,
                response: {
                    200: AccountApiTokensRevokeActionOutputV1Schema,
                    400: AccountApiTokensServerErrorV1Schema,
                    403: PresentUserRequiredResponseSchema,
                },
            },
        },
        async (request, reply) => {
            if (request.validationError) {
                return await reply.code(400).send({ error: "invalid_request" });
            }

            const revoked = await auth.revokeApiToken({
                accountId: request.userId,
                tokenId: request.body.tokenId,
            });
            return await reply.send({ revoked });
        },
    );

    app.post(
        ACCOUNT_API_TOKENS_REVOKE_ALL_HTTP_PATH_V1,
        {
            config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.apiTokens.mutate") },
            preHandler: [app.authenticate, requirePresentUser],
            attachValidation: true,
            schema: {
                body: AccountApiTokensRevokeAllActionInputV1Schema,
                response: {
                    200: AccountApiTokensRevokeAllActionOutputV1Schema,
                    400: AccountApiTokensServerErrorV1Schema,
                    403: PresentUserRequiredResponseSchema,
                },
            },
        },
        async (request, reply) => {
            if (request.validationError) {
                return await reply.code(400).send({ error: "invalid_request" });
            }

            const revokedCount = await auth.revokeAllApiTokens(request.userId);
            return await reply.send({ revokedCount });
        },
    );
}
