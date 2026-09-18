import { describe, expect, it, vi } from 'vitest';

import {
  resolveAgentRealtimeVoiceConversationBinding,
  type AgentRealtimeSessionAvailability,
} from './resolveAgentRealtimeVoiceConversationBinding';

const provider = Object.freeze({ pluginId: 'happier.voice.example', localId: 'realtime' });
const agent = Object.freeze({ pluginId: 'happier.agent.example', localId: 'example' });

const available: AgentRealtimeSessionAvailability = Object.freeze({ available: true });
const declined = (
  code: 'session_unavailable' | 'update_required' | null,
): AgentRealtimeSessionAvailability => Object.freeze({ available: false, code });

describe('resolveAgentRealtimeVoiceConversationBinding', () => {
  it('keeps direct control on the exact visible-session address', async () => {
    const inspect = vi.fn(async () => available);
    const ensureGlobalConversation = vi.fn();

    await expect(resolveAgentRealtimeVoiceConversationBinding({
      provider,
      agent,
      controlSessionId: 'visible-control',
      globalSessionId: 'global-voice-home',
      requestedTargetSessionAddress: { serverId: 'home-b', sessionId: 'visible-control' },
      globalConversationServerId: 'home-b',
      inspect,
      ensureGlobalConversation,
    })).resolves.toEqual({
      conversationSessionAddress: { serverId: 'home-b', sessionId: 'visible-control' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'home-b', sessionId: 'visible-control' },
    });
    expect(inspect).toHaveBeenCalledWith({
      sessionAddress: { serverId: 'home-b', sessionId: 'visible-control' },
      provider,
      agent,
    });
    expect(ensureGlobalConversation).not.toHaveBeenCalled();
  });

  it('obtains and verifies a hidden global conversation on the requested target Home', async () => {
    const inspect = vi.fn(async (input: Readonly<{ sessionAddress: Readonly<{ sessionId: string }> }>) =>
      input.sessionAddress.sessionId === 'hidden-conversation' ? available : declined('session_unavailable'));
    const ensureGlobalConversation = vi.fn(async (input: Readonly<{
      agent: typeof agent;
      isReusableSession(input: Readonly<{ sessionId: string }>): Promise<boolean>;
    }>) => {
      expect(input.agent).toBe(agent);
      await expect(input.isReusableSession({ sessionId: 'wrong-agent-session' })).resolves.toBe(false);
      return 'hidden-conversation';
    });

    await expect(resolveAgentRealtimeVoiceConversationBinding({
      provider,
      agent,
      controlSessionId: 'global-voice-home',
      globalSessionId: 'global-voice-home',
      requestedTargetSessionAddress: { serverId: 'home-b', sessionId: 'visible-target' },
      globalConversationServerId: 'home-b',
      inspect,
      ensureGlobalConversation,
    })).resolves.toEqual({
      conversationSessionAddress: { serverId: 'home-b', sessionId: 'hidden-conversation' },
      transcriptMode: 'native_session',
      targetSessionAddress: { serverId: 'home-b', sessionId: 'visible-target' },
    });
    expect(ensureGlobalConversation).toHaveBeenCalledOnce();
    expect(inspect).not.toHaveBeenCalledWith(expect.objectContaining({
      sessionAddress: { serverId: 'home-b', sessionId: 'visible-target' },
    }));
  });

  it('declines with the typed cause instead of an unnamed miss on the direct path', async () => {
    await expect(resolveAgentRealtimeVoiceConversationBinding({
      provider,
      agent,
      controlSessionId: 'inactive-control',
      globalSessionId: 'global-voice-home',
      requestedTargetSessionAddress: { serverId: 'home-a', sessionId: 'inactive-control' },
      globalConversationServerId: 'home-a',
      inspect: async () => declined('session_unavailable'),
      ensureGlobalConversation: vi.fn(),
    })).rejects.toMatchObject({
      code: 'session_unavailable',
      message: 'session_unavailable',
    });
  });

  it('declines with the typed cause after obtaining the hidden global conversation', async () => {
    await expect(resolveAgentRealtimeVoiceConversationBinding({
      provider,
      agent,
      controlSessionId: 'global-voice-home',
      globalSessionId: 'global-voice-home',
      requestedTargetSessionAddress: null,
      globalConversationServerId: 'home-a',
      inspect: async () => declined('update_required'),
      ensureGlobalConversation: async () => 'hidden-conversation',
    })).rejects.toMatchObject({ code: 'update_required' });
  });

  it('leaves an untyped decline as the unnamed miss its caller already handles', async () => {
    // A decline with no typed reason — the inspect RPC never answered, or the
    // daemon refused without classifying itself — must not be given an invented
    // code; it stays the generic unknown-host-failure path.
    await expect(resolveAgentRealtimeVoiceConversationBinding({
      provider,
      agent,
      controlSessionId: 'visible-control',
      globalSessionId: 'global-voice-home',
      requestedTargetSessionAddress: { serverId: 'home-a', sessionId: 'visible-control' },
      globalConversationServerId: 'home-a',
      inspect: async () => declined(null),
      ensureGlobalConversation: vi.fn(),
    })).resolves.toBeNull();
  });
});
