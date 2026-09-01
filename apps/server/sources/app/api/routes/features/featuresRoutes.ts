import {
    ServerRetentionPolicyV2Schema,
    type HomeSearchCapabilities,
} from '@happier-dev/protocol';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
import {
    resolveAuthenticatedHomeConnectionDescriptor,
    resolvePublishedHomeConnectionDescriptor,
} from '@/app/features/homeConnectionDescriptorPublication';
import {
    resolveConfiguredCanonicalServerUrl,
    resolveConfiguredPublicServerUrl,
} from '@/app/serverUrls/effectiveServerUrls';

export function featuresRoutes(app: Fastify, params: Readonly<{
    resolveHomeSearchCapability?: () => HomeSearchCapabilities | undefined;
    /** Narrow injected Home Iroh state resolver for route tests; production reads the live owner. */
    resolveHomeIrohEndpointState?: () => HomeIrohEndpointState | Promise<HomeIrohEndpointState>;
}> = {}) {
    const featuresRateLimit = resolveApiHotEndpointRateLimit(process.env, "features");
    const sendFeaturesResponse = async (
        request: FastifyRequest,
        reply: FastifyReply,
        descriptorVisibility: 'public' | 'authenticated',
    ) => {
        const payload = resolveFeaturesFromEnv(process.env);
        const serverIdentityId = readCachedServerIdentityIdForHotPath(process.env);
        const homeSearch = params.resolveHomeSearchCapability?.();
        // Request-time read: the descriptor always reflects the current
        // endpoint lifecycle and is never cached beyond this response.
        const homeIrohState = await (params.resolveHomeIrohEndpointState?.() ?? getHomeIrohEndpointState());
        const descriptorFacts = {
            homeServerIdentityId: serverIdentityId,
            canonicalServerUrl: resolveConfiguredCanonicalServerUrl(process.env),
            publicServerUrl: resolveConfiguredPublicServerUrl(process.env) ?? null,
            minimumOuterRevisionExclusive: homeIrohState.snapshot?.revision ?? null,
            iroh: homeIrohState,
        } as const;
        const homeConnectionDescriptor = descriptorVisibility === 'authenticated'
            ? resolveAuthenticatedHomeConnectionDescriptor(descriptorFacts)
            : resolvePublishedHomeConnectionDescriptor(descriptorFacts);
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
    };

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
                rateLimit: featuresRateLimit,
            },
        },
        async (request, reply) => await sendFeaturesResponse(request, reply, 'public'),
    );

    app.get(
        '/v1/features/authenticated',
        {
            preHandler: app.authenticate,
            schema: {
                response: {
                    200: featuresSchema,
                },
            },
            config: {
                rateLimit: featuresRateLimit,
            },
        },
        async (request, reply) => await sendFeaturesResponse(request, reply, 'authenticated'),
    );
}
