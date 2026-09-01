import { timingSafeEqual } from "node:crypto";

import { IrohEndpointIdV1Schema } from "@happier-dev/protocol";

import type { Fastify } from "@/app/api/types";
import { getHomeIrohEndpointState } from "./homeIrohEndpoint";

export const IROH_RELAY_ADMISSION_PATH = "/v1/iroh/relay/admission";
export const IROH_RELAY_ADMISSION_TOKEN_ENV_KEY = "HAPPIER_IROH_RELAY_ADMISSION_TOKEN";

/**
 * A canonical producer adapter returns true only when this exact EndpointId is
 * currently published, active, policy-eligible, and not revoked/replaced.
 * Missing or unreadable state returns false; the callback owns no persistence.
 */
export type IrohRelayEndpointAdmissionReader = (endpointId: string) => Promise<boolean>;

export type IrohRelayAdmissionRouteOptions = Readonly<{
    admissionToken: string | undefined;
    isHomeEndpointActive: IrohRelayEndpointAdmissionReader;
    isMachineEndpointActive?: IrohRelayEndpointAdmissionReader;
    isAccountClientEndpointActive?: IrohRelayEndpointAdmissionReader;
}>;

function readBearerToken(headers: Readonly<Record<string, unknown>>): string | null {
    const raw = headers.authorization;
    if (typeof raw !== "string") return null;
    const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
    return match?.[1]?.trim() || null;
}

function equalSecret(expected: string, supplied: string): boolean {
    const expectedBytes = Buffer.from(expected, "utf8");
    const suppliedBytes = Buffer.from(supplied, "utf8");
    const width = Math.max(expectedBytes.byteLength, suppliedBytes.byteLength, 1);
    const expectedPadded = Buffer.alloc(width);
    const suppliedPadded = Buffer.alloc(width);
    expectedBytes.copy(expectedPadded);
    suppliedBytes.copy(suppliedPadded);
    const bytesEqual = timingSafeEqual(expectedPadded, suppliedPadded);
    return expectedBytes.byteLength === suppliedBytes.byteLength && bytesEqual;
}

async function safelyRead(reader: IrohRelayEndpointAdmissionReader | undefined, endpointId: string): Promise<boolean> {
    if (!reader) return false;
    try {
        return await reader(endpointId);
    } catch {
        return false;
    }
}

async function isAdmittedEndpoint(options: IrohRelayAdmissionRouteOptions, endpointId: string): Promise<boolean> {
    const results = await Promise.all([
        safelyRead(options.isHomeEndpointActive, endpointId),
        safelyRead(options.isMachineEndpointActive, endpointId),
        safelyRead(options.isAccountClientEndpointActive, endpointId),
    ]);
    return results.some(Boolean);
}

/**
 * Stock iroh-relay HTTP admission callback. The relay authenticates separately
 * with a deployment secret, while EndpointId admission is derived directly
 * from the canonical live endpoint owner. Missing producers deny by default;
 * this route deliberately does not materialize a second endpoint registry.
 */
export function registerIrohRelayAdmissionRoutes(
    app: Fastify,
    options: IrohRelayAdmissionRouteOptions = {
        admissionToken: process.env[IROH_RELAY_ADMISSION_TOKEN_ENV_KEY],
        isHomeEndpointActive: async (endpointId) => {
            const state = await getHomeIrohEndpointState();
            return state.status === "active" && state.snapshot?.endpoint.endpointId === endpointId;
        },
    },
): void {
    app.post(IROH_RELAY_ADMISSION_PATH, { config: { cors: false } }, async (request) => {
        const expectedToken = options.admissionToken?.trim() ?? "";
        const suppliedToken = readBearerToken(request.headers);
        const parsedEndpointId = IrohEndpointIdV1Schema.safeParse(request.headers["x-iroh-nodeid"]);

        if (!expectedToken || !suppliedToken || !equalSecret(expectedToken, suppliedToken) || !parsedEndpointId.success) {
            return false;
        }

        return await isAdmittedEndpoint(options, parsedEndpointId.data);
    });
}
