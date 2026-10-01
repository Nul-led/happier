import { createSessionDetailsTerminalTab } from '@/components/sessions/terminal/embeddedTerminalDocking';
import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';

export const SESSION_DETAILS_SCM_REVIEW_TAB_KEY = 'scmReview:working';
export const SESSION_DETAILS_SCM_STASH_TAB_KEY = 'scmStash';
export const SESSION_DETAILS_SCM_PULL_REQUEST_TAB_KEY = 'scmPullRequest';
export const SESSION_DETAILS_BOARD_TAB_KEY = 'board';

export type SessionBoardDetailsFocusTarget = Readonly<{
    kind: 'item';
    itemId: string;
}>;

export type SessionDiscussionDetailsTarget =
    | Readonly<{ kind: 'new'; address: SessionAddress }>
    | Readonly<{ kind: 'discussion'; address: SessionAddress; discussionId: string }>;

export function createSessionDiscussionDetailsTab(
    target: SessionDiscussionDetailsTarget & Readonly<{ title?: string | null }>,
) {
    const targetKey = target.kind === 'new' ? 'new' : target.discussionId;
    return {
        key: `discussion:${sessionAddressKey(target.address)}:${targetKey}`,
        kind: 'discussion' as const,
        title: target.kind === 'new'
            ? t('session.collaboration.discussion.newDiscussion')
            : target.title?.trim() || t('session.collaboration.discussion.title'),
        resource: {
            kind: 'discussion' as const,
            target: target.kind === 'new'
                ? { kind: 'new' as const, address: target.address }
                : {
                    kind: 'discussion' as const,
                    address: target.address,
                    discussionId: target.discussionId,
                },
        },
    };
}

/**
 * The Board destination, and — with an item — that item's own expanded
 * destination. They must not share a key: a single `board` tab instance would make
 * the second "Open in Details" reuse the first tab and silently drop its itemId.
 */
export function createSessionBoardDetailsTab(focusTarget?: SessionBoardDetailsFocusTarget) {
    const itemId = focusTarget?.kind === 'item' ? focusTarget.itemId.trim() : '';
    return {
        key: itemId ? `${SESSION_DETAILS_BOARD_TAB_KEY}:${itemId}` : SESSION_DETAILS_BOARD_TAB_KEY,
        kind: 'board' as const,
        title: t('sessionBoard.title'),
        resource: {
            kind: 'board' as const,
            ...(itemId ? { focusTarget: { kind: 'item' as const, itemId } } : {}),
        },
    };
}

export function createSessionFileDetailsTab(fullPath: string) {
    const fileName = fullPath.split('/').pop() ?? fullPath;
    return {
        key: `file:${fullPath}`,
        kind: 'file' as const,
        title: fileName,
        resource: { kind: 'file' as const, path: fullPath },
    };
}

export function createSessionCommitDetailsTab(sha: string) {
    const safeSha = sha.trim().split(/\s+/)[0] ?? '';
    if (!safeSha) {
        return null;
    }
    return {
        key: `commit:${safeSha}`,
        kind: 'commit' as const,
        title: safeSha.slice(0, 7),
        resource: { kind: 'commit' as const, sha: safeSha },
    };
}

export function createSessionScmReviewDetailsTab() {
    return {
        key: SESSION_DETAILS_SCM_REVIEW_TAB_KEY,
        kind: 'scmReview' as const,
        title: t('files.toolbar.review'),
        resource: { kind: 'scmReview' as const, scope: 'working' as const },
    };
}

export function createSessionScmStashDetailsTab() {
    return {
        key: SESSION_DETAILS_SCM_STASH_TAB_KEY,
        kind: 'scmStash' as const,
        title: t('files.stash.detailsTitle'),
        resource: { kind: 'scmStash' as const },
    };
}

/** The session's new pull request form, moved out of the Git sidebar (Git lab PRD). One per session. */
export function createSessionScmPullRequestDetailsTab() {
    return {
        key: SESSION_DETAILS_SCM_PULL_REQUEST_TAB_KEY,
        kind: 'scmPullRequest' as const,
        title: t('sessionGitPullRequest.form.title'),
        resource: { kind: 'scmPullRequest' as const },
    };
}

export { createSessionDetailsTerminalTab };
