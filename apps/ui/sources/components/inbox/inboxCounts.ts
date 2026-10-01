import type { InboxModel } from '@/hooks/inbox/useInboxModel';

/** How many rows the "Needs you" view holds: work-group rows plus approvals and operations. */
export function countInboxNeedsYou(model: InboxModel): number {
    let count = model.openApprovals.length + model.actionOperationEntries.length;
    for (const group of model.workGroups) count += group.items.length;
    return count;
}

/** How many rows the "Updates" view holds: finished sessions to read and friend requests. */
export function countInboxUpdates(model: InboxModel): number {
    return model.sessionPresentation.readySessions.length + model.friendRequests.length;
}
