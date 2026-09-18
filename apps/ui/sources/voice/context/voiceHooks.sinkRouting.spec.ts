import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storage } from '@/sync/domains/state/storage';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { readLocalConversationVoiceSettings } from '@/sync/domains/settings/voiceSettings';
import type { VoiceSession } from '@/realtime/types';
import { useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { VOICE_AGENT_GLOBAL_SESSION_ID } from '@/voice/agent/voiceAgentGlobalSessionId';
import type { VoiceSessionBinding } from '@/voice/binding/voiceConversationBindingTypes';
import { setVoiceSessionSnapshot } from '@/voice/session/voiceSessionStore';
import { registerVoiceAdapters, resetVoiceAdapterRegistryForTests } from '@/voice/session/voiceAdapterRegistry';
import { createLocalConversationVoiceAdapter } from '@/voice/adapters/localConversation/localConversationAdapter';

const { realtimeState, appendLocalVoiceAgentContextUpdate, sendLocalVoiceAgentTextUpdate, announceLocalVoiceAgentAssistantText, isLocalVoiceAgentActive, resolveVoiceBindingByControlSessionId } = vi.hoisted(() => ({
  realtimeState: {
    started: false,
    hostAuthoredContext: 'session_context' as 'session_context' | 'current_ui_only',
    session: null as Pick<VoiceSession, 'sendContextualUpdate' | 'sendTextMessage'> | null,
  },
  appendLocalVoiceAgentContextUpdate: vi.fn<(sessionId: string, update: string) => void>(),
  sendLocalVoiceAgentTextUpdate: vi.fn<(sessionId: string, update: string) => Promise<void>>(async () => undefined),
  announceLocalVoiceAgentAssistantText: vi.fn<(sessionId: string, text: string) => void>(),
  isLocalVoiceAgentActive: vi.fn<(sessionId: string) => boolean>((_sessionId: string) => true),
  resolveVoiceBindingByControlSessionId: vi.fn<(controlSessionId: string) => VoiceSessionBinding | null>(() => null),
}));

vi.mock('@/voice/local/localVoiceRuntimeController', () => ({
  localVoiceRuntimeController: {
    isAgentActive: (sessionId: string) => isLocalVoiceAgentActive(sessionId),
    appendAgentContextUpdate: (sessionId: string, update: string) =>
      appendLocalVoiceAgentContextUpdate(sessionId, update),
    sendAgentTextUpdate: (sessionId: string, update: string) =>
      sendLocalVoiceAgentTextUpdate(sessionId, update),
    announceAgentAssistantText: (sessionId: string, text: string) =>
      announceLocalVoiceAgentAssistantText(sessionId, text),
  },
}));

vi.mock('@/voice/binding/VoiceConversationBindingResolver', () => ({
  voiceConversationBindingResolver: {
    resolveByControlSessionId: (params: { controlSessionId: string }) =>
      resolveVoiceBindingByControlSessionId(params.controlSessionId),
  },
}));

import {
  createCurrentUiContextAutomaticUpdateProjector,
  voiceHooks,
} from './voiceHooks';

describe('voiceHooks sink routing', () => {
  beforeEach(() => {
    resetVoiceAdapterRegistryForTests();
    registerVoiceAdapters([{
      id: 'happier.voice.elevenlabs/realtime-elevenlabs',
      engineKind: 'realtime',
      start: async () => {},
      stop: async () => {},
      toggle: async () => {},
      interrupt: async () => {},
      setMuted: async () => {},
      sendContextUpdate: ({ update }) => realtimeState.session?.sendContextualUpdate(update),
      sendContextText: ({ text }) => realtimeState.session?.sendTextMessage(text),
      resolveContextChannel: () => realtimeState.session ? {
        hostAuthoredContext: realtimeState.hostAuthoredContext,
        sendContextualUpdate: (update) => realtimeState.session?.sendContextualUpdate(update),
        sendTextMessage: (text) => realtimeState.session?.sendTextMessage(text),
      } : null,
      getSnapshot: () => ({
        adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs', sessionId: 'realtime-s1',
        status: realtimeState.started ? 'connected' : 'disconnected', mode: 'idle', canStop: realtimeState.started,
      }),
    }, createLocalConversationVoiceAdapter()]);
    appendLocalVoiceAgentContextUpdate.mockReset();
    sendLocalVoiceAgentTextUpdate.mockReset();
    announceLocalVoiceAgentAssistantText.mockReset();
    isLocalVoiceAgentActive.mockReset();
    isLocalVoiceAgentActive.mockReturnValue(true);
    resolveVoiceBindingByControlSessionId.mockReset();
    resolveVoiceBindingByControlSessionId.mockReturnValue(null);
    realtimeState.started = false;
    realtimeState.hostAuthoredContext = 'session_context';
    realtimeState.session = null;
    voiceHooks.onVoiceStopped();
    useVoiceTargetStore.getState().setPrimaryActionSessionAddress({ serverId: 'server-a', sessionId: 's1' });
    useVoiceTargetStore.getState().setVoiceLiveContextSessionAddresses([{ serverId: 'server-a', sessionId: 's1' }]);
    setVoiceSessionSnapshot({
      adapterId: null,
      sessionId: null,
      status: 'disconnected',
      mode: 'idle',
      canStop: false,
    });

    const localConversationDefaults = readLocalConversationVoiceSettings(settingsDefaults.voice);
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...settingsDefaults,
        voice: {
          ...settingsDefaults.voice,
          providerId: 'local_conversation',
          privacy: {
            shareSessionSummary: true,
            shareRecentMessages: true,
            recentMessagesCount: 3,
            shareToolNames: true,
            sharePermissionRequests: true,
            shareDeviceInventory: true,
            shareFilePaths: false,
            shareToolArgs: false,
          },
          providers: {
            ...settingsDefaults.voice.providers,
            local_conversation: {
              schemaVersion: 1,
              config: {
                ...localConversationDefaults,
                conversationMode: 'agent',
              },
            },
          },
        },
      },
      sessions: {
        ...state.sessions,
        s1: {
          id: 's1',
          serverId: 'server-a',
          metadata: { path: '/tmp/project', host: 'localhost', summary: { text: 'Session summary', updatedAt: Date.now() } },
          presence: 'online',
        },
        s2: {
          id: 's2',
          serverId: 'server-a',
          metadata: { path: '/tmp/other-project', host: 'localhost', summary: { text: 'Other session summary', updatedAt: Date.now() } },
          presence: 'online',
        },
      },
      sessionListRowsByServerId: {
        'server-a': {
          s1: {
            id: 's1',
            serverId: 'server-a',
            metadata: { path: '/tmp/project', host: 'localhost', summary: { text: 'Session summary', updatedAt: Date.now() } },
            presence: 'online',
          },
          s2: {
            id: 's2',
            serverId: 'server-a',
            metadata: { path: '/tmp/other-project', host: 'localhost', summary: { text: 'Other session summary', updatedAt: Date.now() } },
            presence: 'online',
          },
        },
      },
      ordinarySessionListMembershipByServerId: {
        'server-a': ['s1', 's2'],
      },
      sessionMessages: {
        ...state.sessionMessages,
        s1: { messages: [] },
        s2: { messages: [] },
      },
    }));
  });

  it('does not route ready updates when local agent mode is selected without a canonical binding', () => {
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' });

    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalled();
  });

  it('does not fall back to a stale remote voice session while local agent mode is selected without a canonical binding', () => {
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' });

    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalled();
    expect(sendContextualUpdate).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('includes fresh agent-text content in the remote ready-event announcement when available', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
        },
      },
    }));
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'speaking',
      canStop: true,
    });

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'Implemented the change and updated the tests.',
      createdAt: 2,
    } as any]);

    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.stringContaining('Implemented the change and updated the tests.'),
    );
  });

  it('falls back to stored recent agent-text content when the ready event arrives without a fresh batch', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
        },
      },
    }));
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'speaking',
      canStop: true,
    });

    storage.setState((state: any) => ({
      ...state,
      sessionMessages: {
        ...state.sessionMessages,
        s1: {
          messageIdsOldestFirst: ['m1', 'm2'],
          messagesById: {
            m1: { id: 'm1', kind: 'user-text', text: 'Please inspect this.', createdAt: 1 },
            m2: { id: 'm2', kind: 'agent-text', text: 'I found the root cause in the session sync path.', createdAt: 2 },
          },
          messagesMap: {
            m1: { id: 'm1', kind: 'user-text', text: 'Please inspect this.', createdAt: 1 },
            m2: { id: 'm2', kind: 'agent-text', text: 'I found the root cause in the session sync path.', createdAt: 2 },
          },
        },
      },
    }));

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' });

    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.stringContaining('I found the root cause in the session sync path.'),
    );
  });

  it('does not route to realtime from selected settings alone while the canonical voice snapshot is disconnected', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
        },
      },
    }));
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'Should not route through a disconnected realtime owner.',
      createdAt: 2,
    } as any]);

    expect(sendContextualUpdate).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('does not route to agent when agent is inactive', () => {
    isLocalVoiceAgentActive.mockReturnValue(false);

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' });

    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
  });

  it('does not fall back to a stale remote voice session when local agent mode is selected but inactive', () => {
    isLocalVoiceAgentActive.mockReturnValue(false);
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' });

    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalled();
    expect(sendContextualUpdate).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('prefers the active realtime owner over newly selected local-agent settings during ready-event routing', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-conversation-1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-conversation-1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'speaking',
      canStop: true,
    });

    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'The coding assistant finished the review.',
      createdAt: 1,
    } as any]);

    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.stringContaining('The coding assistant finished the review.'),
    );
    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalled();
  });

  it('prefers the active local-agent owner over newly selected realtime settings during ready-event routing', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
        },
      },
    }));
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-conversation-1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-conversation-1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);
    setVoiceSessionSnapshot({
      adapterId: 'local_conversation',
      sessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      status: 'connected',
      mode: 'listening',
      canStop: true,
    });

    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'The coding assistant finished the review.',
      createdAt: 1,
    } as any]);

    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendContextualUpdate).not.toHaveBeenCalled();
  });

  it('leaves local ready catch-up to daemon turn admission', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-conversation-1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-conversation-1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' });

    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalledWith(
      VOICE_AGENT_GLOBAL_SESSION_ID,
      expect.stringContaining('Coding assistant finished working in “Session summary”'),
    );
  });

  it('routes non-target session updates when other-session voice updates are enabled', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-conversation-1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-conversation-1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's2' });

    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalled();
  });

  it('interrupts the active target with assistant message content instead of only a contextual update', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
        },
      },
    }));
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'speaking',
      canStop: true,
    });

    voiceHooks.onMessages({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'The coding assistant finished the review.',
      createdAt: 1,
    } as any]);

    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.stringContaining('The coding assistant finished the review.'),
    );
    expect(sendContextualUpdate).not.toHaveBeenCalledWith(
      expect.stringContaining('The coding assistant finished the review.'),
    );
  });

  it('routes active-target assistant replies to local voice as deterministic foreground announcements only', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-conversation-1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-conversation-1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onMessages({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'The coding assistant needs approval.',
      createdAt: 1,
    } as any]);

    expect(announceLocalVoiceAgentAssistantText).toHaveBeenCalledWith(
      'voice-conversation-1',
      expect.stringContaining('The coding assistant needs approval.'),
    );
    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalledWith(
      VOICE_AGENT_GLOBAL_SESSION_ID,
      expect.stringContaining('The coding assistant needs approval.'),
    );
  });

  it('announces failed sub-agent run summaries immediately in the bound hidden voice conversation', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-hidden-s1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-hidden-s1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onMessages({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'tool-call',
      id: 'tool_1',
      localId: null,
      createdAt: 1,
      children: [],
      tool: {
        name: 'SubAgentRun',
        state: 'completed',
        input: { intent: 'review' },
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        description: null,
        result: {
          status: 'failed',
          summary: 'Invalid review output (expected strict JSON).',
          error: { code: 'invalid_output' },
        },
      },
    } as any]);

    expect(announceLocalVoiceAgentAssistantText).toHaveBeenCalledWith(
      'voice-hidden-s1',
      expect.stringContaining('Invalid review output (expected strict JSON).'),
    );
    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
  });

  it('mirrors active-target assistant replies into the bound hidden voice conversation for hands-free follow-up', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-hidden-s1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-hidden-s1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onMessages({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'What do you want handled in this workspace?',
      createdAt: 1,
    } as any]);

    expect(announceLocalVoiceAgentAssistantText).toHaveBeenCalledWith(
      'voice-hidden-s1',
      expect.stringContaining('What do you want handled in this workspace?'),
    );
    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalledWith(
      VOICE_AGENT_GLOBAL_SESSION_ID,
      expect.stringContaining('What do you want handled in this workspace?'),
    );
  });

  it('treats the bound local target session as the primary action session without retaining background context when the target store is stale', () => {
    useVoiceTargetStore.getState().setPrimaryActionSessionAddress(null);
    useVoiceTargetStore.getState().setVoiceLiveContextSessionAddresses([]);
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-hidden-s1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-hidden-s1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onMessages({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'Choose one of the onboarding options.',
      createdAt: 1,
    } as any]);

    expect(announceLocalVoiceAgentAssistantText).toHaveBeenCalledWith(
      'voice-hidden-s1',
      expect.stringContaining('Choose one of the onboarding options.'),
    );
    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalledWith(
      VOICE_AGENT_GLOBAL_SESSION_ID,
      expect.stringContaining('Choose one of the onboarding options.'),
    );
  });

  it('announces permission requests immediately without retaining a second detailed-request queue', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-conversation-1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-conversation-1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onAgentRequest({ serverId: 'server-a', sessionId: 's1' }, 'req_1', 'permission', 'Bash', { command: 'rm -rf /tmp/x' });

    expect(announceLocalVoiceAgentAssistantText).toHaveBeenCalledWith(
      'voice-conversation-1',
      expect.stringContaining('needs permission'),
    );
    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalledWith(
      VOICE_AGENT_GLOBAL_SESSION_ID,
      expect.stringContaining('<request_id>req_1</request_id>'),
    );
  });

  it('announces non-target user-action requests in the local hidden voice conversation when other-session updates are enabled', () => {
    resolveVoiceBindingByControlSessionId.mockReturnValue({
      adapterId: 'local_conversation',
      controlSessionId: VOICE_AGENT_GLOBAL_SESSION_ID,
      conversationSessionId: 'voice-conversation-1',
      conversationSessionAddress: { serverId: 'server-a', sessionId: 'voice-conversation-1' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      updatedAt: 1,
    });
    isLocalVoiceAgentActive.mockImplementation((sessionId: string) => sessionId === VOICE_AGENT_GLOBAL_SESSION_ID);

    voiceHooks.onAgentRequest({ serverId: 'server-a', sessionId: 's2' }, 'req_2', 'user_action', 'AskUserQuestion', {
      prompt: 'Pick a shape',
      answers: [{ value: 'circle', title: 'Circle' }, { value: 'square', title: 'Square' }],
    });

    expect(announceLocalVoiceAgentAssistantText).toHaveBeenCalledWith(
      'voice-conversation-1',
      expect.stringContaining('needs your input'),
    );
    expect(appendLocalVoiceAgentContextUpdate).not.toHaveBeenCalled();
    expect(sendLocalVoiceAgentTextUpdate).not.toHaveBeenCalled();
  });

  it('leaves non-target Session catch-up to daemon turn admission', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
        },
      },
    }));
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'speaking',
      canStop: true,
    });
    useVoiceTargetStore.getState().setPrimaryActionSessionAddress({ serverId: 'server-a', sessionId: 'other-session' });

    voiceHooks.onMessages({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'Background session reply.',
      createdAt: 1,
    } as any]);

    expect(sendContextualUpdate).toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Background session reply.'),
    );
  });
  it('withholds host-authored session context from a provider whose Agent runtime owns the prompt, while keeping authorized current-UI metadata', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
          privacy: { ...state.settings.voice.privacy, currentUiContextMode: 'automatic' },
        },
      },
    }));
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.hostAuthoredContext = 'current_ui_only';
    realtimeState.session = { sendContextualUpdate, sendTextMessage };
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'listening',
      canStop: true,
    });

    voiceHooks.onSessionOnline({ serverId: 'server-a', sessionId: 's1' }, { summary: { text: 'Session summary' } } as any);
    voiceHooks.onSessionFocus({ serverId: 'server-a', sessionId: 's1' }, { summary: { text: 'Session summary' } } as any);
    voiceHooks.onMessages({ serverId: 'server-a', sessionId: 's1' }, [{
      kind: 'agent-text',
      text: 'Stored transcript content.',
      createdAt: 1,
    } as any]);

    expect(sendContextualUpdate).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();

    voiceHooks.onCurrentUiContextChanged(
      's1',
      { navigation: { area: 'app', screen: 'home' }, commands: [] } as any,
      createCurrentUiContextAutomaticUpdateProjector(),
    );

    expect(sendContextualUpdate).toHaveBeenCalledTimes(1);
    expect(sendContextualUpdate.mock.calls[0]?.[0]).toContain('CURRENT UI CONTEXT');
  });

  it('withholds announced stored-session text from a provider whose Agent runtime owns the prompt', () => {
    storage.setState((state: any) => ({
      ...state,
      settings: {
        ...state.settings,
        voice: {
          ...state.settings.voice,
          providerId: 'happier.voice.elevenlabs/realtime-elevenlabs',
        },
      },
    }));
    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.hostAuthoredContext = 'current_ui_only';
    realtimeState.session = { sendContextualUpdate, sendTextMessage };
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'speaking',
      canStop: true,
    });
    storage.setState((state: any) => ({
      ...state,
      sessionMessages: {
        ...state.sessionMessages,
        s1: {
          messageIdsOldestFirst: ['m1', 'm2'],
          messagesById: {
            m1: { id: 'm1', kind: 'user-text', text: 'Please inspect this.', createdAt: 1 },
            m2: { id: 'm2', kind: 'agent-text', text: 'I found the root cause in the session sync path.', createdAt: 2 },
          },
          messagesMap: {
            m1: { id: 'm1', kind: 'user-text', text: 'Please inspect this.', createdAt: 1 },
            m2: { id: 'm2', kind: 'agent-text', text: 'I found the root cause in the session sync path.', createdAt: 2 },
          },
        },
      },
    }));

    // An announced ready/assistant update is stored-session context whichever
    // transport the sink offers, so the text-turn channel must withhold it too.
    voiceHooks.onReady({ serverId: 'server-a', sessionId: 's1' });

    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendContextualUpdate).not.toHaveBeenCalled();
  });

  it('routes duplicate-id lifecycle events only by their exact Home and fails closed for a bare id', () => {
    storage.setState((state: any) => ({
      ...state,
      sessions: {
        ...state.sessions,
        same: {
          id: 'same',
          serverId: 'server-a',
          metadata: { summary: { text: 'Home A session' } },
          presence: 'online',
        },
      },
      sessionListRowsByServerId: {
        ...state.sessionListRowsByServerId,
        'server-a': {
          ...state.sessionListRowsByServerId?.['server-a'],
          same: {
            id: 'same',
            serverId: 'server-a',
            metadata: { summary: { text: 'Home A session' } },
            presence: 'online',
          },
        },
        'server-b': {
          same: {
            id: 'same',
            serverId: 'server-b',
            metadata: { summary: { text: 'Home B session' } },
            presence: 'online',
            viewer: { follow: { following: true, includeInVoice: true } },
          },
        },
      },
      ordinarySessionListMembershipByServerId: {
        ...state.ordinarySessionListMembershipByServerId,
        'server-a': [...(state.ordinarySessionListMembershipByServerId?.['server-a'] ?? []), 'same'],
        'server-b': ['same'],
      },
    }));
    useVoiceTargetStore.getState().setPrimaryActionSessionAddress({ serverId: 'server-a', sessionId: 'same' });
    useVoiceTargetStore.getState().setVoiceLiveContextSessionAddresses([{ serverId: 'server-a', sessionId: 'same' }]);

    const sendContextualUpdate = vi.fn();
    const sendTextMessage = vi.fn();
    realtimeState.started = true;
    realtimeState.session = { sendContextualUpdate, sendTextMessage };
    setVoiceSessionSnapshot({
      adapterId: 'happier.voice.elevenlabs/realtime-elevenlabs',
      sessionId: 'realtime-s1',
      status: 'connected',
      mode: 'listening',
      canStop: true,
    });

    const homeB = { serverId: 'server-b', sessionId: 'same' } as const;
    voiceHooks.onSessionFocus(homeB);
    voiceHooks.onSessionOnline(homeB, { summary: { text: 'Home B session' } });
    voiceHooks.onSessionOffline(homeB, { summary: { text: 'Home B session' } });
    voiceHooks.onMessages(homeB, [{ kind: 'agent-text', text: 'Only Home B changed.', createdAt: 1 } as any]);
    voiceHooks.onReady(homeB, [{ kind: 'agent-text', text: 'Home B is ready.', createdAt: 2 } as any]);

    expect(useVoiceTargetStore.getState().lastFocusedSessionAddress).toEqual(homeB);
    expect(useVoiceTargetStore.getState().primaryActionSessionAddress).toEqual({ serverId: 'server-a', sessionId: 'same' });
    expect(useVoiceTargetStore.getState().voiceLiveContextSessionAddresses).toEqual([{ serverId: 'server-a', sessionId: 'same' }]);
    expect([...sendContextualUpdate.mock.calls, ...sendTextMessage.mock.calls].flat().join('\n'))
      .toContain('Home B');
    expect([...sendContextualUpdate.mock.calls, ...sendTextMessage.mock.calls].flat().join('\n'))
      .not.toContain('Home A');

    sendContextualUpdate.mockClear();
    sendTextMessage.mockClear();
    const focusedBeforeAmbiguousEvent = useVoiceTargetStore.getState().lastFocusedSessionAddress;
    Reflect.apply(voiceHooks.onSessionFocus, voiceHooks, ['same']);
    Reflect.apply(voiceHooks.onSessionOnline, voiceHooks, ['same']);
    Reflect.apply(voiceHooks.onSessionOffline, voiceHooks, ['same']);
    Reflect.apply(voiceHooks.onMessages, voiceHooks, ['same', [{
      kind: 'agent-text',
      text: 'Ambiguous update must not escape.',
      createdAt: 3,
    }]]);
    Reflect.apply(voiceHooks.onReady, voiceHooks, ['same', [{
      kind: 'agent-text',
      text: 'Ambiguous ready must not escape.',
      createdAt: 4,
    }]]);

    expect(useVoiceTargetStore.getState().lastFocusedSessionAddress).toEqual(focusedBeforeAmbiguousEvent);
    expect(sendContextualUpdate).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
