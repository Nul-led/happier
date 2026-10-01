import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import {
    EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HTTP_PATH_TEMPLATE_V1,
    EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_VERIFY_HTTP_PATH_TEMPLATE_V1,
    EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES_V2,
    EXTERNAL_ACTION_HTTP_PATH_PREFIX_V1,
    ExternalActionActionIdV1Schema,
    ExternalActionExecutionAuthorizationRequestV1Schema,
    ExternalActionExecutionAuthorizationVerifyRequestV1Schema,
    computeExternalActionRequestEnvelopeDigestV1,
    ExternalActionRequestEnvelopeSchema,
    isExternalActionRequestWithinLimit,
    type ExternalActionServerPrincipalV1,
    type PreparedExternalActionResponseEnvelope,
    projectExternalActionHttpError,
    projectExternalActionResponseEnvelopeV1,
    type ExternalActionHttpErrorCode,
    prepareExternalActionResponseEnvelopeV1,
    readExternalActionProtectedRequestId,
} from "@happier-dev/protocol/actions";

import {
    type ExternalActionDaemonDispatcher,
} from "@/app/api/socket/externalActionDispatcher";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { auth, ApiTokenOperationError } from "@/app/auth/auth";
import { classifyMachineAvailabilityState } from "@/app/machines/machineStateGuards";
import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";
import { db } from "@/storage/db";

import type { Fastify } from "../../types";

type ExternalActionRouteParams = Readonly<{
    actionId: string;
}>;

// The inner envelope retains its canonical owner limit. This adds only the
// maximum escaped 256-code-unit Machine id and fixed JSON wrapper framing.
const EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_REQUEST_FRAMING_BYTES = Buffer.byteLength(JSON.stringify({
    v: 1,
    machineId: "\u0000".repeat(256),
    envelope: null,
}), "utf8") - Buffer.byteLength("null", "utf8");

async function verifyExternalActionExecutionAuthorizationRoute(
    request: FastifyRequest<{ Params: ExternalActionRouteParams; Body: unknown }>,
    reply: FastifyReply,
): Promise<FastifyReply> {
    reply.header("cache-control", "no-store");
    if (request.externalActionExecutionAuthorized !== true) {
        return sendExternalActionJson(reply, 401, { error: "invalid_token" });
    }
    if (!ExternalActionExecutionAuthorizationVerifyRequestV1Schema.safeParse(request.body).success) {
        return sendExternalActionHttpError(reply, "invalid_envelope");
    }
    return reply.send({ ok: true });
}

export type RegisterExternalActionRoutesDependencies = Readonly<{
    dispatch?: ExternalActionDaemonDispatcher;
}>;

function sendExternalActionJson(reply: FastifyReply, statusCode: number, payload: unknown): FastifyReply {
    const serialized = JSON.stringify(payload);
    const body = typeof serialized === "string" ? serialized : "null";
    return sendExternalActionSerializedJson(reply, statusCode, body, Buffer.byteLength(body, "utf8"));
}

function sendExternalActionSerializedJson(
    reply: FastifyReply,
    statusCode: number,
    body: string,
    byteLength: number,
): FastifyReply {
    return reply
        .code(statusCode)
        .header("cache-control", "no-store")
        .header("content-type", "application/json; charset=utf-8")
        .header("content-length", String(byteLength))
        .send(body);
}

function sendExternalActionResponse(
    reply: FastifyReply,
    prepared: PreparedExternalActionResponseEnvelope,
): FastifyReply {
    return sendExternalActionSerializedJson(reply, 200, prepared.body, prepared.byteLength);
}

function sendExternalActionHttpError(
    reply: FastifyReply,
    code: ExternalActionHttpErrorCode,
    requestId?: string,
): FastifyReply {
    const error = projectExternalActionHttpError(code, requestId);
    return sendExternalActionJson(reply, error.statusCode, error.payload);
}

function sendExternalActionSubmittedUnknown(reply: FastifyReply): FastifyReply {
    // The relay cannot authenticate an Action result after losing the daemon's
    // acknowledgement. An empty transport failure lets the caller retain its
    // own request correlation without fabricating a plaintext Action outcome.
    return reply
        .code(502)
        .header("cache-control", "no-store")
        .send();
}

function isFastifyBodyLimitError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "FST_ERR_CTP_BODY_TOO_LARGE";
}

