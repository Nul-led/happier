import * as React from 'react';

import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import {
    areServerProfileIdentifiersEquivalent,
    resolveServerProfileScopeIdForIdentifier,
} from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';
import { subscribeHomeCredentialChange } from '@/sync/runtime/orchestration/homeAccountChange';
import { captureActiveServerAccountScopeLifetime } from './activeServerAccountScope';
import {
    areServerAccountScopesEqual,
    createServerAccountScope,
    type ServerAccountScope,
    type ServerAccountScopeLifetime,
} from './serverAccountScope';
import {
    resolveServerCredentialAccountScope,
    type ServerCredentialAccountScopeResolution,
} from './serverCredentialAccountScope';

export type { ServerCredentialAccountScopeResolution } from './serverCredentialAccountScope';

export type ServerCredentialAccountScopeBinding = ServerAccountScopeLifetime & Readonly<{
    serverId: string;
    accountId: string;
    revision: number;
}>;

type UnboundScopeResolution =
    | Readonly<{ kind: 'resolving' }>
    | Readonly<{ kind: 'unknown_home' }>
    | Readonly<{ kind: 'signed_out' }>;
type BoundScopeResolution = Readonly<{ kind: 'bound'; scope: ServerAccountScope }>;

type ScopeEntry =
    | Readonly<{ resolution: UnboundScopeResolution }>
    | Readonly<{ resolution: BoundScopeResolution; binding: ServerCredentialAccountScopeBinding }>;

export type ServerCredentialAccountScopeProjectionLifecycle = Readonly<{
    beforeBinding?: (binding: ServerCredentialAccountScopeBinding) => void;
    onCredentialMutation?: (serverId: string) => void;
}>;

const RESOLVING = Object.freeze({ kind: 'resolving' } as const);
const UNKNOWN_HOME = Object.freeze({ kind: 'unknown_home' } as const);
const SIGNED_OUT = Object.freeze({ kind: 'signed_out' } as const);
const RESOLVING_ENTRY: ScopeEntry = Object.freeze({ resolution: RESOLVING });
const UNKNOWN_HOME_ENTRY: ScopeEntry = Object.freeze({ resolution: UNKNOWN_HOME });
const SIGNED_OUT_ENTRY: ScopeEntry = Object.freeze({ resolution: SIGNED_OUT });

/**
 * One credential-resolution and retirement lifecycle for every exact Home.
 * Domain projections may clean up their own rows at the binding boundary;
 * credential identity and currentness always remain owned here.
 */
