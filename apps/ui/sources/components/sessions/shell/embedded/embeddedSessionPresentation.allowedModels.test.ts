import { describe, expect, it } from 'vitest';

import { readEffectiveAllowedModelRef } from './embeddedSessionPresentation';

const agentTargetKey = 'agent:happier.agent.claude/claude';
const m1 = { agentTargetKey, providerConnectionId: null, modelId: 'model-one' };
const m2 = { agentTargetKey, providerConnectionId: null, modelId: 'model-two' };
const refused = { agentTargetKey, providerConnectionId: null, modelId: 'model-refused' };

describe('model-restricted arm selection', () => {
    it('shows the model the next message runs on: the Session’s own when allowed, else the first allowed', () => {
        expect(readEffectiveAllowedModelRef([m1, m2], null)).toEqual(m1);
        expect(readEffectiveAllowedModelRef([m1, m2], refused)).toEqual(m1);
        expect(readEffectiveAllowedModelRef([m1, m2], m2)).toEqual(m2);
    });
});
