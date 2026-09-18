import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_AGENT_GLOBAL_SESSION_ID } from '@/voice/agent/voiceAgentGlobalSessionId';
import { attachVoiceAgentActionEffectId } from '@/voice/agent/types';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { voiceConversationRuntimeMachine } from '@/voice/runtime/machine/VoiceConversationRuntimeMachine';

const appendUser = vi.fn();
const appendAssistant = vi.fn();
const appendNote = vi.fn();
const conversationModeState: { current: 'agent' | 'direct_session' } = { current: 'agent' };
const sendMessage = vi.fn();
const submitMessage = vi.fn();
const enqueuePendingMessage = vi.fn();
const markPendingDeliveryHandled = vi.fn();
const sendSessionMessageWithServerScope = vi.fn();

type AcceptedTurnOptions = Readonly<{
  onUserTranscriptAccepted?: () => void | Promise<void>;
}>;

vi.mock('@/voice/transcript/voiceConversationTranscript', () => ({
  appendVoiceConversationUserText: (params: any) => appendUser(params),
  appendVoiceConversationAssistantText: (params: any) => appendAssistant(params),
  appendVoiceConversationNoteText: (params: any) => appendNote(params),
  buildRealtimeConversationTurnMeta: () => ({
    happier: {
      kind: 'conversation_turn.v1',
      payload: { v: 1 },
      conversationTurnOriginV1: {
        v: 1,
        channel: 'realtime_conversation',
        modality: 'voice',
      },
    },
  }),
}));

vi.mock('@/sync/domains/state/storage', async () => {
  const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
  return createStorageModuleStub({
    storage: {
      getState: () => ({
        settings: buildAccountSettings(),
        settingsScope: { serverId: 'server-a', accountId: 'account-a' },
        sessions: {
          s1: {
            id: 's1',
            serverId: 'server-a',
            active: true,
            metadata: { machineId: 'machine-1', path: '/workspace/s1' },
          },
          'carrier-s1': {
            id: 'carrier-s1',
            serverId: 'server-a',
            active: true,
            updatedAt: 1,
            metadata: {
              machineId: 'machine-1',
              path: '/workspace/s1',
              systemSessionV1: { v: 1, key: 'voice_conversation', hidden: true },
              voiceConversationScopeV1: { v: 1, kind: 'session_root', sessionRootId: 's1' },
            },
          },
        },
        machines: {
          'machine-1': { id: 'machine-1', active: true, metadata: {} },
        },
        sessionMessages: {},
      }),
    },
  });
});

vi.mock('@/sync/sync', () => ({
  sync: {
    sendMessage: (...args: any[]) => sendMessage(...args),
    submitMessage: (...args: any[]) => submitMessage(...args),
    enqueuePendingMessage: (...args: any[]) => enqueuePendingMessage(...args),
    markPendingDeliveryHandled: (...args: any[]) => markPendingDeliveryHandled(...args),
    ensureSessionVisibleForMessageRoute: vi.fn(async () => {}),
    refreshSessionMessages: vi.fn(async () => {}),
    patchSessionMetadataWithRetry: vi.fn(async () => {}),
    encryption: { getSessionEncryption: vi.fn(() => ({})) },
  },
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionSendMessage', () => ({
  sendSessionMessageWithServerScope: (args: any) => sendSessionMessageWithServerScope(args),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => ({ serverId: 'server-a' }),
  subscribeActiveServer: () => () => {},
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
  const { createPartialServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
  return await createPartialServerProfilesModuleMock(importOriginal, {
    profiles: [
      { id: 'server-a', name: 'Home A', serverUrl: 'https://server-a.test' },
      { id: 'server-b', name: 'Home B', serverUrl: 'https://server-b.test' },
    ],
  });
});

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
  return {
    ...actual,
    TokenStorage: {
      ...actual.TokenStorage,
      getCredentialsForServerUrl: vi.fn(async (_url: string, options?: { serverId?: string }) =>
        options?.serverId === 'server-a'
          ? { token: 'e30.eyJzdWIiOiJhY2NvdW50LWEifQ.signature', secret: 'secret-a' }
          : null),
    },
    subscribeHomeCredentialMutations: () => () => {},
  };
});

