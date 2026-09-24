import { describe, expect, it } from 'vitest';

import {
    CURRENT_TEAM_CREDENTIAL_USAGE_CAPABILITIES,
    CURRENT_TEAM_CREDENTIAL_USAGE_ROUTES,
    resolveCurrentTeamCredentialUsageCapabilitiesForRoute,
    resolveCurrentTeamCredentialUsageCapabilitiesForResource,
    resolveTeamCredentialUsageCapabilities,
} from './usageCapabilities';
import { validateTeamCredentialUsageLimitDraftInTx } from './resourceLimits';

describe('resolveTeamCredentialUsageCapabilities', () => {
    it('fails the server mutation boundary closed when capability input is omitted', async () => {
        await expect(validateTeamCredentialUsageLimitDraftInTx({} as never, {
            teamId: 'team-1',
            limit: {
                subjectKind: 'resource', subjectId: '', period: 'month',
                metric: 'inference_requests', maximum: '10', enabled: true,
            },
        })).resolves.toEqual({ ok: false, error: 'invalid_limit' });
    });

    it('keeps request admission available without claiming unobserved token or price coverage', () => {
        expect(resolveTeamCredentialUsageCapabilities({ routes: [{ id: 'external_provider_terminal', tokenObservation: 'unavailable', exactPrice: false, personalUseOnly: true }] })).toEqual({
            inferenceRequests: 'available',
            totalTokens: 'unavailable',
            costUsd: 'unavailable',
            limitCoverage: 'brokered_only',
        });
    });

    it('enables tokens only when every route has canonical terminal observation', () => {
        expect(resolveTeamCredentialUsageCapabilities({ routes: [
            { id: 'agent_runtime_session_turn', tokenObservation: 'complete', exactPrice: false, personalUseOnly: false },
            { id: 'external_provider_terminal', tokenObservation: 'complete', exactPrice: false, personalUseOnly: true },
        ] })).toEqual({
            inferenceRequests: 'available',
            totalTokens: 'available',
            costUsd: 'unavailable',
            limitCoverage: 'brokered_only',
        });
        expect(resolveTeamCredentialUsageCapabilities({ routes: [
            { id: 'agent_runtime_session_turn', tokenObservation: 'complete', exactPrice: false, personalUseOnly: false },
            { id: 'external_provider_terminal', tokenObservation: 'unavailable', exactPrice: false, personalUseOnly: true },
        ] }).totalTokens).toBe('unavailable');
    });

    it('enables cost only with complete token observation and exact prices on every route', () => {
        expect(resolveTeamCredentialUsageCapabilities({ routes: [
            { id: 'agent_runtime_session_turn', tokenObservation: 'complete', exactPrice: true, personalUseOnly: false },
        ] }).costUsd).toBe('available');
        expect(resolveTeamCredentialUsageCapabilities({ routes: [
            { id: 'agent_runtime_session_turn', tokenObservation: 'complete', exactPrice: false, personalUseOnly: false },
        ] }).costUsd).toBe('unavailable');
    });

    it('fails closed when no route catalog is current', () => {
        expect(resolveTeamCredentialUsageCapabilities({ routes: [] })).toEqual({
            inferenceRequests: 'unavailable',
            totalTokens: 'unavailable',
            costUsd: 'unavailable',
            limitCoverage: 'unavailable',
        });
    });

    it('projects supported ordinary routes while keeping unsupported routes fail-closed', () => {
        expect(CURRENT_TEAM_CREDENTIAL_USAGE_ROUTES).toEqual([
            {
                id: 'agent_runtime_session_turn',
                tokenObservation: 'complete',
                exactPrice: false,
                personalUseOnly: false,
            },
            {
                id: 'agent_runtime_attached_execution_run',
                tokenObservation: 'complete',
                exactPrice: false,
                personalUseOnly: false,
            },
            {
                id: 'agent_runtime_detached_execution_run',
                tokenObservation: 'unavailable',
                exactPrice: false,
                personalUseOnly: true,
            },
            {
                id: 'external_provider_terminal',
                tokenObservation: 'unavailable',
                exactPrice: false,
                personalUseOnly: true,
            },
            {
                // A bounded non-inference probe consumes no token or cost
                // ceiling, so it cannot withhold one either: the contract says
                // `not_applicable`, not `unavailable`.
                id: 'resource_test',
                tokenObservation: 'not_applicable',
                exactPrice: false,
                personalUseOnly: false,
            },
        ]);
        expect(CURRENT_TEAM_CREDENTIAL_USAGE_CAPABILITIES).toEqual({
            inferenceRequests: 'available',
            totalTokens: 'unavailable',
            costUsd: 'unavailable',
            limitCoverage: 'brokered_only',
        });
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForRoute(
            'agent_runtime_session_turn',
        ).totalTokens).toBe('available');
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForRoute(
            'agent_runtime_attached_execution_run',
        ).totalTokens).toBe('available');
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForRoute(
            'agent_runtime_detached_execution_run',
        ).totalTokens).toBe('unavailable');
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForRoute(
            'external_provider_terminal',
        ).totalTokens).toBe('unavailable');
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForRoute(
            'resource_test',
        ).totalTokens).toBe('unavailable');
    });

    it('derives limit availability from the resource current delivery modes', () => {
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForResource({
            allMembersDeliveryMode: 'direct', groupGrants: [], memberGrants: [], sessionUsePolicy: 'team_context_required',
        })).toEqual({
            inferenceRequests: 'unavailable', totalTokens: 'unavailable', costUsd: 'unavailable',
            limitCoverage: 'unavailable',
        });
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForResource({
            allMembersDeliveryMode: 'both', groupGrants: [], memberGrants: [], sessionUsePolicy: 'personal_allowed',
        })).toMatchObject({ inferenceRequests: 'available', limitCoverage: 'brokered_only' });
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForResource({
            allMembersDeliveryMode: null,
            groupGrants: [{ deliveryMode: 'not-a-mode' }],
            memberGrants: [],
            sessionUsePolicy: 'team_context_required',
        })).toEqual({
            inferenceRequests: 'unavailable', totalTokens: 'unavailable', costUsd: 'unavailable',
            limitCoverage: 'unavailable',
        });
    });

    it('opens token ceilings only where every route the Session-use policy admits observes tokens', () => {
        const brokered = { allMembersDeliveryMode: 'brokered', groupGrants: [], memberGrants: [] } as const;
        // Detached Runs and the external API admit only personal-use resources,
        // and neither reports tokens, so a personal-use resource stays
        // request-count-only.
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForResource({
            ...brokered, sessionUsePolicy: 'personal_allowed',
        })).toEqual({
            inferenceRequests: 'available', totalTokens: 'unavailable', costUsd: 'unavailable',
            limitCoverage: 'brokered_only',
        });
        // Sessions and attached Runs are the only paths to a Team-context or
        // Team-visibility resource; no route has canonical pricing, so cost
        // stays closed.
        for (const sessionUsePolicy of ['team_context_required', 'team_visibility_required'] as const) {
            expect(resolveCurrentTeamCredentialUsageCapabilitiesForResource({ ...brokered, sessionUsePolicy })).toEqual({
                inferenceRequests: 'available', totalTokens: 'available', costUsd: 'unavailable',
                limitCoverage: 'brokered_only',
            });
        }
        // An unreadable policy fails closed.
        expect(resolveCurrentTeamCredentialUsageCapabilitiesForResource({
            ...brokered, sessionUsePolicy: 'not-a-policy',
        })).toMatchObject({ inferenceRequests: 'unavailable', totalTokens: 'unavailable' });
    });
});
