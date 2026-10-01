import { describe, expect, it } from 'vitest';

import type { FeatureDecision } from '@happier-dev/protocol';

import { resolveWorkflowsDestinationAccess } from './workflowsDestinationAccess';

function decision(
    featureId: 'workflows' | 'automations',
    state: FeatureDecision['state'],
    blockedBy: FeatureDecision['blockedBy'] = null,
    extra: Partial<FeatureDecision> = {},
): FeatureDecision {
    return {
        featureId,
        state,
        blockedBy,
        blockerCode: state === 'enabled' ? 'none' : 'feature_disabled',
        diagnostics: [],
        evaluatedAt: 0,
        scope: { scopeKind: 'runtime' },
        ...extra,
    };
}

describe('resolveWorkflowsDestinationAccess', () => {
    it('opens the whole destination only on the enabled Workflows decision', () => {
        expect(resolveWorkflowsDestinationAccess({
            workflows: decision('workflows', 'enabled'),
            automations: decision('automations', 'enabled'),
        })).toEqual({ kind: 'workflows', discoverable: true });
    });

    it('keeps the supported Automations-only configuration as the Triggers-only destination', () => {
        expect(resolveWorkflowsDestinationAccess({
            workflows: decision('workflows', 'disabled', 'server'),
            automations: decision('automations', 'enabled'),
        })).toEqual({ kind: 'triggersOnly', discoverable: true });
    });

    it('lists a destination disabled only by local policy so its repair stays reachable', () => {
        expect(resolveWorkflowsDestinationAccess({
            workflows: decision('workflows', 'disabled', 'dependency', { blockingDependencyId: 'automations' }),
            automations: decision('automations', 'disabled', 'local_policy'),
        })).toEqual({ kind: 'locallyDisabled', discoverable: true });
    });

    it('hides the destination on a hard server denial', () => {
        expect(resolveWorkflowsDestinationAccess({
            workflows: decision('workflows', 'disabled', 'dependency', { blockingDependencyId: 'automations' }),
            automations: decision('automations', 'disabled', 'server'),
        })).toEqual({ kind: 'unavailable', discoverable: false });
    });

    it('never enables discovery from an unknown or missing bit', () => {
        expect(resolveWorkflowsDestinationAccess({
            workflows: decision('workflows', 'unknown', 'server'),
            automations: decision('automations', 'unknown', 'server'),
        })).toEqual({ kind: 'unavailable', discoverable: false });
        expect(resolveWorkflowsDestinationAccess({
            workflows: decision('workflows', 'unsupported', 'server', { blockerCode: 'endpoint_missing' }),
            automations: decision('automations', 'unsupported', 'server', { blockerCode: 'endpoint_missing' }),
        })).toEqual({ kind: 'unavailable', discoverable: false });
    });

    it('waits, undiscovered, until both decisions resolve', () => {
        expect(resolveWorkflowsDestinationAccess({ workflows: null, automations: decision('automations', 'enabled') }))
            .toEqual({ kind: 'resolving', discoverable: false });
        expect(resolveWorkflowsDestinationAccess({ workflows: decision('workflows', 'disabled', 'server'), automations: null }))
            .toEqual({ kind: 'resolving', discoverable: false });
    });
});
