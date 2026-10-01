import { describe, expect, it } from 'vitest';

import { SessionStoredMessageContentSchema, StrictSessionStoredMessageContentEnvelopeSchema } from './sessionStoredMessageContent.js';

describe('SessionStoredMessageContentSchema', () => {
  it('accepts encrypted envelope', () => {
    const parsed = SessionStoredMessageContentSchema.safeParse({ t: 'encrypted', c: 'aGVsbG8=' });
    expect(parsed.success).toBe(true);
  });

  it('coerces legacy ciphertext string to encrypted envelope', () => {
    const parsed = SessionStoredMessageContentSchema.safeParse('aGVsbG8=');
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ t: 'encrypted', c: 'aGVsbG8=' });
    }
  });

  it('coerces legacy ciphertext object to encrypted envelope', () => {
    const parsed = SessionStoredMessageContentSchema.safeParse({ ciphertext: 'aGVsbG8=' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ t: 'encrypted', c: 'aGVsbG8=' });
    }
  });

  it('accepts plain envelope', () => {
    const parsed = SessionStoredMessageContentSchema.safeParse({ t: 'plain', v: { type: 'user', text: 'hi' } });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown envelope', () => {
    const parsed = SessionStoredMessageContentSchema.safeParse({ t: 'nope', c: 'x' });
    expect(parsed.success).toBe(false);
  });
  it('requires an explicit plain value at the strict envelope boundary', () => {
    expect(StrictSessionStoredMessageContentEnvelopeSchema.safeParse({ t: 'plain' }).success).toBe(false);
    expect(StrictSessionStoredMessageContentEnvelopeSchema.safeParse({ t: 'plain', v: undefined }).success).toBe(false);
    expect(StrictSessionStoredMessageContentEnvelopeSchema.safeParse({ t: 'plain', v: null }).success).toBe(true);
  });
});
