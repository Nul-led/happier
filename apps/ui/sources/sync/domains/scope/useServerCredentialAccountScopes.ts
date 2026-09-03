import * as React from 'react';

import { subscribeHomeCredentialMutations, TokenStorage } from '@/auth/storage/tokenStorage';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import {
    areServerProfileIdentifiersEquivalent,
    getServerProfileById,
    resolveServerProfileScopeIdForIdentifier,
} from '@/sync/domains/server/serverProfiles';
import { parseToken } from '@/utils/auth/parseToken';

export type ServerCredentialAccountScopeBinding = Readonly<{
    serverId: string;
    accountId: string;
    revision: number;
    /** False synchronously once this exact Home credential changes or unmounts. */
    isCurrent(): boolean;
    onRetire(cancel: () => void): Readonly<{ dispose(): void }>;
}>;

/**
 * Component-local projection of exact Home credentials into Account identity.
 * Credential storage and its mutation event remain the authority; this hook
 * adds no persisted/global lifetime. A mutation invalidates captured bindings
 * before the replacement credential is read, fencing late Search publication.
 */
export function useServerCredentialAccountScopes(
    serverIds: readonly (string | null | undefined)[],
): ReadonlyMap<string, ServerCredentialAccountScopeBinding> {
    const profilesGeneration = useServerProfilesGeneration();
    const normalizedServerIds = [...new Set(serverIds
        .map((serverId) => String(serverId ?? '').trim())
        .filter(Boolean))].sort();
    const serverIdsKey = normalizedServerIds.join('\u0000');
    const revisionsRef = React.useRef(new Map<string, number>());
    const retirementCallbacksRef = React.useRef(new Map<string, Set<() => void>>());
    const mountedRef = React.useRef(true);
    const [bindings, setBindings] = React.useState<ReadonlyMap<string, ServerCredentialAccountScopeBinding>>(
        () => new Map(),
    );

    React.useEffect(() => {
        mountedRef.current = true;
        const trackedServerIds = new Set(normalizedServerIds);

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
            if (publish) {
                setBindings((current) => {
                    if (!current.has(serverId)) return current;
                    const next = new Map(current);
                    next.delete(serverId);
                    return next;
                });
            }
            return revision;
        };

        const resolveBinding = async (requestedServerId: string, revision: number): Promise<void> => {
            const canonicalServerId = resolveServerProfileScopeIdForIdentifier(requestedServerId);
            const profile = getServerProfileById(canonicalServerId);
            if (!profile) return;
            const credentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, {
                serverId: profile.id,
            });
            let accountId: string | null = null;
            try {
                accountId = credentials ? parseToken(credentials.token) : null;
            } catch {
                accountId = null;
            }
            if (
                !accountId
                || !mountedRef.current
                || revisionsRef.current.get(requestedServerId) !== revision
            ) return;
            const binding: ServerCredentialAccountScopeBinding = Object.freeze({
                serverId: requestedServerId,
                accountId,
                revision,
                isCurrent: () => mountedRef.current
                    && revisionsRef.current.get(requestedServerId) === revision,
                onRetire: (cancel) => {
                    if (!mountedRef.current || revisionsRef.current.get(requestedServerId) !== revision) {
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
            setBindings((current) => {
                if (!binding.isCurrent()) return current;
                const next = new Map(current);
                next.set(requestedServerId, binding);
                return next;
            });
        };

        for (const serverId of normalizedServerIds) {
            const revision = invalidate(serverId);
            void resolveBinding(serverId, revision);
        }

        const unsubscribe = subscribeHomeCredentialMutations((event) => {
            for (const serverId of trackedServerIds) {
                if (!areServerProfileIdentifiersEquivalent(event.serverId, serverId)) continue;
                const revision = invalidate(serverId);
                void resolveBinding(serverId, revision);
            }
        });

        return () => {
            mountedRef.current = false;
            unsubscribe();
            for (const serverId of trackedServerIds) invalidate(serverId, false);
        };
        // The sorted key is the identity of the requested set. The profile
        // generation deliberately retriggers credential resolution after a
        // profile URL/identity update without making profile data authoritative.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profilesGeneration, serverIdsKey]);

    return bindings;
}
