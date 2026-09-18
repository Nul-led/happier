import { describe, expect, it } from 'vitest';

import {
    CONNECTED_SERVICE_MODEL_ENTITLEMENT_COOLDOWN_MS,
    buildConnectedServiceAuthGroupObservedFailureMemberState,
} from './buildConnectedServiceAuthGroupObservedFailureMemberState';

describe('buildConnectedServiceAuthGroupObservedFailureMemberState', () => {
    it('records exact model entitlement failures for 24 hours without blocking the whole account', () => {
        expect(buildConnectedServiceAuthGroupObservedFailureMemberState({
            existing: {},
            reason: 'plan',
            limitCategory: 'plan_invalid',
            quotaScope: 'model',
            providerLimitId: 'gpt-5.6-sol',
            retryAtMs: null,
            cooldownMs: 30_000,
            autoDisablePlanInvalidAccounts: false,
            planType: 'free',
            observedAtMs: 1_000,
        })).toEqual(expect.objectContaining({
            lastFailureKind: 'plan',
            lastFailureCode: 'model_not_entitled',
            modelUnavailableUntilMsByModelId: {
                'gpt-5.6-sol': 1_000 + CONNECTED_SERVICE_MODEL_ENTITLEMENT_COOLDOWN_MS,
            },
        }));
    });

    it('marks only exact model entitlement evidence for optional persistent disable', () => {
        expect(buildConnectedServiceAuthGroupObservedFailureMemberState({
            existing: {}, reason: 'plan', limitCategory: 'plan_invalid', quotaScope: 'model',
            providerLimitId: 'gpt-5.6-sol', retryAtMs: null, cooldownMs: 30_000,
            autoDisablePlanInvalidAccounts: true, planType: 'free', observedAtMs: 1_000,
        })).toMatchObject({ autoDisabledReason: 'model_not_entitled' });
        const providerScoped = buildConnectedServiceAuthGroupObservedFailureMemberState({
            existing: {}, reason: 'permission_denied', limitCategory: 'plan_invalid', quotaScope: 'provider',
            providerLimitId: null, retryAtMs: null, cooldownMs: 30_000,
            autoDisablePlanInvalidAccounts: true, planType: 'free', observedAtMs: 1_000,
        });
        expect(providerScoped).toEqual(expect.objectContaining({
            planUnavailableUntilMs:
                1_000 + CONNECTED_SERVICE_MODEL_ENTITLEMENT_COOLDOWN_MS,
        }));
        expect(providerScoped).not.toHaveProperty('autoDisabledReason');
    });
});
