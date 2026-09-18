import { describe, expect, it } from 'vitest';

import {
  applySessionFollowContextBudgetV1,
  measureSessionFollowUtf8Bytes,
  resolveSessionFollowContextUtf8AllowanceV1,
  SESSION_FOLLOW_CONTEXT_V1_MEASURED_FALLBACK_UTF8_BYTES,
} from './sessionFollowContextBudget';

// Recorded 2026-09-08 from fully framed samples using the official
// @anthropic-ai/tokenizer and js-tiktoken o200k_base packages. The temporary
// measurement install was removed and is deliberately not a runtime dependency.
const PROVIDER_CONTEXT_MEASUREMENT_V1 = [
  { corpus: 'ascii', bytes: 4_096, anthropicTokens: 720, openAiTokens: 718 },
  { corpus: 'cjk', bytes: 4_094, anthropicTokens: 1_074, openAiTokens: 975 },
  { corpus: 'emoji_zwj', bytes: 4_096, anthropicTokens: 2_453, openAiTokens: 1_962 },
  { corpus: 'combining_marks', bytes: 3_860, anthropicTokens: 1_287, openAiTokens: 2_559 },
  { corpus: 'xml_escaped', bytes: 3_605, anthropicTokens: 3_072, openAiTokens: 2_048 },
] as const;

function candidate(input: Readonly<{
  sourceSessionId: string;
  sourceRecencyMs: number;
  actionableAttention?: boolean;
  recentMessages: readonly Readonly<{ seq: number; text: string }>[];
  renderedOverhead?: string;
  messageSelection?: 'oldest_pending_prefix' | 'latest_current_suffix';
}>) {
  return {
    ...input,
    actionableAttention: input.actionableAttention ?? false,
    truncated: false,
    render: ({ keptMessageSeqs, truncated }: Readonly<{ keptMessageSeqs: readonly number[]; truncated: boolean }>) => [
      input.renderedOverhead ?? '',
      ...input.recentMessages.filter((message) => keptMessageSeqs.includes(message.seq)).map((message) => message.text),
      truncated ? 'truncated' : '',
    ].join(''),
  };
}

