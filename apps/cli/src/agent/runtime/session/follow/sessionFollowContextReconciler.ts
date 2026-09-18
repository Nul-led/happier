import {
  compareSessionFollowFrontierProgressV1,
  deriveSessionFollowWakeEventLocalIdV1,
  isAuthoritativeHumanSessionFollowMessageV1,
  isSessionFollowFrontierEqualV1,
  normalizeSessionFollowWakeObservationsV1,
  renderSessionInputContextPromptV1,
  type SessionFollowAcknowledgeResponseV1,
  type SessionFollowPendingObservationV1,
  type SessionFollowUpdateEnvelopeV1,
  SESSION_FOLLOW_ZERO_FRONTIER_V1,
} from '@happier-dev/protocol';

import type { ApiSessionClient } from '@/api/session/sessionClient';

import { applySessionFollowContextBudgetV1 } from './sessionFollowContextBudget';
import type {
  SessionFollowHydratedUpdate,
  SessionFollowHydrationReadModeV1,
} from './sessionFollowSourceHydrator';
import type { SessionFollowSourceMaterialController } from './sessionFollowSourceMaterialResolver';

export type SessionFollowHydrateObservation = (input: Readonly<{
  observation: SessionFollowPendingObservationV1;
  signal: AbortSignal;
  readMode: SessionFollowHydrationReadModeV1;
}>) => Promise<(SessionFollowUpdateEnvelopeV1 & Partial<Pick<
  SessionFollowHydratedUpdate,
  'sourceRecencyMs' | 'transcriptConsumedThroughByRenderedMessageCount'
>>) | null>;

export type SessionFollowPreparedContext = Readonly<{
  updates: readonly SessionFollowUpdateEnvelopeV1[];
  /** Present only for a wake; this is the deterministic durable event identity committed before delivery. */
  wakeEventLocalId?: string;
  acknowledgeAccepted: (input: Readonly<{
    kind: 'admitted_input';
    localInputId: string;
    userMessageSeq: number | null;
  }> | Readonly<{
    kind: 'context_only_wake';
    eventLocalId: string;
  }>) => void;
}>;

export type SessionFollowObserverV1 =
  | Readonly<{ kind: 'destination_session'; destinationSessionId: string }>
  | Readonly<{ kind: 'account_voice'; accountId: string; voiceSessionId: string }>;

function resolveSessionFollowHydrationReadMode(input: Readonly<{
  observer: SessionFollowObserverV1;
  voiceExpected?: SessionFollowPendingObservationV1['delivered'] | null;
}>): SessionFollowHydrationReadModeV1 {
  return input.observer.kind === 'account_voice' && input.voiceExpected === null
    ? 'initial_current_snapshot'
    : 'incremental';
}

/**
 * Composes the one destination-owned Follow observation with the canonical provider acceptance
 * effect. Hydration is deliberately injected: the Session client owns observe/ACK transport,
 * while the existing Session transcript/awareness and encryption owners remain responsible for
 * reading source content. This helper never creates a Pending row, queue entry, turn, worker,
 * poller, database, ledger, or exactly-once protocol.
 *
 * Guarantees:
 * - The destination is derived from the bound `session.sessionId`; a caller-supplied
 *   destination identity is never trusted. Observations for another destination are omitted.
 * - Hydration is capped to the originally observed frontier. Ordinary Follow advances its
 *   transcript component only through the oldest contiguous messages actually represented.
 *   Account Voice's explicit initial-current-snapshot mode instead acknowledges that exact
 *   observed frontier after one bounded latest projection. A source block omitted by the total
 *   budget is never acknowledged.
 * - `source_unavailable` envelopes remain visible in `updates` but are never acknowledged,
 *   so they stay retryable. Budget-omitted sources are excluded from `updates` and stay pending.
 * - Re-admission is enforced by the server observe/ACK owners plus the hydration fetch
 *   immediately before injection; revocation between hydrate and inject fails the final CAS
 *   and leaves the frontier pending.
 */
