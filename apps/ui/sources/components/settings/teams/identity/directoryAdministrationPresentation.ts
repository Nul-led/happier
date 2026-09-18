import type { TeamDirectorySourceSummaryV1 } from '@happier-dev/protocol/teams';

export type DirectorySourcePresentationState =
    | 'initializing'
    | 'syncing'
    | 'failed'
    | 'stale'
    | 'never_synced'
    | 'active'
    | 'paused'
    | 'needs_attention';

/**
 * The server projects lifecycle `state`, `sync.attempt` and `sync.freshness`
 * as three facets on purpose, and this is their one presentation precedence:
 * lifecycle first, then the outstanding attempt, then a recorded failure, then
 * freshness. A run token that outlived its operation window is already a
 * failed attempt on the wire, so a stalled import stops animating here, and a
 * source whose worker has not succeeded in twice its target window reads stale
 * rather than active. Clocks never enter this decision.
 */
export function directorySourcePresentationState(
    source: TeamDirectorySourceSummaryV1,
): DirectorySourcePresentationState {
    if (source.state === 'paused') return 'paused';
    if (source.state === 'needs_attention') return 'needs_attention';
    if (source.sync.attempt === 'syncing') return 'syncing';
    if (source.sync.attempt === 'failed' || source.error !== null) return 'failed';
    if (source.state === 'initializing') return 'initializing';
    if (source.sync.attempt === 'never' || source.sync.freshness === 'never_synced') return 'never_synced';
    if (source.sync.freshness === 'stale') return 'stale';
    return 'active';
}
