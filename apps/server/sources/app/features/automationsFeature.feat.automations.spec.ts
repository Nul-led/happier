import { describe, expect, it } from 'vitest';

import { resolveAutomationsFeature } from './automationsFeature';
import { resolveWorkflowsFeature } from './workflowsFeature';

describe('resolveAutomationsFeature', () => {
    it('defaults to automations enabled', () => {
        const feature = resolveAutomationsFeature({} as NodeJS.ProcessEnv);

        expect(feature.features?.automations).toEqual({
            enabled: true,
        });
        expect(feature.capabilities).toBeUndefined();
    });
});

describe('resolveWorkflowsFeature', () => {
    it('advertises approved Workflow activation by default', () => {
        expect(resolveWorkflowsFeature({} as NodeJS.ProcessEnv).features?.workflows).toEqual({ enabled: true });
    });

    it('supports an explicit operator opt-out', () => {
        expect(resolveWorkflowsFeature({ HAPPIER_FEATURE_WORKFLOWS__ENABLED: '0' } as NodeJS.ProcessEnv).features?.workflows)
            .toEqual({ enabled: false });
    });
});
