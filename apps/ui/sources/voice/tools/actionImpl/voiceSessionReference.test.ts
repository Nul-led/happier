import { describe, expect, it } from 'vitest';

import { resolveVoiceSessionReference } from './sessionReference';

/**
 * Two Homes that both expose a `release-prep` Session, one of them sharing the
 * exact same Home-local Session ID. Bare-ID and exact-title lookups must both
 * refuse to guess a Home.
 */
const TWO_HOME_STATE = {
  concurrentSessionListCacheByServerId: {
    'server-a': { serverName: 'Acme' },
    'server-b': { serverName: 'Globex' },
  },
  ordinarySessionListMembershipByServerId: {
    'server-a': ['shared_id'],
    'server-b': ['shared_id'],
  },
  sessionListRowsByServerId: {
    'server-a': {
      shared_id: {
        id: 'shared_id',
        updatedAt: 40,
        active: true,
        presence: 'online',
        metadata: { summaryText: 'Release prep', path: '/Users/alice/acme' },
      },
    },
    'server-b': {
      shared_id: {
        id: 'shared_id',
        updatedAt: 30,
        active: false,
        presence: 'offline',
        metadata: { summaryText: 'Release prep', path: '/Users/alice/globex' },
      },
    },
  },
} as const;

const KNOWN_TWO_HOMES = ['server-a', 'server-b'] as const;

describe('resolveVoiceSessionReference — qualified Voice discovery', () => {
  it('refuses to pick a Home for one Session ID present on two Homes', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionId: 'shared_id' },
      TWO_HOME_STATE,
      { knownServerIds: KNOWN_TWO_HOMES, coverage: 'complete' },
    );

    expect(resolution.kind).toBe('ambiguous');
    expect(resolution.kind === 'ambiguous' && resolution.candidates.map((c) => c.address)).toEqual([
      { serverId: 'server-a', sessionId: 'shared_id' },
      { serverId: 'server-b', sessionId: 'shared_id' },
    ]);
  });

  it('refuses to pick a Home for one title present on two Homes', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionTitle: 'Release prep' },
      TWO_HOME_STATE,
      { knownServerIds: KNOWN_TWO_HOMES, coverage: 'complete' },
    );

    expect(resolution.kind).toBe('ambiguous');
    expect(resolution.kind === 'ambiguous' && resolution.candidates.map((c) => c.address.serverId))
      .toEqual(['server-a', 'server-b']);
  });

  it('refuses to pick between duplicate titles inside one Home', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionTitle: 'Release prep' },
      {
        concurrentSessionListCacheByServerId: { 'server-a': { serverName: 'Acme' } },
        ordinarySessionListMembershipByServerId: { 'server-a': ['first', 'second'] },
        sessionListRowsByServerId: {
          'server-a': {
            first: { id: 'first', updatedAt: 40, metadata: { summaryText: 'Release prep' } },
            second: { id: 'second', updatedAt: 10, metadata: { summaryText: 'Release prep' } },
          },
        },
      },
      { knownServerIds: ['server-a'], coverage: 'complete' },
    );

    expect(resolution.kind).toBe('ambiguous');
    expect(resolution.kind === 'ambiguous' && resolution.candidates.map((c) => c.address.sessionId))
      .toEqual(['first', 'second']);
  });

  it('reports incomplete rather than unique while a known Home contributed no corpus', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionTitle: 'Release prep' },
      {
        concurrentSessionListCacheByServerId: { 'server-a': { serverName: 'Acme' } },
        ordinarySessionListMembershipByServerId: { 'server-a': ['only'] },
        sessionListRowsByServerId: {
          'server-a': { only: { id: 'only', updatedAt: 40, metadata: { summaryText: 'Release prep' } } },
        },
      },
      // `server-b` is a known Home whose corpus is unavailable in local state.
      { knownServerIds: ['server-a', 'server-b'], coverage: 'incomplete' },
    );

    expect(resolution.kind).toBe('incomplete');
  });

  it('reports incomplete rather than none when nothing matched and coverage is partial', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionTitle: 'Nowhere' },
      TWO_HOME_STATE,
      { knownServerIds: [...KNOWN_TWO_HOMES, 'server-c'], coverage: 'incomplete' },
    );

    expect(resolution.kind).toBe('incomplete');
  });

  it('resolves an exact qualified selection without enumerating any Home', () => {
    const resolution = resolveVoiceSessionReference(
      { serverId: 'server-b', sessionId: 'shared_id' },
      // No corpus at all: an exact qualified selection is self-sufficient.
      {},
      { knownServerIds: KNOWN_TWO_HOMES, coverage: 'incomplete' },
    );

    expect(resolution).toEqual({
      kind: 'unique',
      address: { serverId: 'server-b', sessionId: 'shared_id' },
      candidate: {
        address: { serverId: 'server-b', sessionId: 'shared_id' },
        id: 'shared_id',
        serverId: 'server-b',
      },
    });
  });

  it('resolves a unique title when every known Home contributed its corpus', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionTitle: 'Release prep.' },
      TWO_HOME_STATE,
      { knownServerIds: ['server-a'], coverage: 'complete' },
    );

    // Only `server-a` is known here, so `server-b` rows are outside the corpus.
    expect(resolution.kind).toBe('unique');
    expect(resolution.kind === 'unique' && resolution.address)
      .toEqual({ serverId: 'server-a', sessionId: 'shared_id' });
  });

  it('reports none for an unmatched reference under complete coverage', () => {
    expect(resolveVoiceSessionReference(
      { sessionTitle: 'Nowhere' },
      TWO_HOME_STATE,
      { knownServerIds: KNOWN_TWO_HOMES, coverage: 'complete' },
    )).toEqual({ kind: 'none' });

    expect(resolveVoiceSessionReference(
      { sessionId: 'missing_id' },
      TWO_HOME_STATE,
      { knownServerIds: KNOWN_TWO_HOMES, coverage: 'complete' },
    )).toEqual({ kind: 'none' });
  });

  it('qualifies an unqualified active-Home session through the explicit active Home', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionId: 'local_only' },
      {
        sessions: {
          local_only: { id: 'local_only', updatedAt: 5, metadata: { summaryText: 'Local' } },
        },
      },
      { activeServerId: 'server-a', knownServerIds: ['server-a'], coverage: 'complete' },
    );

    expect(resolution.kind).toBe('unique');
    expect(resolution.kind === 'unique' && resolution.address)
      .toEqual({ serverId: 'server-a', sessionId: 'local_only' });
  });

  it('cannot qualify a session when no active Home is known', () => {
    const resolution = resolveVoiceSessionReference(
      { sessionId: 'local_only' },
      {
        sessions: {
          local_only: { id: 'local_only', updatedAt: 5, metadata: { summaryText: 'Local' } },
        },
      },
      { knownServerIds: ['server-a'], coverage: 'incomplete' },
    );

    expect(resolution.kind).toBe('incomplete');
  });

  it('returns none without a session id or title', () => {
    expect(resolveVoiceSessionReference({}, TWO_HOME_STATE, { knownServerIds: KNOWN_TWO_HOMES, coverage: 'complete' }))
      .toEqual({ kind: 'none' });
  });
});
