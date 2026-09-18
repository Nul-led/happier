import { describe, expect, it } from 'vitest';

import {
  SessionIdSchema,
  SessionIndexedIdentifierMaxLengthV1,
  SidechainIdSchema,
  ExecutionRunIdSchema,
} from './idsV1.js';

describe('SessionIdSchema', () => {
  it('keeps closed session identity bytes instead of normalizing surrounding whitespace', () => {
    const atLimit = 's'.repeat(SessionIndexedIdentifierMaxLengthV1);

    expect(SessionIdSchema.parse(atLimit)).toBe(atLimit);
    expect(SessionIdSchema.safeParse(' session-1 ').success).toBe(false);
    expect(SessionIdSchema.safeParse('   ').success).toBe(false);
    expect(SessionIdSchema.safeParse('s'.repeat(SessionIndexedIdentifierMaxLengthV1 + 1)).success).toBe(false);
  });
});

describe('SidechainIdSchema', () => {
  it('shares the indexed session identifier boundary', () => {
    expect(SidechainIdSchema.safeParse('s'.repeat(SessionIndexedIdentifierMaxLengthV1)).success).toBe(true);
    expect(SidechainIdSchema.safeParse('s'.repeat(SessionIndexedIdentifierMaxLengthV1 + 1)).success).toBe(false);
  });
});

describe('ExecutionRunIdSchema', () => {
  it('fits the indexed Pending routing identity on every database provider', () => {
    expect(ExecutionRunIdSchema.safeParse('r'.repeat(SessionIndexedIdentifierMaxLengthV1)).success).toBe(true);
    expect(ExecutionRunIdSchema.safeParse('r'.repeat(SessionIndexedIdentifierMaxLengthV1 + 1)).success).toBe(false);
  });
});
