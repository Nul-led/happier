import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installVoiceStorageModuleMocks } from './installVoiceStorageModuleMocks';

const applySettings = vi.fn();
let state: any;

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
  getSyncSingleton: () => ({ applySettings }),
}));

installVoiceStorageModuleMocks({
  storage: async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
      storage: {
        getState: () => state,
      },
    });
  },
});

describe('voiceAutoTargetMachineSettings', () => {
  beforeEach(() => {
    vi.resetModules();
    applySettings.mockReset();
    state = {
      settingsScope: { serverId: 'server-a', accountId: 'account-a' },
      settings: {
        voice: {
          executionMachine: {
            mode: ' auto ',
            autoMachineId: '  machine-1  ',
          },
        },
      },
    };
  });

  it('reads a trimmed sticky auto-target machine id when the mode is auto', async () => {
    const { readVoiceAutoTargetMachineId } = await import('./voiceAutoTargetMachineSettings');

    expect(readVoiceAutoTargetMachineId(state)).toBe('machine-1');
  });

  it('persists a sticky auto-target machine id when the mode is auto even if it is padded', async () => {
    const { persistVoiceAutoTargetMachineId } = await import('./voiceAutoTargetMachineSettings');

    persistVoiceAutoTargetMachineId('  machine-2  ', {
      serverId: 'server-a',
      accountId: 'account-a',
    });

    expect(applySettings).toHaveBeenCalledWith(expect.objectContaining({
      voice: expect.objectContaining({
        executionMachine: {
          mode: 'auto',
          machineId: null,
          autoMachineId: 'machine-2',
        },
      }),
    }), {
      expectedSettingsScope: { serverId: 'server-a', accountId: 'account-a' },
      source: 'ui',
    });
  });

  it('uses the pre-await captured scope for automatic machine persistence', async () => {
    const { persistVoiceAutoTargetMachineId } = await import('./voiceAutoTargetMachineSettings');
    const capturedScope = { serverId: 'server-a', accountId: 'account-a' };
    state.settingsScope = { serverId: 'server-b', accountId: 'account-b' };

    persistVoiceAutoTargetMachineId('machine-2', capturedScope);

    expect(applySettings).toHaveBeenCalledWith(expect.any(Object), {
      expectedSettingsScope: capturedScope,
      source: 'ui',
    });
  });
});
