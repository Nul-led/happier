import { describe, expect, it } from 'vitest';

import { FEATURE_CATALOG, isFeatureId } from './catalog.js';
import { FeaturesResponseSchema } from './payload/featuresResponseSchema.js';
import { readServerEnabledBit } from './serverEnabledBit.js';

describe('sessions.filteredListing feature contract', () => {
  it('is a fail-closed server feature dependent on sessions', () => {
    expect(isFeatureId('sessions.filteredListing')).toBe(true);
    expect(FEATURE_CATALOG['sessions.filteredListing']).toMatchObject({
      representation: 'server',
      dependencies: ['sessions'],
      defaultFailMode: 'fail_closed',
    });
  });

  it('defaults missing and malformed support off without a capability fallback', () => {
    const missing = FeaturesResponseSchema.parse({ features: {}, capabilities: {} });
    expect(readServerEnabledBit(missing, 'sessions.filteredListing')).toBe(false);

    const malformed = {
      features: { sessions: { enabled: true, filteredListing: { enabled: 'yes' } } },
      capabilities: { session: { listing: { queryVersion: 1 } } },
    } as unknown as Parameters<typeof readServerEnabledBit>[0];
    expect(readServerEnabledBit(malformed, 'sessions.filteredListing') === true).toBe(false);
  });
});
