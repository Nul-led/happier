import { describe, expect, it } from 'vitest';

import { resolveSessionCompanionLocalInverse } from './useSessionCompanionController';

describe('resolveSessionCompanionLocalInverse', () => {
    it('restores only the fields changed by the original mutation and preserves unrelated newer choices', () => {
        const previous = {
            v: 1 as const,
            visible: false,
            collapsed: false,
            edge: 'trailing' as const,
            density: 'compact' as const,
            items: [] as const,
        };
        const applied = {
            ...previous,
            visible: true,
            items: [{ kind: 'builtin' as const, id: 'session_summary' as const }],
        };

        expect(resolveSessionCompanionLocalInverse({
            previous,
            applied,
        }, {
            ...applied,
            density: 'comfortable',
        })).toEqual({
            ...previous,
            density: 'comfortable',
        });
    });

    it('refuses a stale inverse when a field changed by the original mutation changed again', () => {
        const previous = {
            v: 1 as const,
            visible: true,
            collapsed: false,
            edge: 'trailing' as const,
            density: 'compact' as const,
            items: [{ kind: 'builtin' as const, id: 'session_summary' as const }],
        };
        const applied = { ...previous, edge: 'leading' as const };

        expect(resolveSessionCompanionLocalInverse({ previous, applied }, {
            ...applied,
            edge: 'trailing',
        })).toBeNull();
    });

    it('undoes an exact Summary addition while preserving an unrelated later widget addition', () => {
        const previous = {
            v: 1 as const,
            visible: false,
            collapsed: false,
            edge: 'trailing' as const,
            density: 'compact' as const,
            items: [] as const,
        };
        const applied = {
            ...previous,
            visible: true,
            items: [{ kind: 'builtin' as const, id: 'session_summary' as const }],
        };

        expect(resolveSessionCompanionLocalInverse({
            previous,
            applied,
            itemMutation: {
                kind: 'added',
                item: { kind: 'builtin', id: 'session_summary' },
            },
        }, {
            ...applied,
            density: 'comfortable',
            items: [
                { kind: 'builtin', id: 'session_summary' },
                { kind: 'widget', widgetId: 'later-widget' },
            ],
        })).toEqual({
            ...previous,
            density: 'comfortable',
            items: [{ kind: 'widget', widgetId: 'later-widget' }],
        });
    });

    it('undoes an exact item reorder without discarding an unrelated later item', () => {
        const summary = { kind: 'builtin' as const, id: 'session_summary' as const };
        const moved = { kind: 'widget' as const, widgetId: 'moved-widget' };
        const later = { kind: 'widget' as const, widgetId: 'later-widget' };
        const previous = {
            v: 1 as const,
            visible: true,
            collapsed: false,
            edge: 'trailing' as const,
            density: 'compact' as const,
            items: [summary, moved],
        };
        const applied = { ...previous, items: [moved, summary] };

        expect(resolveSessionCompanionLocalInverse({
            previous,
            applied,
            itemMutation: { kind: 'moved', item: moved },
        }, {
            ...applied,
            items: [moved, later, summary],
        })).toEqual({
            ...previous,
            items: [later, summary, moved],
        });
    });

    it('refuses an exact-item inverse after that same item changed again', () => {
        const summary = { kind: 'builtin' as const, id: 'session_summary' as const };
        const moved = { kind: 'widget' as const, widgetId: 'moved-widget' };
        const previous = {
            v: 1 as const,
            visible: true,
            collapsed: false,
            edge: 'trailing' as const,
            density: 'compact' as const,
            items: [summary, moved],
        };
        const applied = { ...previous, items: [moved, summary] };

        expect(resolveSessionCompanionLocalInverse({
            previous,
            applied,
            itemMutation: { kind: 'moved', item: moved },
        }, previous)).toBeNull();
    });
});
