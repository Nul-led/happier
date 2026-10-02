import * as React from 'react';
import { Platform } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { resolveHref } from 'expo-router/build/link/href';
import { randomUUID } from '@/platform/randomUUID';

import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { getActiveUnsavedChangesGuard, runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { hrefForDestinationRef, resolveDestinationRefFromHref, type CompactAppDestination } from '../destinations/compactAppDestinationCatalog';
import { createWorkspaceNavigationAdapter, type WorkspaceOpenOptions } from './workspaceNavigationAdapter';
import { createWorkspaceBrowserTransport } from './workspaceBrowserTransport';
import { useWorkspaceState } from './useWorkspaceState';
import { useWorkspaceTabSync } from './useWorkspaceTabSync';
import { WorkspaceNavigationContext, type WorkspaceNavigationContextValue, type WorkspacePhoneControls } from './WorkspaceNavigationContext';
import type { DestinationNavigation } from './DestinationInstanceHost';
import type { SplitCanvasHostControls } from '../splitCanvas/components/SplitCanvasHost';
import { createWorkspaceActionAdapter, workspaceActionFailure, type WorkspaceActionOutcome } from './workspaceActions';
import { registerMountedWorkspaceAction } from './workspaceActionRuntime';
import { admitWorkspaceSingletonState, workspaceSingletonDestinationIds } from './workspaceDestinationPolicy';
import { createWorkspaceEmptyTab, type WorkspaceState } from './workspaceState';
import { resolvePhoneWorkspaceTabHref } from './workspacePhoneProjection';
import { useWorkspaceKeyboardShortcuts } from './useWorkspaceKeyboardShortcuts';

function runNavigation(navigate: () => void): void {
    const result = runGuardedNavigation(navigate);
    if (result !== true) fireAndForget(result, { tag: 'Workspace.navigation' });
}

/** Slice 2 owns the layout; this owner alone translates navigation intent to it and the URL. */
export function WorkspaceProvider(props: Readonly<{
    enabled: boolean;
    /**
     * A phone: the owner keeps (and syncs) the tab set, but the phone's stack keeps navigation — no URL
     * projection, no Actions, and only explicit opens ever become synced tabs.
     */
    phone?: boolean;
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
    const phone = props.phone === true && !props.enabled;
    const phoneTabHref = phone ? resolvePhoneWorkspaceTabHref(props.catalog, routeHref) : null;
    const [initialTab] = React.useState(() => {
        // A phone's first screen is only its preview: nothing reaches the synced set without an explicit open.
        const href = phone ? phoneTabHref : routeHref;
        return {
            id: randomUUID(), target: (href ? resolveDestinationRefFromHref(props.catalog, href) : null) ?? { kind: 'newTab', params: {} },
            pinned: false, preview: phone,
        };
    });
    const admissionCatalog = React.useRef(props.catalog);
    admissionCatalog.current = props.catalog;
    const singletonPolicyKey = React.useMemo(() => JSON.stringify([...workspaceSingletonDestinationIds(props.catalog)].sort()), [props.catalog]);
    const admitState = React.useCallback((state: WorkspaceState) => admitWorkspaceSingletonState(state, admissionCatalog.current, randomUUID), [singletonPolicyKey]);
    const localOwner = useWorkspaceState({ initialTab, admitState });
    const owner = useWorkspaceTabSync({ local: localOwner, catalog: props.catalog, enabled: props.enabled || phone });
    const [historyVersion, changed] = React.useReducer((value: number) => value + 1, 0);
    const latest = React.useRef({ owner, router, catalog: props.catalog, enabled: props.enabled, scopeKey, phoneTabHref });
    latest.current = { owner, router, catalog: props.catalog, enabled: props.enabled, scopeKey, phoneTabHref };
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
        // A phone (mobile web included) keeps its own history; the workspace never writes browser state there.
        const browser = !phone && Platform.OS === 'web' && typeof window !== 'undefined'
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
            dispatch: (action) => {
                const owner = latest.current.owner;
                if (mounted.initialized) owner.dispatch(action);
                else owner.restoreAction(action);
            },
            transport: browser ?? { commit: mirror },
            createId: randomUUID, onChange: changed,
        });
        const mounted = { adapter, browser, initialized: false };
        return mounted;
    }, [guardTraversal, scopeKey, phone]);
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
                || request.actionId === 'workspace.tabs.reopen'
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
            runtime.adapter.initialize(routeHref);
            runtime.initialized = true;
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

    // The phone records what is on screen as its one preview (or the tab it already is). It never
    // projects a URL: tab switches move the phone's stack, and only explicit opens become synced tabs.
    React.useLayoutEffect(() => {
        if (!phone || !owner.isReady) return;
        if (phoneTabHref) runtime.adapter.acceptUrl(phoneTabHref);
        if (phoneTabHref || eligible) runtime.initialized = true;
    }, [eligible, owner.isReady, phone, phoneTabHref, runtime]);
    const phoneOnTab = phoneTabHref !== null;
    const phoneControls = React.useMemo<WorkspacePhoneControls | null>(() => {
        if (!phone || !owner.isReady) return null;
        // A tab switch replaces the screen, so Back still leads to the list; from a main tab it pushes.
        const show = (href: string) => runNavigation(() => {
            if (latest.current.phoneTabHref !== null) latest.current.router.replace(href as never);
            else latest.current.router.push(href as never);
        });
        return {
            catalog: props.catalog,
            onTab: phoneOnTab,
            openHref: (href, mode) => {
                const tabHref = resolvePhoneWorkspaceTabHref(latest.current.catalog, href);
                if (!tabHref) return false;
                runtime.initialized = true;
                if (!runtime.adapter.openHref(tabHref, { mode }, false)) return false;
                show(href);
                return true;
            },
            activateTab: (tabId) => {
                const tab = latest.current.owner.getState().tabs[tabId];
                const href = tab ? hrefForDestinationRef(latest.current.catalog, tab.target) : null;
                if (href) {
                    runtime.initialized = true;
                    show(href);
                }
            },
            closeTab: (tabId) => {
                const state = latest.current.owner.getState();
                const group = Object.values(state.groups).find((item) => item.tabIds.includes(tabId));
                if (group) latest.current.owner.dispatch({ type: 'closeTab', groupId: group.id, tabId, newTab: createWorkspaceEmptyTab(randomUUID()) });
            },
        };
    }, [owner.isReady, phone, phoneOnTab, props.catalog, runtime]);

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
        phone: phoneControls,
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
                || action.type === 'moveTab' || action.type === 'splitTab' || action.type === 'reopenTab') runNavigation(() => runtime.adapter.dispatch(action));
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
    }), [eligible, guardTraversal, historyVersion, navigationForTab, openHref, phoneControls, owner.isReady, owner.state, owner.sharedTabs, owner.tabSyncStatus, owner.handoffSource, props.enabled, runtime]);
    useWorkspaceKeyboardShortcuts(navigation.active, () => latest.current.owner.getState());
    return <WorkspaceNavigationContext.Provider value={navigation}>{typeof props.children === 'function' ? props.children(navigation) : props.children}</WorkspaceNavigationContext.Provider>;
}
