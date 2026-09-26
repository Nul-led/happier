import {
    ServerRetentionPolicyV2Schema,
    type HomeConnectionDescriptorV1,
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
import type { HomeIrohEndpointState } from '@/app/iroh/homeIrohEndpoint';
import {
    readCommittedHomeConnectionDescriptor,
    readHomeConnectionDescriptor,
} from '@/app/features/homeConnectionDescriptorPublication';
import type { HomeConnectionDescriptorContinuityStore } from '@/app/features/homeConnectionDescriptorContinuity';
import { resolveEffectiveHomeAuthMethods } from '@/app/auth/methods/effectiveHomeAuthMethods';
import { toPublishedAuthMethods } from '@/app/auth/methods/effectiveAuthMethods';
import { deriveLegacySignupMethodsFromAuthMethods } from '@/app/features/authFeature';
import { isAuthEmailDeliveryReady } from '@/app/auth/email/resolveAuthEmailDelivery';
import { isRestrictedAuthTokenKind } from '@/app/api/utils/apiTokenRouteAdmission';
import { captureFastifyExceptionForSentry } from '@/app/monitoring/sentry';

export function featuresRoutes(app: Fastify, params: Readonly<{
    resolveHomeSearchCapability?: () => HomeSearchCapabilities | undefined;
    /** Narrow injected Home Iroh state resolver for route tests; production reads the live owner. */
    resolveHomeIrohEndpointState?: () => HomeIrohEndpointState | Promise<HomeIrohEndpointState>;
    /** Startup-selected durable owner; null/absent means descriptor publication is unavailable. */
    homeConnectionDescriptorContinuityStore?: HomeConnectionDescriptorContinuityStore | null;
}> = {}) {
    const featuresRateLimit = resolveApiHotEndpointRateLimit(process.env, "features");
    const sendFeaturesResponse = async (
        request: FastifyRequest,
        reply: FastifyReply,
        descriptorVisibility: 'public' | 'authenticated',
    ) => {
        const environmentPayload = resolveFeaturesFromEnv(process.env);
        const effectiveHomeMethods = await resolveEffectiveHomeAuthMethods({
            env: process.env,
            emailDeliveryReady: await isAuthEmailDeliveryReady(process.env),
        }).catch((error: unknown) => {
            app.log.error({ err: error }, 'Failed to resolve the Home authentication policy for public features');
            captureFastifyExceptionForSentry(error, request);
            return { status: 'unavailable' as const };
        });
        const effectiveDecisions = effectiveHomeMethods.status === 'ready'
            ? effectiveHomeMethods.decisions
            : [];
        // The synchronous assembler only knows the deployment sign-in service;
        // this route publishes the Home's effective value — the same persisted
        // narrowing it already resolves for the method catalog — and withholds
        // the service while the Home policy is unreadable, exactly like auth entry.
        const signInService = effectiveHomeMethods.status === 'ready'
            ? effectiveHomeMethods.signInService ?? undefined
            : undefined;
        const payload = (() => {
                const methods = effectiveHomeMethods.status === 'ready'
                    ? toPublishedAuthMethods(effectiveDecisions)
                    : undefined;
                const isEnabled = (methodId: string, actionId: 'login' | 'provision'): boolean =>
                    effectiveDecisions.some((decision) =>
                        decision.id === methodId && decision.actions.some((action) =>
                            action.id === actionId && action.enabled));
                const priorAuth = environmentPayload.capabilities.auth;
                const priorAuthWithoutStructuredMethods = { ...priorAuth };
                delete priorAuthWithoutStructuredMethods.methods;
                const autoRedirect = priorAuth.ui?.autoRedirect;
                const autoRedirectMethodId = String(autoRedirect?.providerId ?? '').trim().toLowerCase();
                const autoRedirectStillEnabled = autoRedirect?.enabled === true
                    && methods !== undefined
                    && methods.some((method) => method.id === autoRedirectMethodId
                        && method.actions.some((action) => action.enabled
                            && (action.id === 'login' || action.id === 'provision')));
                return {
                    ...environmentPayload,
                    signInService,
                    features: {
                        ...environmentPayload.features,
                        auth: {
                            ...environmentPayload.features.auth,
                            mtls: { enabled: isEnabled('mtls', 'login') },
                            login: {
                                ...environmentPayload.features.auth.login,
                                keyChallenge: { enabled: isEnabled('key_challenge', 'login') },
                            },
                        },
                    },
                    capabilities: {
                        ...environmentPayload.capabilities,
                        auth: {
                            ...priorAuthWithoutStructuredMethods,
                            ...(methods !== undefined ? { methods } : {}),
                            signup: methods === undefined
                                ? priorAuth.signup
                                : {
                                    ...priorAuth.signup,
                                    methods: deriveLegacySignupMethodsFromAuthMethods(
                                        methods,
                                        priorAuth.signup?.methods?.map(({ id }) => id),
                                    ),
                                },
                            login: {
                                ...priorAuth.login,
                                methods: priorAuth.login?.methods?.map(({ id }) => ({
                                    id,
                                    enabled: isEnabled(id, 'login'),
                                })),
                            },
                            ...(autoRedirect ? {
                                ui: {
                                    ...priorAuth.ui,
                                    autoRedirect: {
                                        ...autoRedirect,
                                        enabled: autoRedirectStillEnabled,
                                        providerId: autoRedirectStillEnabled ? autoRedirect.providerId : null,
                                    },
                                },
                            } : {}),
                        },
                    },
                };
            })();
        const serverIdentityId = readCachedServerIdentityIdForHotPath(process.env);
        const homeSearch = params.resolveHomeSearchCapability?.();
        const effectiveDescriptorVisibility = descriptorVisibility === 'authenticated'
            && !isRestrictedAuthTokenKind(request.authTokenKind)
            ? 'authenticated'
            : 'public';
        // Request-time read: the descriptor always reflects the current
        // endpoint lifecycle and is never cached beyond this response.
        const resolvedHomeConnectionDescriptor: HomeConnectionDescriptorV1 | undefined =
            params.homeConnectionDescriptorContinuityStore
                ? effectiveDescriptorVisibility === 'public'
                    ? await readCommittedHomeConnectionDescriptor({
                        env: process.env,
                        continuityStore: params.homeConnectionDescriptorContinuityStore,
                        ...(params.resolveHomeIrohEndpointState
                            ? { resolveIrohEndpointState: params.resolveHomeIrohEndpointState }
                            : {}),
                    })
                    : await readHomeConnectionDescriptor({
                        env: process.env,
                        continuityStore: params.homeConnectionDescriptorContinuityStore,
                        visibility: effectiveDescriptorVisibility,
                        ...(params.resolveHomeIrohEndpointState
                            ? { resolveIrohEndpointState: params.resolveHomeIrohEndpointState }
                            : {}),
                    })
                : undefined;
        reply.header("Cache-Control", "no-store");
        return reply.send(applyPublicSignupProvisioningRestrictionsToFeaturesPayload({
            payload: {
                ...payload,
                ...(resolvedHomeConnectionDescriptor ? { homeConnectionDescriptor: resolvedHomeConnectionDescriptor } : {}),
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
                allowApiToken: true,
                ephemeralSessionRunnerBinding: { scope: "account" },
                rateLimit: featuresRateLimit,
            },
        },
        async (request, reply) => await sendFeaturesResponse(request, reply, 'authenticated'),
    );
}
