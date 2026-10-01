import type { CompactAppDestination, DestinationRef } from '../destinations/compactAppDestinationCatalog';
import { hrefForDestinationRef, resolveDestinationRefFromHref } from '../destinations/compactAppDestinationCatalog';
import { createWorkspaceNavigationHistory, recordWorkspaceNavigation, stepWorkspaceNavigation, workspaceNavigationRestorationActions, type WorkspaceNavigationEntry } from './workspaceNavigationHistory';
import { createWorkspaceEmptyTab, reduceWorkspaceState, type WorkspaceAction, type WorkspaceState, type WorkspaceTab } from './workspaceState';
import { isWorkspaceSingletonDestination } from './workspaceDestinationPolicy';

export type WorkspaceOpenOptions = Readonly<{
    mode?: 'preview' | 'newTab' | 'splitRight' | 'splitDown';
    tabId?: string;
    groupId?: string;
    replace?: boolean;
    availableSizePx?: number;
    minimumFirstSizePx?: number;
    minimumSecondSizePx?: number;
}>;

/** The URL transport does not decide what a tab is or which destination is focused. */
export type WorkspaceUrlTransport = Readonly<{
    commit: (href: string, entry: WorkspaceNavigationEntry, replace: boolean, position: number) => void;
    adoptCurrent?: (entry: WorkspaceNavigationEntry, position: number) => void;
    traverse?: (direction: -1 | 1) => void;
}>;

export function sameDestinationRef(a: DestinationRef, b: DestinationRef): boolean {
    return a.kind === b.kind && Object.keys(a.params).length === Object.keys(b.params).length
        && Object.entries(a.params).every(([key, value]) => b.params[key] === value);
}

