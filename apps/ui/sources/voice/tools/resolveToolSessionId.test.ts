import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storage } from '@/sync/domains/state/storage';
import { useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { resolveToolSessionAddress, resolveToolSessionId } from './resolveToolSessionId';

describe('resolveToolSessionId', () => {
  let previousVoiceState: ReturnType<typeof useVoiceTargetStore.getState>;
  beforeEach(() => {
    previousVoiceState = useVoiceTargetStore.getState();
    useVoiceTargetStore.setState(useVoiceTargetStore.getInitialState(), true);
  });
  afterEach(() => {
    useVoiceTargetStore.setState(previousVoiceState, true);
  });
  it('rejects an explicit bare id shared by two Homes instead of borrowing the current Home', async () => {
    const previous = storage.getState();
    storage.setState({
      sessions: {},
      sessionListRowsByServerId: {
        'home-a': { same: { id: 'same', metadata: { summaryText: 'A' } } },
        'home-b': { same: { id: 'same', metadata: { summaryText: 'B' } } },
      },
      ordinarySessionListMembershipByServerId: { 'home-a': ['same'], 'home-b': ['same'] },
      sessionListIndexByServerId: {},
      concurrentSessionListCacheByServerId: {
        'home-a': { serverName: 'A' },
        'home-b': { serverName: 'B' },
      },
    } as never);
    try {
      expect(await resolveToolSessionAddress({ explicitSessionId: 'same', currentSessionId: 'other', currentServerId: 'home-a' })).toBeNull();
      expect(await resolveToolSessionAddress({ explicitSessionId: 'same', explicitServerId: 'home-b', currentServerId: 'home-a' }))
        .toEqual({ serverId: 'home-b', sessionId: 'same' });
      storage.setState((state) => ({
        sessionListRowsByServerId: { 'home-a': state.sessionListRowsByServerId['home-a'] },
        ordinarySessionListMembershipByServerId: { 'home-a': ['same'] },
        concurrentSessionListCacheByServerId: { 'home-a': state.concurrentSessionListCacheByServerId['home-a'] },
      }));
      expect(await resolveToolSessionAddress({ explicitSessionId: 'same', currentServerId: 'home-a' })).toBeNull();
    } finally {
      storage.setState(previous);
    }
  });
  it('prefers explicit sessionId', async () => {
    useVoiceTargetStore.setState({
      scope: 'global',
      primaryActionSessionAddress: { serverId: 'home', sessionId: 's_global' },
    });
    expect(await resolveToolSessionId({
      explicitSessionId: 's_explicit',
      explicitServerId: 'home',
      currentSessionId: 's_current',
      currentServerId: 'home',
    })).toBe('s_explicit');
  });

  it('prefers currentSessionId over a stale global primaryActionSessionId when scope is global', async () => {
    useVoiceTargetStore.setState({
      scope: 'global',
      primaryActionSessionAddress: { serverId: 'home', sessionId: 's_global' },
    });
    expect(await resolveToolSessionId({ explicitSessionId: null, currentSessionId: 's_current', currentServerId: 'home' })).toBe('s_current');
  });

  it('falls back to currentSessionId when scope is global but no target is set', async () => {
    useVoiceTargetStore.setState({ scope: 'global', primaryActionSessionAddress: null, lastFocusedSessionAddress: null });
    expect(await resolveToolSessionId({ explicitSessionId: null, currentSessionId: 's_current', currentServerId: 'home' })).toBe('s_current');
  });

  it('falls back to lastFocusedSessionId when scope is global and no explicit/current target is set', async () => {
    useVoiceTargetStore.setState({
      scope: 'global',
      primaryActionSessionAddress: null,
      lastFocusedSessionAddress: { serverId: 'home', sessionId: 's_last' },
    });
    expect(await resolveToolSessionId({ explicitSessionId: null, currentSessionId: null })).toBe('s_last');
  });

  it('uses currentSessionId when scope is session', async () => {
    useVoiceTargetStore.setState({
      scope: 'session',
      primaryActionSessionAddress: { serverId: 'home', sessionId: 's_global' },
      lastFocusedSessionAddress: { serverId: 'home', sessionId: 's_last' },
    });
    expect(await resolveToolSessionId({ explicitSessionId: null, currentSessionId: 's_current', currentServerId: 'home' })).toBe('s_current');
  });

  it('trims stored global target ids before falling back to them', async () => {
    useVoiceTargetStore.setState({
      scope: 'global',
      primaryActionSessionAddress: { serverId: ' home ', sessionId: ' s_primary ' },
      lastFocusedSessionAddress: { serverId: ' home ', sessionId: ' s_last ' },
    });
    expect(await resolveToolSessionId({ explicitSessionId: null, currentSessionId: null })).toBe('s_primary');
  });
});
