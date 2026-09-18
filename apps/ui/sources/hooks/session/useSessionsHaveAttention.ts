import { useActivityOverview } from '@/activity/source/useActivityOverview';

/**
 * Whether any Session currently wants the viewer, for the Sessions tab dot.
 *
 * The same mounted Activity projection the Inbox dot reads: one overview, one
 * clock. A second local `buildActivityOverviewFromSource` here would answer
 * from whatever instant it last rendered at, so the dot would outlive the
 * attention that lit it.
 */
export function useSessionsHaveAttention(): boolean {
    const { overview } = useActivityOverview();

    return overview.counts.totalAttention > 0;
}
