import axios from 'axios';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { ApiClient } from './api';

describe('ApiClient.getMachine capability authority', () => {
  it('retains the exact-target snapshot and withdraws revoked, replaced or malformed authority', async () => {
    const capabilities = { irohMachineEndpoint: {
      protocolVersions: [1], endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'],
    } };
    let machine = {
      id: 'target', metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0,
      revokedAt: null as string | null, replacedByMachineId: null as string | null,
      operationProtocolCapabilities: capabilities, operationProtocolCapabilitiesRevision: 7,
    };
    // Only HTTP is replaced; the API reader, content codec and capability parser are real.
    const get = vi.spyOn(axios, 'get').mockImplementation(async (url: string) => url.endsWith('/v1/machines/target')
      ? { status: 200, data: { machine } }
      : { status: 200, data: { mode: 'e2ee', version: 1,
          signingKeyFingerprint: 'signing-fingerprint', contentKeyFingerprint: 'content-fingerprint', updatedAt: 1,
        } });
    onTestFinished(() => get.mockRestore());
    const api = await ApiClient.create({ token: 'test-token', encryption: { type: 'legacy', secret: new Uint8Array(32) } });
    const current = await api.getMachine('target');
    expect(current).toMatchObject({
      operationProtocolCapabilities: capabilities,
      operationProtocolCapabilitiesRevision: 7,
    });

    const original = machine;
    for (const change of [
      { revokedAt: '2026-10-01T00:00:00.000Z' },
      { replacedByMachineId: 'replacement' },
      { id: 'another-machine' },
      { operationProtocolCapabilitiesRevision: 0 },
      { operationProtocolCapabilities: { irohMachineEndpoint: { ...capabilities.irohMachineEndpoint, endpointId: 'invalid' } } },
    ]) {
      machine = { ...original, ...change };
      expect(await api.getMachine('target')).toMatchObject({
        operationProtocolCapabilities: null,
        operationProtocolCapabilitiesRevision: null,
      });
    }
  });
});
