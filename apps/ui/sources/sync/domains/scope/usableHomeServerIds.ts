import * as React from 'react';

import { subscribeHomeCredentialChange } from '@/sync/runtime/orchestration/homeAccountChange';
import { listServerProfiles, resolveServerProfileScopeId, subscribeServerProfiles } from '@/sync/domains/server/serverProfiles';

import { resolveServerCredentialAccountScope } from './serverCredentialAccountScope';

/**
 * The saved Homes this device can actually use: those it holds a credential for, read through the
 * one credential owner (`resolveServerCredentialAccountScope` → `bound`). A pre-saved Happier Cloud
 * profile has no credential until the person signs in, so it is not one of them. This is a derived,
 * in-memory projection, never persisted. It is re-read on Home credential and profile changes:
 * credential-first adoption writes a credential before adding its profile, so the latter change
 * must also refresh the projection.
 * `null` until the first read settles (callers then treat it as unknown, not as "none").
 */
let snapshot: readonly string[] | null = null;
let generation = 0;
let started = false;
const listeners = new Set<() => void>();

function sameIds(left: readonly string[] | null, right: readonly string[]): boolean {
    return left !== null && left.length === right.length && left.every((id, index) => id === right[index]);
}

async function refresh(): Promise<void> {
    const run = ++generation;
    const ids = [...new Set(listServerProfiles().map((profile) => resolveServerProfileScopeId(profile)).filter(Boolean))];
    const resolutions = await Promise.all(ids.map(async (id) => {
        try {
            return { id, bound: (await resolveServerCredentialAccountScope(id)).kind === 'bound' };
        } catch {
            return { id, bound: false };
        }
    }));
    if (run !== generation) return;
    const usable = resolutions.filter((entry) => entry.bound).map((entry) => entry.id).sort();
    if (sameIds(snapshot, usable)) return;
    snapshot = usable;
    for (const listener of [...listeners]) listener();
}

function ensureStarted(): void {
    if (started) return;
    started = true;
    subscribeHomeCredentialChange(() => { void refresh(); });
    subscribeServerProfiles(() => { void refresh(); });
    void refresh();
}

/** The Homes this device can use, or null while not yet known. */
export function readUsableHomeServerIds(): readonly string[] | null {
    ensureStarted();
    return snapshot;
}

export function subscribeUsableHomeServerIds(listener: () => void): () => void {
    ensureStarted();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function useUsableHomeServerIds(): readonly string[] | null {
    return React.useSyncExternalStore(subscribeUsableHomeServerIds, readUsableHomeServerIds, readUsableHomeServerIds);
}