function isFastifyExternalActionBodyParseError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (
            error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
            || error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
            || error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
        );
}

function createRequestLifetime(
    request: FastifyRequest,
    reply: FastifyReply,
): Readonly<{ signal: AbortSignal; dispose: () => void }> {
    const controller = new AbortController();
    const abort = (): void => {
        if (!controller.signal.aborted) {
            controller.abort(new Error("External Action request ended"));
        }
    };
    const abortIfResponseDidNotFinish = (): void => {
        if (!reply.raw.writableEnded) abort();
    };
    request.raw.once("aborted", abort);
    reply.raw.once("close", abortIfResponseDidNotFinish);
    if (request.raw.aborted) abort();
    return {
        signal: controller.signal,
        dispose: () => {
            request.raw.removeListener("aborted", abort);
            reply.raw.removeListener("close", abortIfResponseDidNotFinish);
        },
    };
}

function readExternalActionRequestPrincipal(
    request: FastifyRequest,
): ExternalActionServerPrincipalV1 | null {
    const verified = request.apiTokenPrincipal;
    if (
        request.authTokenKind !== "api_token"
        || request.authAuthority !== "account_automation"
        || !verified
        || verified.authority !== "account_automation"
        || verified.accountId !== request.userId
    ) {
        return null;
    }
    return {
        accountId: verified.accountId,
        principalId: verified.principalId,
        credentialId: verified.credentialId,
        grant: verified.grant,
        authority: verified.authority,
    };
}

/**
 * Public server Action ingress. It authenticates only a PAT, validates the
 * finite transport envelope, then delegates placement and all Action semantics
 * to the server's single exact-daemon relay.
 */
