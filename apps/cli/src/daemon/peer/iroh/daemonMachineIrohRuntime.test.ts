import { describe, expect, it, vi } from 'vitest';

import { createDaemonMachineIrohRuntime } from './daemonMachineIrohRuntime';

describe('createDaemonMachineIrohRuntime', () => {
  it('owns one daemon-lifetime endpoint, attempt acceptors, and exact verified tunnel handshakes', async () => {
    const order: string[] = [];
    const native = {
      createEndpoint: vi.fn(async () => ({ endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64) })),
      getEndpointStatus: vi.fn(async () => ({
        endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64), relayMode: 'custom', relayUrls: ['https://relay.test/'],
        capProfile: 'machineBulk', directAddresses: ['127.0.0.1:7777'], active: true,
      })),
      startMachineAcceptor: vi.fn(async () => { order.push('acceptor:start'); return {}; }),
      stopMachineAcceptor: vi.fn(async () => { order.push('acceptor:stop'); }),
      startMachineTunnel: vi.fn(async () => ({
        machineTunnelId: 'tunnel-1', endpointHandle: 'endpoint-1', localPort: 48123,
        connectionActive: true, remoteEndpointId: 'b'.repeat(64), observedPath: 'relay',
        startedAtMs: 1, lastErrorCode: null,
      })),
      stopMachineTunnel: vi.fn(async () => { order.push('tunnel:stop'); }),
      shutdownEndpoint: vi.fn(async () => { order.push('endpoint:stop'); }),
    };
    const connectTcp = vi.fn(async () => ({
      write: async () => undefined, endWrite: async () => undefined,
      onData: () => () => undefined, close: async () => { order.push('tcp:stop'); },
    }));
    const runtime = await createDaemonMachineIrohRuntime({
      happyHomeDir: '/daemon-home',
      relayConfig: { relayPolicy: 'automatic', relayUrls: ['https://relay.test/'] },
      native: native as never,
      connectTcp: connectTcp as never,
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    expect(native.createEndpoint).toHaveBeenCalledTimes(1);
    expect(native.createEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      keyPath: expect.stringMatching(/runtime[\\/]iroh[\\/]endpoint\.key$/), capProfile: 'machineBulk',
    }));
    expect(runtime.endpoint).toEqual({
      endpointId: 'a'.repeat(64), relayUrls: ['https://relay.test/'], directAddresses: ['127.0.0.1:7777'],
    });

    await runtime.startAttemptAcceptor({ admissionPort: 47001 });
    await runtime.stopAttemptAcceptor();
    await runtime.startAttemptAcceptor({ admissionPort: 47002 });
    expect(native.createEndpoint).toHaveBeenCalledTimes(1);

    const handshake = { v: 1, flow: 'workspace_sync', operationId: 'operation-1', exact: 'verified' };
    const tunnel = await runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: handshake as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    expect(tunnel).toMatchObject({
      localPort: 48123,
      remoteEndpointId: 'b'.repeat(64),
      observedPath: 'relay',
    });
    expect(connectTcp).not.toHaveBeenCalled();
    await tunnel.close();

    const connection = await runtime.openTransport({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: handshake as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    expect(native.startMachineTunnel).toHaveBeenCalledWith(expect.objectContaining({
      endpointHandle: 'endpoint-1', endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'],
      handshakeJson: JSON.stringify(handshake), capProfile: 'workspaceSync',
    }));
    expect(connectTcp).toHaveBeenCalledWith({ host: '127.0.0.1', port: 48123 });
    expect(connection.remoteEndpointId).toBe('b'.repeat(64));

    await expect(runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'file_transfer',
      operationId: 'operation-1', handshake: handshake as never,
    }, { endpointId: 'b'.repeat(64) })).rejects.toThrow('does not match the verified handshake');

    await runtime.stopActiveTunnels();
    await runtime.shutdown();
    expect(order).toEqual(['acceptor:start', 'acceptor:stop', 'acceptor:start', 'tunnel:stop', 'tcp:stop', 'tunnel:stop', 'acceptor:stop', 'endpoint:stop']);
  });
});
