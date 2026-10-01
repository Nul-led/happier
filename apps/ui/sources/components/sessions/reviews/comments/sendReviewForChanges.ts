import { resolveReviewCommentDraftAnchorsForPrompt } from '@/components/sessions/reviews/comments/resolveReviewCommentDraftAnchorsForPrompt';
import { buildReviewCommentsOutboundMessage } from '@/sync/domains/input/reviewComments/buildReviewCommentsOutboundMessage';
import { filterReviewCommentDraftsIncludedInPrompt } from '@/sync/domains/input/reviewComments/reviewCommentPrompt';
import type { ReviewCommentDraft } from '@/sync/domains/input/reviewComments/reviewCommentTypes';
import type { ServerAccountScopeLifetime } from '@/sync/domains/scope/serverAccountScope';
import type { WorkspaceScopeBase } from '@/sync/domains/workspaces/workspaceScope';
import {
    captureSessionDraftCurrentness,
    clearSessionDraftCurrentness,
    getSessionDraftSnapshot,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { sync } from '@/sync/sync';

export type SendReviewForChangesOutcome =
    /** The message reached its durable handoff; the draft text and the sent comments were cleared. */
    | 'sent'
    /** No comment rides along; nothing was sent. */
    | 'nothing'
    /**
     * The session draft holds more than text (mentions, attachments, a recipient): those belong to the
     * main composer's own send, so the caller hands off to it instead of dropping them.
     */
    | 'handoff'
    /** The send was refused; the draft and the comments are kept. */
    | 'failed';

/**
 * "Ask for changes" from Review (details lab 2, SG; orchestrator Q3). There is one send path: the
 * message is the same one the session composer builds for these comments
 * (`buildReviewCommentsOutboundMessage` over the included comments plus the session draft's text), and
 * it goes through the canonical session send owner (`sync.submitMessage` → `submitSessionUserMessage`).
 * The session draft is read and cleared through its one owner, the draft repository, only for the
 * exact value captured before sending — a newer edit survives.
 */
export async function sendReviewForChanges(input: Readonly<{
    sessionId: string;
    serverId?: string | null;
    accountLifetime: Pick<ServerAccountScopeLifetime, 'scope' | 'isCurrent'>;
    drafts: readonly ReviewCommentDraft[];
    reviewScope: WorkspaceScopeBase | null;
    /** Removes the comments that were sent (the review-comment drafts' own owner). */
    clearSentDrafts: (sent: readonly ReviewCommentDraft[]) => void;
}>): Promise<SendReviewForChangesOutcome> {
    const included = filterReviewCommentDraftsIncludedInPrompt(input.drafts);
    if (included.length === 0) return 'nothing';
    if (!input.accountLifetime.isCurrent()) return 'failed';

    const scope = input.accountLifetime.scope;
    const address = { kind: 'session', sessionId: input.sessionId } as const;
    const snapshot = getSessionDraftSnapshot(scope, address);
    const composer = snapshot?.document.composer ?? null;
    if (composer && (hasItems(composer.mentions.value) || hasItems(composer.attachments.value))) return 'handoff';
    const additionalMessage = typeof composer?.text.value === 'string' ? composer.text.value : '';
    const currentness = snapshot ? captureSessionDraftCurrentness({ scope, address }) : null;

    const resolved = await resolveReviewCommentDraftAnchorsForPrompt({ drafts: included, reviewScope: input.reviewScope });
    const outbound = buildReviewCommentsOutboundMessage({ sessionId: input.sessionId, drafts: resolved, additionalMessage });

    let handedOff = false;
    const clearOnce = () => {
        if (handedOff) return;
        handedOff = true;
        if (currentness && input.accountLifetime.isCurrent()) {
            void clearSessionDraftCurrentness({ scope, address, currentness, clearComposerReferencesWithCurrentText: true });
        }
        input.clearSentDrafts(included);
    };
    try {
        await sync.submitMessage(input.sessionId, outbound.text, outbound.displayText, outbound.metaOverrides, {
            ...(input.serverId ? { serverId: input.serverId } : {}),
            callerSurface: 'session_review_comment_composer',
            onOutboundHandoff: clearOnce,
        });
    } catch {
        return handedOff ? 'sent' : 'failed';
    }
    clearOnce();
    return 'sent';
}

function hasItems(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}
