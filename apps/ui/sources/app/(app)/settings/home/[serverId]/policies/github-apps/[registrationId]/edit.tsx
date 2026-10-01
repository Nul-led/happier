import * as React from 'react';
import { Redirect, useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { legacyPoliciesRedirectHref } from '@/components/settings/home/signInProviders/legacyPoliciesRedirect';
import { homeAdministrationGitHubAppEditPath } from '@/components/settings/home/governance/homeAdministrationRoutes';

/** GitHub Apps moved to Sign-in providers; a link saved before the move still opens the same page. */
export function LegacyManagedGitHubAppEditRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; registrationId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const registrationId = Array.isArray(params.registrationId) ? params.registrationId[0] ?? '' : params.registrationId ?? '';
    return <Redirect href={legacyPoliciesRedirectHref(homeAdministrationGitHubAppEditPath(serverId, registrationId), params, ['serverId', 'registrationId']) as never} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { LegacyManagedGitHubAppEditRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={LegacyManagedGitHubAppEditRoute} />; }
