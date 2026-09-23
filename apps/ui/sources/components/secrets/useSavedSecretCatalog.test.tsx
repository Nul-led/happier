import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const catalogSpies = vi.hoisted(() => ({
    observe: vi.fn(),
    refresh: vi.fn(),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    resolve: vi.fn(),
}));
const featureState = vi.hoisted(() => ({ enabled: false, read: vi.fn() }));
const personalState = vi.hoisted(() => ({
    secrets: [{
        id: 'personal-1',
        name: 'Personal',
        kind: 'token',
        encryptedValue: { _isSecretValue: true, value: 'sealed' },
        createdAt: 1,
        updatedAt: 1,
    }],
    settingsVersion: 1,
}));
const settingsMutationSpies = vi.hoisted(() => ({ mutateOnce: vi.fn() }));
const resourceMutationSpies = vi.hoisted(() => ({ deleteResource: vi.fn() }));

vi.mock('expo-crypto', () => ({
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
}));

vi.mock('@/sync/store/hooks', () => ({
    useSetting: () => personalState.secrets,
    useSettingsVersion: () => personalState.settingsVersion,
}));

vi.mock('@/sync/store/settingsWriters', () => ({
    useAccountSettingsScope: () => ({ serverId: 'home-1', accountId: 'account-1' }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (...args: unknown[]) => {
        featureState.read(args[0], args[1]);
        return featureState.enabled;
    },
}));

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({ mutateAccountSettingsOnce: settingsMutationSpies.mutateOnce }),
}));

vi.mock('@/sync/engine/settings/savedSecretCatalogEngine', () => ({
    observeSavedSecretCatalog: (...args: unknown[]) => catalogSpies.observe(args[0]),
    refreshSavedSecretCatalog: (...args: unknown[]) => catalogSpies.refresh(args[0]),
}));

vi.mock('@/sync/ops/settings/savedSecretResourceOperations', () => ({
    deleteSavedSecretResource: (...args: unknown[]) => resourceMutationSpies.deleteResource(args[0]),
}));

vi.mock('@/sync/store/settings/savedSecretCatalogSnapshot', () => ({
    subscribeSavedSecretCatalogSnapshots: () => catalogSpies.subscribe(),
    getSavedSecretCatalogSnapshot: (...args: unknown[]) => catalogSpies.getSnapshot(args[0]),
    getUsableSavedSecrets: (_scope: unknown, personal: unknown) => personal,
    resolveSavedSecretReference: (...args: unknown[]) => catalogSpies.resolve(args[0], args[1], args[2]),
}));

