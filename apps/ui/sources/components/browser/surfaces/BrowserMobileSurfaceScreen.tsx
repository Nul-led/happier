import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { usePaneHeaderSlotContent } from '@/components/appShell/panes/paneHeaderSlot';
import { useMachinePresenceSummary } from '@/components/sessions/model/useMachinePresenceSummary';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';

import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { useSessionBrowserContextProductModel } from '@/components/sessions/browser/useSessionBrowserContextProductModel';
import { useSessionBrowserRecordingRuntime } from '@/components/sessions/browser/sessionBrowserRecordingRuntime';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import type { PluginUiProjectionCurrentness } from '@/sync/domains/plugins/ui/usePluginUiProjectionCurrentness';
import { useScopedPluginUiProjection } from '@/components/plugins/projection/useScopedPluginUiProjection';
import { resolveBrowserSurfacePlatform, useBrowserSurfaceHostProps } from './useBrowserSurfaceHostProps';
import { createSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { useDestinationPaneScopeId } from '@/components/appShell/workspace/DestinationInstanceHost';

import { BrowserScopedWorkspace } from './BrowserScopedWorkspace';

/**
 * The session's browser host outside the desktop Details workspace: the phone cockpit's Browser tab
 * and the session right panel's Browser tab both mount this one composition.
 *
 * Session-cockpit mobile browser surface. Mounts a scoped instance of the SAME details-workspace
 * tab engine as desktop (D2-revised) — `browser-view` tabs only, single-group, splits off. The
 * `scopeId` is threaded from the cockpit so the workspace has a stable per-surface pane scope.
 */
export function BrowserMobileSurfaceScreen(props: Readonly<{
    sessionId: string;
    scopeId?: string;
    testID?: string;
    /**
     * An enclosing cockpit supplies its one admitted projection. Standalone
     * Browser routes retain the incumbent scoped lookup below.
     */
    pluginProjection?: PluginUiProjectionCurrentness;
}>): React.ReactElement {
    // An enclosing pane supplies its admitted target (its plugin projection's machine and Home);
    // that wins over ambient Session lookup, and an explicit unavailable target stays unavailable.
    // Standalone routes have no admitted target and resolve the Session's own.
    const admitted = props.pluginProjection !== undefined;
    const preferredServerId = usePreferredServerIdForSession({
        serverId: props.pluginProjection?.serverId,
        sessionId: props.sessionId,
    });
    const serverId = admitted ? props.pluginProjection?.serverId ?? null : preferredServerId;
    const machineTarget = useSessionMachineTarget(props.sessionId, serverId);
    const machineId = admitted ? props.pluginProjection?.machineId ?? null : machineTarget?.machineId ?? null;
    // The phone Browser tab is the launchpad in the pane anatomy (session-tabs lab Wp): its header says
    // where the previews come from. No trailing action — Open an address is the body's first row.
    const { theme } = useUnistyles();
    const machineName = useMachinePresenceSummary(serverId, machineId).name;
    const machineMark = React.useMemo(
        () => <Icon name="laptop" size={13} color={theme.colors.text.tertiary} />,
        [theme.colors.text.tertiary],
    );
    usePaneHeaderSlotContent(React.useMemo(() => ({
        line: {
            leading: machineMark,
            segments: [machineName
                ? t('browserLaunchpad.pane.previewsFrom', { machine: machineName })
                : t('browserLaunchpad.pane.previews')],
        },
    }), [machineMark, machineName]));
    const destinationScopeId = useDestinationPaneScopeId(createSessionPaneScopeId(props.sessionId, serverId));
    const scopeId = props.scopeId ?? destinationScopeId;
    const scopedPluginProjection = useScopedPluginUiProjection({
        machineId,
        serverId,
        enabled: props.pluginProjection === undefined,
    });
    const pluginProjection = props.pluginProjection ?? scopedPluginProjection;
    // Assemble the live workspace-ranked launchpad feed so the mobile new-tab page shows running
    // services + recents (not only URL entry). The shared bootstrap also resolves the preview
    // state used to seed access URLs when a launchpad row is opened.
    const hostProps = useBrowserSurfaceHostProps({
        scope: 'sessionMobile',
        sessionId: props.sessionId,
        machineId,
        serverId,
        pluginUiProjection: pluginProjection.pluginUiProjection,
        pluginBrowserProjection: pluginProjection.pluginBrowserProjection,
    });
    const recordingRuntime = useSessionBrowserRecordingRuntime({
        enabled: true,
        scopeKey: scopeId,
        sessionId: props.sessionId,
        machineId,
        serverId,
    });
    const browserContext = useSessionBrowserContextProductModel({ machineId, serverId });
    const productModels = React.useMemo(() => ({
        browserContext: browserContext ?? null,
        browserRecording: recordingRuntime?.browserShellRecording ?? null,
    }), [browserContext, recordingRuntime?.browserShellRecording]);

    return (
        <BrowserScopedWorkspace
            scopeId={scopeId}
            scope={{
                kind: 'session',
                sessionId: props.sessionId,
                serverId,
                machineId,
            }}
            openScope="sessionMobile"
            platform={resolveBrowserSurfacePlatform()}
            localServicePreviewState={hostProps.localServicePreviewState}
            localServicePreviewServerId={hostProps.localServicePreviewServerId}
            launchpadRows={hostProps.launchpadRows}
            launchpadRefreshStatus={hostProps.launchpadRefreshStatus}
            launchpadRefreshError={hostProps.launchpadRefreshError}
            productModels={productModels}
            pluginProjection={pluginProjection}
            pluginBrowserActionSessionId={props.sessionId}
            testID={props.testID ?? 'session-mobile-browser'}
        />
    );
}
