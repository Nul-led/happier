import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { reloadConfiguration } from '@/configuration';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { RpcHandlerManager } from '../rpc/RpcHandlerManager';
import { registerMachineRpcHandlers, type MachineRpcLifecycleRegistration } from './rpcHandlers';

describe('machine agent install job transport', () => {
  let home = '';
  let envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'PATH']);
  let manager: RpcHandlerManager;
  let registration: MachineRpcLifecycleRegistration;

  beforeEach(async () => {
    home = await createTempDir('happier-machine-agent-install-jobs-');
    envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'PATH']);
    envScope.patch({ HAPPIER_HOME_DIR: home, PATH: '' });
    reloadConfiguration();
    manager = new RpcHandlerManager({ scopePrefix: 'machine-install-jobs', encryptionMode: 'plain', logger: () => {} });
    registration = registerMachineRpcHandlers({
      rpcHandlerManager: manager,
      handlers: {
        spawnSession: async () => ({ type: 'success', sessionId: 'unused' }),
        stopSession: async () => ({ status: 'not_found' }),
        requestShutdown: () => {},
      },
    });
  });

  afterEach(async () => {
    await registration?.dispose();
    envScope.restore();
    reloadConfiguration();
    await removeTempDir(home);
  });

  it('exposes the daemon job inventory through the real machine RPC registration', async () => {
    await expect(manager.invokeLocal(RPC_METHODS.DAEMON_AGENTS_INSTALL_LIST, {})).resolves.toEqual({ ok: true, jobs: [] });
  });

  it('rejects invalid start/read/cancel/list requests before reaching the job owner', async () => {
    for (const method of [
      RPC_METHODS.DAEMON_AGENTS_INSTALL_START,
      RPC_METHODS.DAEMON_AGENTS_INSTALL_READ,
      RPC_METHODS.DAEMON_AGENTS_INSTALL_CANCEL,
      RPC_METHODS.DAEMON_AGENTS_INSTALL_LIST,
    ]) {
      await expect(manager.invokeLocal(method, { callerCommand: 'unsafe' })).resolves.toMatchObject({ ok: false, errorCode: 'invalid_request' });
    }
    await expect(manager.invokeLocal(RPC_METHODS.DAEMON_AGENTS_INSTALL_LIST, {})).resolves.toEqual({ ok: true, jobs: [] });
  });
});
