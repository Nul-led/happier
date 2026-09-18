import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildVoiceInitialContext = vi.fn(() => 'context');

vi.mock('@/voice/context/buildVoiceInitialContext', () => ({
  buildVoiceInitialContext: (
    sessionId: string,
    options?: Parameters<typeof import('@/voice/context/buildVoiceInitialContext').buildVoiceInitialContext>[1],
  ) => options === undefined
    ? Reflect.apply(buildVoiceInitialContext, undefined, [sessionId])
    : Reflect.apply(buildVoiceInitialContext, undefined, [sessionId, options]),
}));

import { resolveVoiceAgentInitialContexts } from './resolveVoiceAgentInitialContexts';

describe('resolveVoiceAgentInitialContexts', () => {
  beforeEach(() => {
    buildVoiceInitialContext.mockClear();
  });

  it('preserves the qualified target address when composing deferred context', () => {
    const targetSessionAddress = { serverId: 'home-b', sessionId: 'shared-session' } as const;

    resolveVoiceAgentInitialContexts('voice-carrier', { targetSessionAddress });

    expect(buildVoiceInitialContext).toHaveBeenNthCalledWith(1, 'voice-carrier');
    expect(buildVoiceInitialContext).toHaveBeenNthCalledWith(2, 'voice-carrier', {
      targetSessionAddress,
    });
  });
});
