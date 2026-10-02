import { describe, expect, it, vi } from 'vitest';

import { runSetupMachineRecipe } from '../recipes/setupMachineRecipe.js';
import { createSetupMachineRecipeExecutorFromHappierJsonExecutor } from './setupMachineRecipeExecutor.js';

describe('createSetupMachineRecipeExecutorFromHappierJsonExecutor', () => {
  it('uses the service takeover contract for install and start when manual relay takeover is enabled', async () => {
    const runHappierJson = vi.fn(async () => ({ ok: true }));
    const executor = createSetupMachineRecipeExecutorFromHappierJsonExecutor({
      executor: {
        runHappierJson,
        runHappierText: vi.fn(),
      },
      options: {
        takeOverManualRelayRuntime: true,
      },
    });

    await executor.installDaemonService?.();
    await executor.startDaemonService?.();

    expect(runHappierJson).toHaveBeenNthCalledWith(1, ['service', 'install', '--takeover', '--json']);
    expect(runHappierJson).toHaveBeenNthCalledWith(2, ['service', 'start', '--takeover', '--json']);
  });
  it('repairs a current local machine using the existing pending request file before wait', async () => {
    let approved = false;
    const stateFile = '/private/pending-auth.json';
    const executor = createSetupMachineRecipeExecutorFromHappierJsonExecutor({
      executor: {
        runHappierText: vi.fn(),
        runHappierJson: async (argv) => {
          if (argv[1] === 'request') return { publicKey: 'current-key', stateFile, pairing: { secretB64Url: 'private-context' } };
          if (argv[1] === 'approve') { approved = argv.includes('--request-file') && argv[argv.indexOf('--request-file') + 1] === stateFile; return { success: true }; }
          if (argv[1] === 'wait') { if (!approved) throw new Error('Current recipient rejects legacy approval'); return { machineId: 'repaired-machine' }; }
          throw new Error('Unexpected CLI boundary invocation');
        },
      },
    });
    const result = await runSetupMachineRecipe({
      executor, relayProfile: { serverUrl: 'https://relay.example', webappUrl: 'https://web.example', localServerUrl: null },
      initialAuthStatus: { authenticated: true, machineId: null }, steps: { configureRelay: false, installService: false, startService: false, verifyService: false }, emit: () => {},
    });
    expect(result.machineId).toBe('repaired-machine');
  });

});
