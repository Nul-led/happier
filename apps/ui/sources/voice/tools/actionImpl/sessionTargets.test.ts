import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installVoiceToolActionImplCommonModuleMocks } from './voiceToolActionImplTestHelpers';

const syncTargetSession = vi.fn();
const sessionFollowGet = vi.fn();
const sessionFollowSet = vi.fn();
const replaceSessionVoiceInclusions = vi.fn();
let state: any = {
  sessions: {
    s1: { id: 's1', serverId: 'server-a', metadata: { summary: { text: 'Primary session' } } },
    s2: { id: 's2', serverId: 'server-a', metadata: { summary: { text: 'Tracked session' } } },
    s3: { id: 's3', serverId: 'server-a', metadata: { summary: { text: 'Session Setup' } } },
    s4: { id: 's4', serverId: 'server-a', metadata: { name: 'leeroy' }, updatedAt: 10 },
  },
  sessionListRowsByServerId: {
    'server-a': {
      s4: {
        id: 's4',
        updatedAt: 10,
        metadata: { summaryText: 'Session QA Voice Matrix' },
      },
    },
  },
  ordinarySessionListMembershipByServerId: {
    'server-a': ['s4'],
  },
  sessionListIndexByServerId: {
    'server-a': [
      { type: 'session', sessionId: 's4', serverId: 'server-a', serverName: 'Server A' },
    ],
  },
  concurrentSessionListCacheByServerId: {},
};

vi.mock('@/voice/binding/voiceConversationBindingRuntime', () => ({
  voiceSessionBindingManager: {
    syncTargetSession: (params: any) => syncTargetSession(params),
  },
}));

vi.mock('@/sync/api/session/sessionFollowApi', () => ({
  sessionFollowGet: (address: unknown) => sessionFollowGet(address),
  sessionFollowSet: (address: unknown, preferences: unknown) => sessionFollowSet(address, preferences),
  replaceSessionVoiceInclusions: (serverId: string, sessionIds: readonly string[]) => replaceSessionVoiceInclusions(serverId, sessionIds),
}));

installVoiceToolActionImplCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            storage: {
                getState: () => state,
            } as typeof import('@/sync/domains/state/storage').storage,
        });
    },
});

