import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';
import { createTestAuth } from '../../src/testkit/auth';
import { waitFor } from '../../src/testkit/timing';
import { createUserScopedSocketCollector } from '../../src/testkit/socketClient';
import { createLegacyRpcClient } from '../../src/testkit/syntheticAgent/rpcClient';
import { RpcHandlerManager } from '../../../../apps/cli/src/api/rpc/RpcHandlerManager';

import { io as socketIo } from 'socket.io-client';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { CapabilitiesInvokeRequest, CapabilitiesInvokeResponse } from '@happier-dev/protocol/capabilities';

const run = createRunDirs({ runLabel: 'core' });

describe('core e2e: capabilities.invoke(cli.* probeModels) machine RPC transport', () => {
  let server: StartedServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('routes a capabilities.invoke request to a machine-scoped socket and returns the encrypted result', async () => {
    const testDir = run.testDir('capabilities-invoke-probe-models-transport');
    server = await startServerLight({ testDir, dbProvider: 'sqlite' });

    const auth = await createTestAuth(server.baseUrl);
    const secret = Uint8Array.from(randomBytes(32));
    const machineId = randomUUID();

    // Machine-scoped sockets are rejected unless the machine id is registered to the account.
    // Register the machine first so the socket handshake can succeed.
    const machineRes = await fetch(`${server.baseUrl}/v1/machines`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: machineId, metadata: 'e2e-machine-metadata' }),
    });
    if (!machineRes.ok) {
      throw new Error(`Failed to create machine (${machineRes.status}): ${await machineRes.text()}`);
    }

    const ui = createUserScopedSocketCollector(server.baseUrl, auth.token);
    ui.connect();

    const machineSock = socketIo(server.baseUrl, {
      path: '/v1/updates/',
      transports: ['websocket'],
      reconnection: false,
      auth: { token: auth.token, clientType: 'machine-scoped', machineId },
    });

    const rpcMethod = `${machineId}:${RPC_METHODS.CAPABILITIES_INVOKE}`;

    try {
      await waitFor(() => ui.isConnected(), { timeoutMs: 20_000 });
      await waitFor(() => machineSock.connected, { timeoutMs: 20_000 });

      const response: CapabilitiesInvokeResponse = {
        ok: true,
        result: {
          provider: 'opencode',
          source: 'dynamic',
          supportsFreeform: false,
          availableModels: [
            { id: 'default', name: 'Default' },
            { id: 'model-a', name: 'Model A' },
            { id: 'model-b', name: 'Model B' },
          ],
        },
      };
      const rpcManager = new RpcHandlerManager({
        scopePrefix: machineId, encryptionKey: secret, encryptionVariant: 'legacy', logger: () => {},
      });
      rpcManager.registerHandler(RPC_METHODS.CAPABILITIES_INVOKE, (_request: CapabilitiesInvokeRequest) => response);
      machineSock.on(SOCKET_RPC_EVENTS.REQUEST, async (data: { method: string; params: unknown }, callback: (response: unknown) => void) => {
        callback(await rpcManager.handleRequest(data));
      });
      rpcManager.onSocketConnect(machineSock);
      expect((await rpcManager.waitForRegisteredHandlers([RPC_METHODS.CAPABILITIES_INVOKE], { timeoutMs: 15_000 })).status).toBe('ready');

      const request: CapabilitiesInvokeRequest = {
        id: 'cli.opencode',
        method: 'probeModels',
        params: { timeoutMs: 10_000 },
      };
      const rpc = await createLegacyRpcClient(ui, secret).call(rpcMethod, request);
      expect(rpc).toEqual({ ok: true, result: response });
    } finally {
      try {
        machineSock.close();
      } catch {
        // ignore
      }
      ui.close();
    }
  }, 120_000);
});
