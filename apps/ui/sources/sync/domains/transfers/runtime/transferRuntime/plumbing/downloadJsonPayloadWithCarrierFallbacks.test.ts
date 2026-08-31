import { describe, expect, it, vi } from 'vitest';

import { downloadJsonPayloadWithCarrierFallbacks } from '../carriers/downloadJsonPayloadWithCarrierFallbacks';

describe('downloadJsonPayloadWithCarrierFallbacks', () => {
  it('acquires before direct download, forwards the local origin, and releases without falling back', async () => {
    const relay = vi.fn(async () => ({ ok: true as const, payload: { source: 'relay' } }));
    const chunk = vi.fn(async () => ({ ok: true as const, payload: { source: 'chunk' } }));
    const release = vi.fn(async () => undefined);
    const acquireMachineCarrierHttpLease = vi.fn(async () => ({ localOrigin: 'http://localhost:48124/', release }));
    const direct = vi.fn(async (localOrigin?: string) => ({ ok: true as const, payload: { source: localOrigin } }));
    const result = await downloadJsonPayloadWithCarrierFallbacks({
      downloadViaDirectExport: direct,
      downloadViaServerRelay: relay,
      downloadViaChunkRpc: chunk,
      machineCarrierRequired: true,
      machineCarrierOperationId: 'download-1',
      machineId: 'machine-1',
      machineCarrierFlow: 'file_transfer',
      machineCarrierMaxBytes: 2_500_000,
      acquireMachineCarrierHttpLease,
    });
    expect(result).toEqual({ ok: true, payload: { source: 'http://localhost:48124' } });
    expect(acquireMachineCarrierHttpLease).toHaveBeenCalledWith({
      operationId: 'download-1',
      machineId: 'machine-1',
      flow: 'file_transfer',
      maxBytes: 2_500_000,
      signal: undefined,
    });
    expect(direct).toHaveBeenCalledWith('http://localhost:48124');
    expect(release).toHaveBeenCalledTimes(1);
    expect(relay).not.toHaveBeenCalled();
    expect(chunk).not.toHaveBeenCalled();
  });

  it('releases after tunneled failure and does not attempt relay or chunk RPC', async () => {
    const relay = vi.fn(async () => ({ ok: true as const, payload: { source: 'relay' } }));
    const chunk = vi.fn(async () => ({ ok: true as const, payload: { source: 'chunk' } }));
    const release = vi.fn(async () => undefined);
    const result = await downloadJsonPayloadWithCarrierFallbacks({
      downloadViaDirectExport: async () => { throw new Error('tunnel closed'); },
      downloadViaServerRelay: relay,
      downloadViaChunkRpc: chunk,
      machineCarrierRequired: true,
      machineCarrierOperationId: 'download-2',
      machineId: 'machine-1',
      machineCarrierFlow: 'file_transfer',
      machineCarrierMaxBytes: 2_500_000,
      acquireMachineCarrierHttpLease: async () => ({ localOrigin: 'http://127.0.0.1:48125', release }),
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'machine_carrier_transport_failed' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(relay).not.toHaveBeenCalled();
    expect(chunk).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'does not acquire or try any carrier with invalid required maxBytes %s',
    async (machineCarrierMaxBytes) => {
      const acquireMachineCarrierHttpLease = vi.fn();
      const direct = vi.fn();
      const relay = vi.fn();
      const chunk = vi.fn();
      const result = await downloadJsonPayloadWithCarrierFallbacks({
        downloadViaDirectExport: direct,
        downloadViaServerRelay: relay,
        downloadViaChunkRpc: chunk,
        machineCarrierRequired: true,
        machineCarrierOperationId: 'download-invalid-size',
        machineId: 'machine-1',
        machineCarrierFlow: 'file_transfer',
        machineCarrierMaxBytes,
        acquireMachineCarrierHttpLease,
      });
      expect(result).toMatchObject({ ok: false, errorCode: 'machine_carrier_unavailable' });
      expect(acquireMachineCarrierHttpLease).not.toHaveBeenCalled();
      expect(direct).not.toHaveBeenCalled();
      expect(relay).not.toHaveBeenCalled();
      expect(chunk).not.toHaveBeenCalled();
    },
  );

    it('falls back to relay and legacy carriers when an earlier carrier throws', async () => {
        const directExport = vi.fn(async () => {
            throw new Error('direct export unavailable');
        });
        const relay = vi.fn(async () => ({ ok: true as const, payload: { source: 'relay' } }));

        const result = await downloadJsonPayloadWithCarrierFallbacks({
            downloadViaDirectExport: directExport,
            downloadViaServerRelay: relay,
        });

        expect(result).toEqual({ ok: true, payload: { source: 'relay' } });
        expect(directExport).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledTimes(1);
    });

    it('does not fall back to legacy when direct export and relay carriers throw', async () => {
        const directExport = vi.fn(async () => {
            throw new Error('direct export unavailable');
        });
        const relay = vi.fn(async () => {
            throw new Error('relay unavailable');
        });

        const result = await downloadJsonPayloadWithCarrierFallbacks({
            downloadViaDirectExport: directExport,
            downloadViaServerRelay: relay,
        });

        expect(result).toEqual({ ok: false, error: 'relay unavailable' });
        expect(directExport).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledTimes(1);
    });
});