vi.mock('@/sync/api/account/apiAccountEncryptionMode', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/sync/api/account/apiAccountEncryptionMode')>(),
  fetchAccountEncryptionMode: vi.fn(async () => ({ mode: 'plain' as const })),
}));

function buildAccountSettings() {
  return {
    ...settingsDefaults,
    experiments: true,
    featureToggles: {
      ...settingsDefaults.featureToggles,
      voice: true,
    },
    voice: {
      ...settingsDefaults.voice,
      providerId: 'local_conversation',
      providers: {
        ...settingsDefaults.voice.providers,
        local_conversation: {
          schemaVersion: 1,
          config: {
            conversationMode: conversationModeState.current,
            tts: { autoSpeakReplies: false },
            streaming: { enabled: false, ttsEnabled: false, ttsChunkChars: 120 },
          },
        },
      },
    },
  };
}

async function loadSendVoiceTextTurnWithProductionBinding() {
  const [
    { createLocalConversationVoiceAdapter },
    { registerVoiceAdapters, resetVoiceAdapterRegistryForTests },
    { voiceSessionBindingManager },
    { voiceSessionBindingStore },
    localVoiceTextTurn,
  ] = await Promise.all([
    import('@/voice/adapters/localConversation/localConversationAdapter'),
    import('@/voice/session/voiceAdapterRegistry'),
    import('@/voice/binding/voiceConversationBindingRuntime'),
    import('@/voice/binding/voiceConversationBindingStore'),
    import('./sendVoiceTextTurn'),
  ]);

  resetVoiceAdapterRegistryForTests();
  registerVoiceAdapters([createLocalConversationVoiceAdapter()]);
  for (const binding of voiceSessionBindingManager.list()) {
    voiceSessionBindingStore.getState().unbind(binding.conversationSessionId);
  }
  const binding = await voiceSessionBindingManager.ensureBound({
    adapterId: 'local_conversation',
    controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
    requestedTargetSessionId: 's1',
  });
  expect(binding).toMatchObject({
    adapterId: 'local_conversation',
    controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
    conversationSessionId: 'carrier-s1',
    transcriptMode: 'native_session',
    targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
  });
  return localVoiceTextTurn;
}

