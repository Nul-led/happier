import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import { registerNativeAuthEmailOperationRoutes } from "./registerNativeAuthEmailPreviewRoutes";

describe("native authentication email delivery readiness", () => {
    it("returns the neutral accepted response without consulting invitation state when delivery is unavailable", async () => {
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        registerNativeAuthEmailOperationRoutes(app as never, {
            delivery: {
                isReady: async () => false,
                deliver: async () => {
                    throw new Error("delivery must not be attempted while unavailable");
                },
            },
            isDeliveryReady: () => false,
            env: process.env,
            resolveApplicationLinkTarget: async () => {
                throw new Error("link resolution must not run while delivery is unavailable");
            },
        });

        try {
            const invitationResponse = await app.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: {
                    v: 1,
                    email: "invitee@example.test",
                    admission: {
                        kind: "team_invitation",
                        token: "A".repeat(43),
                    },
                },
            });
            expect(invitationResponse.statusCode).toBe(200);
            expect(invitationResponse.json()).toEqual({ accepted: true });
        } finally {
            await app.close();
        }
    });
});
