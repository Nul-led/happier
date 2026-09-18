import { beforeEach, describe, expect, it } from 'vitest';

let state: any;

function sessionRow(id: string, title: string, updatedAt: number) {
  return { id, title, updatedAt, active: true, presence: 'online', metadata: { summaryText: title } };
}

function corpus(coverage: 'complete' | 'incomplete' = 'complete') {
  return {
    state,
    options: {
      activeServerId: 'server-a',
      knownServerIds: ['server-a', 'server-b'],
      coverage,
    } as const,
  };
}

describe('resolveVoiceActionSessionReference', () => {
  beforeEach(() => {
    state = {
      sessions: {},
      concurrentSessionListCacheByServerId: {
        'server-a': { serverName: 'Home A' },
        'server-b': { serverName: 'Home B' },
      },
      ordinarySessionListMembershipByServerId: {
        'server-a': ['same'],
        'server-b': ['same'],
      },
      sessionListRowsByServerId: {
        'server-a': { same: sessionRow('same', 'Release prep', 2) },
        'server-b': { same: sessionRow('same', 'Release prep', 1) },
      },
    };
  });

  it('keeps equal ids and titles on two selected Homes ambiguous', async () => {
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    await expect(resolveVoiceActionSessionReference({ sessionTitle: 'Release prep' }, corpus())).resolves.toEqual({
      kind: 'ambiguous',
      candidates: [
        { serverId: 'server-a', sessionId: 'same' },
        { serverId: 'server-b', sessionId: 'same' },
      ],
    });
  });

  it('reports incomplete without mutating or fetching when supplied coverage is incomplete', async () => {
    const before = structuredClone(state);
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    await expect(resolveVoiceActionSessionReference({ sessionTitle: 'Release prep' }, corpus('incomplete')))
      .resolves.toEqual({ kind: 'incomplete' });
    expect(state).toEqual(before);
  });

  it('resolves a result beyond the former 20-by-100 cap from the authoritative corpus', async () => {
    const rows = Object.fromEntries(Array.from({ length: 2_101 }, (_, index) => {
      const id = `session-${index}`;
      return [id, sessionRow(id, index === 2_100 ? 'Deep result' : `Other ${index}`, index)];
    }));
    state.concurrentSessionListCacheByServerId = { 'server-a': { serverName: 'Home A' } };
    state.ordinarySessionListMembershipByServerId = { 'server-a': Object.keys(rows) };
    state.sessionListRowsByServerId = { 'server-a': rows };
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    await expect(resolveVoiceActionSessionReference(
      { sessionTitle: 'Deep result', serverId: 'server-a' },
      { state, options: { activeServerId: 'server-a', knownServerIds: ['server-a'], coverage: 'complete' } },
    ))
      .resolves.toEqual({
        kind: 'unique',
        address: { serverId: 'server-a', sessionId: 'session-2100' },
      });
  });

  it('does not read active Home focus while resolving a supplied corpus', async () => {
    state.ordinarySessionListMembershipByServerId['server-b'] = ['other'];
    state.sessionListRowsByServerId['server-b'] = { other: sessionRow('other', 'Other', 1) };
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    const first = await resolveVoiceActionSessionReference({ sessionTitle: 'Release prep' }, corpus());
    const second = await resolveVoiceActionSessionReference({ sessionTitle: 'Release prep' }, corpus());

    expect(first).toEqual({ kind: 'unique', address: { serverId: 'server-a', sessionId: 'same' } });
    expect(second).toEqual(first);
  });

  it('preserves an explicit qualified reference without consulting corpus completeness', async () => {
    state.concurrentSessionListCacheByServerId = {};
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    await expect(resolveVoiceActionSessionReference({ sessionId: 'same', serverId: 'server-b' })).resolves.toEqual({
      kind: 'unique',
      address: { serverId: 'server-b', sessionId: 'same' },
    });
  });

  it('reports none for a missing title only after supplied coverage is complete', async () => {
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    await expect(resolveVoiceActionSessionReference({ sessionTitle: 'Missing' }, corpus()))
      .resolves.toEqual({ kind: 'none' });
  });

  it('uses only the mounted corpus addresses rather than every hydrated cache row', async () => {
    state.sessionListRowsByServerId['server-a'].other = sessionRow('other', 'Release prep', 3);
    state.ordinarySessionListMembershipByServerId['server-a'] = ['same', 'other'];
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    await expect(resolveVoiceActionSessionReference(
      { sessionTitle: 'Release prep' },
      {
        state,
        options: {
          knownServerIds: ['server-a'],
          addresses: [{ serverId: 'server-a', sessionId: 'same' }],
          coverage: 'complete',
        },
      },
    )).resolves.toEqual({
      kind: 'unique',
      address: { serverId: 'server-a', sessionId: 'same' },
    });
  });

  it('reports incomplete for a natural reference when no corpus owner is supplied', async () => {
    const { resolveVoiceActionSessionReference } = await import('./resolveVoiceActionSessionReference');

    await expect(resolveVoiceActionSessionReference({ sessionTitle: 'Release prep' }))
      .resolves.toEqual({ kind: 'incomplete' });
  });
});
