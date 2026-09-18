import * as React from 'react';
import { useOptionalAppPaneContext } from '@/components/appShell/panes/AppPaneProvider';
import type { PaneDriver, PaneSurfaceScope } from '@/components/appShell/panes/types';
import { useScopedPluginUiProjection } from '@/components/plugins/projection/useScopedPluginUiProjection';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import { RIGHT_SIDEBAR_BUILTIN_TABS } from '@/components/appShell/rightSidebar/rightSidebarBuiltinTabs';
import { SessionRightPanel } from './SessionRightPanel';
import { SessionBottomPanel } from './bottom/SessionBottomPanel';
import { SessionDetailsPanel } from './SessionDetailsPanel';
import { createSessionPaneScopeId } from './sessionPaneScopeId';
import type { SessionBoardPrimaryMountResolver } from '@/sync/domains/session/board';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';

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
): string {
    const scopeId = React.useMemo(
        () => createSessionPaneScopeId(sessionId, explicitServerId),
        [explicitServerId, sessionId],
    );
    const paneCtx = useOptionalAppPaneContext();
    const registerDriver = paneCtx?.registerDriver ?? null;
    const canRegister = Boolean(registerDriver);
    // The registered PaneDriver is the sole target/currentness producer for
    // this scope. AppPane receives these facts; it must not reconstruct a
    // Session target from `scopeId` or issue a competing projection lookup.
    const sessionMachineTarget = useSessionMachineTarget(
        suppliedPluginRuntime ? null : sessionId,
        suppliedPluginRuntime ? null : explicitServerId,
    );
    const inferredServerId = usePreferredServerIdForSession({ serverId: explicitServerId, sessionId });
    const serverId = String(explicitServerId ?? '').trim() || inferredServerId;
    const pluginProjection = useScopedPluginUiProjection({
        machineId: suppliedPluginRuntime ? null : sessionMachineTarget?.machineId ?? null,
        serverId: suppliedPluginRuntime ? null : serverId,
        enabled: suppliedPluginRuntime === undefined,
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
        const surfaceScope = {
            targetKind: 'session',
            sessionId,
            machineId: pluginRuntime.machineId,
            serverId: pluginRuntime.serverId,
            pluginUiProjection: pluginRuntime.pluginUiProjection,
            pluginBrowserProjection: pluginRuntime.pluginBrowserProjection,
            projectionPhase: pluginRuntime.phase,
            interactionEnabled: pluginRuntime.interactionEnabled,
            platform: pluginRuntime.platform,
        } satisfies Extract<PaneSurfaceScope, Readonly<{ targetKind: 'session' }>>;
        const driver: PaneDriver = {
            scopeId,
            surfaceScope,
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
    ]);

    return scopeId;
}