export function createSessionFollowContextReconciler(input: Readonly<{
  session: ApiSessionClient;
  hydrateObservation: SessionFollowHydrateObservation;
  observer?: SessionFollowObserverV1;
  sourceMaterialController?: SessionFollowSourceMaterialController | null;
  /** Evidence-backed allowance from the final provider-context owner; null/absent disables optional Follow. */
  maxFollowContextUtf8Bytes?: number | null;
}>): (options: Readonly<{
  signal: AbortSignal;
  maxFollowContextUtf8Bytes?: number | null;
  deliveryIntent?: 'natural' | 'wake';
  executionRunId?: string;
}>) => Promise<SessionFollowPreparedContext | null> {
  return async ({ signal, maxFollowContextUtf8Bytes: invocationAllowance, deliveryIntent = 'natural', executionRunId }) => {
    const observer = input.observer ?? {
      kind: 'destination_session' as const,
      destinationSessionId: input.session.sessionId,
    };
    const maxFollowContextUtf8Bytes = invocationAllowance !== undefined
      ? invocationAllowance
      : input.maxFollowContextUtf8Bytes ?? null;
    const canAdmitFollowContext = maxFollowContextUtf8Bytes !== null
      && Number.isSafeInteger(maxFollowContextUtf8Bytes)
      && maxFollowContextUtf8Bytes > 0;
    if (!canAdmitFollowContext && !input.sourceMaterialController) {
      return null;
    }
    let observed: Readonly<{
      ok: boolean;
      publisherGeneration?: string;
      executionRunOccurrenceId?: string;
      currentSourceSessionIds?: readonly string[];
      observations?: readonly (SessionFollowPendingObservationV1 & Readonly<{
        voiceExpected?: SessionFollowPendingObservationV1['delivered'] | null;
      }>)[];
    }>;
    try {
      if (observer.kind === 'account_voice') {
        if (!executionRunId?.trim()) return null;
        const voice = await input.session.observePendingAccountVoiceFollow({ executionRunId });
        observed = voice.ok ? {
          ok: true,
          publisherGeneration: voice.publisherGeneration,
          executionRunOccurrenceId: voice.executionRunOccurrenceId,
          observations: voice.observations.map((entry) => ({
            sourceSessionId: entry.sourceSessionId,
            destinationSessionId: entry.voiceSessionId,
            delivered: entry.expected ?? SESSION_FOLLOW_ZERO_FRONTIER_V1,
            observed: entry.observed,
            mode: 'next_turn',
            voiceExpected: entry.expected,
          })),
        } : { ok: false };
      } else {
        observed = await input.session.observePendingSessionFollow();
      }
    } catch {
      // Follow is optional host context. Home unavailable, unsupported runtime, or a
      // test double without Follow transport must never break the real admitted turn.
      return null;
    }
    if (!observed.ok) return null;
    if (observer.kind === 'destination_session' && observed.currentSourceSessionIds) {
      input.sourceMaterialController?.retainSources(observed.currentSourceSessionIds);
    }
    if (!canAdmitFollowContext) return null;
    if (!observed.publisherGeneration || !observed.observations || observed.observations.length === 0) return null;
    const destinationSessionId = (input.session as Pick<ApiSessionClient, 'sessionId'>).sessionId;

    const candidateObservations = deliveryIntent === 'wake'
      ? observed.observations.filter((observation) => observation.mode === 'wake_on_human_change')
      : observed.observations;
    const hydrated = await Promise.all(candidateObservations.map(async (observation) => {
      if (signal.aborted) return null;
      if (observation.destinationSessionId !== destinationSessionId) return null;
      if (observation.sourceSessionId === observation.destinationSessionId) return null;
      try {
        const readMode = resolveSessionFollowHydrationReadMode({
          observer,
          voiceExpected: observation.voiceExpected,
        });
        const update = await input.hydrateObservation({ observation, signal, readMode });
        if (!update) return null;
        if (update.edge.sourceSessionId !== observation.sourceSessionId) return null;
        if (update.edge.destinationSessionId !== observation.destinationSessionId) return null;
        if (update.awareness.sessionId !== observation.sourceSessionId) return null;
        if (
          update.observed.transcriptSeq < observation.delivered.transcriptSeq
          || update.observed.transcriptSeq > observation.observed.transcriptSeq
          || !isSessionFollowFrontierEqualV1(
            { ...update.observed, transcriptSeq: observation.observed.transcriptSeq },
            observation.observed,
          )
        ) return null;
        if (deliveryIntent === 'wake' && !update.recentMessages.some(isAuthoritativeHumanSessionFollowMessageV1)) return null;
        const {
          sourceRecencyMs = 0,
          transcriptConsumedThroughByRenderedMessageCount,
          ...rawPromptUpdate
        } = update;
        if (transcriptConsumedThroughByRenderedMessageCount !== undefined) {
          const checkpoints = transcriptConsumedThroughByRenderedMessageCount;
          if (
            checkpoints.length !== update.recentMessages.length + 1
            || checkpoints.some((seq) => !Number.isSafeInteger(seq))
            || checkpoints[0]! < observation.delivered.transcriptSeq
            || checkpoints[checkpoints.length - 1] !== update.observed.transcriptSeq
            || checkpoints.some((seq, index) => index > 0 && seq < checkpoints[index - 1]!)
            || update.recentMessages.some((message, index) => (
              (index > 0 && message.seq <= update.recentMessages[index - 1]!.seq)
              || checkpoints[index]! >= message.seq
              || checkpoints[index + 1]! < message.seq
            ))
          ) return null;
        }
        const promptUpdate = deliveryIntent === 'wake'
          ? { ...rawPromptUpdate, reason: 'human_changed_source' as const, deliveryIntent: 'wake' as const }
          : rawPromptUpdate;
        return { update: promptUpdate, sourceRecencyMs, transcriptConsumedThroughByRenderedMessageCount, readMode };
      } catch {
        // Follow is optional host context. An unavailable source remains unacknowledged and can
        // be retried by a later accepted turn through the same canonical observation owner.
        return null;
      }
    }));
    const admitted = candidateObservations.flatMap((observation, index) => {
      const update = hydrated[index];
      return update ? [{ observation, ...update }] : [];
    });
    if (signal.aborted || admitted.length === 0) return null;

    // Re-enter the server admission owner after content hydration and immediately
    // before prompt injection. A revoked/replaced edge, broadened/public audience,
    // publisher handoff, or lost destination input authority omits optional context
    // without rejecting the real turn.
    let readmitted: typeof observed;
    try {
      if (observer.kind === 'account_voice') {
        const voice = await input.session.observePendingAccountVoiceFollow({ executionRunId: executionRunId! });
        readmitted = voice.ok ? {
          ok: true,
          publisherGeneration: voice.publisherGeneration,
          executionRunOccurrenceId: voice.executionRunOccurrenceId,
          observations: voice.observations.map((entry) => ({
            sourceSessionId: entry.sourceSessionId,
            destinationSessionId: entry.voiceSessionId,
            delivered: entry.expected ?? SESSION_FOLLOW_ZERO_FRONTIER_V1,
            observed: entry.observed,
            voiceExpected: entry.expected,
            mode: 'next_turn',
          })),
        } : { ok: false };
      } else {
        readmitted = await input.session.observePendingSessionFollow();
      }
    } catch {
      return null;
    }
    if (observer.kind === 'destination_session' && readmitted.ok && readmitted.currentSourceSessionIds) {
      input.sourceMaterialController?.retainSources(readmitted.currentSourceSessionIds);
    }
    if (signal.aborted || !readmitted.ok || readmitted.publisherGeneration !== observed.publisherGeneration
      || readmitted.executionRunOccurrenceId !== observed.executionRunOccurrenceId) return null;
    if (!readmitted.observations) return null;
    const stillAdmitted = admitted.filter(({ observation }) => readmitted.observations!.some((current) => (
      current.sourceSessionId === observation.sourceSessionId
      && current.destinationSessionId === observation.destinationSessionId
      && isSessionFollowFrontierEqualV1(current.delivered, observation.delivered)
      && current.mode === observation.mode
      && (
        observer.kind !== 'account_voice'
        || (
          current.voiceExpected === null
            ? observation.voiceExpected === null
            : current.voiceExpected !== undefined
              && observation.voiceExpected !== null
              && observation.voiceExpected !== undefined
              && isSessionFollowFrontierEqualV1(current.voiceExpected, observation.voiceExpected)
        )
      )
    )));
    if (stillAdmitted.length === 0) return null;

    let budget: ReturnType<typeof applySessionFollowContextBudgetV1>;
    try {
      budget = applySessionFollowContextBudgetV1({
        candidates: stillAdmitted.map(({ observation, update, sourceRecencyMs, readMode }) => ({
          sourceSessionId: observation.sourceSessionId,
          sourceRecencyMs,
          actionableAttention: update.awareness.operational.primary === 'failed'
            || update.awareness.operational.primary === 'action_required'
            || update.awareness.operational.primary === 'permission_required',
          recentMessages: update.recentMessages.map((message) => ({ seq: message.seq, text: message.text })),
          messageSelection: readMode === 'initial_current_snapshot'
            ? 'latest_current_suffix' as const
            : 'oldest_pending_prefix' as const,
          truncated: update.truncated,
          render: ({ keptMessageSeqs, truncated }) => `${renderSessionInputContextPromptV1({
            sessionFollowUpdates: [{
              ...update,
              recentMessages: update.recentMessages.filter((message) => keptMessageSeqs.includes(message.seq)),
              truncated,
            }],
            transformedUserText: '',
          })}\n\n`,
        })),
        maxUtf8Bytes: maxFollowContextUtf8Bytes,
      });
    } catch {
      // Invalid or concurrently unreadable optional context cannot reject the admitted input.
      return null;
    }
    const admittedBySource = new Map(stillAdmitted.map((entry) => [entry.observation.sourceSessionId, entry] as const));
    const prepared = [...budget.keptBySource.keys()].flatMap((sourceSessionId) => {
      const entry = admittedBySource.get(sourceSessionId);
      if (!entry) return [];
      const { observation, update, transcriptConsumedThroughByRenderedMessageCount, readMode } = entry;
      if (budget.omittedSources.includes(observation.sourceSessionId)) return [];
      const keptSeqs = budget.keptBySource.get(observation.sourceSessionId);
      const truncated = budget.truncatedBySource.get(observation.sourceSessionId) ?? update.truncated;
      const keptMessageCount = keptSeqs?.length ?? update.recentMessages.length;
      const consumedTranscriptSeq = readMode === 'initial_current_snapshot'
        ? observation.observed.transcriptSeq
        : transcriptConsumedThroughByRenderedMessageCount?.[keptMessageCount]
          ?? (keptSeqs && keptSeqs.length > 0
            ? keptSeqs[keptSeqs.length - 1]!
            : observation.delivered.transcriptSeq);
      const filtered = keptSeqs
        ? {
            ...update,
            recentMessages: update.recentMessages.filter((message) => keptSeqs.includes(message.seq)),
            observed: {
              ...update.observed,
              transcriptSeq: consumedTranscriptSeq,
            },
            truncated,
          }
        : (truncated !== update.truncated ? { ...update, truncated } : update);
      const ackable = filtered.reason !== 'source_unavailable'
        && (
          (observer.kind === 'account_voice' && observation.voiceExpected === null)
          || compareSessionFollowFrontierProgressV1(observation.delivered, filtered.observed) === 'ahead'
        );
      return [{ observation, update: filtered, ackable }];
    });
    if (prepared.length === 0) return null;

    const wakeObservations = deliveryIntent === 'wake'
      ? normalizeSessionFollowWakeObservationsV1(prepared.map(({ observation, update }) => ({
          sourceSessionId: observation.sourceSessionId,
          expected: observation.delivered,
          consumed: update.observed,
        })))
      : undefined;
    const wakeEventLocalId = wakeObservations
      ? deriveSessionFollowWakeEventLocalIdV1({
          destinationSessionId,
          publisherGeneration: observed.publisherGeneration,
          observations: wakeObservations,
        })
      : undefined;

    return {
      updates: prepared.map(({ update }) => update),
      ...(wakeEventLocalId ? { wakeEventLocalId } : {}),
      acknowledgeAccepted: (acceptance) => {
        if (
          acceptance.kind === 'context_only_wake'
          && acceptance.eventLocalId !== wakeEventLocalId
        ) return;
        const localInputId = acceptance.kind === 'context_only_wake'
          ? acceptance.eventLocalId
          : acceptance.localInputId;
        const userMessageSeq = acceptance.kind === 'context_only_wake' ? null : acceptance.userMessageSeq;
        if (signal.aborted) return;
        for (const { observation, update, ackable } of prepared) {
          if (!ackable) continue;
          const acknowledgement = observer.kind === 'account_voice'
            ? input.session.acknowledgeAccountVoiceFollow({
                executionRunId: executionRunId!,
                expectedExecutionRunOccurrenceId: observed.executionRunOccurrenceId!,
                sourceSessionId: observation.sourceSessionId,
                expectedPublisherGeneration: observed.publisherGeneration!,
                expected: observation.voiceExpected ?? null,
                observed: observation.observed,
                consumed: update.observed,
                acceptance: { localInputId, userMessageSeq },
              })
            : input.session.acknowledgeSessionFollow({
                sourceSessionId: observation.sourceSessionId,
                expectedPublisherGeneration: observed.publisherGeneration!,
                expected: observation.delivered,
                observed: observation.observed,
                consumed: update.observed,
                acceptance: acceptance.kind === 'context_only_wake'
                  ? { ...acceptance, observations: wakeObservations! }
                  : { kind: 'admitted_input', localInputId, userMessageSeq },
              });
          void acknowledgement.then((result: SessionFollowAcknowledgeResponseV1 | unknown) => {
            // A stale/revoked ACK is an ordinary reconciliation result. The next observation
            // will retain the source frontier; do not retry or invent a second receipt here.
            void result;
          }).catch(() => {
            // Provider acceptance already happened. Lost ACKs intentionally redeliver safely.
          });
        }
      },
    };
  };
}
