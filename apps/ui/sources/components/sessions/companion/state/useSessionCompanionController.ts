import * as React from 'react';

import { useMutateSessionCompanionPreference } from '@/sync/domains/state/storage';

import { useSessionCompanionPreference, type SessionCompanionAvailability } from './useSessionCompanionPreference';
import {
    addSessionCompanionItem,
    areSessionCompanionItemsEqual,
    areSessionCompanionPreferencesEqual,
    hideSessionCompanion,
    moveSessionCompanionItem,
    normalizeSessionCompanionPreference,
    removeSessionCompanionItem,
    SESSION_SUMMARY_COMPANION_ITEM,
    sessionCompanionItemKey,
    setSessionCompanionCollapsed,
    setSessionCompanionDensity,
    setSessionCompanionEdge,
    showSessionCompanion,
    type SessionCompanionDensity,
    type SessionCompanionEdge,
    type SessionCompanionItemRefV1,
    type SessionCompanionPreferenceV1,
} from './sessionCompanionPreference';

/**
 * What one applied local mutation changed. The applying surface keeps this to
 * offer a safe local inverse through the existing presentation-notice owner:
 * the inverse is only valid while the live preference is still exactly what this
 * mutation produced, so a newer manual change is never overwritten.
 */
export type SessionCompanionMutationOutcome = Readonly<{
    previous: SessionCompanionPreferenceV1;
    applied: SessionCompanionPreferenceV1;
    /** Exact list mutation, when this operation changed item membership/order. */
    itemMutation?: Readonly<{
        kind: 'added' | 'removed' | 'moved';
        item: SessionCompanionItemRefV1;
    }>;
}>;

function areItemListsEqual(
    first: readonly SessionCompanionItemRefV1[],
    second: readonly SessionCompanionItemRefV1[],
): boolean {
    return first.length === second.length && first.every((item, index) => {
        const other = second[index];
        return other !== undefined && areSessionCompanionItemsEqual(item, other);
    });
}

/**
 * Resolve the notice host's narrow local inverse.
 *
 * Only fields changed by the original mutation participate in currentness and
 * restoration. A later unrelated choice (for example density after showing the
 * Companion) survives Undo, while any newer edit to an affected field makes the
 * inverse stale and therefore inert.
 */
export function resolveSessionCompanionLocalInverse(
    outcome: SessionCompanionMutationOutcome,
    current: SessionCompanionPreferenceV1,
): SessionCompanionPreferenceV1 | null {
    const visibleChanged = outcome.previous.visible !== outcome.applied.visible;
    const collapsedChanged = outcome.previous.collapsed !== outcome.applied.collapsed;
    const edgeChanged = outcome.previous.edge !== outcome.applied.edge;
    const densityChanged = outcome.previous.density !== outcome.applied.density;
    const itemsChanged = !areItemListsEqual(outcome.previous.items, outcome.applied.items);

    if (
        (visibleChanged && current.visible !== outcome.applied.visible)
        || (collapsedChanged && current.collapsed !== outcome.applied.collapsed)
        || (edgeChanged && current.edge !== outcome.applied.edge)
        || (densityChanged && current.density !== outcome.applied.density)
        || (itemsChanged && !outcome.itemMutation && !areItemListsEqual(current.items, outcome.applied.items))
    ) {
        return null;
    }

    let restoredItems = itemsChanged ? outcome.previous.items : current.items;
    if (itemsChanged && outcome.itemMutation) {
        const mutation = outcome.itemMutation;
        const itemKey = sessionCompanionItemKey(mutation.item);
        const previousKeys = outcome.previous.items.map(sessionCompanionItemKey);
        const appliedKeys = outcome.applied.items.map(sessionCompanionItemKey);
        const currentKeys = current.items.map(sessionCompanionItemKey);
        const baselineKeys = mutation.kind === 'removed' ? appliedKeys : appliedKeys;
        const currentBaselineOrder = currentKeys.filter((key) => baselineKeys.includes(key));
        if (!areStringListsEqual(currentBaselineOrder, baselineKeys)) return null;

        if (mutation.kind === 'added') {
            if (!currentKeys.includes(itemKey)) return null;
            restoredItems = current.items.filter((item) => sessionCompanionItemKey(item) !== itemKey);
        } else if (mutation.kind === 'removed') {
            if (currentKeys.includes(itemKey)) return null;
            restoredItems = insertItemAtOriginalNeighbors(current.items, mutation.item, previousKeys);
        } else {
            if (!currentKeys.includes(itemKey)) return null;
            restoredItems = insertItemAtOriginalNeighbors(
                current.items.filter((item) => sessionCompanionItemKey(item) !== itemKey),
                mutation.item,
                previousKeys,
            );
        }
    }

    return normalizeSessionCompanionPreference({
        v: 1,
        visible: visibleChanged ? outcome.previous.visible : current.visible,
        collapsed: collapsedChanged ? outcome.previous.collapsed : current.collapsed,
        edge: edgeChanged ? outcome.previous.edge : current.edge,
        density: densityChanged ? outcome.previous.density : current.density,
        items: itemsChanged ? restoredItems : current.items,
    });
}