export function createWorkspaceNavigationAdapter(input: Readonly<{
    getState: () => WorkspaceState;
    getCatalog: () => readonly CompactAppDestination[];
    dispatch: (action: WorkspaceAction) => void;
    transport: WorkspaceUrlTransport;
    createId: () => string;
    onChange: () => void;
}>) {
    let history = createWorkspaceNavigationHistory();
    const focusedEntry = (): WorkspaceNavigationEntry => {
        const state = input.getState();
        const group = state.groups[state.focusedGroupId];
        const tab = state.tabs[group.activeTabId];
        return { tabId: tab.id, groupId: group.id, target: tab.target };
    };
    const visit = (replace = false, projectUrl = true) => {
        const entry = focusedEntry();
        const next = replace && history.index >= 0
            ? { entries: history.entries.map((item, index) => index === history.index ? entry : item), index: history.index }
            : recordWorkspaceNavigation(history, entry);
        if (next === history) return;
        history = next;
        if (projectUrl) {
            const href = hrefForDestinationRef(input.getCatalog(), entry.target);
            if (href) input.transport.commit(href, entry, replace, history.index);
        } else input.transport.adoptCurrent?.(entry, history.index);
        input.onChange();
    };
    const singletonActions = (state: WorkspaceState, target: DestinationRef): readonly WorkspaceAction[] | null => {
        // The catalog owns admission: subpaths never change an app page's mount identity.
        if (!isWorkspaceSingletonDestination(input.getCatalog(), target)) return null;
        const tab = Object.values(state.tabs).find((item) => item.target.kind === target.kind);
        if (!tab) return null;
        const group = Object.values(state.groups).find((item) => item.tabIds.includes(tab.id));
        return group ? [
            { type: 'setTarget', tabId: tab.id, target },
            { type: 'activateTab', groupId: group.id, tabId: tab.id },
        ] : [];
    };
    const restore = (entry: WorkspaceNavigationEntry) => {
        const state = input.getState();
        for (const action of singletonActions(state, entry.target) ?? workspaceNavigationRestorationActions(state, entry)) input.dispatch(action);
        return focusedEntry();
    };
    return {
        get history() { return history; },
        get canGoBack() { return history.index > 0; },
        get canGoForward() { return history.index < history.entries.length - 1; },
        initialize(href: string) {
            this.openHref(href, { replace: true });
        },
        openHref(href: string, options: WorkspaceOpenOptions = {}, projectUrl = true): boolean {
            const target = resolveDestinationRefFromHref(input.getCatalog(), href);
            if (!target) return false;
            const state = input.getState();
            if (options.tabId && !state.tabs[options.tabId]) return false;
            if (options.groupId && !state.groups[options.groupId]) return false;
            if (options.tabId && options.groupId && !state.groups[options.groupId].tabIds.includes(options.tabId)) return false;
            const openingGroupId = options.groupId ?? state.focusedGroupId;
            const mode = options.mode ?? 'preview';
            const admittedSingleton = singletonActions(state, target);
            if (admittedSingleton) {
                if (admittedSingleton.length === 0) return false;
                for (const action of admittedSingleton) input.dispatch(action);
                if (mode === 'newTab') input.dispatch({ type: 'promoteTab', tabId: focusedEntry().tabId });
            } else if (options.tabId && state.tabs[options.tabId]) {
                const group = Object.values(state.groups).find((item) => item.tabIds.includes(options.tabId!));
                if (!group) return false;
                input.dispatch({ type: 'setTarget', tabId: options.tabId, target });
                if (mode === 'newTab') input.dispatch({ type: 'promoteTab', tabId: options.tabId });
                input.dispatch({ type: 'activateTab', groupId: group.id, tabId: options.tabId });
            } else {
                const existing = mode === 'preview' || mode === 'newTab'
                    ? Object.values(state.tabs).find((tab) => sameDestinationRef(tab.target, target)
                        && (mode === 'preview' || tab.preview)
                        && (!options.groupId || state.groups[options.groupId].tabIds.includes(tab.id))) : undefined;
                if (existing) {
                    const group = Object.values(state.groups).find((item) => item.tabIds.includes(existing.id));
                    if (!group) return false;
                    if (mode === 'newTab') input.dispatch({ type: 'promoteTab', tabId: existing.id });
                    input.dispatch({ type: 'activateTab', groupId: group.id, tabId: existing.id });
                } else {
                    const split = mode === 'splitRight' || mode === 'splitDown';
                    if (split && (options.availableSizePx === undefined || options.minimumFirstSizePx === undefined || options.minimumSecondSizePx === undefined)) return false;
                    const tab: WorkspaceTab = { id: input.createId(), target, pinned: false, preview: mode === 'preview' };
                    const openAction: WorkspaceAction = { type: 'openTab', groupId: openingGroupId, tab };
                    if (split) {
                        const splitAction: WorkspaceAction = {
                            type: 'splitTab', tabId: tab.id, sourceGroupId: openingGroupId,
                            targetGroupId: openingGroupId, newGroupId: input.createId(),
                            axis: mode === 'splitRight' ? 'row' : 'column', placement: 'after',
                            availableSizePx: options.availableSizePx!, minimumFirstSizePx: options.minimumFirstSizePx!, minimumSecondSizePx: options.minimumSecondSizePx!,
                        };
                        // Admission stays with the layout/geometry owner. Calculate the
                        // composed result before publishing either action so rejection is atomic.
                        const opened = reduceWorkspaceState(state, openAction);
                        const candidate = reduceWorkspaceState(opened, splitAction);
                        if (candidate.root === state.root) return false;
                        input.dispatch(openAction);
                        input.dispatch(splitAction);
                    } else input.dispatch(openAction);
                }
            }
            visit(options.replace, projectUrl);
            return true;
        },
        activateTab(groupId: string, tabId: string) {
            input.dispatch({ type: 'activateTab', groupId, tabId });
            visit();
        },
        dispatch(action: WorkspaceAction) {
            input.dispatch(action);
            visit();
        },
        closeTab(groupId: string, tabId: string) {
            input.dispatch({ type: 'closeTab', groupId, tabId, newTab: createWorkspaceEmptyTab(input.createId()) });
            visit();
        },
        setParams(tabId: string, values: Readonly<Record<string, unknown>>) {
            const state = input.getState();
            const tab = state.tabs[tabId];
            if (!tab) return;
            const params = { ...tab.target.params };
            for (const [key, value] of Object.entries(values)) {
                if (value === undefined || value === null) delete params[key];
                else if (typeof value === 'string') params[key] = value;
                else if (typeof value === 'number' || typeof value === 'boolean') params[key] = String(value);
            }
            const target = { ...tab.target, params };
            if (sameDestinationRef(target, tab.target)) return;
            input.dispatch({ type: 'setTarget', tabId, target });
            if (focusedEntry().tabId === tabId) visit(true);
        },
        acceptUrl(href: string, entry?: WorkspaceNavigationEntry, position?: number) {
            if (entry) {
                const restoredEntry = restore(entry);
                const index = position !== undefined && history.entries[position]
                    ? position : history.index;
                history = index >= 0 ? {
                    entries: history.entries.map((item, at) => at === index ? restoredEntry : item), index,
                } : recordWorkspaceNavigation(history, restoredEntry);
                input.transport.adoptCurrent?.(restoredEntry, history.index);
                input.onChange();
                return;
            }
            const target = resolveDestinationRefFromHref(input.getCatalog(), href);
            if (!target || sameDestinationRef(focusedEntry().target, target)) return;
            this.openHref(href, {}, false);
        },
        step(direction: -1 | 1) {
            if (direction === -1 ? !this.canGoBack : !this.canGoForward) return;
            if (input.transport.traverse) {
                input.transport.traverse(direction);
                return;
            }
            const next = stepWorkspaceNavigation(history, direction);
            if (!next.entry) return;
            history = next.history;
            const restoredEntry = restore(next.entry);
            history = { ...history, entries: history.entries.map((item, index) => index === history.index ? restoredEntry : item) };
            const href = hrefForDestinationRef(input.getCatalog(), restoredEntry.target);
            if (href) input.transport.commit(href, restoredEntry, true, history.index);
            input.onChange();
        },
    };
}
