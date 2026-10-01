import * as React from 'react';

import { PromptCollectionIndex } from '@/components/settings/prompts/collection/PromptCollectionList';

export const WorkspaceRouteBody = React.memo(function PromptSkillsIndexRoute() {
    return <PromptCollectionIndex kind="bundle" />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
