import * as React from 'react';

import type { DestinationRef } from '@/components/appShell/destinations/compactAppDestinationCatalog';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';
import { matchWorkspaceDestinationRoute, workspaceRouteBodies } from './workspaceRouteBodies';

const bodies = Object.fromEntries(Object.entries(workspaceRouteBodies).map(([routeKey, load]) => (
    [routeKey, React.lazy(load)]
)));
const PluginAppPageScreen = React.lazy(() => import('@/components/appShell/plugins/PluginAppPageScreen')
    .then((module) => ({ default: module.PluginAppPageScreen })));

/** Renders the catalog-admitted identity; the Expo entrypoint is only its URL sink. */
export function WorkspaceDestinationBody(props: Readonly<{
    target: DestinationRef;
    pathname: string;
    renderSession: (target: DestinationRef) => React.ReactNode;
    renderSessionDetails: (target: DestinationRef) => React.ReactNode;
}>): React.ReactNode {
    if (props.target.kind === 'session') return props.renderSession(props.target);
    if (props.target.kind === 'sessionDetails') return props.renderSessionDetails(props.target);
    const match = matchWorkspaceDestinationRoute(props.pathname);
    const Body = match ? bodies[match.routeKey] : undefined;
    if (props.target.params.pluginId && props.target.params.localId && props.pathname.startsWith('/plugins/')) {
        return <React.Suspense fallback={<SurfaceStateCard kind="loading" title={t('common.loading')} />}>
            <PluginAppPageScreen pluginId={props.target.params.pluginId}
                localId={props.target.params.localId} subPath={props.target.params.subPath ?? ''} />
        </React.Suspense>;
    }
    if (!Body) return <SurfaceStateCard kind="unavailable" title={t('common.unavailable')} />;
    return <React.Suspense fallback={<SurfaceStateCard kind="loading" title={t('common.loading')} />}>
        <Body />
    </React.Suspense>;
}
