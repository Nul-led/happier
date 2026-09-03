import { describe, expect, it } from 'vitest';

import {
  MEMORY_SEARCH_QUERY_MAX_LENGTH,
  MemorySearchErrorCodeSchema,
  MemorySearchQueryV1Schema,
  MemorySearchResultV1Schema,
} from './memorySearch.js';

describe('memory_search_result.v1 schema', () => {
  it('parses a success result', () => {
    const parsed = MemorySearchResultV1Schema.parse({
      v: 1,
      ok: true,
      hits: [
        {
          sessionId: 'sess_1',
          seqFrom: 10,
          seqTo: 25,
          createdAtFromMs: 1000,
          createdAtToMs: 2000,
          summary: 'We discussed OpenClaw memory indexing.',
          score: 0.42,
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    expect((parsed as any).hits).toHaveLength(1);
  });

  it('parses a failure result with stable error codes', () => {
    expect(MemorySearchErrorCodeSchema.parse('memory_disabled')).toBe('memory_disabled');
    const parsed = MemorySearchResultV1Schema.parse({
      v: 1,
      ok: false,
      errorCode: 'memory_disabled',
      error: 'Memory search is disabled.',
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('MemorySearchQueryV1Schema', () => {
  it('parses a basic query', () => {
    const parsed = MemorySearchQueryV1Schema.parse({
      v: 1,
      query: 'openclaw',
      scope: { type: 'global' },
      mode: 'auto',
      maxResults: 20,
      minScore: 0.15,
    });
    expect(parsed.query).toBe('openclaw');
  });

  it('parses an additive eligible Session identity filter', () => {
    const parsed = MemorySearchQueryV1Schema.parse({
      v: 1,
      query: 'openclaw',
      scope: { type: 'global' },
      mode: 'auto',
      eligibleSessionIds: ['archived-1', 'archived-2'],
    });

    expect(parsed.eligibleSessionIds).toEqual(['archived-1', 'archived-2']);
  });

  it('rejects a query past the shared length bound that blocks the FTS boundary', () => {
    const atBound = {
      v: 1,
      query: 'x'.repeat(MEMORY_SEARCH_QUERY_MAX_LENGTH),
      scope: { type: 'global' },
      mode: 'auto',
    };
    expect(MemorySearchQueryV1Schema.safeParse(atBound).success).toBe(true);
    expect(MemorySearchQueryV1Schema.safeParse({
      ...atBound,
      query: 'x'.repeat(MEMORY_SEARCH_QUERY_MAX_LENGTH + 1),
    }).success).toBe(false);
  });
});
