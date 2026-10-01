import { describe, expect, it } from 'vitest';
import * as protocol from '../index.js';
import type { ReviewFinding } from './ReviewFinding.js';

type ApplyApi = {
  REVIEW_FINDINGS_VERIFY_AND_FIX_INSTRUCTIONS_V1: string;
  REVIEW_FINDINGS_VERIFY_ONLY_INSTRUCTIONS_V1: string;
  renderReviewFindingsForVerifyV1: (findings: readonly ReviewFinding[]) => string;
};

describe('review findings verification input', () => {
  it('preserves evidence, attribution, and the durable CAS reference as labelled data', () => {
    const api = protocol as typeof protocol & Partial<ApplyApi>;
    expect(api.renderReviewFindingsForVerifyV1).toBeTypeOf('function');
    if (!api.renderReviewFindingsForVerifyV1) return;
    const finding = {
      id: 'f1', title: 'Unsafe read', severity: 'high' as const, category: 'correctness' as const,
      summary: 'Missing null check', evidence: 'reader.ts dereferences null',
      filePath: 'src/reader.ts', startLine: 20, confidence: 0.6,
      attributionConfidence: 'uncertain', threadRefs: ['thread-1'],
      comment: { id: 'comment-1', workspace: { machineId: 'machine-1', path: '/repo' }, serverRevision: 7, state: 'open' as const },
    };
    const text = api.renderReviewFindingsForVerifyV1([finding]);
    const data = JSON.parse(text.slice(text.indexOf('[')));
    expect(data).toEqual([expect.objectContaining({
      id: 'f1', evidence: finding.evidence, confidence: 0.6, attributionConfidence: 'uncertain', threadRefs: ['thread-1'],
      comment: { commentId: 'comment-1', workspace: finding.comment.workspace, expectedServerRevision: 7, expectedState: 'open' },
    })]);
  });
});
