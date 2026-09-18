import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, applySettings } = vi.hoisted(() => {
  const voice = {
    providers: {
      local_conversation: {
        schemaVersion: 1,
        config: { agent: {
          transcript: {
            persistenceMode: 'persistent',
            epoch: 2,
          },
        } },
      },
    },
  };
  const state: any = {
    settingsScope: { serverId: 'server-a', accountId: 'account-a' },
    settings: {
      voiceSettingsV1: voice,
      voice,
    },
  };
  const applySettings = vi.fn((patch: any) => {
      state.settings = { ...state.settings, ...patch };
  });
  return { state, applySettings };
});

vi.mock('@/sync/domains/state/storage', async () => {
  const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
  return createStorageModuleStub({
    storage: {
      getState: () => state,
    },
  });
});

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
  getSyncSingleton: () => ({ applySettings }),
}));

describe('invalidatePersistentVoiceTranscript', () => {
  beforeEach(() => {
    vi.resetModules();
    const voice = {
      providers: {
        local_conversation: {
          schemaVersion: 1,
          config: { agent: { transcript: { persistenceMode: 'persistent', epoch: 2 } } },
        },
      },
    };
    state.settings = {
      voiceSettingsV1: voice,
      voice,
    };
    applySettings.mockReset();
    applySettings.mockImplementation((patch: any) => {
      state.settings = { ...state.settings, ...patch };
    });
  });

  it('increments the transcript epoch through both canonical and runtime Voice projections', async () => {
    const { invalidatePersistentVoiceTranscript } = await import('./invalidatePersistentVoiceTranscript');

    expect(invalidatePersistentVoiceTranscript(state.settingsScope)).toBe(3);
    expect(applySettings).toHaveBeenCalledWith(expect.any(Object), {
      expectedSettingsScope: state.settingsScope,
      source: 'ui',
    });
    expect(state.settings.voice.providers.local_conversation.config.agent.transcript.epoch).toBe(3);
    expect(state.settings.voiceSettingsV1.providers.local_conversation.config.agent.transcript.epoch).toBe(3);
  });
});