function areStringListsEqual(first: readonly string[], second: readonly string[]): boolean {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}

function insertItemAtOriginalNeighbors(
    current: readonly SessionCompanionItemRefV1[],
    item: SessionCompanionItemRefV1,
    originalKeys: readonly string[],
): readonly SessionCompanionItemRefV1[] {
    const itemKey = sessionCompanionItemKey(item);
    const originalIndex = originalKeys.indexOf(itemKey);
    const nextKeys = originalKeys.slice(originalIndex + 1);
    const beforeIndex = current.findIndex((candidate) => nextKeys.includes(sessionCompanionItemKey(candidate)));
    const next = [...current];
    if (beforeIndex >= 0) {
        next.splice(beforeIndex, 0, item);
        return next;
    }
    const previousKeys = originalKeys.slice(0, originalIndex).reverse();
    // Scanned backwards by hand: this package compiles against the ES2022 lib and
    // ships to Hermes, where `Array.prototype.findLastIndex` is not guaranteed.
    let previousIndex = -1;
    for (let index = next.length - 1; index >= 0; index -= 1) {
        const candidate = next[index];
        if (candidate && previousKeys.includes(sessionCompanionItemKey(candidate))) {
            previousIndex = index;
            break;
        }
    }
    next.splice(previousIndex >= 0 ? previousIndex + 1 : 0, 0, item);
    return next;
}

/**
 * The persisted settings entry owns its own list; the in-memory model is frozen.
 * Handing the frozen array straight to local settings would let one stored entry
 * alias this render's immutable value.
 */
function toStoredCompanionEntry(preference: SessionCompanionPreferenceV1) {
    return {
        v: preference.v,
        visible: preference.visible,
        collapsed: preference.collapsed,
        edge: preference.edge,
        density: preference.density,
        items: preference.items.map((item) => ({ ...item })),
    };
}

export type { SessionCompanionAvailability } from './useSessionCompanionPreference';

export type SessionCompanionController = Readonly<{
    preference: SessionCompanionPreferenceV1;
    availability: SessionCompanionAvailability;
    preferenceExists: boolean;
    show: (item?: SessionCompanionItemRefV1) => SessionCompanionMutationOutcome | null;
    hide: () => SessionCompanionMutationOutcome | null;
    setCollapsed: (collapsed: boolean) => SessionCompanionMutationOutcome | null;
    setEdge: (edge: SessionCompanionEdge) => SessionCompanionMutationOutcome | null;
    setDensity: (density: SessionCompanionDensity) => SessionCompanionMutationOutcome | null;
    addItem: (item: SessionCompanionItemRefV1, index?: number) => SessionCompanionMutationOutcome | null;
    removeItem: (item: SessionCompanionItemRefV1) => SessionCompanionMutationOutcome | null;
    moveItem: (item: SessionCompanionItemRefV1, toIndex: number) => SessionCompanionMutationOutcome | null;
    openFullSurface: () => void;
    /** Restores an outcome's previous value, or reports `false` when it went stale. */
    applyLocalInverse: (outcome: SessionCompanionMutationOutcome) => boolean;
}>;

