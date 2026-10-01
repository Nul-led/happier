import * as React from 'react';
import { Redirect, useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { legacyPoliciesRedirectHref } from '@/components/settings/home/signInProviders/legacyPoliciesRedirect';
import { homeAdministrationIdentityProviderPath } from '@/components/settings/home/governance/homeAdministrationRoutes';

/** Identity providers moved to Sign-in providers; a link saved before the move still opens the same page. */
export function LegacyManagedIdentityProviderDetailRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; providerId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const providerId = Array.isArray(params.providerId) ? params.providerId[0] ?? '' : params.providerId ?? '';
    return <Redirect href={legacyPoliciesRedirectHref(homeAdministrationIdentityProviderPath(serverId, providerId), params, ['serverId', 'providerId']) as never} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { LegacyManagedIdentityProviderDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={LegacyManagedIdentityProviderDetailRoute} />; }
