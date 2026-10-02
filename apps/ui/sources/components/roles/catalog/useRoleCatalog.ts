import * as React from 'react';

import { useActiveServerAccountScope, useSetting } from '@/sync/domains/state/storage';
import { areServerAccountScopesEqual, serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { captureActiveServerAccountScopeLifetime, getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { createFrontDoorActionExecute } from '@/sync/ops/actions/frontDoorRuntimeActionExecutor';
import { buildRoleCatalog, parseRolesListOutput, type RoleCatalogEntry, type RolesListItem } from '@/sync/domains/roles/roleCatalog';

export type RoleCatalogState = Readonly<{
    status: 'loading' | 'ready' | 'failed';
    entries: ReadonlyArray<RoleCatalogEntry>;
    refresh: () => void;
}>;

type ScopeSnapshot = Readonly<{ items: ReadonlyArray<RolesListItem> | null; failed: boolean }>;

const EMPTY_ITEMS: ReadonlyArray<RolesListItem> = Object.freeze([]);
const NO_OVERRIDES = Object.freeze({});
const lastKnownByScope = new Map<string, ScopeSnapshot>();
const listeners = new Set<() => void>();
const inFlightByScope = new Map<string, Promise<void>>();
let execute: ReturnType<typeof createFrontDoorActionExecute> | null = null;

function publish(scopeKey: string, snapshot: ScopeSnapshot): void {
    lastKnownByScope.set(scopeKey, snapshot);
    for (const listener of listeners) listener();
}

/** One `roles.list` per scope at a time; concurrent opens share it. */
function loadRoleCatalog(scope: ServerAccountScope): Promise<void> {
    const scopeKey = serverAccountScopeKeySuffix(scope);
    const lifetime = captureActiveServerAccountScopeLifetime();
    if (!lifetime || !areServerAccountScopesEqual(lifetime.scope, scope)) return Promise.resolve();
    const pending = inFlightByScope.get(scopeKey);
    if (pending) return pending;
    execute ??= createFrontDoorActionExecute();
    const request = execute('roles.list', {}, { surface: 'ui', serverId: scope.serverId, expectedAccountId: scope.accountId })
        .then((result) => {
            if (!lifetime.isCurrent()) return;
            const items = result.ok ? parseRolesListOutput(result.result) : null;
            const previous = lastKnownByScope.get(scopeKey);
            publish(scopeKey, items === null
                ? { items: previous?.items ?? null, failed: true }
                : { items, failed: false });
        }, () => {
            if (!lifetime.isCurrent()) return;
            const previous = lastKnownByScope.get(scopeKey);
            publish(scopeKey, { items: previous?.items ?? null, failed: true });
        })
        .finally(() => {
            inFlightByScope.delete(scopeKey);
        });
    inFlightByScope.set(scopeKey, request);
    return request;
}

/** Re-reads the catalog after a role write, for every open surface of that scope. */
export function invalidateRoleCatalog(scopeKey?: string): void {
    const scope = getActiveServerAccountScope();
    if (scope && (scopeKey === undefined || scopeKey === serverAccountScopeKeySuffix(scope))) void loadRoleCatalog(scope);
}

/**
 * Every role the reader can use: the documents `roles.list` returns (built-in, plugin, own and
 * shared), each resolved with the reader's `rolesV1` override by the one resolver. Mount it only in
 * an open surface: the read happens on mount and keeps the last known list per account while it
 * refreshes.
 */
export function useRoleCatalog(): RoleCatalogState {
    const scope = useActiveServerAccountScope();
    const scopeKey = scope ? serverAccountScopeKeySuffix(scope) : 'local';
    const snapshot = React.useSyncExternalStore(
        React.useCallback((listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        }, []),
        () => lastKnownByScope.get(scopeKey),
    );
    React.useEffect(() => {
        if (scope) void loadRoleCatalog(scope);
    }, [scopeKey]);
    const refresh = React.useCallback(() => { if (scope) void loadRoleCatalog(scope); }, [scopeKey]);
    const overrides = useSetting('rolesV1')?.overrides ?? NO_OVERRIDES;
    const items = snapshot?.items ?? EMPTY_ITEMS;
    const entries = React.useMemo(() => buildRoleCatalog({ items, overrides }), [items, overrides]);

    return React.useMemo(() => ({
        status: snapshot?.items ? 'ready' : snapshot?.failed ? 'failed' : 'loading',
        entries,
        refresh,
    }), [entries, refresh, snapshot]);
}
