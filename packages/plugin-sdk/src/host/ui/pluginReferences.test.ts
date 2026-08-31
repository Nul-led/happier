import { describe, expect, it } from 'vitest';

import { qualifyPluginContributionReference } from './pluginReferences.js';

describe('qualifyPluginContributionReference', () => {
    it('qualifies caller-local references and preserves explicit cross-plugin references', () => {
        expect(qualifyPluginContributionReference('details', 'acme.plugin')).toEqual({
            pluginId: 'acme.plugin',
            localId: 'details',
        });
        expect(qualifyPluginContributionReference(
            { pluginId: 'other.plugin', localId: 'details' },
            'acme.plugin',
        )).toEqual({
            pluginId: 'other.plugin',
            localId: 'details',
        });
    });
});
