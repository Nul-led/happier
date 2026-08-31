import type { PluginUiEphemeralSharedScope } from '@happier-dev/plugin-ui/hostApi';
import type { PluginMachineExecutionOriginV1 } from '@happier-dev/protocol';
import { useLayoutEffect, useState } from 'react';

import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';

type SharedValueEntry = {
    value: unknown;
    dispose(): void;
    onExecutionOriginChange?: () => void;
    readonly leases: Set<SharedValueLease>;
};

type SharedValueLease = Readonly<{
    executionOriginKey: string;
}>;

type GenerationScope = {
    readonly immutableGenerationId: string;
    readonly values: Map<string, SharedValueEntry>;
    retired: boolean;
};

type PluginScopeRecord = {
    /** Per-transport currentness fences; these never participate in value identity. */
    readonly origins: Map<string, { current: GenerationScope | null }>;
    /** Opaque value identity is exactly Account + plugin + immutable generation. */
    readonly generations: Map<string, GenerationScope>;
};

type AccountScopeRecord = {
    retired: boolean;
    readonly plugins: Map<string, PluginScopeRecord>;
};

const accountScopes = new WeakMap<ActiveServerAccountScopeLifetime, AccountScopeRecord>();

function disposeSharedValue(entry: SharedValueEntry): void {
    entry.leases.clear();
    try {
        entry.dispose();
    } catch {
        // A plugin-owned value cannot prevent the host from retiring the rest
        // of this Account/generation scope.
    }
}

function retireGeneration(scope: GenerationScope): void {
    if (scope.retired) return;
    scope.retired = true;
    const entries = [...scope.values.values()];
    scope.values.clear();
    for (const entry of entries) disposeSharedValue(entry);
}

function retireAccount(record: AccountScopeRecord): void {
    if (record.retired) return;
    record.retired = true;
    for (const plugin of record.plugins.values()) {
        for (const generation of plugin.generations.values()) retireGeneration(generation);
        plugin.generations.clear();
        plugin.origins.clear();
    }
    record.plugins.clear();
}

function readExecutionOriginSlot(executionOrigin: PluginMachineExecutionOriginV1 | null | undefined): string {
    if (!executionOrigin) return 'unqualified';
    return JSON.stringify([
        executionOrigin.serverIdentityId,
        executionOrigin.materializationRef.pluginId,
        executionOrigin.materializationRef.machineId,
        executionOrigin.materializationRef.materializationId,
    ]);
}

function readAccountRecord(
    accountLifetime: ActiveServerAccountScopeLifetime,
): AccountScopeRecord | null {
    if (!accountLifetime.isCurrent()) return null;
    const existing = accountScopes.get(accountLifetime);
    if (existing) return existing.retired ? null : existing;

    const record: AccountScopeRecord = {
        retired: false,
        plugins: new Map(),
    };
    accountScopes.set(accountLifetime, record);
    accountLifetime.onRetire(() => retireAccount(record));
    return record.retired || !accountLifetime.isCurrent() ? null : record;
}

function createGenerationFacade(input: Readonly<{
    accountLifetime: ActiveServerAccountScopeLifetime;
    account: AccountScopeRecord;
    slot: { current: GenerationScope | null };
    generation: GenerationScope;
    executionOriginKey: string;
    isCurrent(): boolean;
}>): PluginUiEphemeralSharedScope {
    return Object.freeze({
        acquire<T>(
            localKey: string,
            create: () => Readonly<{
                value: T;
                dispose(): void;
                onExecutionOriginChange?(): void;
            }>,
        ) {
            if (
                input.account.retired
                || input.generation.retired
                || input.slot.current !== input.generation
                || !input.accountLifetime.isCurrent()
                || !input.isCurrent()
            ) return null;

            let entry = input.generation.values.get(localKey);
            if (!entry) {
                const created = create();
                entry = {
                    value: created.value,
                    dispose: created.dispose,
                    ...(created.onExecutionOriginChange === undefined
                        ? {}
                        : { onExecutionOriginChange: created.onExecutionOriginChange }),
                    leases: new Set(),
                };
                // `create` is trusted plugin code and may synchronously retire
                // this mount. Refuse publication and dispose its value if the
                // owner changed while it ran.
                if (
                    input.account.retired
                    || input.generation.retired
                    || input.slot.current !== input.generation
                    || !input.accountLifetime.isCurrent()
                    || !input.isCurrent()
                ) {
                    disposeSharedValue(entry);
                    return null;
                }
                input.generation.values.set(localKey, entry);
            }

            const leaseRecord = Object.freeze({ executionOriginKey: input.executionOriginKey });
            entry.leases.add(leaseRecord);
            let released = false;
            const leasedEntry = entry;
            return Object.freeze({
                value: leasedEntry.value as T,
                release(): void {
                    if (released) return;
                    released = true;
                    const activeBeforeRelease = leasedEntry.leases.values().next().value as SharedValueLease | undefined;
                    if (!leasedEntry.leases.delete(leaseRecord)) return;
                    if (input.generation.values.get(localKey) !== leasedEntry) return;
                    if (leasedEntry.leases.size === 0) {
                        input.generation.values.delete(localKey);
                        disposeSharedValue(leasedEntry);
                        return;
                    }
                    const activeAfterRelease = leasedEntry.leases.values().next().value as SharedValueLease | undefined;
                    if (
                        activeBeforeRelease === leaseRecord
                        && activeAfterRelease?.executionOriginKey !== input.executionOriginKey
                    ) {
                        try {
                            leasedEntry.onExecutionOriginChange?.();
                        } catch {
                            // A plugin-owned lifecycle observer cannot prevent
                            // the host from completing lease retirement.
                        }
                    }
                },
            });
        },
    });
}

