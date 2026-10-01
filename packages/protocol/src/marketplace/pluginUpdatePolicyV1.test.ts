import { describe, expect, it } from 'vitest';

import { PluginUpdatePolicyV1Schema } from './pluginUpdatePolicyV1';

describe('PluginUpdatePolicyV1Schema', () => {
  it('models only update eligibility and rejects retired review-trigger policies', () => {
    expect(PluginUpdatePolicyV1Schema.safeParse('allowed').success).toBe(true);
    expect(PluginUpdatePolicyV1Schema.safeParse('pinned').success).toBe(true);
    expect(PluginUpdatePolicyV1Schema.safeParse('reviewEveryUpdate').success).toBe(false);
    expect(PluginUpdatePolicyV1Schema.safeParse('reviewSensitiveChanges').success).toBe(false);
  });
});
