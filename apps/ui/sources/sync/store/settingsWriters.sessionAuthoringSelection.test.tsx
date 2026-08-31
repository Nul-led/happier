import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { FavoriteModelSelectionV1Schema } from '@/sync/domains/models/favoriteModelSelections';
import { RememberedEngineSelectionsByScopeV1Schema } from '@/sync/domains/session/authoring/rememberedEngineSelections';

const mutateAccountSettingsOnce = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({ mutateAccountSettingsOnce }),
}));
vi.mock('@/sync/domains/state/storageStore', () => ({
    getStorage: () => ({ getState: () => ({ settingsVersion: 7 }) }),
}));

import {
    useApplyFavoriteModelSelectionReplacementIntent,
    useApplyRememberedEngineSelectionReplacementIntent,
} from './settingsWriters';

function favorite(modelId: string, updatedAt: number) {
    return FavoriteModelSelectionV1Schema.parse({
        selection: {
            v: 1,
            updatedAt,
            ref: {
                agentTargetKey: 'backend:codex',
                providerConnectionId: null,
                modelId,
            },
        },
        addedAtMs: updatedAt,
    });
}

describe('session-authoring Settings writers', () => {
    beforeEach(() => {
        mutateAccountSettingsOnce.mockImplementation(async (input) => {
            const result = input.mutate({});
            return { status: 'applied', settingsVersion: 8, value: result.value };
        });
    });

    afterEach(() => {
        standardCleanup();
        vi.clearAllMocks();
    });

    it('applies a Favorite replacement once and retains an opaque entry in the observed carrier', async () => {
        const base = [favorite('gpt-5.4', 1)];
        const proposed = [...base, favorite('gpt-5.5', 2)];
        const hook = await renderHook(() => useApplyFavoriteModelSelectionReplacementIntent());

        await hook.getCurrent()({ base, proposed });

        expect(mutateAccountSettingsOnce).toHaveBeenCalledOnce();
        const input = mutateAccountSettingsOnce.mock.calls[0]?.[0];
        expect(input.expectedSettingsVersion).toBe(7);
        const result = input.mutate({
            favoriteModelSelectionsV1: [
                base[0],
                { v: 2, futureWriterField: 'opaque-favorite' },
            ],
        });

        expect(result.settings).toMatchObject({
            favoriteModelSelectionsV1: [
                base[0],
                { v: 2, futureWriterField: 'opaque-favorite' },
                proposed[1],
            ],
        });
    });

    it('applies a remembered replacement once and retains an opaque scope in the observed carrier', async () => {
        const base = RememberedEngineSelectionsByScopeV1Schema.parse({
            'server-a:backend:codex': {
                v: 1,
                modelSelection: favorite('gpt-5.4', 1).selection,
                updatedAt: 1,
            },
        });
        const proposed = {
            ...base,
            'server-a:backend:codex': {
                ...base['server-a:backend:codex']!,
                updatedAt: 2,
            },
        };
        const hook = await renderHook(() => useApplyRememberedEngineSelectionReplacementIntent());

        await hook.getCurrent()({ base, proposed });

        expect(mutateAccountSettingsOnce).toHaveBeenCalledOnce();
        const input = mutateAccountSettingsOnce.mock.calls[0]?.[0];
        expect(input.expectedSettingsVersion).toBe(7);
        const result = input.mutate({
            lastEngineSelectionsByScopeV1: {
                'server-a:backend:codex': base['server-a:backend:codex'],
                'server-a:backend:future': { v: 2, futureWriterField: 'opaque-remembered' },
            },
        });

        expect(result.settings).toMatchObject({
            lastEngineSelectionsByScopeV1: {
                'server-a:backend:codex': proposed['server-a:backend:codex'],
                'server-a:backend:future': { v: 2, futureWriterField: 'opaque-remembered' },
            },
        });
    });
});
