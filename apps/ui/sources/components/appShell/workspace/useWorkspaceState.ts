import * as React from 'react';
import { Platform } from 'react-native';
import { useActiveServerAccountScope, useIsDataReady, useLocalSettingMutable } from '@/sync/domains/state/storage';
import type { WorkspaceAction, WorkspaceTab, WorkspaceState } from './workspaceState';
import { createWorkspaceState, reduceWorkspaceState } from './workspaceState';
import { randomUUID } from '@/platform/randomUUID';
import { reconcileWorkspaceSyncedTabs, type SharedWorkspaceTabs } from './workspaceSyncedTabs';
import {
    readScopedWorkspaceLayout, workspaceLayoutScopeKey, writeScopedWorkspaceLayout,
} from './workspacePersistence';

const WINDOW_ID_KEY = 'happier.workspace.windowIdV1';

function readOrCreateWindowId(): string | null {
    if (Platform.OS !== 'web') return 'main';
    if (typeof window === 'undefined') return null;
    try {
        const existing = window.sessionStorage.getItem(WINDOW_ID_KEY);
        if (existing) return existing;
        const next = globalThis.crypto?.randomUUID?.();
        if (!next) return null;
        window.sessionStorage.setItem(WINDOW_ID_KEY, next);
        return next;
    } catch {
        return null;
    }
}

export function useWorkspaceState(input: Readonly<{ initialTab: WorkspaceTab; windowId?: string }>): Readonly<{
    state: WorkspaceState;
    dispatch: (action: WorkspaceAction) => void;
    getState: () => WorkspaceState;
    isReady: boolean;
    windowId: string | null;
    applySharedRecord: (record: SharedWorkspaceTabs) => void;
}> {
    const scope = useActiveServerAccountScope();
    const isDataReady = useIsDataReady();
    const [layouts, setLayouts] = useLocalSettingMutable('workspaceLayoutV1');
    const [generatedWindowId] = React.useState(readOrCreateWindowId);
    const windowId = input.windowId ?? generatedWindowId;
    const scopeKey = scope && windowId
        ? workspaceLayoutScopeKey({ serverId: scope.serverId, accountId: scope.accountId, windowId })
        : null;
    const canRestore = isDataReady && scopeKey !== null;
    const currentScopeRef = React.useRef(scopeKey);
    currentScopeRef.current = scopeKey;
    const fallbackState = React.useMemo(() => createWorkspaceState(input.initialTab), [input.initialTab]);
    const [state, setState] = React.useState<WorkspaceState>(() => (
        canRestore && scopeKey ? readScopedWorkspaceLayout(layouts, scopeKey) ?? fallbackState
            : fallbackState
    ));
    const stateRef = React.useRef(state);
    stateRef.current = state;
    const layoutsRef = React.useRef(layouts);
    layoutsRef.current = layouts;
    const restoredScopeRef = React.useRef<string | null>(canRestore ? scopeKey : null);
    const isReady = canRestore && restoredScopeRef.current === scopeKey;

    React.useEffect(() => {
        if (!canRestore || !scopeKey || restoredScopeRef.current === scopeKey) return;
        restoredScopeRef.current = scopeKey;
        const restored = readScopedWorkspaceLayout(layoutsRef.current, scopeKey) ?? createWorkspaceState(input.initialTab);
        stateRef.current = restored;
        setState(restored);
    }, [canRestore, input.initialTab, scopeKey]);

    const persist = React.useCallback((next: WorkspaceState) => {
        if (!isReady || !scopeKey || currentScopeRef.current !== scopeKey) return;
        if (next === stateRef.current) return;
        stateRef.current = next;
        setState(next);
        const nextLayouts = writeScopedWorkspaceLayout(layoutsRef.current, scopeKey, next);
        layoutsRef.current = nextLayouts;
        setLayouts(nextLayouts);
    }, [isReady, scopeKey, setLayouts]);

    const dispatch = React.useCallback((action: WorkspaceAction) => {
        if (!isReady || currentScopeRef.current !== scopeKey) return;
        persist(reduceWorkspaceState(stateRef.current, action));
    }, [isReady, persist, scopeKey]);
    const applySharedRecord = React.useCallback((record: SharedWorkspaceTabs) => {
        if (!isReady || currentScopeRef.current !== scopeKey) return;
        persist(reconcileWorkspaceSyncedTabs(stateRef.current, record, randomUUID));
    }, [isReady, persist, scopeKey]);

    const getState = React.useCallback(() => isReady ? stateRef.current : fallbackState, [fallbackState, isReady]);
    return { state: isReady ? state : fallbackState, dispatch, getState, isReady, windowId, applySharedRecord };
}