describe('useSavedSecretCatalog exact shared feature gate', () => {
    beforeEach(() => {
        featureState.enabled = false;
        personalState.secrets = [{
            id: 'personal-1',
            name: 'Personal',
            kind: 'token',
            encryptedValue: { _isSecretValue: true, value: 'sealed' },
            createdAt: 1,
            updatedAt: 1,
        }];
        personalState.settingsVersion = 1;
        settingsMutationSpies.mutateOnce.mockReset();
        resourceMutationSpies.deleteResource.mockReset();
        featureState.read.mockReset();
        catalogSpies.observe.mockReset();
        catalogSpies.refresh.mockReset();
        catalogSpies.refresh.mockResolvedValue(undefined);
        catalogSpies.getSnapshot.mockReset();
        catalogSpies.subscribe.mockClear();
        catalogSpies.resolve.mockReset();
        catalogSpies.getSnapshot.mockReturnValue({
            status: 'ready',
            stale: false,
            error: null,
            data: [],
            materializedSecrets: [],
            corruptEntries: [],
        });
        catalogSpies.resolve.mockImplementation((_scope: unknown, _personal: unknown, ref: string) => ({
            ref,
            kind: ref.startsWith('happier:shared-secret:v1:') ? 'shared_resource' : 'personal',
            status: 'ready',
            entry: null,
            secret: { id: ref },
            revision: ref.startsWith('happier:shared-secret:v1:') ? 9 : null,
            fingerprint: `test:${ref}`,
        }));
    });

    afterEach(() => standardCleanup());

    it('does not observe or refresh shared state and projects retained shared refs unavailable while personal refs remain ready', async () => {
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());

        expect(featureState.read).toHaveBeenCalledWith('teams', {
            scopeKind: 'spawn',
            serverId: 'home-1',
        });
        expect(catalogSpies.observe).not.toHaveBeenCalled();
        expect(catalogSpies.subscribe).not.toHaveBeenCalled();
        expect(catalogSpies.getSnapshot).not.toHaveBeenCalled();
        await hook.getCurrent().reload();
        expect(catalogSpies.refresh).not.toHaveBeenCalled();
        expect(hook.getCurrent().resolveReference('personal-1')).toEqual(expect.objectContaining({
            kind: 'personal',
            status: 'ready',
        }));
        expect(hook.getCurrent().resolveReference('happier:shared-secret:v1:shared-1')).toEqual(expect.objectContaining({
            kind: 'shared_resource',
            status: 'temporarily_unavailable',
            secret: null,
            revision: null,
        }));
        expect(hook.getCurrent().usableSecrets.map((secret) => secret.id)).toEqual(['personal-1']);
        await hook.unmount();
    });

    it('observes the shared catalog when the exact Home decision is enabled', async () => {
        featureState.enabled = true;
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());

        expect(catalogSpies.subscribe).toHaveBeenCalled();
        expect(catalogSpies.getSnapshot).toHaveBeenCalledWith({ serverId: 'home-1', accountId: 'account-1' });
        expect(catalogSpies.observe).toHaveBeenCalledWith({ serverId: 'home-1', accountId: 'account-1' });
        await hook.unmount();
    });

    it('projects corrupt results separately from healthy and selectable catalog entries', async () => {
        featureState.enabled = true;
        const corruptEntries = [{
            materialStatus: 'resource_corrupt',
            relationship: 'recipient',
            repair: null,
        }] as const;
        catalogSpies.getSnapshot.mockReturnValue({
            status: 'ready', stale: false, error: null,
            data: [], materializedSecrets: [], corruptEntries,
        });
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());

        expect(hook.getCurrent().sharedEntries).toEqual([]);
        expect(hook.getCurrent().entries.map((entry) => entry.ref)).toEqual(['personal-1']);
        expect(hook.getCurrent().corruptEntries).toBe(corruptEntries);
        await hook.unmount();
    });

    it('deletes an owner corrupt result through the canonical operation with its exact opaque identity and revision', async () => {
        featureState.enabled = true;
        resourceMutationSpies.deleteResource.mockResolvedValue({ ok: true });
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());
        const entry = {
            materialStatus: 'resource_corrupt', relationship: 'owner',
            repair: { kind: 'delete_resource', resourceId: 'opaque-row-id', expectedRevision: -3 },
        } as const;

        await expect(hook.getCurrent().deleteCorruptResource(entry)).resolves.toEqual({ ok: true });
        expect(resourceMutationSpies.deleteResource).toHaveBeenCalledWith({
            scope: { serverId: 'home-1', accountId: 'account-1' },
            resourceId: 'opaque-row-id',
            expectedRevision: -3,
            expectedSettingsVersion: 1,
            confirmedByPresentUser: true,
        });
        expect(catalogSpies.refresh).toHaveBeenCalledWith({ serverId: 'home-1', accountId: 'account-1' });
        await hook.unmount();
    });

    it('writes personal secret values through the catalog mutation owner without trimming bytes', async () => {
        settingsMutationSpies.mutateOnce.mockImplementation(async (request: {
            mutate: (settings: Readonly<Record<string, unknown>>) => Readonly<{
                settings: Readonly<Record<string, unknown>>;
            }>;
        }) => {
            const next = request.mutate({ secrets: [] });
            return { status: 'applied', settingsVersion: 2, value: next.settings };
        });
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());

        const createdId = await hook.getCurrent().personalMutations.create({
            name: '  Exact token  ',
            value: '  exact bytes\n',
        });

        expect(createdId).toBe('00000000-0000-4000-8000-000000000001');
        const result = await settingsMutationSpies.mutateOnce.mock.results[0]?.value;
        expect(result.value.secrets[0]).toEqual(expect.objectContaining({
            id: createdId,
            name: 'Exact token',
            encryptedValue: { _isSecretValue: true, value: '  exact bytes\n' },
        }));
        await hook.unmount();
    });

    it('rekeys a genuine colliding personal id through the one-shot Settings CAS before shared activation', async () => {
        featureState.enabled = true;
        const collisionId = 'happier:shared-secret:v1:legacy-personal';
        personalState.secrets = [{
            id: collisionId,
            name: 'Whitespace token',
            kind: 'token',
            encryptedValue: { _isSecretValue: true, value: '  exact bytes\n' },
            createdAt: 1,
            updatedAt: 7,
        }];
        settingsMutationSpies.mutateOnce.mockImplementation(async (request: {
            mutate: (settings: Readonly<Record<string, unknown>>) => Readonly<{
                settings: Readonly<Record<string, unknown>>;
            }>;
        }) => ({
            status: 'applied',
            settingsVersion: 2,
            value: request.mutate({ secrets: personalState.secrets }).settings,
        }));
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());

        await vi.waitFor(() => expect(settingsMutationSpies.mutateOnce).toHaveBeenCalledOnce());
        const result = await settingsMutationSpies.mutateOnce.mock.results[0]?.value;
        expect(result.value.secrets).toEqual([{
            ...personalState.secrets[0],
            id: '00000000-0000-4000-8000-000000000001',
        }]);
        expect(result.value.secrets[0].encryptedValue.value).toBe('  exact bytes\n');
        expect(hook.getCurrent().sharedEnabled).toBe(false);
        expect(catalogSpies.observe).not.toHaveBeenCalled();

        personalState.secrets = result.value.secrets;
        personalState.settingsVersion = 2;
        await hook.rerender();
        await vi.waitFor(() => expect(hook.getCurrent().sharedEnabled).toBe(true));
        expect(settingsMutationSpies.mutateOnce).toHaveBeenCalledOnce();
        expect(catalogSpies.observe).toHaveBeenCalledOnce();
        await hook.unmount();
    });

    it('keeps personal secrets usable and exposes retry when collision CAS fails', async () => {
        featureState.enabled = true;
        const collisionId = 'happier:shared-secret:v1:legacy-personal';
        personalState.secrets = [{
            id: collisionId,
            name: 'Legacy personal key',
            kind: 'token',
            encryptedValue: { _isSecretValue: true, value: 'exact-value' },
            createdAt: 1,
            updatedAt: 7,
        }];
        catalogSpies.resolve.mockReturnValue({
            ref: collisionId,
            kind: 'personal',
            status: 'ready',
            entry: null,
            secret: personalState.secrets[0],
            revision: 7,
            fingerprint: `personal:${collisionId}:7`,
        });
        settingsMutationSpies.mutateOnce.mockRejectedValue(new Error('settings conflict'));
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());

        await vi.waitFor(() => expect(hook.getCurrent().collisionMigrationStatus).toBe('failed'));
        expect(hook.getCurrent()).toMatchObject({
            sharedEnabled: false,
            status: 'error',
            stale: true,
            error: true,
        });
        expect(hook.getCurrent().usableSecrets.map((secret) => secret.id))
            .toEqual([collisionId]);
        expect(hook.getCurrent().resolveReference(collisionId)).toMatchObject({
            kind: 'personal',
            status: 'ready',
            secret: personalState.secrets[0],
        });

        await hook.getCurrent().reload();
        await vi.waitFor(() => expect(settingsMutationSpies.mutateOnce).toHaveBeenCalledTimes(2));
        await hook.unmount();
    });

    it('resolves an extant colliding personal record while Teams is disabled', async () => {
        const collisionId = 'happier:shared-secret:v1:legacy-personal';
        personalState.secrets = [{
            id: collisionId,
            name: 'Legacy personal key',
            kind: 'token',
            encryptedValue: { _isSecretValue: true, value: 'exact-value' },
            createdAt: 1,
            updatedAt: 7,
        }];
        catalogSpies.resolve.mockReturnValue({
            ref: collisionId,
            kind: 'personal',
            status: 'ready',
            entry: null,
            secret: personalState.secrets[0],
            revision: 7,
            fingerprint: `personal:${collisionId}:7`,
        });
        const { useSavedSecretCatalog } = await import('./useSavedSecretCatalog');
        const hook = await renderHook(() => useSavedSecretCatalog());

        expect(hook.getCurrent().resolveReference(collisionId)).toMatchObject({
            kind: 'personal',
            status: 'ready',
            secret: personalState.secrets[0],
        });
        expect(catalogSpies.observe).not.toHaveBeenCalled();
        await hook.unmount();
    });
});