/**
 * Resolve one host-owned, in-process sharing scope for a mounted plugin
 * generation. Account and generation replacement retire every opaque value;
 * the caller's incumbent mount currentness fences stale overlapping renders.
 */
export function getPluginUiEphemeralSharedScope(input: Readonly<{
    accountLifetime: ActiveServerAccountScopeLifetime | null;
    pluginId: string;
    immutableGenerationId: string;
    /** Exact transport participant; it fences currentness but never keys the value. */
    executionOrigin?: PluginMachineExecutionOriginV1 | null;
    isCurrent(): boolean;
}>): PluginUiEphemeralSharedScope | null {
    if (!input.accountLifetime || !input.isCurrent()) return null;
    const account = readAccountRecord(input.accountLifetime);
    if (!account || !input.isCurrent()) return null;

    let plugin = account.plugins.get(input.pluginId);
    if (!plugin) {
        plugin = { origins: new Map(), generations: new Map() };
        account.plugins.set(input.pluginId, plugin);
    }

    const executionOriginKey = readExecutionOriginSlot(input.executionOrigin);
    let slot = plugin.origins.get(executionOriginKey);
    if (!slot) {
        slot = { current: null };
        plugin.origins.set(executionOriginKey, slot);
    }
    let generation = plugin.generations.get(input.immutableGenerationId);
    if (!generation || generation.retired) {
        generation = {
            immutableGenerationId: input.immutableGenerationId,
            values: new Map(),
            retired: false,
        };
        plugin.generations.set(input.immutableGenerationId, generation);
    }
    const precedingGeneration = slot.current;
    if (precedingGeneration !== generation) {
        slot.current = generation;
        const precedingStillCurrent = precedingGeneration
            ? [...plugin.origins.values()].some((origin) => origin.current === precedingGeneration)
            : false;
        if (precedingGeneration && !precedingStillCurrent) {
            if (plugin.generations.get(precedingGeneration.immutableGenerationId) === precedingGeneration) {
                plugin.generations.delete(precedingGeneration.immutableGenerationId);
            }
            retireGeneration(precedingGeneration);
        }
    }

    return createGenerationFacade({
        accountLifetime: input.accountLifetime,
        account,
        slot,
        generation,
        executionOriginKey,
        isCurrent: input.isCurrent,
    });
}

type MountedScopeInput = Readonly<{
    accountLifetime: ActiveServerAccountScopeLifetime | null;
    pluginId: string;
    immutableGenerationId: string;
    executionOrigin?: PluginMachineExecutionOriginV1 | null;
    mountLifetime: Readonly<{ isCurrent(): boolean }>;
}>;

type MountedScopeState = MountedScopeInput & Readonly<{
    scope: PluginUiEphemeralSharedScope | null;
}>;

function isSameMountedScopeInput(state: MountedScopeState, input: MountedScopeInput): boolean {
    return state.accountLifetime === input.accountLifetime
        && state.pluginId === input.pluginId
        && state.immutableGenerationId === input.immutableGenerationId
        && readExecutionOriginSlot(state.executionOrigin) === readExecutionOriginSlot(input.executionOrigin)
        && state.mountLifetime === input.mountLifetime;
}

/**
 * Commit-safe React adapter for the host registry. A speculative render never
 * retires another generation, and a changed identity exposes `null` until its
 * committed layout effect installs the exact current scope.
 */
export function usePluginUiEphemeralSharedScopeBinding(
    input: MountedScopeInput,
): PluginUiEphemeralSharedScope | null {
    const executionOriginSlot = readExecutionOriginSlot(input.executionOrigin);
    const [state, setState] = useState<MountedScopeState>(() => ({ ...input, scope: null }));
    if (!isSameMountedScopeInput(state, input)) {
        setState({ ...input, scope: null });
    }
    const effectiveState = isSameMountedScopeInput(state, input)
        ? state
        : { ...input, scope: null };

    useLayoutEffect(() => {
        const scope = getPluginUiEphemeralSharedScope({
            accountLifetime: input.accountLifetime,
            pluginId: input.pluginId,
            immutableGenerationId: input.immutableGenerationId,
            executionOrigin: input.executionOrigin,
            isCurrent: input.mountLifetime.isCurrent,
        });
        setState((current) => isSameMountedScopeInput(current, input)
            ? { ...input, scope }
            : current);
    }, [executionOriginSlot, input.accountLifetime, input.immutableGenerationId, input.mountLifetime, input.pluginId]);

    return effectiveState.scope;
}
