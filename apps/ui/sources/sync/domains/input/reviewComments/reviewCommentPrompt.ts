import {
    REVIEW_FINDINGS_VERIFY_AND_FIX_INSTRUCTIONS_V1,
    renderReviewFindingsForVerifyV1,
} from '@happier-dev/protocol';

import type { ReviewCommentDraft } from './reviewCommentTypes';
import {
    formatReviewCommentDraftAnchorLabel,
    getReviewCommentDraftAnchorPrimaryLine,
} from './anchors/reviewCommentDraftAnchor';

export function isReviewCommentDraftIncludedInPrompt(draft: ReviewCommentDraft): boolean {
    return draft.includeInPrompt !== false;
}

export function filterReviewCommentDraftsIncludedInPrompt(drafts: readonly ReviewCommentDraft[]): ReviewCommentDraft[] {
    return drafts.filter(isReviewCommentDraftIncludedInPrompt);
}

export function buildReviewCommentsPromptText(params: {
    drafts: readonly ReviewCommentDraft[];
    additionalMessage: string;
}): string {
    const drafts = filterReviewCommentDraftsIncludedInPrompt(params.drafts).sort((a, b) => {
        if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
        const aLine = getReviewCommentDraftAnchorPrimaryLine(a.anchor) ?? 0;
        const bLine = getReviewCommentDraftAnchorPrimaryLine(b.anchor) ?? 0;
        if (aLine !== bLine) return aLine - bLine;
        return a.createdAt - b.createdAt;
    });

    const rendered = renderReviewFindingsForVerifyV1(drafts.map((draft) => ({
        id: draft.id,
        title: `${draft.filePath} (${formatReviewCommentDraftAnchorLabel(draft.anchor)})`,
        filePath: draft.filePath,
        summary: draft.body,
        anchor: draft.anchor,
        snapshot: draft.snapshot,
        anchorResolution: draft.anchorResolution,
    })));

    const message = params.additionalMessage.trim();
    const messageBlock = message.length > 0 ? `\n\nAdditional message:\n${message}` : '';

    return `${REVIEW_FINDINGS_VERIFY_AND_FIX_INSTRUCTIONS_V1}\n\n${rendered}${messageBlock}`.trimEnd() + '\n';
}

export function buildReviewCommentsDisplayText(params: { drafts: readonly ReviewCommentDraft[] }): string {
    const count = params.drafts.length;
    if (count === 0) return 'Review comments';
    return `Review comments (${count})`;
}
