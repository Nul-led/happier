import { describe, expect, it } from 'vitest';

import { featureDecisionFixture } from '@/dev/testkit/fixtures/homeGovernanceFixtures';

import { homeFeatureRowState } from './homeFeatureRows';

describe('homeFeatureRowState', () => {
    it('says the deployment decides, with no control, when a feature without a Home switch is off on the server', () => {
        // Live: Happier voice has no Home key and is off because the deployment does not provide the
        // voice service. Neither the owner nor the Happier build is what turns it on.
        const state = homeFeatureRowState(null, featureDecisionFixture('voice.happierVoice', {
            state: 'disabled',
            blockedBy: 'server',
            blockerCode: 'feature_disabled',
        }));
        expect(state).toEqual({ kind: 'unavailable', switchable: false });
    });

    it('keeps an owner switch on a server-unavailable feature switchable', () => {
        const state = homeFeatureRowState(
            {
                key: 'HAPPIER_FEATURE_VOICE__ENABLED',
                value: true,
                source: 'default',
                fixed: false,
                editable: 'home',
                apply: 'live',
                declaration: { type: 'boolean', section: 'features', family: 'voice', featureId: 'voice', default: true },
            },
            featureDecisionFixture('voice', { state: 'disabled', blockedBy: 'server', blockerCode: 'feature_disabled' }),
        );
        expect(state).toEqual({ kind: 'unavailable', switchable: true });
    });

    it('reports an always-on feature without a Home switch as the build\'s to turn off', () => {
        expect(homeFeatureRowState(null, featureDecisionFixture('sharing.session'))).toEqual({ kind: 'noHomeSwitch', on: true });
    });
});
