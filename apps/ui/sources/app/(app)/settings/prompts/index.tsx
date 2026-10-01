import React from 'react';
import { PromptsSettingsHome } from '@/components/settings/prompts/PromptsSettingsHome';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

export const WorkspaceRouteBody = React.memo(function PromptsSettingsRoute() {
    const enabled = useFeatureEnabled('prompts.library');

    if (!enabled) {
        return null;
    }

    return <PromptsSettingsHome />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
