import React from 'react';
import { Redirect } from '@/components/appShell/workspace/destinationRoute';

export const WorkspaceRouteBody = React.memo(function PromptLibraryLegacyRoute() {
    return <Redirect href={'/(app)/settings/prompts' as any} />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
