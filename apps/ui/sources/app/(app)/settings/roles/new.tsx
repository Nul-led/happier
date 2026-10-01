import * as React from 'react';

import { RoleDetailScreen } from '@/components/settings/roles/RoleDetailScreen';

export function NewRoleRoute() {
    return <RoleDetailScreen target={{ kind: 'draft' }} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewRoleRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewRoleRoute} />; }