/**
 * The one owner of viewer-local Session Companion operations. Human menus,
 * reorder controls, "Add to Companion" and (once its PEP producer lands) admitted
 * current-UI presentation commands all call these same mutations.
 *
 * `realm_unavailable` refuses reads and writes for an Account/Home this client
 * cannot prove and falls back to the hidden implicit preference. It never falls
 * back to a bare Session-id key, because that would let one Home's layout apply
 * to a same-ID Session on another Home or Account.
 */
export function useSessionCompanionController(input: Readonly<{
    sessionId: string | null;
    serverId?: string | null;
    /**
     * Navigation stays with the existing pane/Cockpit owners; the controller
     * stores no route state of its own.
     */
    openFullSurface: () => void;
}>): SessionCompanionController {
    const { sessionId, serverId = null, openFullSurface } = input;
    const { preference, availability, preferenceExists } = useSessionCompanionPreference({ sessionId, serverId });
    const mutate = useMutateSessionCompanionPreference();

    const applyMutation = React.useCallback((
        project: (current: SessionCompanionPreferenceV1) => SessionCompanionPreferenceV1,
        itemMutation?: SessionCompanionMutationOutcome['itemMutation'],
    ): SessionCompanionMutationOutcome | null => {
        if (!sessionId) return null;
        let outcome: SessionCompanionMutationOutcome | null = null;
        mutate(sessionId, (stored) => {
            // The latest stored entry is read here, not captured from render, so a
            // stale closure cannot resurrect an older preference.
            const previous = normalizeSessionCompanionPreference(stored);
            const applied = project(previous);
            if (areSessionCompanionPreferencesEqual(previous, applied)) return null;
            outcome = { previous, applied, ...(itemMutation ? { itemMutation } : {}) };
            return toStoredCompanionEntry(applied);
        }, serverId);
        return outcome;
    }, [mutate, serverId, sessionId]);

    const applyLocalInverse = React.useCallback((outcome: SessionCompanionMutationOutcome): boolean => {
        if (!sessionId) return false;
        return mutate(sessionId, (stored) => {
            const current = normalizeSessionCompanionPreference(stored);
            const restored = resolveSessionCompanionLocalInverse(outcome, current);
            return restored ? toStoredCompanionEntry(restored) : null;
        }, serverId);
    }, [mutate, serverId, sessionId]);

    return React.useMemo(() => Object.freeze({
        preference,
        availability,
        preferenceExists,
        show: (item?: SessionCompanionItemRefV1) => {
            const addedItem = item ?? SESSION_SUMMARY_COMPANION_ITEM;
            return applyMutation(
                (current) => showSessionCompanion(current, item),
                { kind: 'added', item: addedItem },
            );
        },
        hide: () => applyMutation(hideSessionCompanion),
        setCollapsed: (collapsed: boolean) => applyMutation((current) => setSessionCompanionCollapsed(current, collapsed)),
        setEdge: (edge: SessionCompanionEdge) => applyMutation((current) => setSessionCompanionEdge(current, edge)),
        setDensity: (density: SessionCompanionDensity) => applyMutation((current) => setSessionCompanionDensity(current, density)),
        addItem: (item: SessionCompanionItemRefV1, index?: number) => applyMutation(
            (current) => addSessionCompanionItem(current, item, index),
            { kind: 'added', item },
        ),
        removeItem: (item: SessionCompanionItemRefV1) => applyMutation(
            (current) => removeSessionCompanionItem(current, item),
            { kind: 'removed', item },
        ),
        moveItem: (item: SessionCompanionItemRefV1, toIndex: number) => applyMutation(
            (current) => moveSessionCompanionItem(current, item, toIndex),
            { kind: 'moved', item },
        ),
        openFullSurface,
        applyLocalInverse,
    }), [applyLocalInverse, applyMutation, availability, openFullSurface, preference, preferenceExists]);
}
