import { describe, expect, it } from 'vitest';

import { createIrohTestController } from '../irohTestController';

/**
 * Supporting Iroh evidence-boundary contracts for Lane 09. They assert real supporting owners
 * only; no native moving-byte or tunnel acceptance is claimed here, and no run status lives in
 * source — the sole Lane 09 release report owns certification status.
 */
describe('Iroh supporting evidence boundaries', () => {
  it('fails closed when the native test-feature controller is unavailable', async () => {
    // A state-only double could falsely claim a relay path without changing real endpoint
    // topology. The canonical testkit instead requires the feature-gated native boundary.
    const controller = createIrohTestController();
    await expect(controller.forceRelayOnly()).rejects.toThrow(/test-relay-fixture/);
    expect(controller.getObservedPath()).toBe('unknown');
  });
});
