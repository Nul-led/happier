import * as React from 'react';
import { useOptionalAppPaneContext } from '@/components/appShell/panes/AppPaneProvider';
import type { PaneDriver } from '@/components/appShell/panes/types';
import { useScopedPluginUiProjection } from '@/components/plugins/projection/useScopedPluginUiProjection';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import { RIGHT_SIDEBAR_BUILTIN_TABS } from '@/components/appShell/rightSidebar/rightSidebarBuiltinTabs';
import { createSessionPaneSurfaceScope } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { SessionRightPanel, SessionActionRail } from './SessionRightPanel';
import { SessionBottomPanel } from './bottom/SessionBottomPanel';
import { SessionDetailsPanel } from './SessionDetailsPanel';
import { createSessionPaneScopeId } from './sessionPaneScopeId';
import type { SessionBoardPrimaryMountResolver } from '@/sync/domains/session/board';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { useDestinationInstanceKey } from '@/components/appShell/workspace/DestinationInstanceHost';
import { useSessionCockpitChromeRegistration } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

type SessionPaneScopedProps = Readonly<{ sessionId: string; scopeId: string }>;

const sessionBuiltinDestinationIds = RIGHT_SIDEBAR_BUILTIN_TABS
    .filter((tab) => tab.scopes.includes('session'))
    .map((tab) => tab.id);

export async function loadSessionSubagentDetailsModule(): Promise<void> {
    await import('@/components/sessions/agents/details/SessionSubagentDetailsView');
}

export const sessionPaneModulePrefetchLoaders: Array<() => Promise<void>> = [
    loadSessionSubagentDetailsModule,
];

export async function prefetchSessionPaneModules(): Promise<void> {
    await Promise.all(sessionPaneModulePrefetchLoaders.map(async (loadModule) => {
        try {
            await loadModule();
        } catch (error) {
            // Speculative loading failures must not become unhandled rejections.
            // Demand loading owns its own import and can retry a failed chunk fetch.
            console.warn('Failed to prefetch session pane module', error);
        }
    }));
}

export function useRegisterSessionPaneDriver(
    sessionId: string,
    explicitServerId?: string | null,
    resolveBoardPrimaryHost?: SessionBoardPrimaryMountResolver,
    suppliedPluginRuntime?: SessionPluginRuntimeState,
    options?: Readonly<{
        /**
         * `false` for a Session presented inside another surface (the embedded arm): the scope is
         * keyed by Session, so registering would replace the route Session's own driver.
         */
        registerDriver?: boolean;
    }>,
): string {
    const instanceKey = useDestinationInstanceKey();
    const paneCtx = useOptionalAppPaneContext();
    const cockpitChrome = useSessionCockpitChromeRegistration();
    const registerDriver = options?.registerDriver === false ? null : paneCtx?.registerDriver ?? null;
    const canRegister = Boolean(registerDriver);
    // The registered PaneDriver is the sole target/currentness producer for
    // this scope. AppPane receives these facts; it must not reconstruct a
    // Session target from `scopeId` or issue a competing projection lookup.
    const sessionMachineTarget = useSessionMachineTarget(
        suppliedPluginRuntime ? null : sessionId,
        suppliedPluginRuntime ? null : explicitServerId,
    );
    const inferredServerId = usePreferredServerIdForSession({ serverId: explicitServerId, sessionId });
    const serverId = String(suppliedPluginRuntime?.serverId ?? explicitServerId ?? '').trim() || inferredServerId;
    const scopeId = React.useMemo(
        () => createSessionPaneScopeId(sessionId, serverId, instanceKey),
        [instanceKey, serverId, sessionId],
    );
    const pluginProjection = useScopedPluginUiProjection({
        machineId: suppliedPluginRuntime ? null : sessionMachineTarget?.machineId ?? null,
        serverId: suppliedPluginRuntime ? null : serverId,
        enabled: suppliedPluginRuntime === undefined && options?.registerDriver !== false,
    });
    const pluginRuntime = suppliedPluginRuntime ?? {
        pluginUiProjection: pluginProjection.pluginUiProjection,
        pluginBrowserProjection: pluginProjection.pluginBrowserProjection,
        phase: pluginProjection.phase,
        interactionEnabled: pluginProjection.interactionEnabled,
        machineId: sessionMachineTarget?.machineId ?? null,
        serverId,
        platform: pluginProjection.platform,
    } satisfies SessionPluginRuntimeState;

    React.useEffect(() => {
        if (!canRegister) return;
        const timer = setTimeout(() => {
            void prefetchSessionPaneModules();
        }, 3000);
        return () => clearTimeout(timer);
    }, [canRegister]);

    React.useEffect(() => {
        if (!registerDriver) return;
        const surfaceScope = createSessionPaneSurfaceScope(sessionId, pluginRuntime);
        const driver: PaneDriver = {
            scopeId,
            surfaceScope,
            onTerminalWorkspaceReveal: () => {
                const matchingHome = serverId
                    ? areServerProfileIdentifiersEquivalent(cockpitChrome?.serverId, serverId)
                    : !cockpitChrome?.serverId;
                if (cockpitChrome?.sessionId === sessionId && matchingHome && cockpitChrome.terminalTabAvailable) {
                    cockpitChrome.switchSurface('terminal');
                }
            },
            rightPaneBuiltinAdapter: {
                destinationIds: sessionBuiltinDestinationIds,
                defaultDestinationId: 'files',
                render: () => React.createElement(SessionRightPanel, {
                    sessionId,
                    scopeId,
                    paneSurfaceScope: surfaceScope,
                    resolveBoardPrimaryHost,
                }),
            },
            rightSidebarAdapter: {
                renderActionRail: () => React.createElement(SessionActionRail),
                render: () => React.createElement(SessionRightPanel, {
                    sessionId,
                    scopeId,
                    paneSurfaceScope: surfaceScope,
                    resolveBoardPrimaryHost,
                }),
            },
            detailsPaneBuiltinAdapter: {
                destinationIds: ['session-details'],
                defaultDestinationId: 'session-details',
                render: () => React.createElement(SessionDetailsPanel, {
                    sessionId,
                    scopeId,
                    paneSurfaceScope: surfaceScope,
                    resolveBoardPrimaryHost,
                }),
            },
            bottomPaneBuiltinAdapter: {
                destinationIds: ['terminal'],
                defaultDestinationId: 'terminal',
                render: () => React.createElement(SessionBottomPanel, { sessionId, scopeId }),
            },
        };
        return registerDriver(driver);
    }, [
        cockpitChrome,
        pluginRuntime.interactionEnabled,
        pluginRuntime.phase,
        pluginRuntime.platform,
        pluginRuntime.pluginBrowserProjection,
        pluginRuntime.pluginUiProjection,
        pluginRuntime.machineId,
        pluginRuntime.serverId,
        registerDriver,
        resolveBoardPrimaryHost,
        scopeId,
        sessionId,
        serverId,
    ]);

    return scopeId;
}
