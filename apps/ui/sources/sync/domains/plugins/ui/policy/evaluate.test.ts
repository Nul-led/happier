import { describe, expect, it } from 'vitest';

import {
    evaluatePluginUiPolicy,
    type PluginUiPolicyEvaluationContext,
} from './evaluate';

const allowAll: PluginUiPolicyEvaluationContext = {
    platform: 'web',
    channel: 'internal',
    isFeatureEnabled: () => true,
    isPermissionGranted: () => true,
    isCapabilityEnabled: () => true,
};

describe('evaluatePluginUiPolicy', () => {
    it('keeps canonical disabled availability authoritative over retired enabled fields', () => {
        for (const enabled of [true, { operand: 'platform.is', value: 'web' }]) {
            expect(evaluatePluginUiPolicy({
                id: 'browserAction:acme.preview:open',
                contributionKind: 'browserAction',
                enabled,
                availability: {
                    disabledWhen: { fact: 'host.platform', operator: 'equals', value: 'web' },
                    disabledReason: 'Open preview requires desktop',
                },
            }, { platform: 'web' })).toMatchObject({ visible: true, enabled: false });
        }
    });

    it('fails closed for a missing entry', () => {
        const decision = evaluatePluginUiPolicy(null, allowAll);
        expect(decision.visible).toBe(false);
        expect(decision.enabled).toBe(false);
    });

    it('renders an entry with no declared policy', () => {
        const decision = evaluatePluginUiPolicy(
            { id: 'surfacePlacement:acme.preview:tab', contributionKind: 'surfacePlacement' },
            allowAll,
        );
        expect(decision.visible).toBe(true);
        expect(decision.enabled).toBe(true);
        expect(decision.diagnostics).toEqual([]);
    });

    it('hides an entry whose required host feature is disabled or unavailable', () => {
        const entry = {
            id: 'surfacePlacement:acme.preview:tab',
            contributionKind: 'surfacePlacement',
            availability: {
                when: { fact: 'host.feature', operator: 'enabled', value: 'plugins.ui.hostedWeb' },
            },
        };
        expect(
            evaluatePluginUiPolicy(entry, { isFeatureEnabled: () => false }).visible,
        ).toBe(false);
        expect(
            evaluatePluginUiPolicy(entry, { isFeatureEnabled: (id) => id === 'plugins.ui.hostedWeb' }).visible,
        ).toBe(true);
        expect(evaluatePluginUiPolicy(entry, {}).visible).toBe(false);
    });

    it('resolves canonical capability facts and nested expressions through host resolvers', () => {
        const entry = {
            id: 'surfacePlacement:acme.preview:tab',
            contributionKind: 'surfacePlacement',
            availability: {
                when: { all: [
                    { fact: 'session.capability', operator: 'contains', value: 'message.edit' },
                    { any: [
                        { fact: 'host.platform', operator: 'equals', value: 'web' },
                        { not: { fact: 'host.platform', operator: 'equals', value: 'ios' } },
                    ] },
                ] },
            },
        };
        const context = { platform: 'web' as const, isCapabilityEnabled: (id: string) => id === 'message.edit' };
        expect(evaluatePluginUiPolicy(entry, context).visible).toBe(true);
        expect(evaluatePluginUiPolicy(entry, { ...context, platform: 'ios' }).visible).toBe(false);
        expect(evaluatePluginUiPolicy(entry, { ...context, isCapabilityEnabled: () => false }).visible).toBe(false);
        expect(evaluatePluginUiPolicy(entry, { platform: 'web' }).visible).toBe(false);
    });

    it('evaluates canonical contribution availability and fails closed when a fact is unavailable', () => {
        const entry = {
            id: 'browserAction:acme.preview:open',
            contributionKind: 'browserAction',
            availability: {
                when: {
                    all: [
                        { fact: 'host.platform', operator: 'notEquals', value: 'ios' },
                        { fact: 'browser.exists', operator: 'equals', value: true },
                    ],
                },
                disabledWhen: { fact: 'host.feature', operator: 'enabled', value: 'preview.readOnly' },
                disabledReason: 'Preview is read-only',
            },
        };

        expect(evaluatePluginUiPolicy(entry, {
            platform: 'web',
            data: { browser: { exists: true } },
            isFeatureEnabled: () => false,
        })).toMatchObject({ visible: true, enabled: true });
        expect(evaluatePluginUiPolicy(entry, {
            platform: 'web',
            data: { browser: { exists: true } },
            isFeatureEnabled: (id) => id === 'preview.readOnly',
        })).toMatchObject({ visible: true, enabled: false });
        expect(evaluatePluginUiPolicy(entry, {
            platform: 'ios',
            data: { browser: { exists: true } },
            isFeatureEnabled: () => false,
        })).toMatchObject({ visible: false, enabled: false });
        expect(evaluatePluginUiPolicy(entry, {
            platform: 'web',
            isFeatureEnabled: () => false,
        })).toMatchObject({ visible: false, enabled: false });

        expect(evaluatePluginUiPolicy({
            id: 'browserAction:acme.preview:unknown-gate',
            contributionKind: 'browserAction',
            availability: {
                disabledWhen: { fact: 'host.feature', operator: 'enabled', value: 'preview.readOnly' },
                disabledReason: 'Preview is read-only',
            },
        }, {
            platform: 'web',
        })).toMatchObject({
            visible: true,
            enabled: false,
            diagnostics: ['availability_disabled_fact_unavailable'],
        });
    });

});
