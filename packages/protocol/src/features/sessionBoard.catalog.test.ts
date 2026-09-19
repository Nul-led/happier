import { describe, expect, it } from 'vitest';

import { FEATURE_CATALOG, isFeatureId } from './catalog.js';
import { applyFeatureDependencies } from './featureDecisionEngine.js';
import { FeaturesResponseSchema } from './payload/featuresResponseSchema.js';
import { readServerEnabledBit } from './serverEnabledBit.js';

/**
 * The Session Board gate is the single availability decision every client
 * resolves. It is published on by default, and an operator who does not want
 * the Board opts that exact Home out.
 * These cases discriminate the gate from the two facts most likely to be
 * mistaken for it: the diagnostic System Records capability, which says the
 * persistence protocol is current but grants nothing, and the parent `sessions`
 * bit, whose closure is owned by the catalog rather than by call sites.
 */
describe('sessions.board feature contract', () => {
  it('is a fail-closed server feature dependent on sessions', () => {
    expect(isFeatureId('sessions.board')).toBe(true);
    expect(FEATURE_CATALOG['sessions.board']).toMatchObject({
      representation: 'server',
      dependencies: ['sessions'],
      defaultFailMode: 'fail_closed',
    });
  });

  it('reports an ordinary Home that publishes no Board gate as disabled', () => {
    const ordinary = FeaturesResponseSchema.parse({ features: {}, capabilities: {} });
    expect(readServerEnabledBit(ordinary, 'sessions.board')).toBe(false);
  });

  it('never promotes the diagnostic System Records capability into the gate', () => {
    const capabilityOnly = FeaturesResponseSchema.parse({
      features: { sessions: { enabled: true } },
      capabilities: { session: { systemRecords: { protocolVersions: [1] } } },
    });

    // The persistence precondition is published and current...
    expect(capabilityOnly.capabilities.session?.systemRecords?.protocolVersions).toEqual([1]);
    // ...and the Board is still unavailable, because capabilities are diagnostic.
    expect(readServerEnabledBit(capabilityOnly, 'sessions.board')).toBe(false);
  });

  it('treats a malformed Board bit as disabled rather than present', () => {
    const malformed = {
      features: { sessions: { enabled: true, board: { enabled: 'yes' } } },
      capabilities: { session: { systemRecords: { protocolVersions: [1] } } },
    } as unknown as Parameters<typeof readServerEnabledBit>[0];
    expect(readServerEnabledBit(malformed, 'sessions.board') === true).toBe(false);
  });

  it('closes the gate when its declared sessions dependency is unavailable', () => {
    const dependencyOff = FeaturesResponseSchema.parse({
      features: { sessions: { enabled: false, board: { enabled: true } } },
      capabilities: {},
    });
    expect(readServerEnabledBit(dependencyOff, 'sessions.board')).toBe(true);

    applyFeatureDependencies({ serverPayload: dependencyOff });

    expect(readServerEnabledBit(dependencyOff, 'sessions.board')).toBe(false);
  });

  it('keeps an explicitly enabled gate enabled once every dependency is ready', () => {
    const ready = FeaturesResponseSchema.parse({
      features: { sessions: { enabled: true, board: { enabled: true } } },
      capabilities: {},
    });

    applyFeatureDependencies({ serverPayload: ready });

    expect(readServerEnabledBit(ready, 'sessions.board')).toBe(true);
  });
});