describe('Session Follow UTF-8 budget', () => {
  it('records the conservative provider-context measurement behind the V1 fallback', () => {
    expect(SESSION_FOLLOW_CONTEXT_V1_MEASURED_FALLBACK_UTF8_BYTES).toBe(4_096);
    for (const sample of PROVIDER_CONTEXT_MEASUREMENT_V1) {
      expect(sample.anthropicTokens, sample.corpus).toBeLessThanOrEqual(sample.bytes);
      expect(sample.openAiTokens, sample.corpus).toBeLessThanOrEqual(sample.bytes);
    }
  });

  it('uses the recorded provider-tokenizer fallback when current usage evidence is unavailable', () => {
    expect(resolveSessionFollowContextUtf8AllowanceV1({
      requiredPrompt: 'the admitted user input always wins',
      activeModelId: 'claude-sonnet-4-6',
      contextUsage: null,
    })).toEqual({
      maxUtf8Bytes: SESSION_FOLLOW_CONTEXT_V1_MEASURED_FALLBACK_UTF8_BYTES,
      basis: 'measured_fallback',
    });
  });

  it('derives conservative remaining capacity only from matching authoritative provider usage', () => {
    expect(resolveSessionFollowContextUtf8AllowanceV1({
      requiredPrompt: 'four',
      activeModelId: 'model-a',
      contextUsage: {
        v: 1,
        modelId: 'model-a',
        usedTokens: 90,
        windowTokens: 100,
        totalProcessedTokens: null,
        baselineTokens: null,
        isAutoCompactEnabled: null,
        categories: null,
        observedAtMs: 1,
        source: 'provider_live',
      },
    })).toEqual({ maxUtf8Bytes: 6, basis: 'authoritative_remaining' });

    expect(resolveSessionFollowContextUtf8AllowanceV1({
      requiredPrompt: 'four',
      activeModelId: 'model-b',
      contextUsage: {
        v: 1,
        modelId: 'model-a',
        usedTokens: 90,
        windowTokens: 100,
        totalProcessedTokens: null,
        baselineTokens: null,
        isAutoCompactEnabled: null,
        categories: null,
        observedAtMs: 1,
        source: 'provider_live',
      },
    })).toEqual({
      maxUtf8Bytes: SESSION_FOLLOW_CONTEXT_V1_MEASURED_FALLBACK_UTF8_BYTES,
      basis: 'measured_fallback',
    });
  });

  it('measures multibyte sequences exactly and never splits them', () => {
    expect(measureSessionFollowUtf8Bytes('a')).toBe(1);
    expect(measureSessionFollowUtf8Bytes('é')).toBe(2);
    expect(measureSessionFollowUtf8Bytes('😀')).toBe(4);
  });

  it('admits no optional Follow context when no authoritative allowance is available', () => {
    const decision = applySessionFollowContextBudgetV1({
      candidates: [candidate({ sourceSessionId: 'a', sourceRecencyMs: 1, recentMessages: [{ seq: 1, text: 'a' }] })],
      maxUtf8Bytes: null,
    });
    expect(decision.omittedSources).toEqual(['a']);
    expect(decision.keptBySource.size).toBe(0);
  });

  it('keeps an older fitting prefix while deferring an overlarge newer message, then admits later sources', () => {
    const decision = applySessionFollowContextBudgetV1({
      candidates: [
        candidate({
          sourceSessionId: 'a',
          sourceRecencyMs: 10,
          recentMessages: [
            { seq: 8, text: 'old' },
            { seq: 9, text: 'x'.repeat(9_000) },
          ],
        }),
        candidate({
          sourceSessionId: 'b',
          sourceRecencyMs: 9,
          recentMessages: [{ seq: 9, text: 'small' }],
        }),
      ],
      maxUtf8Bytes: 8_192,
    });
    expect(decision.omittedSources).toEqual([]);
    expect(decision.keptBySource.get('a')).toEqual([8]);
    expect(decision.keptBySource.get('b')).toEqual([9]);
    expect(decision.truncatedBySource.get('a')).toBe(true);
  });

  it('keeps the oldest contiguous complete prefix when only part of a source fits', () => {
    const decision = applySessionFollowContextBudgetV1({
      candidates: [candidate({
        sourceSessionId: 'source',
        sourceRecencyMs: 1,
        recentMessages: [
          { seq: 2, text: 'old'.repeat(4) },
          { seq: 3, text: 'newer'.repeat(2) },
          { seq: 4, text: 'latest' },
        ],
      })],
      maxUtf8Bytes: 25,
    });

    expect(decision.keptBySource.get('source')).toEqual([2]);
    expect(decision.truncatedBySource.get('source')).toBe(true);
  });

  it('keeps the latest contiguous complete suffix for a current snapshot', () => {
    const decision = applySessionFollowContextBudgetV1({
      candidates: [candidate({
        sourceSessionId: 'source',
        sourceRecencyMs: 1,
        messageSelection: 'latest_current_suffix',
        recentMessages: [
          { seq: 598, text: 'old'.repeat(4) },
          { seq: 599, text: 'newer'.repeat(2) },
          { seq: 600, text: 'latest' },
        ],
      })],
      maxUtf8Bytes: 25,
    });

    expect(decision.keptBySource.get('source')).toEqual([599, 600]);
    expect(decision.truncatedBySource.get('source')).toBe(true);
  });

  it('orders actionable attention before recency and sourceSessionId', () => {
    const decision = applySessionFollowContextBudgetV1({
      candidates: [
        candidate({ sourceSessionId: 'newer', sourceRecencyMs: 9, recentMessages: [{ seq: 9, text: 'n' }] }),
        candidate({ sourceSessionId: 'b', sourceRecencyMs: 5, actionableAttention: true, recentMessages: [{ seq: 5, text: 'b' }] }),
        candidate({ sourceSessionId: 'a', sourceRecencyMs: 5, actionableAttention: true, recentMessages: [{ seq: 5, text: 'a' }] }),
      ],
      maxUtf8Bytes: 1,
    });
    // Only one byte fits: actionable sources beat a newer ordinary source, then `a` wins the tie.
    expect(decision.keptBySource.has('a')).toBe(true);
    expect(decision.omittedSources).toEqual(['b', 'newer']);

    const allFit = applySessionFollowContextBudgetV1({
      candidates: [
        candidate({ sourceSessionId: 'newer', sourceRecencyMs: 9, recentMessages: [{ seq: 9, text: 'n' }] }),
        candidate({ sourceSessionId: 'actionable', sourceRecencyMs: 1, actionableAttention: true, recentMessages: [{ seq: 1, text: 'a' }] }),
      ],
      maxUtf8Bytes: 100,
    });
    expect([...allFit.keptBySource.keys()]).toEqual(['actionable', 'newer']);
  });

  it('charges the fully rendered Follow block, including awareness and framing overhead', () => {
    const decision = applySessionFollowContextBudgetV1({
      candidates: [candidate({
        sourceSessionId: 'a',
        sourceRecencyMs: 1,
        recentMessages: [{ seq: 1, text: 'x' }],
        renderedOverhead: '1234567890',
      })],
      maxUtf8Bytes: 10,
    });
    expect(decision.omittedSources).toEqual(['a']);
    expect(decision.keptBySource.size).toBe(0);
  });
});
