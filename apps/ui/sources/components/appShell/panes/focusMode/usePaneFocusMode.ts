import * as React from 'react';
import { usePathname } from 'expo-router';

import { useOptionalAppPaneContext } from '@/components/appShell/panes/AppPaneProvider';

import { resolvePaneFocusModeRouteScopeId } from './resolvePaneFocusModeRouteScopeId';

export function usePaneFocusMode(scopeId: string): Readonly<{
    active: boolean;
    canEnter: boolean;
    enter: () => boolean;
    exit: () => boolean;
    toggle: () => void;
}> {
    const paneContext = useOptionalAppPaneContext();
    const pathname = usePathname();
    const routeScopeId = React.useMemo(() => resolvePaneFocusModeRouteScopeId(pathname), [pathname]);
    const state = paneContext?.state;
    const scope = state?.scopes[scopeId];
    const hasFocusablePane = Boolean(scope?.right.isOpen || scope?.details.isOpen);
    const canEnter = state != null && state.activeScopeId === scopeId && routeScopeId === scopeId && hasFocusablePane;
    const active = canEnter && state?.focusMode?.scopeId === scopeId;
    const canTargetScope = state != null && state.activeScopeId === scopeId && routeScopeId === scopeId;

    const enter = React.useCallback(() => {
        if (!paneContext || !canTargetScope) return false;
        paneContext.dispatch({ type: 'enterFocusMode', scopeId });
        return true;
    }, [canTargetScope, paneContext, scopeId]);

    const exit = React.useCallback(() => {
        if (!paneContext || state?.focusMode?.scopeId !== scopeId) return false;
        paneContext.dispatch({ type: 'exitFocusMode', scopeId });
        return true;
    }, [paneContext, scopeId, state?.focusMode?.scopeId]);

    const toggle = React.useCallback(() => {
        if (active) {
            exit();
            return;
        }
        if (canEnter) {
            enter();
        }
    }, [active, canEnter, enter, exit]);

    return { active, canEnter, enter, exit, toggle };
}
