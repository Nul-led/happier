import React from 'react';
import { PromptAssetsScreen } from '@/components/settings/prompts/assets/PromptAssetsScreen';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

export const WorkspaceRouteBody = React.memo(function PromptAssetsRoute() {
    const enabled = useFeatureEnabled('prompts.assets.external');

    if (!enabled) {
        return null;
    }

    return <PromptAssetsScreen />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
