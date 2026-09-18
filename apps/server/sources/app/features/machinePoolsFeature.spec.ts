import { describe, expect, it } from 'vitest';

import { readServerEnabledBit } from '@happier-dev/protocol';
import { resolveServerFeaturePayload } from './catalog/resolveServerFeaturePayload';
import { serverFeatureRegistry } from './catalog/serverFeatureRegistry';

describe('resolveMachinePoolsFeature', () => {
    it('is represented, default on, and supports operator opt-out', () => {
        expect(readServerEnabledBit(resolveServerFeaturePayload({}, serverFeatureRegistry), 'machines.pools')).toBe(true);
        expect(readServerEnabledBit(resolveServerFeaturePayload({
            HAPPIER_FEATURE_MACHINES_POOLS__ENABLED: '0',
        }, serverFeatureRegistry), 'machines.pools')).toBe(false);
    });
});
