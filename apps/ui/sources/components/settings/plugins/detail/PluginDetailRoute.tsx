import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { readPluginDetailRoutePluginId } from '../model/pluginsSurfaceRoutes';
import { PluginDetailScreen } from './PluginDetailScreen';

/** A plugin's page, in either host (Settings or the app page); the screen resolves its host's links. */
export const PluginDetailRoute = React.memo(function PluginDetailRoute() {
    const params = useLocalSearchParams();
    return <PluginDetailScreen pluginId={readPluginDetailRoutePluginId(params.pluginId)} />;
});
