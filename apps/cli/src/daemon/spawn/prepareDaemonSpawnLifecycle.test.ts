import { describe, expect, it } from 'vitest';

import { ConnectedServiceRuntimeRegistry } from '../connectedServices/runtimeRegistry/registry';
import { prepareDaemonSpawnLifecycle } from './prepareDaemonSpawnLifecycle';
import { configuration } from '@/configuration';
import { buildSpawnChildProcessEnv } from './buildSpawnChildProcessEnv';

describe('prepareDaemonSpawnLifecycle', () => {
  it('passes the daemon-owned spawn nonce to the runner through the protected control environment', async () => {
    const result = await prepareDaemonSpawnLifecycle({
      runnerAgentSessionBootstrap: null,
      normalizedExistingSessionId: '',
      sessionAttachPayload: null,
      extraEnv: {},
      extraEnvForChild: {},
      providerBindingLaunchHandoff: null,
      processEnv: {},
      effectiveConnectedServicesBindings: undefined,
      catalogAgentId: 'codex',
      materializationKey: 'materialization-1',
      hasConnectedServiceAuth: false,
      connectedServiceRefreshCoordinator: null,
      connectedServiceQuotasCoordinator: null,
      connectedServiceRuntimeRegistry: new ConnectedServiceRuntimeRegistry(),
      spawnResourceCleanupByPid: new Map(),
      sessionAttachCleanupByPid: new Map(),
      setPendingSessionAttachCleanup: () => {},
      getSpawnResourceCleanupOnExit: () => null,
      onSpawnResourceCleanupArmed: () => {},
      spawnNonce: 'creation-attempt-1',
    });

    expect(result.extraEnvForChildWithMessage).toMatchObject({
      HAPPIER_SESSION_STARTUP_SPAWN_NONCE: 'creation-attempt-1',
    });
    expect(result.unsetEnvKeys).not.toContain('HAPPIER_SESSION_STARTUP_SPAWN_NONCE');
    for (const processEnv of [{}, { HAPPIER_HOME_DIR: '/stale-home' }]) {
      const childEnv = buildSpawnChildProcessEnv({
        processEnv,
        extraEnv: result.extraEnvForChildWithMessage,
        unsetEnvKeys: result.unsetEnvKeys,
      });
      expect(childEnv.HAPPIER_HOME_DIR).toBe(configuration.happyHomeDir);
    }
  });
});
