import {
    TeamCredentialDeliveryModeV1Schema,
    type TeamCredentialUsageCapabilitiesV1,
} from '@happier-dev/protocol/teams';

export type TeamCredentialUsageRouteCapability = Readonly<{
    id:
        | 'agent_runtime_session_turn'
        | 'agent_runtime_attached_execution_run'
        | 'agent_runtime_detached_execution_run'
        | 'external_provider_terminal'
        | 'resource_test';
    /** `not_applicable` marks a non-inference route that never consumes a
     * token or cost ceiling and therefore cannot withhold one. */
    tokenObservation: 'complete' | 'unavailable' | 'not_applicable';
    exactPrice: boolean;
}>;

export type TeamCredentialUsageRouteId = TeamCredentialUsageRouteCapability['id'];

/**
 * The sole resource-wide usage-limit availability decision.
 *
 * Every currently enabled route must prove terminal token observation before
 * the next admission. Cost additionally requires exact canonical pricing for
 * every route. Missing routes and unknown facts deliberately fail closed; an
 * unknown value is never interpreted as zero usage.
 */
export function resolveTeamCredentialUsageCapabilities(input: Readonly<{
    routes: readonly TeamCredentialUsageRouteCapability[];
}>): TeamCredentialUsageCapabilitiesV1 {
    if (input.routes.length === 0) {
        return Object.freeze({
            inferenceRequests: 'unavailable',
            totalTokens: 'unavailable',
            costUsd: 'unavailable',
            limitCoverage: 'unavailable',
        });
    }
    const inferenceRoutes = input.routes.filter((route) => route.tokenObservation !== 'not_applicable');
    const tokensComplete = inferenceRoutes.length > 0
        && inferenceRoutes.every((route) => route.tokenObservation === 'complete');
    const pricesComplete = tokensComplete && inferenceRoutes.every((route) => route.exactPrice);
    return Object.freeze({
        inferenceRequests: 'available',
        totalTokens: tokensComplete ? 'available' : 'unavailable',
        costUsd: pricesComplete ? 'available' : 'unavailable',
        limitCoverage: 'brokered_only',
    });
}

/**
 * Installed terminal producers consumed by the server usage writer.
 *
 * Ordinary Session observations enter through the Agent runtime Session-turn
 * route. The writer resolves their immutable turn witness before recording Team
 * attribution, so broker admission remains request-count-only and cannot
 * duplicate the terminal token fact.
 *
 * The ordinary Session producer is also consumed by an attached
 * Session-derived Execution Run. Native/detached Run events still have no usage
 * member, and the external terminal callback currently records an unavailable
 * measurement. Those paths therefore remain explicit fail-closed entries. The
 * resource test is a bounded probe, not inference: it never draws on a token
 * or cost ceiling, so it neither proves nor withholds one.
 * Claude and Codex have Agent-local pricing estimators, but their runtime
 * owners deliberately withhold those estimates for arbitrary Provider-bound
 * models. They therefore do not establish complete exact price coverage for a
 * Team resource's model/protocol set.
 */
export const CURRENT_TEAM_CREDENTIAL_USAGE_ROUTES = Object.freeze([
    Object.freeze({
        id: 'agent_runtime_session_turn',
        tokenObservation: 'complete',
        exactPrice: false,
    }),
    Object.freeze({
        id: 'agent_runtime_attached_execution_run',
        tokenObservation: 'complete',
        exactPrice: false,
    }),
    Object.freeze({
        id: 'agent_runtime_detached_execution_run',
        tokenObservation: 'unavailable',
        exactPrice: false,
    }),
    Object.freeze({
        id: 'external_provider_terminal',
        tokenObservation: 'unavailable',
        exactPrice: false,
    }),
    Object.freeze({
        id: 'resource_test',
        tokenObservation: 'not_applicable',
        exactPrice: false,
    }),
] satisfies readonly TeamCredentialUsageRouteCapability[]);

export function resolveCurrentTeamCredentialUsageCapabilitiesForRoute(
    routeId: TeamCredentialUsageRouteId,
): TeamCredentialUsageCapabilitiesV1 {
    const route = CURRENT_TEAM_CREDENTIAL_USAGE_ROUTES.find((candidate) => candidate.id === routeId);
    return resolveTeamCredentialUsageCapabilities({ routes: route ? [route] : [] });
}

export const CURRENT_TEAM_CREDENTIAL_USAGE_CAPABILITIES = resolveTeamCredentialUsageCapabilities({
    // This projection describes the whole enabled product surface. Filtering
    // to the routes that already observe tokens would advertise a partial
    // ceiling as complete and let administration create a limit that later
    // fails when a detached Run, external request, or resource test uses it.
    routes: CURRENT_TEAM_CREDENTIAL_USAGE_ROUTES,
});

type ResourceDeliveryAudience = Readonly<{
    allMembersDeliveryMode: unknown;
    groupGrants: readonly Readonly<{ deliveryMode: unknown }>[];
    memberGrants: readonly Readonly<{ deliveryMode: unknown }>[];
}>;

/** Derives the advertised limit contract from this resource's canonical
 * audience. Missing or malformed delivery facts fail closed; a direct-only
 * resource never inherits broker capabilities from an unrelated resource. */
export function resolveCurrentTeamCredentialUsageCapabilitiesForResource(
    audience: ResourceDeliveryAudience,
): TeamCredentialUsageCapabilitiesV1 {
    const values = [
        ...(audience.allMembersDeliveryMode === null ? [] : [audience.allMembersDeliveryMode]),
        ...audience.groupGrants.map((grant) => grant.deliveryMode),
        ...audience.memberGrants.map((grant) => grant.deliveryMode),
    ];
    const modes = values.map((value) => TeamCredentialDeliveryModeV1Schema.safeParse(value));
    if (modes.some((mode) => !mode.success)) {
        return resolveTeamCredentialUsageCapabilities({ routes: [] });
    }
    const hasBrokeredRoute = modes.some((mode) => mode.success
        && (mode.data === 'brokered' || mode.data === 'both'));
    return resolveTeamCredentialUsageCapabilities({
        routes: hasBrokeredRoute ? CURRENT_TEAM_CREDENTIAL_USAGE_ROUTES : [],
    });
}
