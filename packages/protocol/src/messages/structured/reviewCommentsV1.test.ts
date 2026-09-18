import { describe, expect, it } from 'vitest';

import { ReviewCommentsV1Schema } from './reviewCommentsV1.js';

const comment = {
  id: 'comment-a',
  filePath: 'src/example.ts',
  source: 'file' as const,
  anchor: { kind: 'fileLine' as const, startLine: 4, lineHash: 'lh1:1234567890abcdef' },
  snapshot: { selectedLines: ['const answer = 41;'], beforeContext: [], afterContext: [] },
  body: 'Use 42.',
  createdAt: 1,
};

describe('ReviewCommentsV1Schema', () => {
  it('parses the canonical ordinary review-comment message payload', () => {
    expect(ReviewCommentsV1Schema.parse({
      sessionId: 'session-a',
      comments: [comment],
    })).toEqual({ sessionId: 'session-a', comments: [comment] });
  });

  it('rejects unknown envelope and comment fields', () => {
    expect(ReviewCommentsV1Schema.safeParse({
      sessionId: 'session-a',
      comments: [comment],
      unexpected: true,
    }).success).toBe(false);
    expect(ReviewCommentsV1Schema.safeParse({
      sessionId: 'session-a',
      comments: [{ ...comment, unexpected: true }],
    }).success).toBe(false);
  });
});
