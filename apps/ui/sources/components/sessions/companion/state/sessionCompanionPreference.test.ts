import { describe, expect, it } from 'vitest';

import {
    HIDDEN_SESSION_COMPANION_PREFERENCE_V1,
    SESSION_SUMMARY_COMPANION_ITEM,
    SessionCompanionPreferencesV1Schema,
    addSessionCompanionItem,
    hideSessionCompanion,
    moveSessionCompanionItem,
    normalizeSessionCompanionPreference,
    removeSessionCompanionItem,
    showSessionCompanion,
    type SessionCompanionItemRefV1,
    type SessionCompanionPreferenceV1,
} from './sessionCompanionPreference';

const widget = (widgetId: string): SessionCompanionItemRefV1 => ({ kind: 'widget', widgetId });

const visible: SessionCompanionPreferenceV1 = {
    v: 1,
    visible: true,
    collapsed: false,
    edge: 'trailing',
    density: 'compact',
    items: [SESSION_SUMMARY_COMPANION_ITEM, widget('item-a')],
};

describe('session companion preference schema', () => {
    it('drops only the malformed entry and keeps every valid sibling', () => {
        const parsed = SessionCompanionPreferencesV1Schema.parse({
            'realm:good': visible,
            'realm:bad': { v: 1, visible: 'yes' },
            'realm:alsoBad': 42,
            'realm:unknownItemKind': { ...visible, items: [{ kind: 'pet', id: 'x' }] },
        });

        expect(Object.keys(parsed).sort()).toEqual(['realm:good']);
    });

    it('resolves a malformed root to an empty map instead of failing the whole local-settings parse', () => {
        expect(SessionCompanionPreferencesV1Schema.parse('not-a-map')).toEqual({});
        expect(SessionCompanionPreferencesV1Schema.parse(null)).toEqual({});
        expect(SessionCompanionPreferencesV1Schema.parse([visible])).toEqual({});
    });

    it('drops an unknown version instead of inventing an opaque future-settings protocol', () => {
        const future = { v: 2, visible: true, edge: 'leading', railGroups: [{ id: 'g1' }] };
        const parsed = SessionCompanionPreferencesV1Schema.parse({ 'realm:future': future });

        expect(parsed).toEqual({});
        expect(normalizeSessionCompanionPreference(parsed['realm:future']))
            .toEqual(HIDDEN_SESSION_COMPANION_PREFERENCE_V1);
    });

    it('accepts only known built-in item ids', () => {
        const withUnknownBuiltin = { ...visible, items: [{ kind: 'builtin', id: 'session_summary_shard' }] };

        expect(SessionCompanionPreferencesV1Schema.parse({ 'realm:x': withUnknownBuiltin })).toEqual({});
    });
});

describe('normalizeSessionCompanionPreference', () => {
    it('returns the hidden implicit default for an absent entry', () => {
        expect(normalizeSessionCompanionPreference(undefined)).toEqual(HIDDEN_SESSION_COMPANION_PREFERENCE_V1);
    });

    it('keeps the first occurrence of a duplicated reference', () => {
        const normalized = normalizeSessionCompanionPreference({
            ...visible,
            items: [widget('item-a'), SESSION_SUMMARY_COMPANION_ITEM, widget('item-a')],
        });

        expect(normalized.items).toEqual([widget('item-a'), SESSION_SUMMARY_COMPANION_ITEM]);
    });
});

describe('session companion mutations', () => {
    it('seeds the Session Summary only when nothing is selected yet', () => {
        expect(showSessionCompanion(HIDDEN_SESSION_COMPANION_PREFERENCE_V1)).toEqual({
            ...HIDDEN_SESSION_COMPANION_PREFERENCE_V1,
            visible: true,
            items: [SESSION_SUMMARY_COMPANION_ITEM],
        });
        expect(showSessionCompanion({ ...visible, visible: false }).items).toEqual(visible.items);
    });

    it('adds an explicitly requested item without seeding the summary', () => {
        const shown = showSessionCompanion(HIDDEN_SESSION_COMPANION_PREFERENCE_V1, widget('item-b'));

        expect(shown.visible).toBe(true);
        expect(shown.items).toEqual([widget('item-b')]);
    });

    it('hides without losing items, order, edge or density', () => {
        expect(hideSessionCompanion(visible)).toEqual({ ...visible, visible: false });
    });

    it('ignores a duplicate add and an unknown move or remove', () => {
        expect(addSessionCompanionItem(visible, widget('item-a'))).toBe(visible);
        expect(moveSessionCompanionItem(visible, widget('missing'), 0)).toBe(visible);
        expect(removeSessionCompanionItem(visible, widget('missing'))).toBe(visible);
    });

    it('hides the card when the last item is removed, keeping the empty customization', () => {
        const single: SessionCompanionPreferenceV1 = { ...visible, items: [widget('item-a')] };
        const removed = removeSessionCompanionItem(single, widget('item-a'));

        expect(removed.items).toEqual([]);
        expect(removed.visible).toBe(false);
    });

    it('keeps the card visible while other items remain', () => {
        const removed = removeSessionCompanionItem(visible, widget('item-a'));

        expect(removed.items).toEqual([SESSION_SUMMARY_COMPANION_ITEM]);
        expect(removed.visible).toBe(true);
    });

    it('clamps a move index instead of dropping the item', () => {
        expect(moveSessionCompanionItem(visible, SESSION_SUMMARY_COMPANION_ITEM, 9).items)
            .toEqual([widget('item-a'), SESSION_SUMMARY_COMPANION_ITEM]);
        expect(moveSessionCompanionItem(visible, widget('item-a'), -3).items)
            .toEqual([widget('item-a'), SESSION_SUMMARY_COMPANION_ITEM]);
    });

    it('inserts at a requested index', () => {
        expect(addSessionCompanionItem(visible, widget('item-b'), 1).items)
            .toEqual([SESSION_SUMMARY_COMPANION_ITEM, widget('item-b'), widget('item-a')]);
    });
});
