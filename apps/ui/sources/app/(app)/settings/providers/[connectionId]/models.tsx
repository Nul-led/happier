import * as React from 'react';
import { Redirect, useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { providerConnectionModelsRoute } from '@/components/settings/providers/collection/providerCollectionModel';

/**
 * `/settings/providers/<id>/models`: the former stand-alone models page. A connection's models are a
 * section of its detail now; old links open the detail on that section.
 */
export function ProviderConnectionModelsRoute() {
    const params = useLocalSearchParams<{ connectionId?: string | string[]; add?: string | string[] }>();
    const connectionId = Array.isArray(params.connectionId) ? params.connectionId[0] ?? '' : params.connectionId ?? '';
    const add = Array.isArray(params.add) ? params.add[0] : params.add;
    return <Redirect href={providerConnectionModelsRoute(connectionId, { add: add === '1' }) as never} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ProviderConnectionModelsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ProviderConnectionModelsRoute} />; }