describe('voice session target actions', () => {
  beforeEach(async () => {
    vi.resetModules();
    syncTargetSession.mockReset();
    sessionFollowGet.mockReset();
    sessionFollowSet.mockReset();
    replaceSessionVoiceInclusions.mockReset();
    replaceSessionVoiceInclusions.mockResolvedValue({ kind: 'ok', value: { changed: true, sessionIds: [] } });
    sessionFollowGet.mockResolvedValue({
      kind: 'ok',
      value: { follow: null, isSessionOwner: false, capabilities: { manageFollow: true } },
    });
    sessionFollowSet.mockImplementation(async (address: { sessionId: string }, preferences: {
      notificationLevel: 'none' | 'important' | 'all_messages';
      includeInVoice: boolean;
    }) => ({
      kind: 'ok',
      value: {
        changed: true,
        follow: { sessionId: address.sessionId, following: true, ...preferences },
      },
    }));
    const { useVoiceTargetStore } = await import('@/voice/runtime/voiceTargetStore');
    useVoiceTargetStore.getState().setVoiceLiveContextSessionAddresses([]);
  });

  it('syncs the hidden voice conversation target when the primary action session changes', async () => {
    const { setPrimaryActionSessionId } = await import('./sessionTargets');

    const result = await setPrimaryActionSessionId({ sessionId: 's2', serverId: 'server-a' });

    expect(syncTargetSession).toHaveBeenCalledWith({
      controlSessionId: '__voice_agent__',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's2' },
    });
    expect(result).toMatchObject({
      ok: true,
      sessionId: 's2',
      session: {
        id: 's2',
        title: 'Tracked session',
      },
    });
  });

  it('returns tracked session labels using the normalized stored ordering', async () => {
    const { setTrackedSessionIds } = await import('./sessionTargets');

    const result = await setTrackedSessionIds({
      sessionIds: ['s2', ' s1 ', 's2'],
      serverId: 'server-a',
      corpus: {
        knownServerIds: ['server-a'],
        addresses: [
          { serverId: 'server-a', sessionId: 's1' },
          { serverId: 'server-a', sessionId: 's2' },
        ],
        coverage: 'complete',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      sessionIds: ['s1', 's2'],
      sessions: [
        { id: 's1', title: 'Primary session' },
        { id: 's2', title: 'Tracked session' },
      ],
    });
  });

  it('adapts the released tracked-set action to qualified Account Follow Include in Voice preferences', async () => {
    const previousState = state;
    state = {
      ...previousState,
      sessionListRowsByServerId: {
        ...previousState.sessionListRowsByServerId,
        'server-a': {
          ...previousState.sessionListRowsByServerId['server-a'],
          s1: {
            ...previousState.sessions.s1,
            viewer: {
              follow: { follows: true, notificationLevel: 'important', includeInVoice: true },
            },
          },
        },
      },
    };
    sessionFollowGet.mockImplementation(async (address: { serverId: string; sessionId: string }) => ({
      kind: 'ok',
      value: {
        follow: address.sessionId === 's1'
          ? { sessionId: 's1', following: true, notificationLevel: 'important', includeInVoice: true }
          : null,
        isSessionOwner: false,
        capabilities: { manageFollow: true },
      },
    }));
    try {
      const { setTrackedSessionIds } = await import('./sessionTargets');

      const result = await setTrackedSessionIds({
        sessionIds: ['s2'],
        serverId: 'server-a',
        corpus: {
          knownServerIds: ['server-a'],
          addresses: [
            { serverId: 'server-a', sessionId: 's1' },
            { serverId: 'server-a', sessionId: 's2' },
          ],
          coverage: 'complete',
        },
      });

      expect(result).toMatchObject({ ok: true, sessionAddresses: [{ serverId: 'server-a', sessionId: 's2' }] });
      expect(replaceSessionVoiceInclusions).toHaveBeenCalledWith('server-a', ['s2']);
    } finally {
      state = previousState;
    }
  });

  it('replaces the synchronized Include in Voice set after an attempt-local restart', async () => {
    const previousState = state;
    state = {
      ...previousState,
      sessionListRowsByServerId: {
        ...previousState.sessionListRowsByServerId,
        'server-a': {
          ...previousState.sessionListRowsByServerId['server-a'],
          s1: {
            ...previousState.sessions.s1,
            viewer: {
              follow: { follows: true, notificationLevel: 'all_messages', includeInVoice: true },
            },
          },
        },
      },
    };
    sessionFollowGet.mockImplementation(async (address: { sessionId: string }) => ({
      kind: 'ok',
      value: {
        follow: address.sessionId === 's1'
          ? { sessionId: 's1', following: true, notificationLevel: 'all_messages', includeInVoice: true }
          : null,
        isSessionOwner: false,
        capabilities: { manageFollow: true },
      },
    }));
    try {
      const { useVoiceTargetStore } = await import('@/voice/runtime/voiceTargetStore');
      const { setTrackedSessionIds } = await import('./sessionTargets');
      expect(useVoiceTargetStore.getState().voiceLiveContextSessionAddresses).toEqual([]);

      await expect(setTrackedSessionIds({
        sessionIds: [],
        serverId: 'server-a',
        corpus: {
          knownServerIds: ['server-a'],
          addresses: [{ serverId: 'server-a', sessionId: 's1' }],
          coverage: 'complete',
        },
      }))
        .resolves.toMatchObject({ ok: true, sessionAddresses: [] });
      expect(replaceSessionVoiceInclusions).toHaveBeenCalledWith('server-a', []);
    } finally {
      state = previousState;
    }
  });

  it('clears omitted Homes when replacing the complete global Include in Voice set', async () => {
    const previousState = state;
    state = {
      ...previousState,
      sessionListRowsByServerId: {
        'home-a': {
          a: { id: 'a', serverId: 'home-a', viewer: { follow: { includeInVoice: true } } },
        },
        'home-b': {
          b: { id: 'b', serverId: 'home-b', viewer: { follow: { includeInVoice: true } } },
        },
      },
      ordinarySessionListMembershipByServerId: {
        'home-a': ['a'],
        'home-b': ['b'],
      },
    };
    try {
      const { setTrackedSessionIds } = await import('./sessionTargets');
      const result = await setTrackedSessionIds({
        sessionAddresses: [{ serverId: 'home-a', sessionId: 'a' }],
        corpus: {
          knownServerIds: ['home-a', 'home-b'],
          addresses: [
            { serverId: 'home-a', sessionId: 'a' },
            { serverId: 'home-b', sessionId: 'b' },
          ],
          coverage: 'complete',
        },
      });

      expect(result).toMatchObject({
        ok: true,
        sessionAddresses: [{ serverId: 'home-a', sessionId: 'a' }],
      });
      const { useVoiceTargetStore } = await import('@/voice/runtime/voiceTargetStore');
      expect(useVoiceTargetStore.getState().voiceLiveContextSessionAddresses).toEqual([
        { serverId: 'home-a', sessionId: 'a' },
      ]);
      expect(replaceSessionVoiceInclusions.mock.calls).toEqual([
        ['home-a', ['a']],
        ['home-b', []],
      ]);
    } finally {
      state = previousState;
    }
  });

  it('clears every authoritatively known Home for an empty global replacement', async () => {
    const previousState = state;
    state = {
      ...previousState,
      sessionListRowsByServerId: {
        'home-a': {
          a: { id: 'a', serverId: 'home-a', viewer: { follow: { includeInVoice: true } } },
        },
        'home-b': {
          b: { id: 'b', serverId: 'home-b', viewer: { follow: { includeInVoice: true } } },
        },
      },
      ordinarySessionListMembershipByServerId: {
        'home-a': ['a'],
        'home-b': ['b'],
      },
    };
    try {
      const { setTrackedSessionIds } = await import('./sessionTargets');
      await expect(setTrackedSessionIds({
        sessionAddresses: [],
        corpus: {
          knownServerIds: ['home-a', 'home-b'],
          addresses: [
            { serverId: 'home-a', sessionId: 'a' },
            { serverId: 'home-b', sessionId: 'b' },
          ],
          coverage: 'complete',
        },
      })).resolves.toMatchObject({ ok: true, sessionAddresses: [] });
      expect(replaceSessionVoiceInclusions.mock.calls).toEqual([
        ['home-a', []],
        ['home-b', []],
      ]);
    } finally {
      state = previousState;
    }
  });

  it('refuses global replacement when current Include in Voice coverage is incomplete', async () => {
    const { setTrackedSessionIds } = await import('./sessionTargets');

    await expect(setTrackedSessionIds({
      sessionAddresses: [{ serverId: 'server-a', sessionId: 's1' }],
      corpus: {
        knownServerIds: ['server-a', 'server-b'],
        addresses: [{ serverId: 'server-a', sessionId: 's1' }],
        coverage: 'incomplete',
      },
    })).resolves.toMatchObject({
      ok: false,
      status: 'incomplete',
      error: { code: 'session_lookup_incomplete' },
    });
    expect(replaceSessionVoiceInclusions).not.toHaveBeenCalled();
  });

  it('keeps equal Session ids on different Homes distinct in the compatibility adapter', async () => {
    const { setTrackedSessionIds } = await import('./sessionTargets');

    const result = await setTrackedSessionIds({
      sessionAddresses: [
        { serverId: 'server-a', sessionId: 'same' },
        { serverId: 'server-b', sessionId: 'same' },
      ],
      corpus: {
        knownServerIds: ['server-a', 'server-b'],
        addresses: [
          { serverId: 'server-a', sessionId: 'same' },
          { serverId: 'server-b', sessionId: 'same' },
        ],
        coverage: 'complete',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      sessionAddresses: [
        { serverId: 'server-a', sessionId: 'same' },
        { serverId: 'server-b', sessionId: 'same' },
      ],
    });
    expect(replaceSessionVoiceInclusions.mock.calls).toEqual([
      ['server-a', ['same']],
      ['server-b', ['same']],
    ]);
  });

  it('fails released bare ids closed when the id exists on multiple Homes', async () => {
    const previousState = state;
    state = {
      ...previousState,
      ordinarySessionListMembershipByServerId: {
        'server-a': ['same'],
        'server-b': ['same'],
      },
    };
    try {
      const { setTrackedSessionIds } = await import('./sessionTargets');
      await expect(setTrackedSessionIds({ sessionIds: ['same'] })).resolves.toMatchObject({
        ok: false,
        status: 'ambiguous',
        error: { code: 'session_ambiguous', sessionId: 'same' },
      });
      expect(replaceSessionVoiceInclusions).not.toHaveBeenCalled();
    } finally {
      state = previousState;
    }
  });

  it('does not publish a transient target projection when the durable Follow mutation fails', async () => {
    replaceSessionVoiceInclusions.mockResolvedValue({ kind: 'failed', error: 'unavailable' });
    const { useVoiceTargetStore } = await import('@/voice/runtime/voiceTargetStore');
    const { setTrackedSessionIds } = await import('./sessionTargets');

    const result = await setTrackedSessionIds({
      sessionIds: ['s2'],
      serverId: 'server-a',
      corpus: {
        knownServerIds: ['server-a'],
        addresses: [{ serverId: 'server-a', sessionId: 's2' }],
        coverage: 'complete',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'unavailable',
      error: { code: 'session_follow_unavailable' },
    });
    expect(useVoiceTargetStore.getState().voiceLiveContextSessionAddresses).toEqual([]);
  });

  // Per-Home replacement is atomic; partial per-Session recovery is no longer a client concern.
  it('resolves the primary action session by human title without storing sentence punctuation', async () => {
    const { setPrimaryActionSessionId } = await import('./sessionTargets');

    const result = await setPrimaryActionSessionId({
      sessionId: null,
      sessionTitle: 'Session Setup.',
      corpus: { activeServerId: 'server-a', knownServerIds: ['server-a'], coverage: 'complete' },
    });

    expect(syncTargetSession).toHaveBeenCalledWith({
      controlSessionId: '__voice_agent__',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's3' },
    });
    expect(result).toMatchObject({
      ok: true,
      sessionId: 's3',
      session: {
        id: 's3',
        title: 'Session Setup',
      },
    });
  });

  it('prefers the visible session title over a stale raw session title for the same session id', async () => {
    const { setPrimaryActionSessionId } = await import('./sessionTargets');

    const result = await setPrimaryActionSessionId({
      sessionId: null,
      sessionTitle: 'Session QA Voice Matrix',
      corpus: { activeServerId: 'server-a', knownServerIds: ['server-a'], coverage: 'complete' },
    });

    expect(syncTargetSession).toHaveBeenCalledWith({
      controlSessionId: '__voice_agent__',
      targetSessionAddress: { serverId: 'server-a', sessionId: 's4' },
    });
    expect(result).toMatchObject({
      ok: true,
      sessionId: 's4',
      session: {
        id: 's4',
        title: 'Session QA Voice Matrix',
      },
    });
  });

  it('returns the visible lookup title when a stale raw title normalizes to the same lookup text', async () => {
    const previousState = state;
    state = {
      ...previousState,
      sessions: {
        ...previousState.sessions,
        s4: {
          id: 's4',
          metadata: { summaryText: 'Session QA Voice Matrix!' },
          updatedAt: 10,
        },
      },
      sessionListRowsByServerId: {
        ...previousState.sessionListRowsByServerId,
        'server-a': {
          ...previousState.sessionListRowsByServerId['server-a'],
          s4: {
            id: 's4',
            updatedAt: 10,
            metadata: { summaryText: 'Session QA Voice Matrix' },
          },
        },
      },
    };

    try {
      const { setPrimaryActionSessionId } = await import('./sessionTargets');

      const result = await setPrimaryActionSessionId({
        sessionId: null,
        sessionTitle: 'Session QA Voice Matrix',
        corpus: { activeServerId: 'server-a', knownServerIds: ['server-a'], coverage: 'complete' },
      });

      expect(syncTargetSession).toHaveBeenCalledWith({
        controlSessionId: '__voice_agent__',
        targetSessionAddress: { serverId: 'server-a', sessionId: 's4' },
      });
      expect(result).toMatchObject({
        ok: true,
        sessionId: 's4',
        session: {
          id: 's4',
          title: 'Session QA Voice Matrix',
        },
      });
    } finally {
      state = previousState;
    }
  });
});
