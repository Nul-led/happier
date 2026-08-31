import {
    HomeConnectionDescriptorV1Schema,
    type HomeConnectionDescriptorV1,
    ServerRetentionPolicyV2Schema,
    type HomeSearchCapabilities,
} from '@happier-dev/protocol';
import { type Fastify } from '../../types';

import { featuresSchema } from '@/app/features/types';
import { resolveFeaturesFromEnv } from '@/app/features/registry';
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import {
    applyPublicSignupProvisioningRestrictionsToFeaturesPayload,
} from "@/app/integrations/publicUrl/publicSignupProvisioningPolicy";
import { readCachedServerIdentityIdForHotPath } from "@/app/serverIdentity/serverIdentity";
import { readRetentionPolicyFromEnv } from '@/app/retention/config/readRetentionPolicyFromEnv';
import { retentionPolicyToPublicPolicy } from '@/app/retention/config/retentionPolicyToPublicPolicy';
import { getHomeIrohEndpointState, type HomeIrohEndpointState } from '@/app/iroh/homeIrohEndpoint';

/**
 * Projects the current Home Iroh endpoint state into the canonical outer wire
 * descriptor published at /v1/features. Only an active endpoint with a
 * non-null snapshot publishes; any other lifecycle state, or a snapshot that
 * does not parse through the canonical descriptor schema, omits the field.
 * Runtime handles, acceptor ports, key material, and failure detail never
 * leave the server through this projection.
 */
function resolvePublishedHomeConnectionDescriptor(
    state: HomeIrohEndpointState,
): HomeConnectionDescriptorV1 | undefined {
    if (state.status !== 'active' || !state.snapshot) return undefined;
    const { homeServerIdentityId, canonicalServerUrl, revision, endpoint } = state.snapshot;
    const parsed = HomeConnectionDescriptorV1Schema.safeParse({
        v: 1,
        homeServerIdentityId,
        canonicalServerUrl,
        revision,
        endpoints: [{
            kind: 'iroh',
            endpointId: endpoint.endpointId,
            ...(endpoint.relayUrls ? { relayUrls: endpoint.relayUrls } : {}),
            ...(endpoint.directAddresses ? { directAddresses: endpoint.directAddresses } : {}),
        }],
    });
    return parsed.success ? parsed.data : undefined;
}

export function featuresRoutes(app: Fastify, params: Readonly<{
    resolveHomeSearchCapability?: () => HomeSearchCapabilities | undefined;
    /** Narrow injected Home Iroh state resolver for route tests; production reads the live owner. */
    resolveHomeIrohEndpointState?: () => HomeIrohEndpointState | Promise<HomeIrohEndpointState>;
}> = {}) {
    app.get(
        '/v2/retention-policy',
        {
            schema: {
                response: {
                    200: ServerRetentionPolicyV2Schema,
                },
            },
            config: {
                rateLimit: resolveApiHotEndpointRateLimit(process.env, 'features'),
            },
        },
        async (_request, reply) => reply.send(
            retentionPolicyToPublicPolicy(readRetentionPolicyFromEnv(process.env)),
        ),
    );

    app.get(
        '/v1/features',
        {
            schema: {
                response: {
                    200: featuresSchema,
                },
            },
            config: {
                rateLimit: resolveApiHotEndpointRateLimit(process.env, "features"),
            },
        },
        async (request, reply) => {
            const payload = resolveFeaturesFromEnv(process.env);
            const serverIdentityId = readCachedServerIdentityIdForHotPath(process.env);
            const homeSearch = params.resolveHomeSearchCapability?.();
            // Request-time read: the descriptor always reflects the current
            // endpoint lifecycle and is never cached beyond this response
            // (Cache-Control no-store below).
            const homeIrohState = await (params.resolveHomeIrohEndpointState?.() ?? getHomeIrohEndpointState());
            const homeConnectionDescriptor = resolvePublishedHomeConnectionDescriptor(homeIrohState);
            reply.header("Cache-Control", "no-store");
            return reply.send(applyPublicSignupProvisioningRestrictionsToFeaturesPayload({
                payload: {
                    ...payload,
                    ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
                    capabilities: {
                        ...payload.capabilities,
                        serverIdentity: { serverIdentityId },
                        ...(homeSearch ? { homeSearch } : {}),
                    },
                },
                env: process.env,
                requestIp: request.ip,
            }));
        }
    );
}
