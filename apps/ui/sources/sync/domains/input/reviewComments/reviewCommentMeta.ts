import {
    ReviewCommentDraftMessageV1Schema,
    ReviewCommentsV1Schema,
    type ReviewCommentsV1,
} from '@happier-dev/protocol';

import type { ReviewCommentDraft } from './reviewCommentTypes';
import { normalizeReviewCommentDrafts } from './reviewCommentDraftBody';

export const ReviewCommentDraftSchema = ReviewCommentDraftMessageV1Schema;
export { ReviewCommentsV1Schema };
export type { ReviewCommentsV1 };

export function buildReviewCommentsV1MetaPayload(params: {
    sessionId: string;
    drafts: readonly ReviewCommentDraft[];
}): ReviewCommentsV1 {
    const drafts = normalizeReviewCommentDrafts(params.drafts);
    return {
        sessionId: params.sessionId,
        comments: drafts.map((d) => {
            const comment = {
                id: d.id,
                filePath: d.filePath,
                source: d.source,
                anchor: d.anchor,
                ...(d.anchorResolution ? { anchorResolution: d.anchorResolution } : {}),
                snapshot: {
                    selectedLines: [...d.snapshot.selectedLines],
                    beforeContext: [...d.snapshot.beforeContext],
                    afterContext: [...d.snapshot.afterContext],
                },
                body: d.body,
                createdAt: d.createdAt,
            };
            return d.includeInPrompt === undefined ? comment : { ...comment, includeInPrompt: d.includeInPrompt };
        }),
    };
}

export function parseReviewCommentsV1(payload: unknown): ReviewCommentsV1 | null {
    const parsed = ReviewCommentsV1Schema.safeParse(payload);
    if (!parsed.success) return null;
    return parsed.data;
}
