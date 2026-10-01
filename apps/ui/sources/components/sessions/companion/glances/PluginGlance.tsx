import * as React from 'react';

import type { PluginContributionIdentityV1 } from '@happier-dev/protocol';

import {
    resolvePluginSurfaceDestinationIcon,
    resolvePluginSurfaceDestinationLabel,
} from '@/components/plugins/surfaces/pluginSurfaceDestinations';
import { useSessionPluginRuntime } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { InstalledWidgetSurface } from '@/components/widgets/InstalledWidgetSurface';
import { WidgetFrame, type WidgetFrameStyle } from '@/components/widgets/frame/WidgetFrame';
import { createPluginLocalizedTextResolver } from '@/sync/domains/plugins/ui/i18n';
import { selectWidgetPlacementsBySurface } from '@/sync/domains/plugins/ui/widgetContract';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';

/**
 * A plugin's compact glance in the Companion (lab WC3, bounded C3): the plugin's own session `widget`
 * body in the host frame. Only views that declared the `companion` placement reach the Companion's
 * references, so this host never squeezes a pane into the column. The body mounts only on a visible
 * Companion; a measuring pass draws the frame and starts no plugin.
 */
export function PluginGlance(props: Readonly<{
    surface: PluginContributionIdentityV1;
    sessionId: string;
    serverId: string | null;
    frameStyle: WidgetFrameStyle;
    menu?: React.ReactNode;
    measurementOnly: boolean;
    testID: string;
}>) {
    const address = React.useMemo(
        () => normalizeSessionAddress(props.serverId, props.sessionId),
        [props.serverId, props.sessionId],
    );
    const runtime = useSessionPluginRuntime({ address });
    const projection = runtime.pluginUiProjection;
    const identity = React.useMemo(() => {
        const placements = projection ? selectWidgetPlacementsBySurface(projection, props.surface, 'session') : [];
        const placement = placements.length === 1 ? placements[0]! : null;
        const localize = createPluginLocalizedTextResolver({ projection });
        return {
            title: placement ? resolvePluginSurfaceDestinationLabel(placement, localize) : props.surface.localId,
            icon: placement ? resolvePluginSurfaceDestinationIcon(placement) : 'puzzle-piece' as const,
            source: projection?.installedPackagesById[props.surface.pluginId]?.displayName.trim() || props.surface.pluginId,
        };
    }, [projection, props.surface]);
    const source = React.useMemo(() => ({ kind: 'installedSurface' as const, surface: props.surface }), [props.surface]);
    return (
        <WidgetFrame
            testID={props.testID}
            frameStyle={props.frameStyle}
            placement="companion"
            mark={identity.icon}
            title={identity.title}
            source={identity.source}
            menu={props.menu}
            body={{
                kind: 'content',
                children: props.measurementOnly ? null : (
                    <InstalledWidgetSurface
                        testID={`${props.testID}.surface`}
                        target={{ kind: 'session', sessionId: props.sessionId }}
                        recordRevision={`${props.surface.pluginId}/${props.surface.localId}`}
                        source={source}
                        presentation="content"
                        runtime={runtime}
                    />
                ),
            }}
        />
    );
}
