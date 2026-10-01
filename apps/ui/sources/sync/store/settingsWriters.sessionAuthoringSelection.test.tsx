import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { FavoriteModelSelectionV1Schema } from '@/sync/domains/models/favoriteModelSelections';
import { RememberedEngineSelectionsByScopeV1Schema } from '@/sync/domains/session/authoring/rememberedEngineSelections';

const mutateAccountSettingsOnce = vi.hoisted(() => vi.fn());
const applyAuthoringMemoryDelta = vi.hoisted(() => vi.fn());
const settingsState = vi.hoisted(() => ({
    settingsVersion: 7 as number | null,
    settingsScope: { serverId: 'server-a', accountId: 'account-a' } as {
        serverId: string;
        accountId: string;
    } | null,
}));

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({ mutateAccountSettingsOnce, applyAuthoringMemoryDelta }),
}));
vi.mock('@/sync/domains/state/storageStore', () => {
    const store = Object.assign(
        (selector: (value: typeof settingsState) => unknown) => selector(settingsState),
        { getState: () => settingsState },
    );
    return { getStorage: () => store };
});

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
                agentTargetKey: 'agent:happier.agent.codex/codex',
                providerConnectionId: null,
                modelId,
            },
        },
        addedAtMs: updatedAt,
    });
}

describe('session-authoring Settings writers', () => {
    beforeEach(() => {
        settingsState.settingsVersion = 7;
        settingsState.settingsScope = { serverId: 'server-a', accountId: 'account-a' };
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
        expect(input.expectedSettingsScope).toEqual({ serverId: 'server-a', accountId: 'account-a' });
        expect(input.expectedSettingsVersion).toBe(7);
        expect(input.rebaseOnConflict).toBe(true);
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

    it('routes remembered edits to authoring memory without writing the Account settings document', async () => {
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

        expect(mutateAccountSettingsOnce).not.toHaveBeenCalled();
        expect(applyAuthoringMemoryDelta).toHaveBeenCalledWith({
            rememberedEngineSelectionReplacement: { base, proposed },
        }, { expectedSettingsScope: { serverId: 'server-a', accountId: 'account-a' } });
    });

    it('keeps a retained writer bound to the Account scope and revision rendered before focus changes', async () => {
        const base = [favorite('gpt-5.4', 1)];
        const proposed = [...base, favorite('gpt-5.5', 2)];
        const hook = await renderHook(() => useApplyFavoriteModelSelectionReplacementIntent());
        const writerForAccountA = hook.getCurrent();

        settingsState.settingsVersion = 19;
        settingsState.settingsScope = { serverId: 'server-b', accountId: 'account-b' };
        await writerForAccountA({ base, proposed });

        expect(mutateAccountSettingsOnce).toHaveBeenCalledWith(expect.objectContaining({
            expectedSettingsScope: { serverId: 'server-a', accountId: 'account-a' },
            expectedSettingsVersion: 7,
        }));
    });
});