function useCredentialScopeEntries(
    serverIds: readonly (string | null | undefined)[],
    projectionLifecycle?: ServerCredentialAccountScopeProjectionLifecycle,
): ReadonlyMap<string, ScopeEntry> {
    const profilesGeneration = useServerProfilesGeneration();
    const normalizedServerIds = [...new Set(serverIds
        .map((serverId) => resolveServerProfileScopeIdForIdentifier(serverId))
        .filter(Boolean))].sort();
    const serverIdsKey = JSON.stringify(normalizedServerIds);
    const revisionsRef = React.useRef(new Map<string, number>());
    const retirementCallbacksRef = React.useRef(new Map<string, Set<() => void>>());
    const mountedRef = React.useRef(true);
    const [entries, setEntries] = React.useState<ReadonlyMap<string, ScopeEntry>>(() => new Map());

    React.useEffect(() => {
        mountedRef.current = true;
        const trackedServerIds = new Set(normalizedServerIds);
        setEntries((current) => {
            if ([...current.keys()].every((serverId) => trackedServerIds.has(serverId))) return current;
            return new Map([...current].filter(([serverId]) => trackedServerIds.has(serverId)));
        });

        const publishEntry = (serverId: string, entry: ScopeEntry): void => {
            setEntries((current) => {
                if (current.get(serverId) === entry) return current;
                const next = new Map(current);
                next.set(serverId, entry);
                return next;
            });
        };

        const invalidate = (serverId: string, publish = true): number => {
            const retirements = retirementCallbacksRef.current.get(serverId);
            retirementCallbacksRef.current.delete(serverId);
            for (const retire of retirements ?? []) {
                try {
                    retire();
                } catch {
                    // One consumer cannot prevent sibling scope retirement.
                }
            }
            const revision = (revisionsRef.current.get(serverId) ?? 0) + 1;
            revisionsRef.current.set(serverId, revision);
            if (publish) publishEntry(serverId, RESOLVING_ENTRY);
            return revision;
        };

        const resolveBinding = async (requestedServerId: string, revision: number): Promise<void> => {
            const isCurrent = () => mountedRef.current
                && revisionsRef.current.get(requestedServerId) === revision;
            const resolution = await resolveServerCredentialAccountScope(requestedServerId);
            if (!isCurrent()) return;
            if (resolution.kind !== 'bound') {
                publishEntry(requestedServerId, resolution.kind === 'unknown_home' ? UNKNOWN_HOME_ENTRY : SIGNED_OUT_ENTRY);
                return;
            }
            const scope = resolution.scope;
            const binding: ServerCredentialAccountScopeBinding = Object.freeze({
                serverId: requestedServerId,
                accountId: scope.accountId,
                scope,
                revision,
                isCurrent,
                onRetire: (cancel) => {
                    if (!isCurrent()) {
                        cancel();
                        return Object.freeze({ dispose(): void {} });
                    }
                    const callbacks = retirementCallbacksRef.current.get(requestedServerId) ?? new Set<() => void>();
                    callbacks.add(cancel);
                    retirementCallbacksRef.current.set(requestedServerId, callbacks);
                    return Object.freeze({
                        dispose(): void {
                            callbacks.delete(cancel);
                            if (callbacks.size === 0) retirementCallbacksRef.current.delete(requestedServerId);
                        },
                    });
                },
            });
            projectionLifecycle?.beforeBinding?.(binding);
            setEntries((current) => {
                if (!binding.isCurrent()) return current;
                const next = new Map(current);
                next.set(requestedServerId, Object.freeze({
                    resolution: Object.freeze({ kind: 'bound' as const, scope }),
                    binding,
                }));
                return next;
            });
        };

        for (const serverId of normalizedServerIds) {
            const revision = invalidate(serverId);
            void resolveBinding(serverId, revision);
        }

        const unsubscribe = subscribeHomeCredentialChange((event) => {
            for (const serverId of trackedServerIds) {
                if (!areServerProfileIdentifiersEquivalent(event.serverId, serverId)) continue;
                projectionLifecycle?.onCredentialMutation?.(serverId);
                const revision = invalidate(serverId);
                void resolveBinding(serverId, revision);
            }
        });

        return () => {
            mountedRef.current = false;
            unsubscribe();
            for (const serverId of trackedServerIds) invalidate(serverId, false);
        };
        // The sorted key identifies the Home set. Profile changes retire and
        // re-resolve bindings without making profile data Account authority.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profilesGeneration, serverIdsKey, projectionLifecycle]);

    return entries;
}

const SESSION_PROJECTION_LIFECYCLE: ServerCredentialAccountScopeProjectionLifecycle = {
    beforeBinding(binding) {
        const activeAccountScope = captureActiveServerAccountScopeLifetime()?.scope ?? null;
        if (!activeAccountScope || !areServerAccountScopesEqual(
            activeAccountScope,
            createServerAccountScope(binding.serverId, binding.accountId),
        )) {
            // A Search consumer may mount after missing a credential mutation.
            // Clear its old inactive-Home rows before publishing the binding.
            storage.getState().clearSessionListRowsForServerScope(binding.serverId);
        }
    },
    onCredentialMutation(serverId) {
        storage.getState().clearSessionListRowsForServerScope(serverId);
    },
};

/** Cancellable bindings for the existing Session/Search projection consumers. */
export function useServerCredentialAccountScopes(
    serverIds: readonly (string | null | undefined)[],
): ReadonlyMap<string, ServerCredentialAccountScopeBinding> {
    const entries = useCredentialScopeEntries(serverIds, SESSION_PROJECTION_LIFECYCLE);
    return React.useMemo(() => boundScopeEntries(entries), [entries]);
}

function boundScopeEntries(entries: ReadonlyMap<string, ScopeEntry>): ReadonlyMap<string, ServerCredentialAccountScopeBinding> {
    const bindings = new Map<string, ServerCredentialAccountScopeBinding>();
    for (const [serverId, entry] of entries) {
        if ('binding' in entry) bindings.set(serverId, entry.binding);
    }
    return bindings;
}

/** Exact Home credential lifetimes without Session-projection cleanup effects. */
export function useServerCredentialAccountScopeBindings(
    serverIds: readonly (string | null | undefined)[],
): ReadonlyMap<string, ServerCredentialAccountScopeBinding> {
    const entries = useCredentialScopeEntries(serverIds);
    return React.useMemo(() => {
        return boundScopeEntries(entries);
    }, [entries]);
}

/** Exact Home identity states without Session projection side effects. */
export function useServerCredentialAccountScopeResolutions(
    serverIds: readonly (string | null | undefined)[],
    projectionLifecycle?: ServerCredentialAccountScopeProjectionLifecycle,
): ReadonlyMap<string, ServerCredentialAccountScopeResolution> {
    const entries = useCredentialScopeEntries(serverIds, projectionLifecycle);
    return React.useMemo(() => new Map(
        [...entries].map(([serverId, entry]) => [serverId, entry.resolution] as const),
    ), [entries]);
}

export function useServerCredentialAccountScopeResolution(
    serverId: string | null | undefined,
): ServerCredentialAccountScopeResolution {
    const normalized = resolveServerProfileScopeIdForIdentifier(serverId);
    const requested = React.useMemo(() => (normalized ? [normalized] : []), [normalized]);
    const resolutions = useServerCredentialAccountScopeResolutions(requested);
    if (!normalized) return UNKNOWN_HOME;
    return resolutions.get(normalized) ?? RESOLVING;
}
