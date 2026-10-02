import type { SessionListFilterV1, WorkflowRunSummaryV1 } from '@happier-dev/protocol';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

/** Mounting a Home does not make the active Account's Run window answer for it. */
export function resolveWorkflowRunUnavailableHomes(input: Readonly<{
    selectedHomeServerIds: readonly string[];
    mountedHomeServerIds: readonly string[];
    servedHomeServerId: string | null;
}>): readonly Readonly<{ serverId: string; reason: 'not_selected' | 'unsupported' }>[] {
    return input.selectedHomeServerIds.flatMap((serverId) => {
        if (input.servedHomeServerId
            && areServerProfileIdentifiersEquivalent(serverId, input.servedHomeServerId)) return [];
        const reason = input.mountedHomeServerIds.some((home) => areServerProfileIdentifiersEquivalent(home, serverId))
            ? 'unsupported' as const : 'not_selected' as const;
        return [{ serverId, reason }];
    });
}

/** The same authorized lean Run membership predicate for Sessions and Boards. */
export function workflowRunMatchesSessionListFilter(
    run: WorkflowRunSummaryV1,
    serverId: string,
    filter: SessionListFilterV1,
): boolean {
    if (filter.show === 'sessions' || !filter.homeServerIds.some((home) => areServerProfileIdentifiersEquivalent(home, serverId))) return false;
    // The incumbent unfiltered Run feed is Account-owned. Runs have neither
    // Session following/assignment nor Session tags or external-session storage.
    if (filter.scope === 'following' || filter.scope === 'assigned_to_me'
        || filter.tagIds.length > 0 || filter.source === 'direct') return false;
    if (filter.audiences.length > 0 && !filter.audiences.some((audience) => (
        areServerProfileIdentifiersEquivalent(audience.serverId, serverId) && (
            audience.kind === 'outside_teams' ? run.visibleTeamId === null
                : audience.kind === 'team' && audience.teamId === run.visibleTeamId
        )
    ))) return false;
    if (filter.attention === 'needs_my_attention' && run.attentionRequired !== true) return false;
    if (run.attentionRequired === true) return true;
    const starter = run.startedBy === 'user' ? 'you' : run.startedBy === 'agent' ? 'agents'
        : run.startedBy === 'trigger' ? 'triggers' : null;
    return starter !== null && filter.startedBy.includes(starter);
}
