import { describe, expect, it } from 'vitest';

import {
  resolveVoiceSessionRef,
  resolveVoiceSessionReferenceFromTitle,
} from './sessionReference';

describe('resolveVoiceSessionRef', () => {
  it('prefers the visible lookup session metadata over stale raw metadata for the same session id', () => {
    const result = resolveVoiceSessionRef('s_matrix', {
      sessions: {
        s_matrix: {
          id: 's_matrix',
          metadata: {
            summaryText: 'Session QA Voice Matrix!',
            path: '/Users/alice/project-alpha',
          },
        },
      },
      sessionListRowsByServerId: {
        'server-a': {
          s_matrix: {
            id: 's_matrix',
            updatedAt: 42,
            metadata: {
              summaryText: 'Session QA Voice Matrix',
              path: '/Users/alice/project-alpha',
            },
          },
        },
      },
      ordinarySessionListMembershipByServerId: { 'server-a': ['s_matrix'] },
      sessionListIndexByServerId: {
        'server-a': [
          { type: 'session', sessionId: 's_matrix', serverId: 'server-a', serverName: 'Server A' },
        ],
      },
      concurrentSessionListCacheByServerId: {},
    }, { activeServerId: 'server-a' });

    expect(result).toEqual({
      address: { serverId: 'server-a', sessionId: 's_matrix' },
      id: 's_matrix',
      title: 'Session QA Voice Matrix',
      locationLabel: 'project-alpha',
      serverId: 'server-a',
      serverName: 'Server A',
    });
  });

  it('returns both same-Home duplicate-title candidates instead of selecting the first', () => {
    const resolution = resolveVoiceSessionReferenceFromTitle('Build release', {
      sessionListRowsByServerId: {
        home: {
          one: { id: 'one', updatedAt: 2, metadata: { summaryText: 'Build release' } },
          two: { id: 'two', updatedAt: 1, metadata: { summaryText: 'Build release.' } },
        },
      },
      ordinarySessionListMembershipByServerId: { home: ['one', 'two'] },
      concurrentSessionListCacheByServerId: {
        home: {
          serverName: 'Home',
        },
      },
    }, { coverage: 'complete' });

    expect(resolution).toEqual({
      kind: 'ambiguous',
      candidates: [
        expect.objectContaining({ address: { serverId: 'home', sessionId: 'one' } }),
        expect.objectContaining({ address: { serverId: 'home', sessionId: 'two' } }),
      ],
    });
  });

  it('returns cross-Home duplicate-title candidates even when Session ids are equal', () => {
    const resolution = resolveVoiceSessionReferenceFromTitle('Deploy', {
      sessionListRowsByServerId: {
        'home-a': { same: { id: 'same', updatedAt: 2, metadata: { summaryText: 'Deploy' } } },
        'home-b': { same: { id: 'same', updatedAt: 1, metadata: { summaryText: 'Deploy' } } },
      },
      ordinarySessionListMembershipByServerId: {
        'home-a': ['same'],
        'home-b': ['same'],
      },
      concurrentSessionListCacheByServerId: {
        'home-a': {
          serverName: 'A',
        },
        'home-b': {
          serverName: 'B',
        },
      },
    }, { coverage: 'complete' });

    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind !== 'ambiguous') throw new Error('expected ambiguity');
    expect(resolution.candidates.map((candidate) => candidate.address)).toEqual([
      { serverId: 'home-a', sessionId: 'same' },
      { serverId: 'home-b', sessionId: 'same' },
    ]);
  });

  it('does not claim unique or none while selected-Home coverage is incomplete', () => {
    const state = {
      sessionListRowsByServerId: {
        home: { one: { id: 'one', updatedAt: 1, metadata: { summaryText: 'Unique here' } } },
      },
      ordinarySessionListMembershipByServerId: { home: ['one'] },
      concurrentSessionListCacheByServerId: {
        home: {
          serverName: 'Home',
        },
      },
    };
    expect(resolveVoiceSessionReferenceFromTitle('Unique here', state, { coverage: 'incomplete' }))
      .toEqual({ kind: 'incomplete' });
    expect(resolveVoiceSessionReferenceFromTitle('Missing', state, { coverage: 'incomplete' }))
      .toEqual({ kind: 'incomplete' });
  });

  it('returns an exact qualified address only after complete coverage', () => {
    const resolution = resolveVoiceSessionReferenceFromTitle('Unique', {
      sessionListRowsByServerId: {
        home: { one: { id: 'one', updatedAt: 1, metadata: { summaryText: 'Unique' } } },
      },
      ordinarySessionListMembershipByServerId: { home: ['one'] },
      concurrentSessionListCacheByServerId: {
        home: {
          serverName: 'Home',
        },
      },
    }, { coverage: 'complete' });
    expect(resolution).toEqual({
      kind: 'unique',
      address: { serverId: 'home', sessionId: 'one' },
      candidate: expect.objectContaining({
        address: { serverId: 'home', sessionId: 'one' },
        title: 'Unique',
      }),
    });
  });
});
