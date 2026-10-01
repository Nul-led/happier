import { describe, expect, it } from 'vitest';

import {
  PluginReactNativeCompatibilityDecisionV1Schema,
} from './reactNativeCompatibility.js';

describe('React Native plugin UI compatibility contracts', () => {
  it('requires fallback diagnostics when a bundle cannot load', () => {
    expect(PluginReactNativeCompatibilityDecisionV1Schema.parse({
      state: 'fallback',
      reason: 'channel_policy_denied',
      diagnostics: ['ios_store_channel_denied'],
    })).toMatchObject({ state: 'fallback' });
  });

  it('rejects the removed UI-specific artifact-revocation decision tier', () => {
    expect(PluginReactNativeCompatibilityDecisionV1Schema.safeParse({
      state: 'blocked',
      reason: 'artifact_revoked',
      diagnostics: ['artifact_revoked'],
    }).success).toBe(false);
  });
});
