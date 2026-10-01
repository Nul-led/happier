import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { ProfileDetailScreen } from '@/components/settings/profiles/ProfileDetailScreen';

export function NewProfileRoute() {
    const params = useLocalSearchParams<{ cloneFrom?: string | string[] }>();
    const cloneFrom = (Array.isArray(params.cloneFrom) ? params.cloneFrom[0] : params.cloneFrom) ?? null;
    return <ProfileDetailScreen key={cloneFrom ?? 'blank'} target={{ kind: 'draft', cloneFrom }} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewProfileRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewProfileRoute} />; }
