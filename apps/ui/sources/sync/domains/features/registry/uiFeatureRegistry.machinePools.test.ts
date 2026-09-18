import { describe, expect, it } from 'vitest';

import { getUiFeatureDefinition } from './uiFeatureRegistry';

describe('uiFeatureRegistry machine pools', () => {
    it('registers the server-owned feature without a client preference toggle', () => {
        expect(getUiFeatureDefinition('machines.pools')).toEqual({ settingsToggle: undefined });
    });
});
