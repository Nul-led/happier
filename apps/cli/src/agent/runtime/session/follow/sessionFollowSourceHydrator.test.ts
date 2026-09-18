import {
  isSessionAwarenessContentReadableV1,
  SessionFollowUpdateEnvelopeV1Schema,
} from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import { encryptSessionPayload } from '@/session/transport/encryption/sessionEncryptionContext';
import { createSessionFollowSourceHydrator } from './sessionFollowSourceHydrator';

const observation = {
  sourceSessionId: 'source',
  destinationSessionId: 'destination',
  delivered: { transcriptSeq: 1, readyEventSeq: 0, agentStateVersion: 0, turn: null },
  observed: { transcriptSeq: 3, readyEventSeq: 0, agentStateVersion: 0, turn: null },
};

const awareness = {
  v: 1,
  sessionId: 'source',
  lifecycle: 'ready' as const,
  runtime: 'idle' as const,
  freshness: 'live' as const,
  operational: { primary: 'ready' as const, reasons: ['ready' as const] },
  encryption: 'plain' as const,
  availability: 'complete' as const,
};

const destinationSession = {
  sessionId: 'destination',
  runSessionFollowSourceRequest: <T>(input: Readonly<{ request: () => T }>): T => input.request(),
};

describe('Session Follow source hydrator', () => {
  it('hydrates a restricted Runner from the dedicated projection and omits a null author label', async () => {
    const sourceDataKey = new Uint8Array(32).fill(17);
    const encryptedContent = encryptSessionPayload({
      ctx: { encryptionKey: sourceDataKey, encryptionVariant: 'dataKey' },
      payload: { role: 'user', content: { type: 'text', text: 'dedicated projection' } },
    });
    // A real E2EE source carries metadata sealed with the same Session key the
    // preparer delivered. Without it the awareness projection reports the source
    // unreadable and the canonical envelope contract forbids summaries entirely,
    // so an empty fixture cannot exercise the hydrated-content path at all.
    const sourceMetadata = encryptSessionPayload({
      ctx: { encryptionKey: sourceDataKey, encryptionVariant: 'dataKey' },
      payload: { path: '/workspace/source', host: 'source-host' },
    });
    const fetchRunnerSourceProjection = vi.fn(async () => ({
      v: 1 as const,
      source: {
        id: 'source', encryptionMode: 'e2ee' as const, metadata: sourceMetadata, metadataLayoutVersion: 0,
        archivedAt: null, createdAt: 1, updatedAt: 2, active: true, activeAt: 2,
        thinking: false, thinkingAt: null, latestTurnStatus: null, latestTurnStatusObservedAt: null,
        latestReadyEventSeq: null, latestReadyEventAt: null, meaningfulActivityAt: null, agentStateVersion: 0,
      },
      messages: [{ seq: 2, content: { t: 'encrypted' as const, c: encryptedContent }, createdAt: 2, accountActor: null }],
      hasMore: false,
    }));
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'runner-token', encryption: null },
      sourceMaterialResolver: {
        installPreparedDataKey: () => 'installed',
        resolveForHydration: () => ({ mode: 'e2ee', dataKey: sourceDataKey }),
      },
      deps: { fetchRunnerSourceProjection: fetchRunnerSourceProjection as never },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(fetchRunnerSourceProjection).toHaveBeenCalledWith(expect.objectContaining({
      destinationSessionId: 'destination', sourceSessionId: 'source', afterTranscriptSeq: 1, observedTranscriptSeq: 3,
    }));
    expect(envelope?.recentMessages).toEqual([{ messageId: 'seq:2', seq: 2, text: 'dedicated projection', provenance: null }]);
    // The reconciler renders every hydrated envelope through this exact schema
    // after removing its host-only ordering/budget evidence. An invalid wire
    // projection drops the optional Follow block before it reaches the provider.
    const {
      sourceRecencyMs: _sourceRecencyMs,
      transcriptConsumedThroughByRenderedMessageCount: _transcriptCheckpoints,
      ...wireEnvelope
    } = envelope!;
    expect(() => SessionFollowUpdateEnvelopeV1Schema.parse(wireEnvelope)).not.toThrow();
  });

  it('hydrates an awareness-only frontier without requiring a transcript page', async () => {
    const fetchTranscriptPage = vi.fn();
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: fetchTranscriptPage as never,
        projectSourceAwareness: () => awareness as never,
      },
    });
    const observed = { transcriptSeq: 1, readyEventSeq: 2, agentStateVersion: 3, turn: null };

    const envelope = await hydrate({
      observation: { ...observation, observed } as never,
      signal: new AbortController().signal,
    });

    expect(fetchTranscriptPage).not.toHaveBeenCalled();
    expect(envelope).toMatchObject({ reason: 'source_changed', observed, recentMessages: [], truncated: false });
  });

  it('hydrates only the originally observed range through existing owners', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain', updatedAt: 1234, activeAt: 2345 },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            { seq: 1, createdAt: 1, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'old' } } } },
            {
              seq: 2,
              createdAt: 2,
              accountActor: { v: 1, accountId: 'author', profile: { firstName: 'Ada', lastName: 'Lovelace', username: 'ada', avatarUrl: null } },
              content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'new' } } },
            },
            { seq: 99, createdAt: 3, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'newer-than-observed' } } } },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });
    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });
    expect(envelope?.reason).toBe('source_changed');
    expect(envelope?.observed).toEqual({ ...observation.observed, transcriptSeq: 2 });
    expect(envelope?.sourceRecencyMs).toBe(2345);
    expect(envelope?.recentMessages.map((message) => message.seq)).toEqual([2]);
    expect(envelope?.recentMessages[0]?.authorLabel).toBe('Ada Lovelace');
  });

  it('uses the canonical semantic summary for durable tool calls and results', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            {
              seq: 2,
              createdAt: 2,
              content: { t: 'plain', v: {
                role: 'agent',
                content: { type: 'acp', agentId: 'opencode', data: {
                  type: 'tool-call', name: 'shell', callId: 'call-1', input: { command: 'git status' },
                } },
              } },
            },
            {
              seq: 3,
              createdAt: 3,
              content: { t: 'plain', v: {
                role: 'agent',
                content: { type: 'acp', agentId: 'opencode', data: {
                  type: 'tool-result', callId: 'call-1', output: [{ type: 'text', text: 'clean' }],
                } },
              } },
            },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(envelope?.recentMessages).toEqual([
      expect.objectContaining({ seq: 2, text: 'Tool use (shell): git status' }),
      expect.objectContaining({ seq: 3, text: 'Tool result: clean' }),
    ]);
    expect(envelope?.observed.transcriptSeq).toBe(3);
  });

  it('advances through valid non-renderable events and still renders a later human message', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            {
              seq: 2,
              createdAt: 2,
              content: { t: 'plain', v: {
                role: 'agent',
                content: { type: 'acp', agentId: 'opencode', data: { type: 'unknown-valid-event' } },
              } },
            },
            {
              seq: 3,
              createdAt: 3,
              content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'human after event' } } },
            },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(envelope?.recentMessages).toEqual([
      expect.objectContaining({ seq: 3, text: 'human after event' }),
    ]);
    expect(envelope?.observed.transcriptSeq).toBe(3);
    expect(envelope?.transcriptConsumedThroughByRenderedMessageCount).toEqual([2, 3]);
  });

  it('carries a trailing valid non-renderable frontier independently from rendered messages', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            { seq: 2, createdAt: 2, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'render me' } } } },
            { seq: 3, createdAt: 3, content: { t: 'plain', v: {
              role: 'agent', content: { type: 'acp', data: { type: 'unknown-valid-event' } },
            } } },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(envelope?.recentMessages.map((message) => message.seq)).toEqual([2]);
    expect(envelope?.observed.transcriptSeq).toBe(3);
    expect(envelope?.transcriptConsumedThroughByRenderedMessageCount).toEqual([1, 3]);
  });

  it('does not require prepared key material for a Plain source', async () => {
    const resolveForHydration = vi.fn(() => ({ mode: 'unavailable' as const }));
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'scoped-runtime-token' } as never,
      sourceMaterialResolver: {
        installPreparedDataKey: () => 'installed',
        resolveForHydration,
      },
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [{
            seq: 2,
            createdAt: 2,
            content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'plain source' } } },
          }],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(envelope?.recentMessages).toEqual([expect.objectContaining({ seq: 2, text: 'plain source' })]);
    expect(resolveForHydration).not.toHaveBeenCalled();
  });

  it('rejects a Plain envelope in an E2EE source and does not scan past it', async () => {
    const sourceDataKey = new Uint8Array(32).fill(37);
    const laterEncryptedContent = encryptSessionPayload({
      ctx: { encryptionKey: sourceDataKey, encryptionVariant: 'dataKey' },
      payload: { role: 'user', content: { type: 'text', text: 'must remain pending' } },
    });
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'scoped-runtime-token', encryption: null },
      sourceMaterialResolver: {
        installPreparedDataKey: () => 'installed',
        resolveForHydration: () => ({ mode: 'e2ee', dataKey: sourceDataKey.slice() }),
      },
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'e2ee' },
          accountEncryptionCurrentness: { mode: 'e2ee' },
          ctx: null,
          mode: 'e2ee',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            { seq: 2, createdAt: 2, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'wrong mode' } } } },
            { seq: 3, createdAt: 3, content: { t: 'encrypted', c: laterEncryptedContent } },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => ({ ...awareness, encryption: 'e2ee', availability: 'complete' }) as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(envelope).toMatchObject({ reason: 'source_unavailable', recentMessages: [] });
  });

  it('rejects an encrypted envelope in a Plain source and does not scan past it', async () => {
    const encryptedContent = encryptSessionPayload({
      ctx: { encryptionKey: new Uint8Array(32).fill(51), encryptionVariant: 'dataKey' },
      payload: { role: 'user', content: { type: 'text', text: 'wrong mode' } },
    });
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            { seq: 2, createdAt: 2, content: { t: 'encrypted', c: encryptedContent } },
            { seq: 3, createdAt: 3, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'must remain pending' } } } },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(envelope).toMatchObject({ reason: 'source_unavailable', recentMessages: [] });
  });

  it('stops at the first corrupt row and exposes only the valid contiguous prefix', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            { seq: 2, createdAt: 2, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'contiguous prefix' } } } },
            { seq: 3, createdAt: 3, content: { t: 'plain', v: { role: 'invalid', content: { type: 'text', text: 'corrupt' } } } },
            { seq: 4, createdAt: 4, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'must remain pending' } } } },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({
      observation: {
        ...observation,
        observed: { ...observation.observed, transcriptSeq: 4 },
      } as never,
      signal: new AbortController().signal,
    });

    expect(envelope).toMatchObject({
      reason: 'source_changed',
      observed: { transcriptSeq: 2 },
      recentMessages: [{ seq: 2, text: 'contiguous prefix' }],
      truncated: true,
    });
  });

  it('retries from the admitted prefix after content repair without duplicating it', async () => {
    let afterSeq = 1;
    let repaired = false;
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async (input: Readonly<{ afterSeq?: number }>) => {
          afterSeq = input.afterSeq ?? 0;
          return {
            messages: afterSeq === 1
              ? [
                  { seq: 2, createdAt: 2, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'first' } } } },
                  { seq: 3, createdAt: 3, content: { t: 'plain', v: repaired
                    ? { role: 'user', content: { type: 'text', text: 'repaired' } }
                    : { role: 'invalid', content: { type: 'text', text: 'corrupt' } } } },
                  { seq: 4, createdAt: 4, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'later' } } } },
                ]
              : [
                  { seq: 3, createdAt: 3, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'repaired' } } } },
                  { seq: 4, createdAt: 4, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'later' } } } },
                ],
            hasMore: false,
            nextBeforeSeq: null,
            nextAfterSeq: null,
          };
        }) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const retryObservation = {
      ...observation,
      observed: { ...observation.observed, transcriptSeq: 4 },
    };
    const first = await hydrate({ observation: retryObservation as never, signal: new AbortController().signal });
    expect(first?.recentMessages.map((message) => message.seq)).toEqual([2]);
    expect(first?.observed.transcriptSeq).toBe(2);

    repaired = true;
    const second = await hydrate({
      observation: {
        ...retryObservation,
        delivered: { ...retryObservation.delivered, transcriptSeq: 2 },
      } as never,
      signal: new AbortController().signal,
    });
    expect(afterSeq).toBe(2);
    expect(second?.recentMessages.map((message) => message.seq)).toEqual([3, 4]);
    expect(second?.observed.transcriptSeq).toBe(4);
  });

  it('rejects a wrong destination instead of trusting caller identity', async () => {
    const resolveSourceTransport = vi.fn();
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: { resolveSourceTransport: resolveSourceTransport as never },
    });
    const envelope = await hydrate({
      observation: { ...observation, destinationSessionId: 'other' } as never,
      signal: new AbortController().signal,
    });
    expect(envelope).toBeNull();
    expect(resolveSourceTransport).not.toHaveBeenCalled();
  });

  it('fails closed before source fetch when the destination Home rejects the credentials', async () => {
    const resolveSourceTransport = vi.fn();
    const hydrate = createSessionFollowSourceHydrator({
      session: {
        sessionId: 'destination',
        runSessionFollowSourceRequest: () => { throw new Error('wrong Home'); },
      },
      credentials: { token: 'wrong-home-token' } as never,
      deps: { resolveSourceTransport: resolveSourceTransport as never },
    });

    await expect(hydrate({
      observation: observation as never,
      signal: new AbortController().signal,
    })).resolves.toBeNull();
    expect(resolveSourceTransport).not.toHaveBeenCalled();
  });

  it('returns visible source_unavailable when decryption cannot open', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => { throw new Error('unavailable'); }) as never,
        projectSourceAwareness: () => ({ ...awareness, encryption: 'locked', availability: 'locked', title: undefined }) as never,
      },
    });
    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });
    expect(envelope?.reason).toBe('source_unavailable');
    expect(envelope?.recentMessages).toEqual([]);
    expect(envelope?.observed).toEqual(observation.observed);
  });

  it('omits readable transcript content while its own awareness projection reports the source unreadable', async () => {
    // AWI-06: everything derived from private content is gated on one readability
    // answer. A source whose metadata cannot be opened projects `locked`/`unknown`
    // awareness even when the prepared Session key still opens transcript rows.
    // Emitting summaries beside that projection builds an envelope the canonical
    // validator rejects, and the reconciler renders every candidate through that
    // validator — so one such source silently discards the whole turn's Follow
    // context instead of staying visibly retryable.
    const sourceDataKey = new Uint8Array(32).fill(53);
    const encryptedContent = encryptSessionPayload({
      ctx: { encryptionKey: sourceDataKey, encryptionVariant: 'dataKey' },
      payload: { role: 'user', content: { type: 'text', text: 'readable row, unreadable metadata' } },
    });
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'runner-token', encryption: null },
      sourceMaterialResolver: {
        installPreparedDataKey: () => 'installed',
        resolveForHydration: () => ({ mode: 'e2ee', dataKey: sourceDataKey }),
      },
      deps: {
        fetchRunnerSourceProjection: (async () => ({
          v: 1 as const,
          source: {
            id: 'source', encryptionMode: 'e2ee' as const, metadata: '', metadataLayoutVersion: 0,
            archivedAt: null, createdAt: 1, updatedAt: 2, active: true, activeAt: 2,
            thinking: false, thinkingAt: null, latestTurnStatus: null, latestTurnStatusObservedAt: null,
            latestReadyEventSeq: null, latestReadyEventAt: null, meaningfulActivityAt: null, agentStateVersion: 0,
          },
          messages: [{ seq: 2, content: { t: 'encrypted' as const, c: encryptedContent }, createdAt: 2, accountActor: null }],
          hasMore: false,
        })) as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(envelope?.reason).toBe('source_unavailable');
    expect(envelope?.recentMessages).toEqual([]);
    expect(isSessionAwarenessContentReadableV1(envelope!.awareness.encryption)).toBe(false);
    const { sourceRecencyMs: _sourceRecencyMs, ...wireEnvelope } = envelope!;
    expect(() => SessionFollowUpdateEnvelopeV1Schema.parse(wireEnvelope)).not.toThrow();
  });

  it('hydrates an E2EE source from explicitly supplied standalone material without Account key fallback', async () => {
    const sourceDataKey = new Uint8Array(32).fill(41);
    const encryptedContent = encryptSessionPayload({
      ctx: { encryptionKey: sourceDataKey, encryptionVariant: 'dataKey' },
      payload: { role: 'user', content: { type: 'text', text: 'prepared source context' } },
    });
    const encryptedMetadata = encryptSessionPayload({
      ctx: { encryptionKey: sourceDataKey, encryptionVariant: 'dataKey' },
      payload: { path: '/workspace/source', host: 'source-host' },
    });
    const resolveForHydration = vi.fn(() => ({ mode: 'e2ee' as const, dataKey: sourceDataKey }));
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      // The scoped runtime has no Account opening material. Only the explicitly
      // prepared standalone source key may open this row.
      credentials: { token: 'scoped-runtime-token', encryption: null },
      sourceMaterialResolver: {
        installPreparedDataKey: () => 'installed',
        resolveForHydration,
      },
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'e2ee', metadata: encryptedMetadata, metadataLayoutVersion: 0 },
          accountEncryptionCurrentness: { mode: 'e2ee' },
          ctx: null,
          mode: 'e2ee',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [{
            seq: 2,
            createdAt: 2,
            content: { t: 'encrypted', c: encryptedContent },
          }],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        // `ready` is the canonical projection for E2EE content this caller
        // actually opened. `e2ee` is not a member of the awareness encryption
        // union, so it read as unreadable and could never carry summaries.
        projectSourceAwareness: () => ({
          ...awareness,
          encryption: 'ready',
          availability: 'complete',
        }) as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(resolveForHydration).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: 'source' }));
    expect(envelope).toMatchObject({
      reason: 'source_changed',
      edge: { sourceSessionId: 'source', destinationSessionId: 'destination' },
      recentMessages: [{ seq: 2, text: 'prepared source context' }],
    });
    expect(sourceDataKey).toEqual(new Uint8Array(32));
  });

  it('zeroes a temporary prepared key copy when hydration exits before transcript decryption', async () => {
    const temporaryKey = new Uint8Array(32).fill(23);
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'scoped-runtime-token', encryption: null },
      sourceMaterialResolver: {
        installPreparedDataKey: () => 'installed',
        resolveForHydration: () => ({ mode: 'e2ee', dataKey: temporaryKey }),
      },
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'e2ee' },
          accountEncryptionCurrentness: { mode: 'e2ee' },
          ctx: null,
          mode: 'e2ee',
        })) as never,
        projectSourceAwareness: () => ({ ...awareness, sessionId: 'wrong-source' }) as never,
      },
    });

    await expect(hydrate({ observation: observation as never, signal: new AbortController().signal })).resolves.toBeNull();
    expect(temporaryKey).toEqual(new Uint8Array(32));
  });

  it('zeroes the temporary prepared-key copy after hydration', async () => {
    const retainedKey = new Uint8Array(32).fill(41);
    const hydrationCopy = retainedKey.slice();
    const encryptedContent = encryptSessionPayload({
      ctx: { encryptionKey: retainedKey, encryptionVariant: 'dataKey' },
      payload: { role: 'user', content: { type: 'text', text: 'prepared source context' } },
    });
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'scoped-runtime-token', encryption: null },
      sourceMaterialResolver: {
        installPreparedDataKey: () => 'installed',
        resolveForHydration: () => ({ mode: 'e2ee', dataKey: hydrationCopy }),
      },
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true, sessionId: 'source', rawSession: { id: 'source', encryptionMode: 'e2ee' },
          accountEncryptionCurrentness: { mode: 'e2ee' }, ctx: null, mode: 'e2ee',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [{ seq: 2, createdAt: 2, content: { t: 'encrypted', c: encryptedContent } }],
          hasMore: false, nextBeforeSeq: null, nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => ({ ...awareness, encryption: 'e2ee', availability: 'complete' }) as never,
      },
    });

    await hydrate({ observation: observation as never, signal: new AbortController().signal });

    expect(hydrationCopy).toEqual(new Uint8Array(32));
    expect(retainedKey).toEqual(new Uint8Array(32).fill(41));
  });

  it('marks a bounded page truncated while consuming its trailing valid non-renderable row', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            { seq: 2, createdAt: 2, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'kept' } } } },
            { seq: 3, createdAt: 3, content: { t: 'plain', v: { role: 'user', content: { type: 'image', url: 'opaque' } } } },
          ],
          hasMore: true,
          nextBeforeSeq: null,
          nextAfterSeq: 3,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });
    expect(envelope?.recentMessages.map((message) => message.seq)).toEqual([2]);
    expect(envelope?.observed.transcriptSeq).toBe(3);
    expect(envelope?.transcriptConsumedThroughByRenderedMessageCount).toEqual([1, 3]);
    expect(envelope?.truncated).toBe(true);
  });

  it('hydrates the oldest bounded pending prefix and exposes its exact consumed frontier', async () => {
    const fetchTranscriptPage = vi.fn().mockResolvedValue({
      messages: Array.from({ length: 20 }, (_, index) => {
        const seq = index + 2;
        return {
          seq,
          createdAt: seq,
          content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: `message-${seq}` } } },
        };
      }),
      hasMore: true,
      nextBeforeSeq: null,
      nextAfterSeq: 21,
    });
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: fetchTranscriptPage as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({
      observation: {
        ...observation,
        observed: { transcriptSeq: 30, readyEventSeq: 4, agentStateVersion: 5, turn: null },
      } as never,
      signal: new AbortController().signal,
    });
    expect(fetchTranscriptPage).toHaveBeenCalledTimes(1);
    expect(fetchTranscriptPage).toHaveBeenCalledWith(expect.objectContaining({ afterSeq: 1, limit: 500 }));
    expect(fetchTranscriptPage).toHaveBeenCalledWith(expect.not.objectContaining({ beforeSeq: expect.anything() }));
    expect(envelope?.recentMessages.map((message) => message.seq)).toEqual(Array.from({ length: 20 }, (_, index) => index + 2));
    expect(envelope?.observed).toEqual({
      transcriptSeq: 21,
      readyEventSeq: 4,
      agentStateVersion: 5,
      turn: null,
    });
    expect(envelope?.truncated).toBe(true);
  });

  it('does not represent a missing observed transcript range as complete', async () => {
    const hydrate = createSessionFollowSourceHydrator({
      session: destinationSession,
      credentials: { token: 'token' } as never,
      deps: {
        resolveSourceTransport: (async () => ({
          ok: true,
          sessionId: 'source',
          rawSession: { id: 'source', encryptionMode: 'plain' },
          accountEncryptionCurrentness: { mode: 'plain' },
          ctx: null,
          mode: 'plain',
        })) as never,
        fetchTranscriptPage: (async () => ({
          messages: [
            { seq: 99, createdAt: 3, content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'newer' } } } },
          ],
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
        })) as never,
        projectSourceAwareness: () => awareness as never,
      },
    });

    const envelope = await hydrate({ observation: observation as never, signal: new AbortController().signal });
    expect(envelope?.reason).toBe('source_unavailable');
  });
});
