import * as React from 'react';
import { Platform } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { resolveHref } from 'expo-router/build/link/href';
import { randomUUID } from '@/platform/randomUUID';

import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { getActiveUnsavedChangesGuard, runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { resolveDestinationRefFromHref, type CompactAppDestination } from '../destinations/compactAppDestinationCatalog';
import { createWorkspaceNavigationAdapter, type WorkspaceOpenOptions } from './workspaceNavigationAdapter';
import { createWorkspaceBrowserTransport } from './workspaceBrowserTransport';
import { useWorkspaceState } from './useWorkspaceState';
import { useWorkspaceTabSync } from './useWorkspaceTabSync';
import { WorkspaceNavigationContext, type WorkspaceNavigationContextValue } from './WorkspaceNavigationContext';
import type { DestinationNavigation } from './DestinationInstanceHost';
import type { SplitCanvasHostControls } from '../splitCanvas/components/SplitCanvasHost';
import { createWorkspaceActionAdapter, workspaceActionFailure, type WorkspaceActionOutcome } from './workspaceActions';
import { registerMountedWorkspaceAction } from './workspaceActionRuntime';

function runNavigation(navigate: () => void): void {
    const result = runGuardedNavigation(navigate);
    if (result !== true) fireAndForget(result, { tag: 'Workspace.navigation' });
}

/** Slice 2 owns the layout; this owner alone translates navigation intent to it and the URL. */
export function WorkspaceProvider(props: Readonly<{
    enabled: boolean;
    catalog: readonly CompactAppDestination[];
    children: React.ReactNode | ((navigation: WorkspaceNavigationContextValue) => React.ReactNode);
}>): React.ReactNode {
    const router = useRouter();
    const pathname = usePathname();
    const params = useGlobalSearchParams();
    const scope = useActiveServerAccountScope();
    const scopeKey = scope ? JSON.stringify([scope.serverId, scope.accountId]) : null;
    const routeHref = React.useMemo(() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            return `${window.location.pathname}${window.location.search}${window.location.hash}`;
        }
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string') query.set(key, value);
        }
        return `${pathname}${query.size ? `?${query}` : ''}`;
    }, [params, pathname]);
    const [initialTab] = React.useState(() => ({
        id: randomUUID(), target: resolveDestinationRefFromHref(props.catalog, routeHref) ?? { kind: 'newTab', params: {} },
        pinned: false, preview: false,
    }));
    const localOwner = useWorkspaceState({ initialTab });
    const owner = useWorkspaceTabSync({ local: localOwner, catalog: props.catalog, enabled: props.enabled });
    const [historyVersion, changed] = React.useReducer((value: number) => value + 1, 0);
    const latest = React.useRef({ owner, router, catalog: props.catalog, enabled: props.enabled, scopeKey });
    latest.current = { owner, router, catalog: props.catalog, enabled: props.enabled, scopeKey };
    const projectedHref = React.useRef<string | null>(null);
    const backSteps = React.useRef(new Map<string, () => boolean>());
    const canvasControlsRef = React.useRef<SplitCanvasHostControls | null>(null);
    const guardTraversal = React.useCallback((direction: -1 | 1, proceed: () => void) => {
        runNavigation(() => {
            const state = latest.current.owner.getState();
            const tabId = state.groups[state.focusedGroupId].activeTabId;
            if (direction === -1 && backSteps.current.get(tabId)?.()) return;
            proceed();
        });
    }, []);
    const runtime = React.useMemo(() => {
        const mirror = (href: string) => {
            projectedHref.current = href;
            latest.current.router.replace(href as never);
        };
        const browser = Platform.OS === 'web' && typeof window !== 'undefined'
            ? createWorkspaceBrowserTransport({
                history: window.history,
                getHref: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
                mirror, createId: randomUUID,
                accept: (href, entry, position) => adapter.acceptUrl(href, entry, position),
                guard: guardTraversal,
                needsGuard: (direction) => {
                    const guard = getActiveUnsavedChangesGuard();
                    const state = latest.current.owner.getState();
                    const tabId = state.groups[state.focusedGroupId].activeTabId;
                    return Boolean((guard && !guard.ignoreRef?.current && (guard.isDirtyRef.current || guard.prepareGuard))
                        || (direction === -1 && backSteps.current.has(tabId)));
                },
            }) : null;
        const adapter = createWorkspaceNavigationAdapter({
            getState: () => latest.current.owner.getState(),
            getCatalog: () => latest.current.catalog,
            dispatch: (action) => latest.current.owner.dispatch(action),
            transport: browser ?? { commit: mirror },
            createId: randomUUID, onChange: changed,
        });
        return { adapter, browser, initialized: false };
    }, [guardTraversal, scopeKey]);
    const eligible = resolveDestinationRefFromHref(props.catalog, routeHref) !== null;

    React.useEffect(() => {
        if (!props.enabled || !owner.isReady || !eligible || !runtime.initialized) return;
        let current = true;
        const execute = createWorkspaceActionAdapter({
            getState: () => latest.current.owner.getState(), navigation: runtime.adapter,
            readCanvas: () => canvasControlsRef.current, createId: randomUUID,
        });
        const retire = registerMountedWorkspaceAction(async (request) => {
            const isCurrent = () => current && latest.current.scopeKey === scopeKey && latest.current.enabled && latest.current.owner.isReady;
            if (!isCurrent()) return workspaceActionFailure('workspace_unavailable');
            if (request.signal?.aborted) return workspaceActionFailure('action_cancelled');
            const navigates = request.actionId === 'workspace.tabs.open' || request.actionId === 'workspace.tabs.activate'
                || request.actionId === 'workspace.tabs.close' || request.actionId === 'workspace.tabs.move'
                || request.actionId === 'workspace.groups.focus' || request.actionId === 'workspace.split';
            if (!navigates) return execute(request.actionId, request.input);
            let outcome: WorkspaceActionOutcome = workspaceActionFailure('workspace_navigation_cancelled');
            await runGuardedNavigation(() => {
                outcome = !isCurrent() ? workspaceActionFailure('workspace_unavailable')
                    : request.signal?.aborted ? workspaceActionFailure('action_cancelled')
                        : execute(request.actionId, request.input);
            });
            return outcome;
        });
        return () => { current = false; retire(); };
    }, [eligible, owner.isReady, props.enabled, runtime, scopeKey]);

    React.useLayoutEffect(() => {
        if (!props.enabled || !owner.isReady || !eligible) return;
        if (!runtime.initialized) {
            runtime.initialized = true;
            runtime.adapter.initialize(routeHref);
        } else if (projectedHref.current !== routeHref) runtime.adapter.acceptUrl(routeHref);
    }, [eligible, owner.isReady, props.enabled, routeHref, runtime]);

    React.useEffect(() => {
        if (!props.enabled || !owner.isReady || !runtime.browser || typeof window === 'undefined') return;
        const onPop = (event: PopStateEvent) => {
            if (runtime.browser?.acceptPopState(event.state)) event.stopImmediatePropagation();
        };
        // Expo's linking listener is a URL mirror, never a competing workspace history reader.
        window.addEventListener('popstate', onPop, true);
        return () => window.removeEventListener('popstate', onPop, true);
    }, [owner.isReady, props.enabled, runtime]);

    const openHref = React.useCallback((href: string, options?: WorkspaceOpenOptions) => {
        if (!latest.current.enabled || !latest.current.owner.isReady
            || !resolveDestinationRefFromHref(latest.current.catalog, href)) return false;
        runNavigation(() => { runtime.adapter.openHref(href, options); });
        return true;
    }, [runtime]);
    const tabNavigations = React.useMemo(() => new Map<string, DestinationNavigation>(), [runtime]);
    const navigationForTab = React.useCallback((tabId: string): DestinationNavigation => {
        const existing = tabNavigations.get(tabId);
        if (existing) return existing;
        const navigate = (href: Parameters<typeof router.push>[0], replace: boolean) => {
            const resolved = resolveHref(href);
            if (!openHref(resolved, { tabId, replace })) {
                runNavigation(() => replace ? latest.current.router.replace(href) : latest.current.router.push(href));
            }
        };
        const navigation: DestinationNavigation = {
            push: (href) => navigate(href, false),
            replace: (href) => navigate(href, true),
            back: () => {
                if (runtime.browser) runtime.adapter.step(-1);
                else guardTraversal(-1, () => runtime.adapter.step(-1));
            },
            canGoBack: () => runtime.adapter.canGoBack,
            setParams: (values) => runtime.adapter.setParams(tabId, values),
        };
        tabNavigations.set(tabId, navigation);
        return navigation;
    }, [guardTraversal, openHref, runtime, tabNavigations]);
    const navigation = React.useMemo<WorkspaceNavigationContextValue>(() => ({
        active: props.enabled && owner.isReady && eligible && runtime.initialized,
        state: owner.state,
        sharedTabs: owner.sharedTabs,
        tabSyncStatus: owner.tabSyncStatus,
        handoffSource: owner.handoffSource,
        canvasControlsRef,
        canGoBack: runtime.adapter.canGoBack, canGoForward: runtime.adapter.canGoForward,
        openHref, navigationForTab,
        registerBackStep: (tabId, consume) => {
            backSteps.current.set(tabId, consume);
            return () => { if (backSteps.current.get(tabId) === consume) backSteps.current.delete(tabId); };
        },
        activateTab: (groupId, tabId) => runNavigation(() => runtime.adapter.activateTab(groupId, tabId)),
        closeTab: (groupId, tabId) => runNavigation(() => runtime.adapter.closeTab(groupId, tabId)),
        dispatch: (action) => {
            if (action.type === 'focusGroup' || action.type === 'activateTab' || action.type === 'openTab'
                || action.type === 'moveTab' || action.type === 'splitTab') runNavigation(() => runtime.adapter.dispatch(action));
            else runtime.adapter.dispatch(action);
        },
        back: () => {
            if (runtime.browser) runtime.adapter.step(-1);
            else guardTraversal(-1, () => runtime.adapter.step(-1));
        },
        forward: () => {
            if (runtime.browser) runtime.adapter.step(1);
            else guardTraversal(1, () => runtime.adapter.step(1));
        },
    }), [eligible, guardTraversal, historyVersion, navigationForTab, openHref, owner.isReady, owner.state, owner.sharedTabs, owner.tabSyncStatus, owner.handoffSource, props.enabled, runtime]);
    return <WorkspaceNavigationContext.Provider value={navigation}>{typeof props.children === 'function' ? props.children(navigation) : props.children}</WorkspaceNavigationContext.Provider>;
}