describe('sendVoiceTextTurn native-session transcript ownership', () => {
  beforeEach(() => {
    voiceConversationRuntimeMachine.reset();
    appendUser.mockReset();
    appendAssistant.mockReset();
    appendNote.mockReset();
    conversationModeState.current = 'agent';
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    submitMessage.mockReset();
    submitMessage.mockResolvedValue(undefined);
    enqueuePendingMessage.mockReset();
    enqueuePendingMessage.mockImplementation(async (_sessionId, _text, _displayText, _meta, options) => ({
      localId: options.localId,
      accepted: true,
      externalHandoffClaimed: true,
    }));
    markPendingDeliveryHandled.mockReset();
    markPendingDeliveryHandled.mockResolvedValue(undefined);
    sendSessionMessageWithServerScope.mockReset();
    sendSessionMessageWithServerScope.mockResolvedValue({ ok: true });
  });

  it('submits direct coding-session voice turns through durable immediate delivery', async () => {
    conversationModeState.current = 'direct_session';
    const { sendVoiceTextTurn } = await import('./sendVoiceTextTurn');

    await sendVoiceTextTurn({
      sessionId: 's1',
      settings: buildAccountSettings(),
      userText: 'send this directly',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: {
        sendTurn: async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
          await opts?.onUserTranscriptAccepted?.();
          return { assistantText: '', actions: [] };
        },
      },
    });

    expect(submitMessage).toHaveBeenCalledWith('s1', 'send this directly', undefined, undefined, {
      callerSurface: 'voice_turn',
      forceImmediate: true,
      hostAdmissionOrigin: 'voice',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not admit a direct coding-session voice turn after cancellation', async () => {
    conversationModeState.current = 'direct_session';
    const controller = new AbortController();
    controller.abort();
    const { sendVoiceTextTurn } = await import('./sendVoiceTextTurn');

    await expect(sendVoiceTextTurn({
      sessionId: 's1',
      settings: buildAccountSettings(),
      userText: 'cancelled before admission',
      signal: controller.signal,
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: {
        sendTurn: async () => ({ assistantText: '', actions: [] }),
      },
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('does not duplicate daemon-owned local agent turns in the UI transcript projector', async () => {
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();

    await sendVoiceTextTurn({
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      settings: buildAccountSettings(),
      userText: 'list the backends',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: {
        sendTurn: async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
          await opts?.onUserTranscriptAccepted?.();
          return { assistantText: 'I found Claude and Codex.', actions: [] };
        },
      },
    });

    expect(appendUser).not.toHaveBeenCalled();
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(appendNote).not.toHaveBeenCalled();
  });

  it('durably enqueues speech input before one local-agent dispatch', async () => {
    const events: string[] = [];
    enqueuePendingMessage.mockImplementationOnce(async (_sessionId, _text, _displayText, _meta, options) => {
      events.push(`enqueue:${options.localId}`);
      return { localId: options.localId, accepted: true, externalHandoffClaimed: true };
    });
    markPendingDeliveryHandled.mockImplementationOnce(async (_sessionId, localId) => {
      events.push(`settle:${localId}`);
    });
    const sendTurn = vi.fn(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
      const localId = enqueuePendingMessage.mock.calls[0]?.[4]?.localId;
      events.push(`dispatch:${localId}`);
      await opts?.onUserTranscriptAccepted?.();
      return { assistantText: 'done', actions: [] };
    });
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();

    await sendVoiceTextTurn({
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      settings: buildAccountSettings(),
      userText: 'from microphone',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: { sendTurn, stop: vi.fn(async () => {}) },
    });

    const localId = enqueuePendingMessage.mock.calls[0]?.[4]?.localId;
    expect(localId).toEqual(expect.any(String));
    expect(markPendingDeliveryHandled).toHaveBeenCalledExactlyOnceWith('carrier-s1', localId);
    expect(sendTurn).toHaveBeenCalledTimes(1);
    expect(events).toEqual([`enqueue:${localId}`, `dispatch:${localId}`, `settle:${localId}`]);
  });

  it('trims the control session id while preserving daemon transcript ownership', async () => {
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();

    await sendVoiceTextTurn({
      sessionId: ` ${VOICE_AGENT_GLOBAL_SESSION_ID} `,
      settings: buildAccountSettings(),
      userText: 'list the backends',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: {
        sendTurn: async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
          await opts?.onUserTranscriptAccepted?.();
          return { assistantText: 'I found Claude and Codex.', actions: [] };
        },
      },
    });

    expect(appendUser).not.toHaveBeenCalled();
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(appendNote).not.toHaveBeenCalled();
  });

  it('normalizes sendSessionMessage preambles without creating synthetic tool transcript rows', async () => {
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();

    const sendTurn = vi
      .fn()
      .mockImplementationOnce(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
        await opts?.onUserTranscriptAccepted?.();
        return {
          assistantText: 'I will send that now.',
          actions: [attachVoiceAgentActionEffectId(
            { t: 'sendSessionMessage', args: { message: 'hello' } },
            'probe-turn:client:1:0',
          )],
        };
      })
      .mockImplementationOnce(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
        await opts?.onUserTranscriptAccepted?.();
        return { assistantText: 'Done.', actions: [] };
      });

    await sendVoiceTextTurn({
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      settings: buildAccountSettings(),
      userText: 'send hello',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: {
        sendTurn,
      },
    });

    expect(sendSessionMessageWithServerScope).toHaveBeenCalledWith({
      sessionId: 's1',
      serverId: 'server-a',
      message: 'hello',
      requestedAction: { v: 1, kind: 'steer_if_active' },
      hostAdmissionOrigin: 'voice',
    });
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(appendNote).not.toHaveBeenCalled();
  });

  it('records a bounded-limit status without persisting or executing the terminal action-bearing response', async () => {
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();
    const { voiceOutputStatusStore } = await import('@/voice/runtime/outputStatus/voiceOutputStatusStore');
    const sendTurn = vi.fn(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
      await opts?.onUserTranscriptAccepted?.();
      const round = sendTurn.mock.calls.length;
      return {
        assistantText: round === 4 ? 'Done. I sent it again.' : `Round ${round}.`,
        actions: [attachVoiceAgentActionEffectId(
          { t: 'sendSessionMessage', args: { message: `hello-${round}` } },
          `bounded-turn:client:${round}:0`,
        )],
      };
    });

    await sendVoiceTextTurn({
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      settings: buildAccountSettings(),
      userText: 'keep sending',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: { sendTurn, stop: vi.fn(async () => {}) },
    });

    expect(sendTurn).toHaveBeenCalledTimes(4);
    expect(sendSessionMessageWithServerScope).toHaveBeenCalledTimes(3);
    expect(sendSessionMessageWithServerScope.mock.calls)
      .not.toContainEqual([expect.objectContaining({ message: 'hello-4' })]);
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(voiceOutputStatusStore.readForSession(VOICE_AGENT_GLOBAL_SESSION_ID)).toMatchObject({
      statusId: 'tool_round_limit_reached',
      text: 'Tool round limit reached before the requested actions could run.',
    });
    voiceOutputStatusStore.clear({
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      turnId: 'local_voice_agent:tool_round_limit',
    });
  });

  it('resolves implicit tool session ids from the bound target session', async () => {
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();

    const sendTurn = vi
      .fn()
      .mockImplementationOnce(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
        await opts?.onUserTranscriptAccepted?.();
        return {
          assistantText: 'I will send that now.',
          actions: [attachVoiceAgentActionEffectId(
            { t: 'sendSessionMessage', args: { message: 'hello' } },
            'probe-turn-2:client:1:0',
          )],
        };
      })
      .mockImplementationOnce(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
        await opts?.onUserTranscriptAccepted?.();
        return { assistantText: 'Done.', actions: [] };
      });

    await sendVoiceTextTurn({
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      settings: buildAccountSettings(),
      userText: 'send hello',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: {
        sendTurn,
      },
    });

    expect(sendSessionMessageWithServerScope).toHaveBeenCalledWith({
      sessionId: 's1',
      serverId: 'server-a',
      message: 'hello',
      requestedAction: { v: 1, kind: 'steer_if_active' },
      hostAdmissionOrigin: 'voice',
    });
  });

  it('does not send an implicit tool action to the active Home when the bound target is on another Home', async () => {
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();
    const { voiceSessionBindingManager } = await import('@/voice/binding/voiceConversationBindingRuntime');
    await voiceSessionBindingManager.syncTargetSession({
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      targetSessionAddress: { serverId: 'server-b', sessionId: 's1' },
    });

    const sendTurn = vi
      .fn()
      .mockImplementationOnce(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
        await opts?.onUserTranscriptAccepted?.();
        return {
          assistantText: 'I will send that now.',
          actions: [attachVoiceAgentActionEffectId(
            { t: 'sendSessionMessage', args: { message: 'hello on Home B' } },
            'cross-home-turn:client:1:0',
          )],
        };
      })
      .mockImplementationOnce(async (_sessionId, _userText, opts?: AcceptedTurnOptions) => {
        await opts?.onUserTranscriptAccepted?.();
        return { assistantText: 'Done.', actions: [] };
      });

    await sendVoiceTextTurn({
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      settings: buildAccountSettings(),
      userText: 'send hello on the bound target',
      playbackController: {
        registerStopper: () => () => {},
        interrupt: () => {},
        captureEpoch: () => 1,
        isEpochCurrent: () => true,
      },
      voiceAgentSessions: { sendTurn },
    });

    expect(sendSessionMessageWithServerScope).not.toHaveBeenCalled();
  });

  it('rethrows agent-mode send failures after recording the error state', async () => {
    const { sendVoiceTextTurn } = await loadSendVoiceTextTurnWithProductionBinding();

    await expect(
      sendVoiceTextTurn({
        sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
        settings: buildAccountSettings(),
        userText: 'send hello',
        playbackController: {
          registerStopper: () => () => {},
          interrupt: () => {},
          captureEpoch: () => 1,
          isEpochCurrent: () => true,
        },
        voiceAgentSessions: {
          sendTurn: async () => {
            throw new Error('send_failed');
          },
        },
      }),
    ).rejects.toThrow('voice_turn_dispatch_ambiguous');
  });
});