export function registerExternalActionRoutes(
    app: Fastify,
    dependencies: RegisterExternalActionRoutesDependencies = {},
): void {
    const dispatch = dependencies.dispatch ?? app.forwardExternalActionToMachine;

    app.post<{ Params: ExternalActionRouteParams; Body: unknown }>(
        EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HTTP_PATH_TEMPLATE_V1,
        {
            bodyLimit: EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES_V2
                + EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_REQUEST_FRAMING_BYTES,
            config: {
                allowApiToken: true,
                allowScopedApiToken: true,
                connectionAuthFailureError: "invalid_token",
                rateLimit: resolveApiHotEndpointRateLimit(process.env, "actions"),
            },
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            reply.header("cache-control", "no-store");
            const principal = readExternalActionRequestPrincipal(request);
            const actionId = ExternalActionActionIdV1Schema.safeParse(request.params.actionId);
            const body = ExternalActionExecutionAuthorizationRequestV1Schema.safeParse(request.body);
            if (!principal || !actionId.success || !body.success) {
                return sendExternalActionHttpError(reply, principal ? "invalid_envelope" : "invalid_token");
            }
            if (!isExternalActionRequestWithinLimit(body.data.envelope)) {
                return sendExternalActionHttpError(reply, "request_too_large");
            }
            const target = body.data.envelope.target ?? {
                kind: "machine" as const,
                machineId: body.data.machineId,
            };
            if (target.kind === "machine" && target.machineId !== body.data.machineId) {
                return sendExternalActionHttpError(reply, "invalid_envelope");
            }
            const machine = await db.machine.findFirst({
                where: { id: body.data.machineId, accountId: principal.accountId },
                select: {
                    revokedAt: true,
                    replacedByMachineId: true,
                    installationId: true,
                    installationPublicKey: true,
                },
            });
            if (
                !machine
                || classifyMachineAvailabilityState(machine) !== "available"
                || !machine.installationId
                || !machine.installationPublicKey
            ) {
                return sendExternalActionHttpError(reply, "target_unavailable", body.data.envelope.requestId);
            }
            try {
                const authorization = await auth.mintExternalActionExecutionAuthorization({
                    serverIdentityId: await getOrCreateServerIdentityId(),
                    accountId: principal.accountId,
                    principalId: principal.principalId,
                    credentialId: principal.credentialId,
                    grant: principal.grant,
                    machineId: body.data.machineId,
                    actionId: actionId.data,
                    requestId: body.data.envelope.requestId ?? randomUUID(),
                    requestEnvelopeDigest: computeExternalActionRequestEnvelopeDigestV1(body.data.envelope),
                    target,
                }, { ...(body.data.envelope.v === 1 ? { input: body.data.envelope.input } : {}) });
                return reply.header("cache-control", "no-store").send(authorization);
            } catch (error) {
                if (error instanceof ApiTokenOperationError && (error.code === "credential_scope_denied" || error.code === "invalid_token")) {
                    return sendExternalActionHttpError(reply, error.code, body.data.envelope.requestId);
                }
                throw error;
            }
        },
    );

    app.post<{ Params: ExternalActionRouteParams; Body: unknown }>(
        EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_VERIFY_HTTP_PATH_TEMPLATE_V1,
        {
            config: {
                allowApiToken: true,
                connectionAuthFailureError: "invalid_token",
            },
            preHandler: app.authenticate,
        },
        verifyExternalActionExecutionAuthorizationRoute,
    );

    app.post<{
        Params: ExternalActionRouteParams;
        Body: unknown;
    }>(`${EXTERNAL_ACTION_HTTP_PATH_PREFIX_V1}:actionId`, {
        bodyLimit: EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES_V2,
        config: {
            allowApiToken: true,
            allowScopedApiToken: true,
            connectionAuthFailureError: "invalid_token",
            rateLimit: resolveApiHotEndpointRateLimit(process.env, "actions"),
        },
        errorHandler: (error, _request, reply) => {
            if (isFastifyBodyLimitError(error)) {
                sendExternalActionHttpError(reply, "request_too_large");
                return;
            }
            if (isFastifyExternalActionBodyParseError(error)) {
                sendExternalActionHttpError(reply, "invalid_envelope");
                return;
            }
            sendExternalActionHttpError(reply, "internal_error");
        },
        onRequest: async (request, reply) => {
            reply.header("cache-control", "no-store");
            await app.authenticate(request, reply);
            if (reply.sent) return;
            if (!readExternalActionRequestPrincipal(request)) {
                return sendExternalActionHttpError(reply, "invalid_token");
            }
        },
    }, async (request, reply) => {
        const lifetime = createRequestLifetime(request, reply);
        try {
            // The onRequest admission verified the bearer once and stamped
            // its immutable PAT provenance on this request. Do not retain or
            // forward the plaintext bearer beyond that boundary.
            const principal = readExternalActionRequestPrincipal(request);
            if (!principal) {
                return sendExternalActionHttpError(reply, "invalid_token");
            }

            const actionId = ExternalActionActionIdV1Schema.safeParse(request.params.actionId);
            if (!actionId.success) {
                return sendExternalActionHttpError(
                    reply,
                    "invalid_action",
                    readExternalActionProtectedRequestId(request.body),
                );
            }

            const envelope = ExternalActionRequestEnvelopeSchema.safeParse(request.body);
            if (!envelope.success) {
                return sendExternalActionHttpError(
                    reply,
                    "invalid_envelope",
                    readExternalActionProtectedRequestId(request.body),
                );
            }
            if (!isExternalActionRequestWithinLimit(envelope.data)) {
                return sendExternalActionHttpError(reply, "request_too_large");
            }

            const result = await dispatch({
                actionId: actionId.data,
                envelope: envelope.data,
                principal,
            }, { signal: lifetime.signal });
            if (result.kind === "submitted_unknown") {
                return sendExternalActionSubmittedUnknown(reply);
            }
            if (result.kind === "placement_error") {
                if (result.code === "credential_scope_denied") return sendExternalActionHttpError(reply, result.code, envelope.data.requestId);
                if (envelope.data.v === 2) {
                    return sendExternalActionHttpError(reply, result.code, envelope.data.requestId);
                }
                const response = projectExternalActionResponseEnvelopeV1({
                    v: 1,
                    actionId: actionId.data,
                    ...(envelope.data.requestId === undefined
                        ? {}
                        : { requestId: envelope.data.requestId }),
                    execution: {
                        ok: false,
                        errorCode: result.code,
                        error: result.code,
                    },
                });
                if (!response) {
                    throw new Error("Protocol rejected external Action placement response");
                }
                return sendExternalActionResponse(
                    reply,
                    prepareExternalActionResponseEnvelopeV1(response),
                );
            }
            if (result.kind === "invalid_request") {
                return sendExternalActionHttpError(
                    reply,
                    result.errorCode,
                    envelope.data.v === 2 ? envelope.data.requestId : undefined,
                );
            }
            return sendExternalActionResponse(reply, result.prepared);
        } finally {
            lifetime.dispose();
        }
    });
}
