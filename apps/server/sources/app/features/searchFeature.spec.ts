import { readServerEnabledBit } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';
import { resolveServerFeaturePayload } from './catalog/resolveServerFeaturePayload';
import { serverFeatureRegistry } from './catalog/serverFeatureRegistry';
import { resolveSearchFeature } from './searchFeature';

describe('search server feature resolver', () => {
    it('advertises the server search owner by default and supports the canonical kill switch', () => {
        expect(resolveSearchFeature({} as NodeJS.ProcessEnv)).toEqual({
            features: { search: { enabled: true } },
        });
        expect(readServerEnabledBit(
            resolveServerFeaturePayload({} as NodeJS.ProcessEnv, serverFeatureRegistry),
            'search',
        )).toBe(true);
        expect(readServerEnabledBit(
            resolveServerFeaturePayload({ HAPPIER_FEATURE_SEARCH__ENABLED: '0' } as NodeJS.ProcessEnv, serverFeatureRegistry),
            'search',
        )).toBe(false);
    });
});
