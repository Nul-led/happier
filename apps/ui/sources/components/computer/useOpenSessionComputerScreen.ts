import * as React from 'react';
import { useWindowDimensions } from 'react-native';

import { useOptionalAppPaneScopeLayout } from '@/components/appShell/panes/hooks/useAppPaneScopeLayout';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { createSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { useDestinationPaneScopeId } from '@/components/appShell/workspace/DestinationInstanceHost';
import { shouldRedirectDetailsRouteToPanes } from '@/components/ui/panels/shouldRedirectDetailsRouteToPanes';
import { useSessionCockpitSurfaceNavigation } from '@/components/workspaceCockpit/session/SessionCockpitSurfaceNavigation';
import { useLocalSetting } from '@/sync/domains/state/storage';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import { t } from '@/text';
import { useDeviceType } from '@/utils/platform/responsive';

import { createComputerScreenDetailsTab } from './computerScreenDetailsTab';

/**
 * The one way to open a Session's shared window: its Details tab, through the session pane scope.
 * Where Details panes exist the tab opens there; on a phone the same tab opens and the session cockpit
 * switches to its Tabs surface (the phone's home for Details tabs, as files and terminals use). Null only
 * where neither exists, so callers render no Watch that cannot land.
 */
export function useOpenSessionComputerScreen(input: Readonly<{
    sessionId: string;
    serverId: string | null;
    /** The machine a request named; it must be the Session's own (otherwise there is nothing to open). */
    machineId?: string | null;
}>): (() => void) | null {
    const { width: windowWidth } = useWindowDimensions();
    const deviceType = useDeviceType();
    const multiPaneEnabled = useLocalSetting('uiMultiPanePanelsEnabled') !== false;
    const serverId = usePreferredServerIdForSession({ sessionId: input.sessionId, serverId: input.serverId });
    const paneScopeLayout = useOptionalAppPaneScopeLayout();
    const scopeId = useDestinationPaneScopeId(createSessionPaneScopeId(input.sessionId, serverId ?? undefined));
    const pane = useAppPaneScope(scopeId);
    const cockpit = useSessionCockpitSurfaceNavigation();
    const detailsAvailable = shouldRedirectDetailsRouteToPanes({
        containerWidthPx: paneScopeLayout?.containerWidthPx ?? windowWidth,
        deviceType,
        multiPaneEnabled,
    });
    // Computer use targets the Session's own machine: a request naming another machine has no viewer.
    const sessionMachineId = useSessionMachineTarget(input.sessionId, serverId)?.machineId ?? null;
    const machineId = sessionMachineId && (!input.machineId || input.machineId === sessionMachineId) ? sessionMachineId : null;
    const open = React.useCallback(() => {
        if (!machineId) return;
        pane.openDetailsTab(createComputerScreenDetailsTab({ machineId, title: t('computerUse.viewer.tabFallback') }), { intent: 'default' });
        if (!detailsAvailable) cockpit?.switchSurface('tabs');
    }, [cockpit, detailsAvailable, machineId, pane]);
    if (!machineId || (!detailsAvailable && !cockpit)) return null;
    return open;
}
