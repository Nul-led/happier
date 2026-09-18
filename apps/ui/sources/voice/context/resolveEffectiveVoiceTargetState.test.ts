import { describe, expect, it, vi } from 'vitest';

describe('resolveEffectiveVoiceTargetState', () => {
  it('treats malformed attempt-local live-context state as empty instead of throwing', async () => {
    vi.resetModules();
    const { useVoiceTargetStore } = await import('@/voice/runtime/voiceTargetStore');
    const { resolveEffectiveVoiceTargetState } = await import('./resolveEffectiveVoiceTargetState');

    useVoiceTargetStore.setState({
      scope: 'global',
      primaryActionSessionAddress: null,
      voiceLiveContextSessionAddresses: null,
      lastFocusedSessionAddress: null,
    } as any);

    expect(
      resolveEffectiveVoiceTargetState({ serverId: 'server-a', sessionId: 's1' }, {
        targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      }),
    ).toEqual({
      primaryActionSessionAddress: { serverId: 'server-a', sessionId: 's1' },
      voiceLiveContextSessionAddresses: [{ serverId: 'server-a', sessionId: 's1' }],
    });
  });

  it('leaves the existing target state untouched when no canonical local-agent binding exists', async () => {
    vi.resetModules();
    vi.doMock('@/voice/context/resolveActiveLocalVoiceAgentBinding', () => ({
      resolveActiveLocalVoiceAgentBinding: () => null,
    }));
    const { useVoiceTargetStore } = await import('@/voice/runtime/voiceTargetStore');
    const { resolveEffectiveVoiceTargetState } = await import('./resolveEffectiveVoiceTargetState');

    useVoiceTargetStore.setState({
      scope: 'global',
      primaryActionSessionAddress: { serverId: 'server-a', sessionId: 'existing-session' },
      voiceLiveContextSessionAddresses: [{ serverId: 'server-a', sessionId: 'existing-session' }],
      lastFocusedSessionAddress: null,
    } as any);

    expect(resolveEffectiveVoiceTargetState('s1')).toEqual({
      primaryActionSessionAddress: { serverId: 'server-a', sessionId: 'existing-session' },
      voiceLiveContextSessionAddresses: [{ serverId: 'server-a', sessionId: 'existing-session' }],
    });
  });
});
