import type {
  SessionAwarenessProjectionV1,
  SessionFollowPendingObservationV1,
  SessionFollowUpdateEnvelopeV1,
} from '@happier-dev/protocol';
import {
  isSessionAwarenessContentReadableV1,
  parseSessionMessageAccountActorV1,
  readSessionMessageProvenanceV1,
  SessionStoredMessageContentSchema,
  SESSION_FOLLOW_SOURCE_PROJECTION_MAX_PAGE_ROWS_V1,
} from '@happier-dev/protocol';

import type { ApiSessionClient } from '@/api/session/sessionClient';
import type { StoredCredentials } from '@/persistence';
import {
  projectCliSessionAwarenessFromMaterialV1,
  projectCliSessionAwarenessUnavailableMaterialV1,
  projectCliSessionAwarenessV1,
} from '@/cli/output/session/sessionAwareness';
import { fetchEncryptedTranscriptMessagesPage } from '@/session/replay/fetchEncryptedTranscriptMessages';
import { decodeTranscriptBody } from '@/session/services/transcript/transcriptBodyDecoder';
import {
  openSessionStoredContent,
  resolveSessionEncryptionContextFromCredentials,
  resolveSessionStoredContentEncryptionMode,
  resolveSessionTransportContextFromMaterial,
  type SessionEncryptionContext,
  type SessionStoredContentEncryptionMode,
} from '@/session/transport/encryption/sessionEncryptionContext';
import { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { fetchSessionFollowSourceProjection } from '@/session/transport/http/sessionFollowSourceProjectionHttp';

/**
 * Encryption-context seam for Lane 13 restricted-Runner prepared source keys.
 *
 * This is the typed extension point consumed by the ordinary Follow source
 * hydrator below. Lane 13 owns the receiver/lifetime that installs material;
 * this module never materializes keys, stores them on disk, or invents
 * Account-wide keys. The ordinary Account daemon path resolves `plain` or uses
 * its own Account credentials; a Runner destination supplies this resolver once
 * Lane 13 lands, and one reconciler serves both runtime kinds.
 */
export type SessionFollowSourceMaterialResolver = Readonly<{
  installPreparedDataKey(input: Readonly<{
    sourceSessionId: string;
    dataKey: Uint8Array;
  }>): 'installed';
  resolveForHydration(input: Readonly<{
    sourceSessionId: string;
    signal: AbortSignal;
  }>):
    | Readonly<{ mode: 'plain' }>
    | Readonly<{ mode: 'e2ee'; dataKey: Uint8Array }>
    | Readonly<{ mode: 'unavailable' }>;
}>;

export type SessionFollowHydratorDeps = Readonly<{
  resolveSourceTransport?: typeof resolveSessionTransportContext;
  fetchTranscriptPage?: typeof fetchEncryptedTranscriptMessagesPage;
  projectSourceAwareness?: (input: Readonly<{
    rawSession: Parameters<typeof projectCliSessionAwarenessV1>[0]['row'];
    accountEncryption: Parameters<typeof projectCliSessionAwarenessV1>[0]['accountEncryption'];
  }>) => SessionAwarenessProjectionV1;
  fetchRunnerSourceProjection?: typeof fetchSessionFollowSourceProjection;
}>;

export type SessionFollowHydratedUpdate = SessionFollowUpdateEnvelopeV1 & Readonly<{
  /** Host-only ordering evidence from the canonical source Session row. */
  sourceRecencyMs: number;
  /**
   * Exact contiguous transcript frontier represented after keeping the first
   * N rendered summaries. Index 0 covers valid non-renderable rows before the
   * first summary; the final entry includes valid non-renderable rows trailing
   * the last summary. This host-only evidence lets the context budget defer a
   * renderable row without leaving earlier semantic events pending forever.
   */
  transcriptConsumedThroughByRenderedMessageCount?: readonly number[];
}>;

/** Selects the shared transcript read semantics before provider-context budgeting. */
export type SessionFollowHydrationReadModeV1 =
  | 'incremental'
  | 'initial_current_snapshot';

type SessionFollowOpenedTranscriptRow = Readonly<{
  seq: number;
  role: 'user' | 'agent';
  content: unknown;
  meta?: unknown;
  accountActor?: unknown;
}>;

type SessionFollowTranscriptRowOpenResult =
  | Readonly<{ ok: true; row: SessionFollowOpenedTranscriptRow }>
  | Readonly<{ ok: false; reason: 'invalid_row' | 'content_unavailable' }>;

function openSessionFollowTranscriptRow(input: Readonly<{
  mode: SessionStoredContentEncryptionMode;
  ctx: SessionEncryptionContext | null;
  row: Readonly<{
    seq?: unknown;
    createdAt?: unknown;
    content?: unknown;
    accountActor?: unknown;
  }>;
}>): SessionFollowTranscriptRowOpenResult {
  const seq = typeof input.row.seq === 'number' && Number.isSafeInteger(input.row.seq) && input.row.seq >= 0
    ? input.row.seq
    : null;
  const createdAt = typeof input.row.createdAt === 'number'
    && Number.isSafeInteger(input.row.createdAt)
    && input.row.createdAt >= 0
    ? input.row.createdAt
    : null;
  const content = SessionStoredMessageContentSchema.safeParse(input.row.content);
  if (seq === null || createdAt === null || !content.success) {
    return { ok: false, reason: 'invalid_row' };
  }

  let opened: unknown;
  try {
    if (input.mode === 'plain') {
      opened = openSessionStoredContent({ mode: 'plain', ctx: null, content: content.data });
    } else {
      if (!input.ctx) return { ok: false, reason: 'content_unavailable' };
      opened = openSessionStoredContent({ mode: 'e2ee', ctx: input.ctx, content: content.data });
    }
  } catch {
    // The canonical opener distinguishes mode mismatch from unavailable E2EE
    // bytes. Follow deliberately projects both as the same content-free,
    // retryable omission so neither ciphertext nor corruption details leak.
    return { ok: false, reason: 'content_unavailable' };
  }
  if (!opened || typeof opened !== 'object' || Array.isArray(opened)) {
    return { ok: false, reason: 'invalid_row' };
  }
  const record = opened as Readonly<Record<string, unknown>>;
  if (record.role !== 'user' && record.role !== 'agent') {
    return { ok: false, reason: 'invalid_row' };
  }
  return {
    ok: true,
    row: {
      seq,
      role: record.role,
      content: record.content,
      ...(record.meta !== undefined ? { meta: record.meta } : {}),
      ...(input.row.accountActor !== undefined ? { accountActor: input.row.accountActor } : {}),
    },
  };
}

function readAuthorLabel(accountActor: unknown): string | null {
  const actor = parseSessionMessageAccountActorV1(accountActor);
  if (!actor?.profile) return null;
  const fullName = [actor.profile.firstName, actor.profile.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  const label = fullName || actor.profile.username?.trim() || null;
  return label?.replace(/\s+/gu, ' ').trim().slice(0, 191) || null;
}

function readSourceRecencyMs(rawSession: unknown): number {
  if (!rawSession || typeof rawSession !== 'object') return 0;
  const record = rawSession as Readonly<Record<string, unknown>>;
  return Math.max(0, ...[record.updatedAt, record.activeAt, record.createdAt].flatMap((candidate) => (
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? [candidate]
      : []
  )));
}

function buildUnavailableEnvelope(input: Readonly<{
  observation: SessionFollowPendingObservationV1;
  awareness: SessionAwarenessProjectionV1;
}>): SessionFollowUpdateEnvelopeV1 {
  return {
    v: 1,
    kind: 'session_follow_update',
    edge: {
      sourceSessionId: input.observation.sourceSessionId,
      destinationSessionId: input.observation.destinationSessionId,
    },
    reason: 'source_unavailable',
    deliveryIntent: 'context_only',
    observed: input.observation.observed,
    awareness: input.awareness,
    recentMessages: [],
    truncated: false,
  };
}

/**
 * Canonical source-content hydrator for Session Follow.
 *
 * It reuses the existing Session transport/encryption/transcript/awareness
 * owners: `resolveSessionTransportContext` for authenticated fetch plus
 * encryption context, `fetchEncryptedTranscriptMessagesPage` for bounded
 * transcript reads, `openSessionStoredContent` + `decodeTranscriptBody` +
 * `readSessionMessageProvenanceV1` for content, and `projectCliSessionAwarenessV1`
 * for awareness. Every HTTP read stays inside the destination Session client's
 * exact Home context and rejects mismatched credentials. It never creates a
 * second decryptor, HTTP client, key store, or queue.
 *
 * The hydrated envelope is always capped to the originally observed frontier:
 * only messages with `delivered < seq <= observed` are included, so a newer
 * hydration frontier can never be acknowledged by the earlier turn. Unknown,
 * unavailable, or key-not-ready material returns a `source_unavailable`
 * envelope (visible, retryable, unacknowledged) or `null` when even the
 * relationship cannot be disclosed safely.
 */
export function createSessionFollowSourceHydrator(input: Readonly<{
  session: Pick<ApiSessionClient, 'sessionId' | 'runSessionFollowSourceRequest'>;
  credentials: StoredCredentials;
  sourceMaterialResolver?: SessionFollowSourceMaterialResolver | null;
  deps?: SessionFollowHydratorDeps;
}>): (args: Readonly<{
  observation: SessionFollowPendingObservationV1;
  signal: AbortSignal;
  /** Omitted direct callers retain ordinary oldest-contiguous Follow behavior. */
  readMode?: SessionFollowHydrationReadModeV1;
}>) => Promise<SessionFollowHydratedUpdate | null> {
  const resolveTransport = input.deps?.resolveSourceTransport ?? resolveSessionTransportContext;
  const fetchPage = input.deps?.fetchTranscriptPage ?? fetchEncryptedTranscriptMessagesPage;
  const fetchRunnerProjection = input.deps?.fetchRunnerSourceProjection ?? fetchSessionFollowSourceProjection;

  return async ({ observation, signal, readMode = 'incremental' }) => {
    signal.throwIfAborted();
    const destinationSessionId = input.session.sessionId;
    if (
      observation.destinationSessionId !== destinationSessionId
      || observation.sourceSessionId === destinationSessionId
    ) {
      return null;
    }

    const useRunnerProjection = input.sourceMaterialResolver && !input.deps?.resolveSourceTransport;
    const fetchRunnerPage = async (afterTranscriptSeq: number) => await input.session.runSessionFollowSourceRequest({
      credentials: input.credentials,
      request: async () => await fetchRunnerProjection({
        token: input.credentials.token,
        destinationSessionId,
        sourceSessionId: observation.sourceSessionId,
        afterTranscriptSeq,
        observedTranscriptSeq: observation.observed.transcriptSeq,
        limit: SESSION_FOLLOW_SOURCE_PROJECTION_MAX_PAGE_ROWS_V1,
        signal,
      }),
    });
    // The restricted Runner projection currently exposes only ascending
    // after-frontier reads. Fail closed rather than approximating a current
    // snapshot with a second read implementation.
    if (readMode === 'initial_current_snapshot' && useRunnerProjection) return null;
    const runnerProjection = useRunnerProjection
      ? await fetchRunnerPage(observation.delivered.transcriptSeq).catch(() => null)
      : null;

    let transport: Awaited<ReturnType<typeof resolveSessionTransportContext>> | null = null;

    try {
      if (useRunnerProjection) {
        if (!runnerProjection || runnerProjection.source.id !== observation.sourceSessionId) return null;
        const mode = resolveSessionStoredContentEncryptionMode(runnerProjection.source);
        transport = {
          ok: true,
          sessionId: observation.sourceSessionId,
          rawSession: runnerProjection.source,
          accountEncryptionCurrentness: { mode },
          ctx: null,
          mode,
        } as Awaited<ReturnType<typeof resolveSessionTransportContext>>;
      } else {
        transport = await input.session.runSessionFollowSourceRequest({
          credentials: input.credentials,
          request: async () => await resolveTransport({
            credentials: input.credentials,
            idOrPrefix: observation.sourceSessionId,
            ...(signal ? { signal } : {}),
          }),
        });
      }
    } catch {
      return null;
    }
    if (!transport || transport.ok !== true) {
      // Unknown, key-not-ready, or unreadable sources stay pending and retryable.
      // When the row itself is readable the transcript fetch below still yields a
      // visible `source_unavailable` envelope; otherwise this omission stays pending.
      return null;
    }

    const rawSession = transport.rawSession as unknown as Parameters<typeof projectCliSessionAwarenessV1>[0]['row'];
    const sourceRecencyMs = readSourceRecencyMs(transport.rawSession);
    const mode = resolveSessionStoredContentEncryptionMode(transport.rawSession as { encryptionMode?: unknown });
    const preparedMaterial = input.sourceMaterialResolver && mode === 'e2ee'
      ? input.sourceMaterialResolver.resolveForHydration({ sourceSessionId: observation.sourceSessionId, signal })
      : null;
    try {
      const runnerPresentationMaterial = useRunnerProjection
        ? mode === 'plain'
          ? { mode: 'plain' as const }
          : preparedMaterial?.mode === 'e2ee'
            ? { mode: 'e2ee' as const, dataEncryptionKey: preparedMaterial.dataKey }
            : null
        : null;
      const awareness = input.deps?.projectSourceAwareness
        ? input.deps.projectSourceAwareness({ rawSession, accountEncryption: transport.accountEncryptionCurrentness })
        : runnerPresentationMaterial
          ? projectCliSessionAwarenessFromMaterialV1({
              row: rawSession,
              material: runnerPresentationMaterial,
              nowMs: Date.now(),
            })
          : useRunnerProjection
            ? projectCliSessionAwarenessUnavailableMaterialV1({ row: rawSession, nowMs: Date.now() })
            : projectCliSessionAwarenessV1({
                credentials: input.credentials,
                accountEncryption: transport.accountEncryptionCurrentness,
                row: rawSession,
                nowMs: Date.now(),
              });

      if (awareness.sessionId !== observation.sourceSessionId) {
        return null;
      }
      // AWI-06: the projection above is the single readability answer for every
      // content-derived fact, transcript summaries included. A source whose
      // metadata is absent, unparseable, or unopenable projects `locked`-class
      // encryption even when the resolved key still opens transcript rows, and
      // `SessionFollowUpdateEnvelopeV1Schema` rejects summaries beside such a
      // projection. Because the reconciler renders every candidate through that
      // validator, emitting them here discards the whole turn's Follow context
      // instead of this one source. Stay visible, unacknowledged, and retryable.
      if (!isSessionAwarenessContentReadableV1(awareness.encryption)) {
        return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
      }

      let resolvedMaterial: ReturnType<SessionFollowSourceMaterialResolver['resolveForHydration']> | null = null;
      if (input.sourceMaterialResolver && mode === 'e2ee') {
        resolvedMaterial = preparedMaterial;
        if (!resolvedMaterial || resolvedMaterial.mode === 'unavailable') {
          return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
        }
      }
      let ctx: SessionEncryptionContext | null = null;
      if (resolvedMaterial) {
        if (resolvedMaterial.mode === 'plain') {
          if (mode !== 'plain') return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
          ctx = null;
        } else {
          const materialized = resolveSessionTransportContextFromMaterial({
            rawSession: transport.rawSession as { encryptionMode?: unknown },
            material: { mode: 'e2ee', dataEncryptionKey: resolvedMaterial.dataKey },
          });
          if (!materialized.ok) return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
          ctx = materialized.ctx;
        }
      } else if (mode === 'plain') {
        ctx = null;
      } else {
        const ordinary = resolveSessionEncryptionContextFromCredentials(
          input.credentials,
          transport.rawSession as unknown as Parameters<typeof resolveSessionEncryptionContextFromCredentials>[1],
        );
        if (!ordinary) return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
        ctx = ordinary;
      }

      const deliveredSeq = observation.delivered.transcriptSeq;
      const observedSeq = observation.observed.transcriptSeq;
      if (observedSeq <= deliveredSeq) {
        return {
          v: 1,
          kind: 'session_follow_update',
          edge: {
            sourceSessionId: observation.sourceSessionId,
            destinationSessionId: observation.destinationSessionId,
          },
          reason: 'source_changed',
          deliveryIntent: 'context_only',
          observed: observation.observed,
          awareness,
          recentMessages: [],
          truncated: false,
          sourceRecencyMs,
          transcriptConsumedThroughByRenderedMessageCount: [deliveredSeq],
        };
      }

      let rows: Awaited<ReturnType<typeof fetchPage>>['messages'];
      let pageHasMore = false;
      if (readMode === 'initial_current_snapshot' && observedSeq >= Number.MAX_SAFE_INTEGER) {
        return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
      }
      try {
        const page = runnerProjection ?? await input.session.runSessionFollowSourceRequest({
          credentials: input.credentials,
          request: async () => await fetchPage({
            token: input.credentials.token,
            sessionId: observation.sourceSessionId,
            limit: SESSION_FOLLOW_SOURCE_PROJECTION_MAX_PAGE_ROWS_V1,
            scope: 'all',
            ...(readMode === 'initial_current_snapshot'
              ? {
                  // The route's `beforeSeq` arm returns the latest bounded window
                  // in descending order. The exclusive cap prevents a concurrent
                  // source advance from entering this originally observed snapshot.
                  beforeSeq: observedSeq + 1,
                }
              : {
                  // `afterSeq` is the route's ascending catch-up arm. Reading from
                  // the delivered frontier preserves a contiguous ACK prefix.
                  afterSeq: deliveredSeq,
                }),
            ...(signal ? { signal } : {}),
          }),
        });
        rows = readMode === 'initial_current_snapshot'
          ? [...page.messages].reverse()
          : [...page.messages];
        pageHasMore = page.hasMore;
      } catch {
        return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
      }

      const summaries: SessionFollowUpdateEnvelopeV1['recentMessages'] = [];
      // Entry N is the exact contiguous transcript frontier after rendering N
      // summaries. Structurally valid rows without model-visible text advance
      // the current entry; malformed or unopenable rows stop traversal.
      const firstStoredSeq = rows[0]?.seq;
      const traversalBaseline = readMode === 'initial_current_snapshot'
        && typeof firstStoredSeq === 'number'
        && Number.isSafeInteger(firstStoredSeq)
        ? firstStoredSeq - 1
        : deliveredSeq;
      const consumedThroughByRenderedMessageCount: number[] = [traversalBaseline];
      let omittedObservedMessage = false;
      let nextContiguousSeq = traversalBaseline + 1;
      for (const storedRow of rows) {
        const storedSeq = typeof storedRow.seq === 'number' && Number.isSafeInteger(storedRow.seq)
          ? storedRow.seq
          : null;
        if (readMode === 'incremental' && storedSeq !== null && storedSeq <= deliveredSeq) continue;
        if (storedSeq !== null && storedSeq > observedSeq) {
          omittedObservedMessage = nextContiguousSeq <= observedSeq;
          break;
        }
        if (storedSeq !== nextContiguousSeq) {
          omittedObservedMessage = true;
          break;
        }
        const opened = openSessionFollowTranscriptRow({ mode, ctx, row: storedRow });
        if (!opened.ok) {
          omittedObservedMessage = true;
          break;
        }
        const row = opened.row;
        const decoded = decodeTranscriptBody({ role: row.role, content: row.content, meta: row.meta });
        const semanticText = decoded?.text ?? decoded?.summary;
        if (semanticText && semanticText.trim().length > 0) {
          const provenance = readSessionMessageProvenanceV1(row.meta);
          const messageId = `seq:${row.seq}`;
          const authorLabel = readAuthorLabel(row.accountActor);
          summaries.push({
            messageId,
            seq: row.seq,
            text: semanticText,
            ...(authorLabel ? { authorLabel } : {}),
            provenance,
          });
          consumedThroughByRenderedMessageCount.push(row.seq);
        } else {
          // The Protocol semantic projector deliberately returns no text for
          // valid events that have no useful model-visible representation.
          // They are consumed by traversal, not invented into prompt prose.
          consumedThroughByRenderedMessageCount[consumedThroughByRenderedMessageCount.length - 1] = row.seq;
        }
        nextContiguousSeq = row.seq + 1;
      }

      const consumedTranscriptSeq = consumedThroughByRenderedMessageCount[
        consumedThroughByRenderedMessageCount.length - 1
      ] ?? deliveredSeq;
      if (readMode === 'initial_current_snapshot' && consumedTranscriptSeq !== observedSeq) {
        // A current snapshot is useful only when the bounded window reaches the
        // exact observed cap. Missing, malformed, or unavailable tail material
        // must not turn an approximate read into a durable baseline ACK.
        return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
      }
      if (consumedTranscriptSeq === traversalBaseline && consumedTranscriptSeq < observedSeq) {
        // A gap at the first pending row admits no transcript prefix. Keep the
        // whole observation retryable; later rows must never be scanned around
        // the unreadable or mode-incompatible sequence.
        return { ...buildUnavailableEnvelope({ observation, awareness }), sourceRecencyMs };
      }

      return {
        v: 1,
        kind: 'session_follow_update',
        edge: {
          sourceSessionId: observation.sourceSessionId,
          destinationSessionId: observation.destinationSessionId,
        },
        reason: 'source_changed',
        deliveryIntent: 'context_only',
        observed: readMode === 'initial_current_snapshot'
          ? observation.observed
          : {
              ...observation.observed,
              transcriptSeq: consumedTranscriptSeq,
            },
        awareness,
        recentMessages: summaries,
        truncated: pageHasMore
          || traversalBaseline > deliveredSeq
          || consumedTranscriptSeq < observedSeq
          || omittedObservedMessage,
        sourceRecencyMs,
        transcriptConsumedThroughByRenderedMessageCount: Object.freeze([
          ...consumedThroughByRenderedMessageCount,
        ]),
      };
    } finally {
      if (preparedMaterial?.mode === 'e2ee') preparedMaterial.dataKey.fill(0);
    }
  };
}
