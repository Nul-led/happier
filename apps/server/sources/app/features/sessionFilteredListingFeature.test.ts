import { readServerEnabledBit } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { resolveServerFeaturePayload } from './catalog/resolveServerFeaturePayload';
import { serverFeatureRegistry } from './catalog/serverFeatureRegistry';

describe('sessions.filteredListing server feature', () => {
    it('stays disabled while its access and personal-state producers are unavailable', () => {
        const payload = resolveServerFeaturePayload(
            {} as NodeJS.ProcessEnv,
            serverFeatureRegistry,
        );
        expect(readServerEnabledBit(payload, 'sessions.filteredListing')).toBe(false);
    });

    it('can be enabled explicitly for a composed development or QA vertical', () => {
        const payload = resolveServerFeaturePayload(
            { HAPPIER_FEATURE_SESSIONS_FILTERED_LISTING__ENABLED: '1' } as NodeJS.ProcessEnv,
            serverFeatureRegistry,
        );
        expect(readServerEnabledBit(payload, 'sessions.filteredListing')).toBe(true);
    });
});
