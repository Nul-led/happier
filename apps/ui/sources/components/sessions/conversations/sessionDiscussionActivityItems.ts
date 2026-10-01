import type { SessionDiscussionOpenedSummaryV1 } from '@happier-dev/protocol';

/**
 * One row of the Conversations list in the Collaboration pane (Lane 05 canonical owner).
 *
 * Collaboration is about people: Agent conversations live only in the Agents tab (lab `collab` A3),
 * so this list holds the Conversations heading and its creation action, the conversations with
 * people, and the section's own state while there are none to show.
 *
 * The union stays exhaustive and closed: the renderer is a switch, never a
 * registry, and no member exists without a producer here.
 */
export type SessionDiscussionActivityItem =
    | Readonly<{ kind: 'human_section' }>
    | Readonly<{ kind: 'human_discussion'; discussion: SessionDiscussionOpenedSummaryV1 }>
    /** The first page is still being read: its rows are reserved, never a blank body. */
    | Readonly<{ kind: 'human_pending' }>
    | Readonly<{ kind: 'human_empty' }>;

/** Stable per-item list identity. */
export function sessionDiscussionActivityItemKey(item: SessionDiscussionActivityItem): string {
    switch (item.kind) {
        case 'human_section':
        case 'human_pending':
        case 'human_empty':
            return `section:${item.kind}`;
        case 'human_discussion':
            return `discussion:${item.discussion.id}`;
    }
}

/**
 * Compose the section without owning its source: summaries arrive already activity-ordered from the
 * discussion repository, so this projection preserves that order rather than imposing another.
 */
export function buildSessionDiscussionActivityItems(input: Readonly<{
    discussions: readonly SessionDiscussionOpenedSummaryV1[];
    /** The list has never settled yet, so it reserves rows instead of stating "empty". */
    humanListPending: boolean;
}>): readonly SessionDiscussionActivityItem[] {
    const items: SessionDiscussionActivityItem[] = [{ kind: 'human_section' }];
    for (const discussion of input.discussions) {
        items.push({ kind: 'human_discussion', discussion });
    }
    if (input.discussions.length === 0) {
        items.push({ kind: input.humanListPending ? 'human_pending' : 'human_empty' });
    }
    return items;
}
