import * as React from 'react';

import { BrowserMobileSurfaceScreen } from '@/components/browser/surfaces/BrowserMobileSurfaceScreen';
import type { PluginUiProjectionCurrentness } from '@/sync/domains/plugins/ui/usePluginUiProjectionCurrentness';

/**
 * The session right panel's Browser tab. It is the same host as the phone Browser tab (H-UX F-21:
 * one session browser composition): the details-workspace tab engine with the launchpad as its
 * new-tab page, the session's browser context, recording and plugin projection, and the pane's
 * admitted machine target.
 */
export function SessionRightPanelBrowserView(props: Readonly<{
    sessionId: string;
    /** The Session shell's already-admitted plugin projection (and so its machine target). */
    pluginProjection?: PluginUiProjectionCurrentness;
}>): React.ReactElement {
    return (
        <BrowserMobileSurfaceScreen
            sessionId={props.sessionId}
            pluginProjection={props.pluginProjection}
            testID="session-rightpanel-browser"
        />
    );
}
