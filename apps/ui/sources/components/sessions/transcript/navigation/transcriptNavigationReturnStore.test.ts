import { describe, expect, it } from 'vitest';

import { createTranscriptNavigationReturnStore } from './transcriptNavigationReturnStore';

function jumpFrom1018To0934() {
    const store = createTranscriptNavigationReturnStore();
    const target = store.record('s1', {
        returnTo: { entryId: 'turn-1018', atMs: 1_018 },
        landingEntryId: 'turn-0934',
        newestEntryId: 'turn-1042',
    });
    return { store, target };
}

describe('transcript navigation return target', () => {
    it('offers the way back to where you were reading after a jump', () => {
        const { store } = jumpFrom1018To0934();
        expect(store.get('s1')?.returnTo).toEqual({ entryId: 'turn-1018', atMs: 1_018 });
        expect(store.get('other')).toBeNull();
    });

    it('survives the jump passing other turns, then goes away once you scroll off the landing', () => {
        const { store } = jumpFrom1018To0934();
        store.observeAnchor('s1', 'turn-1000');
        expect(store.get('s1')).not.toBeNull();
        store.observeAnchor('s1', 'turn-0934');
        expect(store.get('s1')).not.toBeNull();
        store.observeAnchor('s1', 'turn-0920');
        expect(store.get('s1')).toBeNull();
    });

    it('goes away when a new turn is sent', () => {
        const { store } = jumpFrom1018To0934();
        store.observeNewestEntry('s1', 'turn-1042');
        expect(store.get('s1')).not.toBeNull();
        store.observeNewestEntry('s1', 'turn-1050');
        expect(store.get('s1')).toBeNull();
    });

    it('records nothing when there is nowhere else to return to', () => {
        const store = createTranscriptNavigationReturnStore();
        expect(store.record('s1', { returnTo: null, landingEntryId: 'turn-0934', newestEntryId: null })).toBeNull();
        expect(store.record('s1', {
            returnTo: { entryId: 'turn-0934', atMs: 934 },
            landingEntryId: 'turn-0934',
            newestEntryId: null,
        })).toBeNull();
        expect(store.get('s1')).toBeNull();
    });

    it('clears only the jump it belongs to, so a stale failure never hides a newer way back', () => {
        const { store, target } = jumpFrom1018To0934();
        const newer = store.record('s1', {
            returnTo: { entryId: 'turn-0934', atMs: 934 },
            landingEntryId: 'turn-0912',
            newestEntryId: 'turn-1042',
        });
        store.clear('s1', target);
        expect(store.get('s1')).toBe(newer);
        store.clear('s1', newer);
        expect(store.get('s1')).toBeNull();
    });

    it('notifies subscribers of the session only when its target changes', () => {
        const { store } = jumpFrom1018To0934();
        let calls = 0;
        const unsubscribe = store.subscribe('s1', () => { calls += 1; });
        store.observeAnchor('s1', 'turn-0934');
        store.observeAnchor('s1', 'turn-0934');
        store.observeNewestEntry('s1', 'turn-1042');
        store.clear('other');
        store.clear('s1');
        unsubscribe();
        // Landing once, then clearing: repeated observations of the same state are silent.
        expect(calls).toBe(2);
    });
});
