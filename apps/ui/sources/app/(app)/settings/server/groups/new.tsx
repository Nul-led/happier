import * as React from 'react';

import { HomeGroupPage } from '@/components/settings/server/collection/HomeGroupPage';

export function NewHomeGroupRoute() {
    return <HomeGroupPage groupId={null} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewHomeGroupRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewHomeGroupRoute} />; }
