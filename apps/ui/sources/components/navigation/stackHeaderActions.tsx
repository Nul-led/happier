import * as React from 'react';
import * as ReactNavigationNative from '@react-navigation/native';

/**
 * A route's stack-header actions (`headerLeft`/`headerRight`) while its stack header is not drawn:
 * inside the desktop app shell a page draws no stack header (`createHeader`), so the actions a route
 * put there move into the page's own header (`PageHeader`) instead of being lost. The header publishes
 * them by route key; the page's header claims and renders them. A page with no page header keeps a
 * slim actions-only bar from the stack header, so no route loses an action.
 */
type Entry = Readonly<{ render: () => React.ReactNode; claims: number }>;

type RouteIdentity = Readonly<{ key?: string }> | undefined;
const NO_ROUTE_CONTEXT = React.createContext<RouteIdentity>(undefined);
/**
 * The screen's route (React Navigation's own route context). A navigation boundary stub without it
 * leaves pages unkeyed, so they claim nothing.
 */
const RouteContext: React.Context<RouteIdentity> = (() => {
    try {
        return (ReactNavigationNative as unknown as { NavigationRouteContext?: React.Context<RouteIdentity> }).NavigationRouteContext
            ?? NO_ROUTE_CONTEXT;
    } catch {
        return NO_ROUTE_CONTEXT;
    }
})();

const entries = new Map<string, Entry>();
const NO_ACTIONS = () => null;
const listeners = new Set<() => void>();
function emit() {
    for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Publishes the actions of the route whose stack header is hidden; `null` withdraws them. */
export function useStackHeaderActionsPublisher(routeKey: string, render: (() => React.ReactNode) | null) {
    React.useEffect(() => {
        if (!render) return undefined;
        const claims = entries.get(routeKey)?.claims ?? 0;
        entries.set(routeKey, { render, claims });
        emit();
        return () => {
            const current = entries.get(routeKey);
            if (current?.render === render) {
                if (current.claims > 0) entries.set(routeKey, { render: NO_ACTIONS, claims: current.claims });
                else entries.delete(routeKey);
                emit();
            }
        };
    }, [render, routeKey]);
}

/** Whether a page header on this route has taken its actions (the stack header then draws nothing). */
export function useStackHeaderActionsClaimed(routeKey: string): boolean {
    return React.useSyncExternalStore(subscribe, () => (entries.get(routeKey)?.claims ?? 0) > 0, () => false);
}

/** The page header's side: claims the route's stack-header actions and returns them to render. */
export function useClaimedStackHeaderActions(): React.ReactNode {
    const route = React.useContext(RouteContext);
    const routeKey = route?.key ?? null;
    React.useEffect(() => {
        if (!routeKey) return undefined;
        const current = entries.get(routeKey);
        entries.set(routeKey, { render: current?.render ?? NO_ACTIONS, claims: (current?.claims ?? 0) + 1 });
        emit();
        return () => {
            const latest = entries.get(routeKey);
            if (!latest) return;
            const claims = Math.max(0, latest.claims - 1);
            if (claims === 0 && latest.render === NO_ACTIONS) entries.delete(routeKey);
            else entries.set(routeKey, { render: latest.render, claims });
            emit();
        };
    }, [routeKey]);
    const render = React.useSyncExternalStore(
        subscribe,
        () => (routeKey ? entries.get(routeKey)?.render ?? null : null),
        () => null,
    );
    return render ? render() : null;
}
