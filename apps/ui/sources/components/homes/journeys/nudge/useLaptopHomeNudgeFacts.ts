import * as React from 'react';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { useHomeReachNudge } from '@/sync/runtime/connectivity/homeReachFailures';

export type LaptopHomeNudgeFacts = Readonly<{
    homeServerId: string;
    homeIdentityId: string;
    missedReachesThisWeek: number;
}>;

export function useLaptopHomeNudgeFacts(): LaptopHomeNudgeFacts | null {
    const { serverId } = useActiveServerSnapshot();
    const generation = useServerProfilesGeneration();
    const profile = React.useMemo(() => getServerProfileById(serverId), [generation, serverId]);
    const homeIdentityId = profile?.serverIdentityId ?? '';
    const nudge = useHomeReachNudge(homeIdentityId);
    // Local observations establish failed reaches, never which machine hosts the Home or why it slept.
    return React.useMemo(() => nudge.show && profile ? {
        homeServerId: profile.id,
        homeIdentityId,
        missedReachesThisWeek: nudge.failureCount,
    } : null, [homeIdentityId, nudge.failureCount, nudge.show, profile]);
}
