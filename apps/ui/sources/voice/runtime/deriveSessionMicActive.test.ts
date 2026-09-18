import { describe, expect, it } from 'vitest';

import type { VoiceAssistantScope } from '@/voice/runtime/voiceTargetStore';
import type { VoiceSessionStatus } from '@/voice/session/types';

import { deriveSessionMicActive } from './deriveSessionMicActive';

describe('deriveSessionMicActive', () => {
  it('returns false when voice is disconnected', () => {
    expect(
      deriveSessionMicActive({
        voiceStatus: 'disconnected',
        scope: 'global',
        sessionAddress: { serverId: 'server-a', sessionId: 's1' },
        primaryActionSessionAddress: { serverId: 'server-a', sessionId: 's1' },
        lastFocusedSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      }),
    ).toBe(false);
  });

  it('returns true for session scope when voice is active', () => {
    expect(
      deriveSessionMicActive({
        voiceStatus: 'connected' satisfies VoiceSessionStatus,
        scope: 'session' satisfies VoiceAssistantScope,
        sessionAddress: { serverId: 'server-a', sessionId: 's1' },
        primaryActionSessionAddress: null,
        lastFocusedSessionAddress: null,
      }),
    ).toBe(true);
  });

  it('returns true for global scope when primary action session matches', () => {
    expect(
      deriveSessionMicActive({
        voiceStatus: 'connected' satisfies VoiceSessionStatus,
        scope: 'global' satisfies VoiceAssistantScope,
        sessionAddress: { serverId: 'server-a', sessionId: 's1' },
        primaryActionSessionAddress: { serverId: 'server-a', sessionId: 's1' },
        lastFocusedSessionAddress: { serverId: 'server-a', sessionId: 's2' },
      }),
    ).toBe(true);
  });

  it('returns true for global scope when primary action session is unset and last focused matches', () => {
    expect(
      deriveSessionMicActive({
        voiceStatus: 'connected' satisfies VoiceSessionStatus,
        scope: 'global' satisfies VoiceAssistantScope,
        sessionAddress: { serverId: 'server-a', sessionId: 's1' },
        primaryActionSessionAddress: null,
        lastFocusedSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      }),
    ).toBe(true);
  });

  it('returns false for global scope when targeting a different session', () => {
    expect(
      deriveSessionMicActive({
        voiceStatus: 'connected' satisfies VoiceSessionStatus,
        scope: 'global' satisfies VoiceAssistantScope,
        sessionAddress: { serverId: 'server-a', sessionId: 's1' },
        primaryActionSessionAddress: { serverId: 'server-a', sessionId: 's2' },
        lastFocusedSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      }),
    ).toBe(false);
  });
});
