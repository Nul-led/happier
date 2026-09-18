import { Platform } from 'react-native';

import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { isDesktopHost } from '@/utils/platform/desktopHost';

import { resolveRoutineServerSelectionScope } from './serverSelectionScope';

export type OpenRouteWithEstablishedHomeResult = 'opened' | 'blocked';

/**
 * Account-scoped screens edit whichever Home is currently active, so a caller that starts from a
 * specific Session/Home must establish that Home first and open the destination only once the
 * switch actually took effect. A blocked or unfinished switch navigates nowhere rather than
 * silently editing the previous Account.
 */
export async function openRouteWithEstablishedHome(params: Readonly<{
    serverId: string;
    navigate: () => void;
    refreshAuth?: (() => Promise<void>) | null;
}>): Promise<OpenRouteWithEstablishedHomeResult> {
    const result = await setActiveServerAndSwitch({
        serverId: params.serverId,
        scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
        refreshAuth: params.refreshAuth ?? null,
    });
    if (result === 'blocked') return 'blocked';
    if (!areServerProfileIdentifiersEquivalent(getActiveServerSnapshot().serverId, params.serverId)) {
        return 'blocked';
    }
    params.navigate();
    return 'opened';
}
