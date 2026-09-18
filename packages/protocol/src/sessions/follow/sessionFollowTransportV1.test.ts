import { describe, expect, it } from 'vitest';

import {
  buildSessionFollowWakeEventLocalId,
  deriveSessionFollowWakeEventLocalIdV1,
  isSessionFollowWakeEventLocalId,
  SessionFollowAcknowledgeRequestV1Schema,
  SessionFollowAcknowledgeResponseV1Schema,
  SessionFollowObservePendingResponseV1Schema,
} from './sessionFollowTransportV1.js';

const frontier = { transcriptSeq: 1, readyEventSeq: 2, agentStateVersion: 3, turn: null } as const;
const wakeObservations = [{
  sourceSessionId: 'source',
  expected: frontier,
  consumed: { ...frontier, transcriptSeq: 4 },
}] as const;

describe('Session Follow socket transport V1', () => {
  it('derives one stable wake event identity from the exact accepted frontier set', () => {
    const first = deriveSessionFollowWakeEventLocalIdV1({
      destinationSessionId: 'destination',
      publisherGeneration: '7',
      observations: [
        {
          sourceSessionId: 'source-b',
          expected: frontier,
          consumed: { ...frontier, transcriptSeq: 4 },
        },
        {
          sourceSessionId: 'source-a',
          expected: frontier,
          consumed: { ...frontier, transcriptSeq: 3 },
        },
      ],
    });
    const retry = deriveSessionFollowWakeEventLocalIdV1({
      destinationSessionId: 'destination',
      publisherGeneration: '7',
      observations: [
        {
          sourceSessionId: 'source-a',
          expected: frontier,
          consumed: { ...frontier, transcriptSeq: 3 },
        },
        {
          sourceSessionId: 'source-b',
          expected: frontier,
          consumed: { ...frontier, transcriptSeq: 4 },
        },
      ],
    });
    const laterFrontier = deriveSessionFollowWakeEventLocalIdV1({
      destinationSessionId: 'destination',
      publisherGeneration: '7',
      observations: [{
        sourceSessionId: 'source-a',
        expected: frontier,
        consumed: { ...frontier, transcriptSeq: 4 },
      }],
    });

    expect(first).toBe(retry);
    expect(first).toMatch(/^session-follow-wake:[A-Za-z0-9_-]{43}$/u);
    expect(laterFrontier).not.toBe(first);
    expect(deriveSessionFollowWakeEventLocalIdV1({
      destinationSessionId: 'destination',
      publisherGeneration: '8',
      observations: wakeObservations,
    })).not.toBe(deriveSessionFollowWakeEventLocalIdV1({
      destinationSessionId: 'destination',
      publisherGeneration: '7',
      observations: wakeObservations,
    }));
  });

  it('keeps observe responses strict and carries the publisher fence as a decimal string', () => {
    const parsed = SessionFollowObservePendingResponseV1Schema.safeParse({
      ok: true, v: 1, sessionId: 'destination', publisherGeneration: '0', observations: [],
      ignored: true,
    });
    expect(parsed.success).toBe(false);
    expect(SessionFollowObservePendingResponseV1Schema.parse({
      ok: true, v: 1, sessionId: 'destination', publisherGeneration: '42', currentSourceSessionIds: ['source'], observations: [],
    }).publisherGeneration).toBe('42');
    expect(SessionFollowObservePendingResponseV1Schema.safeParse({
      ok: true, v: 1, sessionId: 'destination', publisherGeneration: '42', observations: [],
    }).success).toBe(false);
  });

  it('requires the exact relation, frontiers, and provider acceptance identity for ACK', () => {
    const parsed = SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7',
      expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'admitted_input', localInputId: 'input-1', userMessageSeq: null },
    });
    expect(parsed.success).toBe(true);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7',
      expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { localInputId: 'input-1', userMessageSeq: null },
    }).success).toBe(false);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7',
      expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'admitted_input', localInputId: 'input-1', userMessageSeq: null }, extra: true,
    }).success).toBe(false);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'same', sourceSessionId: 'same',
      expectedPublisherGeneration: '7',
      expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'admitted_input', localInputId: 'input-1', userMessageSeq: null },
    }).success).toBe(false);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7', expectedMode: 'next_turn',
      expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'admitted_input', localInputId: 'input-1', userMessageSeq: null },
    }).success).toBe(false);
    const wakeEventLocalId = buildSessionFollowWakeEventLocalId('wake-1');
    expect(isSessionFollowWakeEventLocalId(wakeEventLocalId)).toBe(true);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7', expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'context_only_wake', eventLocalId: wakeEventLocalId, observations: wakeObservations },
    }).success).toBe(true);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7', expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'context_only_wake', eventLocalId: wakeEventLocalId },
    }).success).toBe(false);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7', expected: frontier, observed: frontier, consumed: frontier,
      acceptance: {
        kind: 'context_only_wake',
        eventLocalId: wakeEventLocalId,
        observations: [...wakeObservations, ...wakeObservations],
      },
    }).success).toBe(false);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7', expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'context_only_wake', eventLocalId: 'fabricated-wake-1', observations: wakeObservations },
    }).success).toBe(false);
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7', expected: frontier, observed: frontier, consumed: frontier,
      acceptance: { kind: 'context_only_wake', localInputId: wakeEventLocalId },
    }).success).toBe(false);
  });

  it('requires the exact observed frontier in every ACK', () => {
    expect(SessionFollowAcknowledgeRequestV1Schema.safeParse({
      v: 1,
      destinationSessionId: 'destination', sourceSessionId: 'source',
      expectedPublisherGeneration: '7', expected: frontier, consumed: frontier,
      acceptance: { kind: 'admitted_input', localInputId: 'input-1', userMessageSeq: null },
    }).success).toBe(false);
  });

  it('parses both ACK response branches with canonical session ids', () => {
    expect(SessionFollowAcknowledgeResponseV1Schema.parse({
      ok: true,
      v: 1,
      destinationSessionId: 'destination',
      sourceSessionId: 'source',
      delivered: frontier,
    })).toMatchObject({ ok: true, destinationSessionId: 'destination' });
    expect(SessionFollowAcknowledgeResponseV1Schema.parse({
      ok: false,
      v: 1,
      error: 'source_forbidden',
    })).toEqual({ ok: false, v: 1, error: 'source_forbidden' });
    expect(SessionFollowAcknowledgeResponseV1Schema.parse({
      ok: false,
      v: 1,
      error: 'provider_acceptance_unverified',
    })).toEqual({ ok: false, v: 1, error: 'provider_acceptance_unverified' });
    expect(SessionFollowAcknowledgeResponseV1Schema.parse({
      ok: false,
      v: 1,
      error: 'unsupported',
    })).toEqual({ ok: false, v: 1, error: 'unsupported' });
  });
});
