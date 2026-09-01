import { describe, expect, it, vi } from "vitest";
import fastify from "fastify";

import { createRouteTestBuilder } from "@/app/api/testkit/routeTestBuilder";
import type { Fastify } from "@/app/api/types";

import {
    IROH_RELAY_ADMISSION_PATH,
    registerIrohRelayAdmissionRoutes,
} from "./irohRelayAdmissionRoutes";

const ENDPOINT_ID = "a".repeat(64);

function route(options: Parameters<typeof registerIrohRelayAdmissionRoutes>[1]) {
    return createRouteTestBuilder({
        method: "POST",
        path: IROH_RELAY_ADMISSION_PATH,
        registerRoutes(app) {
            registerIrohRelayAdmissionRoutes(app as unknown as Fastify, options);
        },
    });
}

describe("Iroh relay admission", () => {
    it("returns the exact boolean body required by stock iroh-relay over HTTP", async () => {
        const app = fastify();
        registerIrohRelayAdmissionRoutes(app as unknown as Fastify, {
            admissionToken: "relay-secret",
            isHomeEndpointActive: async () => true,
        });
        try {
            const response = await app.inject({
                method: "POST",
                url: IROH_RELAY_ADMISSION_PATH,
                headers: {
                    authorization: "Bearer relay-secret",
                    "x-iroh-nodeid": ENDPOINT_ID,
                },
            });
            expect(response.statusCode).toBe(200);
            expect(response.body).toBe("true");
        } finally {
            await app.close();
        }
    });

    it("admits the exact active Home endpoint for the authenticated stock relay callback", async () => {
        const isHomeEndpointActive = vi.fn().mockResolvedValue(true);
        const admission = route({
            admissionToken: "relay-secret",
            isHomeEndpointActive,
        });

        const { response } = await admission.invoke({
            headers: {
                authorization: "Bearer relay-secret",
                "x-iroh-nodeid": ENDPOINT_ID,
            },
        });

        expect(response).toBe(true);
        expect(isHomeEndpointActive).toHaveBeenCalledWith(ENDPOINT_ID);
    });

    it("denies an unknown endpoint without consulting a second registry", async () => {
        const admission = route({
            admissionToken: "relay-secret",
            isHomeEndpointActive: vi.fn().mockResolvedValue(false),
        });

        const { response } = await admission.invoke({
            headers: {
                authorization: "Bearer relay-secret",
                "x-iroh-nodeid": ENDPOINT_ID,
            },
        });

        expect(response).toBe(false);
    });

    it("fails closed for a missing callback secret, bad bearer, or malformed EndpointId", async () => {
        const reader = vi.fn();
        for (const fixture of [
            { token: "", authorization: "Bearer relay-secret", endpointId: ENDPOINT_ID },
            { token: "relay-secret", authorization: "Bearer wrong", endpointId: ENDPOINT_ID },
            { token: "relay-secret", authorization: "Bearer relay-secret", endpointId: "not-an-endpoint" },
        ]) {
            const admission = route({
                admissionToken: fixture.token,
                isHomeEndpointActive: reader,
            });
            const { response } = await admission.invoke({
                headers: {
                    authorization: fixture.authorization,
                    "x-iroh-nodeid": fixture.endpointId,
                },
            });
            expect(response).toBe(false);
        }
        expect(reader).not.toHaveBeenCalled();
    });
});
