import { z } from "zod";

import { type Fastify } from "../../types";
import { Context } from "@/context";
import { resolveOAuthRuntimeById } from "@/app/auth/providers/identityProviderCatalog";
import { disconnectExternalIdentity } from "@/app/auth/providers/identity";
import { IdentityManagementDeniedError } from "@/app/auth/providers/accountIdentityLifecycle";
import { deleteOAuthPendingBestEffort, loadValidOAuthPending } from "./connectRoutes.oauthPending";
import { createExternalAuthorizeUrl } from "./oauthExternal/createExternalAuthorizeUrl";
import { oauthExternalRateLimitConnectParamsPerUser } from "./oauthExternal/oauthExternalRateLimits";
import { connectPendingSchema } from "./oauthExternal/oauthExternalSchemas";
import { OAUTH_STATE_UNAVAILABLE_CODE } from "@/app/auth/oauthStateErrors";
import { OAUTH_NOT_CONFIGURED_ERROR } from "./oauthExternal/oauthExternalErrors";
import { registerExternalConnectFinalizeRoute } from "./oauthExternal/registerExternalConnectFinalizeRoute";
import { ExternalOAuthErrorResponseSchema, ExternalOAuthParamsResponseSchema } from "@happier-dev/protocol";
import { NotFoundSchema } from "../../schemas/notFoundSchema";
import { resolveWebAppOAuthReturnUrlFromRequestHeaders } from "./oauthExternal/oauthExternalConfig";

export function connectConnectExternalRoutes(app: Fastify) {
    //
    // External provider connection (authenticated identity linking)
    //

    app.get("/v1/connect/external/:provider/params", {
        preHandler: app.authenticate,
        config: { rateLimit: oauthExternalRateLimitConnectParamsPerUser() },
        schema: {
            params: z.object({ provider: z.string() }),
            querystring: z.object({
                connectFinalization: z.literal("credential_adoption_v1").optional(),
            }),
            response: {
                200: ExternalOAuthParamsResponseSchema,
                400: ExternalOAuthErrorResponseSchema,
                404: z.union([NotFoundSchema, z.object({ error: z.literal("unsupported-provider") })]),
            },
        },
    }, async (request, reply) => {
        const providerId = request.params.provider.toString().trim().toLowerCase();
        const resolved = await resolveOAuthRuntimeById(process.env, providerId);
        if (!resolved) return reply.code(404).send({ error: "unsupported-provider" });
        const { provider, reference } = resolved;

        try {
            const webAppOAuthReturnUrl = resolveWebAppOAuthReturnUrlFromRequestHeaders({
                env: process.env,
                providerId,
                headers: request.headers as any,
            });
            const url = await createExternalAuthorizeUrl({
                flow: "connect",
                env: process.env,
                providerId,
                provider,
                reference,
                userId: request.userId,
                ...(request.query.connectFinalization
                    ? { connectFinalization: request.query.connectFinalization }
                    : {}),
                ...(webAppOAuthReturnUrl ? { webAppOAuthReturnUrl } : {}),
            });
            if (!url) return reply.code(400).send({ error: OAUTH_STATE_UNAVAILABLE_CODE });
            return reply.send({ url });
        } catch (error) {
            if (error instanceof Error && error.message === OAUTH_NOT_CONFIGURED_ERROR) {
                return reply.code(400).send({ error: OAUTH_NOT_CONFIGURED_ERROR });
            }
            throw error;
        }
    });

    registerExternalConnectFinalizeRoute(app);

    app.delete("/v1/connect/external/:provider/pending/:pending", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ provider: z.string(), pending: z.string() }),
            response: {
                200: z.object({ success: z.literal(true) }),
                404: z.union([NotFoundSchema, z.object({ error: z.literal("unsupported-provider") })]),
            },
        },
    }, async (request, reply) => {
        const providerId = request.params.provider.toString().trim().toLowerCase();
        if (!await resolveOAuthRuntimeById(process.env, providerId)) {
            return reply.code(404).send({ error: "unsupported-provider" });
        }

        const pendingKey = request.params.pending.toString().trim();
        if (!pendingKey) return reply.send({ success: true });

        const pending = await loadValidOAuthPending(pendingKey);
        if (!pending) return reply.send({ success: true });
        try {
            const parsed = connectPendingSchema.safeParse(JSON.parse(pending.value));
            if (!parsed.success) return reply.send({ success: true });
            if (parsed.data.userId !== request.userId) return reply.send({ success: true });
        } catch {
            return reply.send({ success: true });
        }
        await deleteOAuthPendingBestEffort(pendingKey);
        return reply.send({ success: true });
    });

    app.delete("/v1/connect/external/:provider", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ provider: z.string() }),
            response: {
                200: z.object({ success: z.literal(true) }),
                404: z.union([NotFoundSchema, z.object({ error: z.literal("unsupported-provider") })]),
                409: z.object({
                    error: z.literal("identity-management-denied"),
                    reason: z.enum(["required_by_team", "last_login_method", "management_unavailable"]),
                }),
            },
        },
    }, async (request, reply) => {
        const providerId = request.params.provider.toString().trim().toLowerCase();
        const ctx = Context.create(request.userId);
        try {
            await disconnectExternalIdentity({ providerId, ctx });
        } catch (error) {
            if (error instanceof IdentityManagementDeniedError) {
                return reply.code(409).send({ error: "identity-management-denied", reason: error.reason });
            }
            if (error instanceof Error && error.message === "unsupported-provider") {
                return reply.code(404).send({ error: "unsupported-provider" });
            }
            throw error;
        }
        return reply.send({ success: true });
    });
}
