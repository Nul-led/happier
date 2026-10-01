import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { ProviderConnectionAuthoringScreen } from '@/components/settings/providers/ProviderConnectionAuthoringScreen';

export function NewProviderConnectionRoute() {
    const params = useLocalSearchParams<{
        contributionKey?: string | string[];
        candidateId?: string | string[];
        displayName?: string | string[];
    }>();
    const contributionKey = Array.isArray(params.contributionKey)
        ? params.contributionKey[0]
        : params.contributionKey;
    const candidateId = Array.isArray(params.candidateId) ? params.candidateId[0] : params.candidateId;
    const displayName = Array.isArray(params.displayName) ? params.displayName[0] : params.displayName;
    return (
        <ProviderConnectionAuthoringScreen
            contributionKey={contributionKey}
            candidateId={candidateId}
            displayName={displayName}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewProviderConnectionRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewProviderConnectionRoute} />; }
