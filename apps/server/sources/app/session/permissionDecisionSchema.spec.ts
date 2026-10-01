import { describe, expect, it } from 'vitest';
import { SessionPermissionApprovalReviewerClaimV1Schema, SessionPermissionDecisionActorV1Schema } from '@happier-dev/protocol';

describe('persisted approval reviewer decision contract', () => {
    const claim = { version: 1, origin: 'approvalReviewer', decision: 'approved', scope: 'request' };
    it('accepts only the strict request-scoped reviewer origin', () => {
        expect(SessionPermissionApprovalReviewerClaimV1Schema.safeParse(claim).success).toBe(true);
        for (const extra of [{ scope: 'session' }, { decision: 'approved_for_session' }, { actor: { kind: 'accountUser' } }, { execPolicyAmendment: { command: ['git'] } }]) {
            expect(SessionPermissionApprovalReviewerClaimV1Schema.safeParse({ ...claim, ...extra }).success).toBe(false);
        }
        expect(SessionPermissionDecisionActorV1Schema.safeParse({ kind: 'approvalReviewer' }).success).toBe(true);
        expect(SessionPermissionDecisionActorV1Schema.safeParse({ kind: 'approvalReviewer', accountId: 'human' }).success).toBe(false);
    });
});
