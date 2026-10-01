import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { ProfileDetailScreen } from '@/components/settings/profiles/ProfileDetailScreen';

export function ProfileDetailRoute() {
    const params = useLocalSearchParams<{ profileId?: string | string[] }>();
    const profileId = Array.isArray(params.profileId) ? params.profileId[0] : params.profileId;
    if (!profileId) return null;
    return <ProfileDetailScreen key={profileId} target={{ kind: 'profile', profileId }} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ProfileDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ProfileDetailRoute} />; }
