import { describe, expect, it } from 'vitest';
import * as comments from './index.js';
import type { ReviewCommentFingerprintV1 } from './v1.js';

type IdentityApi = {
  createReviewFindingIdentityV1: (input: { path?: string; title: string; fingerprint: ReviewCommentFingerprintV1 }) => string;
};

describe('semantic finding identity', () => {
  it('keeps one identity across lines, engines and changed file contents', () => {
    const api = comments as typeof comments & Partial<IdentityApi>;
    expect(typeof api.createReviewFindingIdentityV1).toBe('function');
    if (!api.createReviewFindingIdentityV1) return;
    const fingerprint = { normalizedMessageHash: 'message', fileSha: 'before', engineId: 'engine-a', lineRange: { startLine: 2, endLine: 3 } };
    const identity = api.createReviewFindingIdentityV1({ path: 'src/a.ts', title: 'Null check', fingerprint });
    const changed = { ...fingerprint, fileSha: 'after', engineId: 'engine-b', lineRange: { startLine: 20, endLine: 21 } };
    expect(api.createReviewFindingIdentityV1({ path: 'src/a.ts', title: '  NULL   check ', fingerprint: changed })).toBe(identity);
    expect(changed.fileSha).not.toBe(fingerprint.fileSha);
    expect(api.createReviewFindingIdentityV1({ path: 'src/b.ts', title: 'Null check', fingerprint })).not.toBe(identity);
    expect(api.createReviewFindingIdentityV1({ path: 'src/a.ts', title: 'Null check', fingerprint: { ...fingerprint, normalizedMessageHash: 'different' } })).not.toBe(identity);
  });

  it('uses rule identity ahead of the reviewer title and normalizes path separators', () => {
    const api = comments as typeof comments & Partial<IdentityApi>;
    expect(typeof api.createReviewFindingIdentityV1).toBe('function');
    if (!api.createReviewFindingIdentityV1) return;
    const fingerprint = { ruleId: 'null-check', normalizedMessageHash: 'message' };
    expect(api.createReviewFindingIdentityV1({ path: 'src\\a.ts', title: 'First title', fingerprint }))
      .toBe(api.createReviewFindingIdentityV1({ path: './src/a.ts', title: 'Other title', fingerprint }));
  });
});
