import * as React from 'react';

import { ProjectsIndexView } from '@/components/projects/ProjectsIndexView';

export const WorkspaceRouteBody = React.memo(() => {
    return <ProjectsIndexView />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
