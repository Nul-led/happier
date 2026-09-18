import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { createPartialStorageModuleMock } from '@/dev/testkit/mocks/storage';

/**
 * The persisted device-local settings slot is the only boundary mocked here: the
 * preference model, seeding rules and mutation outcomes below are the real
 * production logic every Companion entry point runs.
 */
const local = vi.hoisted(() => ({ stored: undefined as unknown }));

vi.mock('@/sync/domains/state/storage', async (importOriginal) =>
    createPartialStorageModuleMock(importOriginal, {
        useSessionCompanionPreferenceSlot: (sessionId: string | null, serverId?: string | null) => ({
            storageKey: sessionId && serverId ? `${serverId}:${sessionId}` : null,
            stored: local.stored,
        }),
        useMutateSessionCompanionPreference: () => (
            _sessionId: string,
            updater: (stored: unknown) => unknown,
            serverId?: string | null,
        ) => {
            if (!serverId) return false;
            const next = updater(local.stored);
            if (next === null) return false;
            local.stored = next;
            return true;
        },
    }),
);

import { useSessionCompanionController } from './useSessionCompanionController';

const SUMMARY = { kind: 'builtin', id: 'session_summary' };

async function mountController(serverId: string | null = 'home-a') {
    return await renderHook(() => useSessionCompanionController({
        sessionId: 'session-1',
        serverId,
        openFullSurface: () => {},
    }));
}

describe('useSessionCompanionController', () => {
    beforeEach(() => {
        local.stored = undefined;
    });

    it('seeds and persists the built-in Session Summary when the Companion is first revealed', async () => {
        const hook = await mountController();

        const outcome = hook.getCurrent().show();

        expect(outcome).not.toBeNull();
        expect(local.stored).toMatchObject({ visible: true, items: [SUMMARY] });
        const current = await hook.rerender();
        expect(current.preference.visible).toBe(true);
        expect(current.preference.items).toEqual([SUMMARY]);
    });

    it('reveals an existing selection without seeding a second summary card', async () => {
        local.stored = {
            v: 1,
            visible: false,
            collapsed: true,
            edge: 'trailing',
            density: 'compact',
            items: [{ kind: 'widget', widgetId: 'item-1' }],
        };
        const hook = await mountController();

        hook.getCurrent().show();

        const current = await hook.rerender();
        expect(current.preference.visible).toBe(true);
        expect(current.preference.collapsed).toBe(false);
        expect(current.preference.items).toEqual([{ kind: 'widget', widgetId: 'item-1' }]);
    });

    it('refuses to write when the exact Session realm cannot be proven', async () => {
        const hook = await mountController(null);

        expect(hook.getCurrent().availability).toBe('realm_unavailable');
        expect(hook.getCurrent().show()).toBeNull();
        expect(local.stored).toBeUndefined();
    });
});
