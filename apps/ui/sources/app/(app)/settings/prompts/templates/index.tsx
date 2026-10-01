import * as React from 'react';

import { PromptCollectionIndex } from '@/components/settings/prompts/collection/PromptCollectionList';

export const WorkspaceRouteBody = React.memo(function PromptTemplatesIndexRoute() {
    return <PromptCollectionIndex kind="template" />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
