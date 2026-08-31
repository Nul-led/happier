import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('keeps the checked-in iroh relay fixture holepunch-only by default', () => {
    // Source-level deployment assertion only: it checks the checked-in relay policy; it does not
    // force a runtime path or prove that application bytes moved over direct or relayed transport.
    const configPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../deploy/iroh-relay/relay.toml');
    const config = readFileSync(configPath, 'utf8');
    expect(config).toMatch(/^enable_relay\s*=\s*false\b/m);
    expect(config).toMatch(/^enable_quic_addr_discovery\s*=\s*true\b/m);
  });
});
