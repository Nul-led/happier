import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { RoleDetailScreen } from '@/components/settings/roles/RoleDetailScreen';

export function RoleDetailRoute() {
    const params = useLocalSearchParams<{ roleId?: string | string[] }>();
    const roleId = Array.isArray(params.roleId) ? params.roleId[0] : params.roleId;
    if (!roleId) return null;
    return <RoleDetailScreen key={roleId} target={{ kind: 'role', roleId }} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { RoleDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={RoleDetailRoute} />; }
