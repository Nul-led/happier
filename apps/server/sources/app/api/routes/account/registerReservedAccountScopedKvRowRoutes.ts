import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { Fastify } from "@/app/api/types";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { asServerProtocolZod } from "@/app/api/utils/protocolComposableZodAdapter";
import type { ReservedAccountScopedKvRowMutationResult, ReservedAccountScopedKvRowReadResult } from "@/app/kv/reservedAccountScopedKvRow";
import { inTx, type Tx } from "@/storage/inTx";

type ProtocolSchema<T> = Readonly<{
    safeParse(value: unknown): { success: true; data: T } | { success: false };
}>;

/** One authenticated HTTP projection of the reserved-row read and CAS owner. */
export function registerReservedAccountScopedKvRowRoutes<TParams, TEnvelope>(
    app: Fastify,
    domain: Readonly<{
        path: string;
        paramsSchema: ProtocolSchema<TParams>;
        mutationSchema: ProtocolSchema<{ expectedRevision: number | "absent"; content: TEnvelope | null }>;
        readResponseSchema: ProtocolSchema<unknown>;
        mutationResponseSchema: ProtocolSchema<unknown>;
        unavailableError: string;
        available?: (request: FastifyRequest) => boolean;
        includeCursor?: boolean;
        read(tx: Tx, input: { accountId: string; params: TParams }): Promise<ReservedAccountScopedKvRowReadResult<TEnvelope>>;
        mutate(tx: Tx, input: { accountId: string; params: TParams; expectedRevision: number | "absent"; envelope: TEnvelope | null }): Promise<ReservedAccountScopedKvRowMutationResult>;
    }>,
): void {
    const errors = {
        400: z.object({ error: z.literal("invalid-params") }).strict(),
        503: z.object({ error: z.literal(domain.unavailableError) }).strict(),
        500: z.object({ error: z.literal("internal") }).strict(),
    };
    const params = asServerProtocolZod(domain.paramsSchema);
    const config = { rateLimit: resolveApiHotEndpointRateLimit(process.env, "account.settings") };
    const unavailable = () => ({ error: domain.unavailableError });

    app.get(domain.path, {
        preHandler: app.authenticate, config,
        schema: { params, response: { 200: asServerProtocolZod(domain.readResponseSchema), ...errors } },
    }, async (request, reply) => {
        if (domain.available && !domain.available(request)) return reply.code(503).send(unavailable());
        try {
            const result = await inTx(tx => domain.read(tx, { accountId: request.userId, params: request.params }));
            const response = result.status === "present"
                ? { status: "present" as const, revision: result.revision, content: result.envelope }
                : result.status === "absent" || result.status === "deleted" ? result : null;
            const parsed = domain.readResponseSchema.safeParse(response);
            if (!parsed.success) return reply.code(503).send(unavailable());
            return reply.send(parsed.data);
        } catch {
            return reply.code(500).send({ error: "internal" });
        }
    });

    app.post(domain.path, {
        preHandler: app.authenticate, config,
        schema: { params, body: asServerProtocolZod(domain.mutationSchema), response: { 200: asServerProtocolZod(domain.mutationResponseSchema), ...errors } },
    }, async (request, reply) => {
        if (domain.available && !domain.available(request)) return reply.code(503).send(unavailable());
        try {
            const result = await inTx(tx => domain.mutate(tx, {
                accountId: request.userId, params: request.params,
                expectedRevision: request.body.expectedRevision, envelope: request.body.content,
            }));
            if (result.status === "updated" || result.status === "conflict") {
                return reply.send({ status: result.status, revision: result.revision,
                    ...(domain.includeCursor && result.status === "updated" ? { cursor: result.cursor } : {}),
                });
            }
            return reply.code(503).send(unavailable());
        } catch {
            return reply.code(500).send({ error: "internal" });
        }
    });
}
