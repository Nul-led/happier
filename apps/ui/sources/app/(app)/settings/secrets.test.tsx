import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const testState = vi.hoisted(() => ({
    sharedEnabled: false,
    collisionMigrationStatus: 'not_required' as 'not_required' | 'migrating' | 'failed',
    sharedEntries: [] as Array<Record<string, unknown>>,
    corruptEntries: [] as Array<Record<string, unknown>>,
    modalPrompt: vi.fn(),
    modalConfirm: vi.fn(),
    deleteCorruptResource: vi.fn(),
    updateSavedSecretResource: vi.fn(),
    promotePersonalSavedSecretResource: vi.fn(),
    repairCustodiedSavedSecretResourceEnvelopesBestEffort: vi.fn(async () => undefined),
    encryption: null as null | Readonly<{ decryptEncryptionKey: (value: string, scope: unknown) => Promise<Uint8Array | null> }>,
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/secrets/SecretsList', () => ({
    SecretsList: (props: Record<string, unknown>) => React.createElement('SecretsList', {
        ...props,
        testID: 'secrets-list',
    }),
}));
vi.mock('@/components/secrets/SavedSecretAccessEditor', () => ({
    SavedSecretAccessEditor: (props: Record<string, unknown>) => React.createElement('SavedSecretAccessEditor', {
        ...props,
        testID: 'saved-secret-access-editor',
    }),
}));
vi.mock('@/components/secrets/SavedSecretCreateEditor', () => ({ SavedSecretCreateEditor: () => null }));
vi.mock('@/components/secrets/useSavedSecretCatalog', () => ({
    useSavedSecretCatalog: () => ({
        sharedEnabled: testState.sharedEnabled,
        personalSecrets: [{ id: 'personal-a', name: 'Personal', kind: 'token', encryptedValue: { _isSecretValue: true, value: 'value' }, createdAt: 1, updatedAt: 1 }],
        personalMutations: {
            create: vi.fn(async () => null),
            rename: vi.fn(async () => true),
            rotate: vi.fn(async () => true),
            delete: vi.fn(async () => true),
        },
        collisionMigrationStatus: testState.collisionMigrationStatus,
        sharedEntries: testState.sharedEntries,
        corruptEntries: testState.corruptEntries,
        deleteCorruptResource: testState.deleteCorruptResource,
        resolveReference: vi.fn(),
        status: 'ready',
        stale: false,
        reload: vi.fn(async () => undefined),
    }),
}));
vi.mock('@/components/approvals/useActionApprovalContinuation', () => ({
    useActionApprovalContinuation: () => ({
        approvalId: null,
        approvalPending: false,
        requestApproval: vi.fn(),
    }),
}));
vi.mock('@/sync/store/settingsWriters', () => ({
    useAccountSettingsScope: () => ({ serverId: 'home-a', accountId: 'account-a' }),
}));
vi.mock('@/sync/store/hooks', () => ({ useSettingsVersion: () => 1 }));
vi.mock('@/sync/runtime/getSyncSingleton', () => ({ getSyncSingleton: () => ({ encryption: testState.encryption }) }));
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('@/sync/ops/settings/savedSecretResourceOperations', () => ({
    deleteSavedSecretResource: vi.fn(),
    promotePersonalSavedSecretResource: testState.promotePersonalSavedSecretResource,
    updateSavedSecretResource: testState.updateSavedSecretResource,
    repairCustodiedSavedSecretResourceEnvelopesBestEffort: testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort,
}));
vi.mock('@/sync/ops/teams/teamActionClient', () => ({
    isTeamActionApprovalPendingError: () => false,
}));
vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn(), confirm: testState.modalConfirm, prompt: testState.modalPrompt },
}));

describe('SecretsSettingsScreen shared feature decision', () => {
    beforeEach(() => {
        testState.sharedEnabled = false;
        testState.collisionMigrationStatus = 'not_required';
        testState.sharedEntries = [];
        testState.corruptEntries = [];
        testState.modalPrompt.mockReset();
        testState.modalConfirm.mockReset();
        testState.deleteCorruptResource.mockReset();
        testState.updateSavedSecretResource.mockReset();
        testState.promotePersonalSavedSecretResource.mockReset();
        testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort.mockReset();
        testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort.mockResolvedValue(undefined);
        testState.encryption = null;
    });

    it('opens the grant picker for a still-personal secret and converts nothing until it is saved', async () => {
        testState.sharedEnabled = true;
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const list = tree.root.findByProps({ testID: 'secrets-list' }).props;
        const secret = list.secrets[0];

        await act(async () => { list.onSharePersonal(secret); });

        expect(testState.promotePersonalSavedSecretResource).not.toHaveBeenCalled();
        const editor = tree.root.findByProps({ testID: 'saved-secret-access-editor' }).props;
        expect(editor.target).toEqual({ kind: 'personal', secret, expectedSettingsVersion: 1 });
        expect(editor.scope).toEqual({ serverId: 'home-a', accountId: 'account-a' });
        expect(tree.root.findAllByProps({ testID: 'secrets-list' })).toHaveLength(0);

        await act(async () => { editor.onClose(); });
        expect(tree.root.findByProps({ testID: 'secrets-list' })).toBeTruthy();
        expect(testState.promotePersonalSavedSecretResource).not.toHaveBeenCalled();
    });

    it('keeps personal editing available while hiding every shared mutation when disabled', async () => {
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-list' }).props;

        expect(props.allowAdd).toBe(true);
        expect(props.allowEdit).toBe(true);
        expect(props.onCreateShared).toBeUndefined();
        expect(props.onSharePersonal).toBeUndefined();
        expect(props.onRenameShared).toBeUndefined();
        expect(props.onRotateShared).toBeUndefined();
        expect(props.onManageAccessShared).toBeUndefined();
        expect(props.onDeleteShared).toBeUndefined();
        expect(props.onRetrySharedCatalog).toBeUndefined();
        expect(props.sharedApprovalId).toBeNull();
    });

    it('exposes shared mutations when the exact Home decision is enabled', async () => {
        testState.sharedEnabled = true;
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-list' }).props;

        expect(props.onCreateShared).toBeTypeOf('function');
        expect(props.onSharePersonal).toBeTypeOf('function');
        expect(props.onRenameShared).toBeTypeOf('function');
        expect(props.onRotateShared).toBeTypeOf('function');
        expect(props.onManageAccessShared).toBeTypeOf('function');
        expect(props.onDeleteShared).toBeTypeOf('function');
    });

    it('keeps collision-rekey recovery reachable while shared hydration is blocked', async () => {
        testState.collisionMigrationStatus = 'failed';
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-list' }).props;

        expect(props.onRetrySharedCatalog).toBeTypeOf('function');
        expect(props.onCreateShared).toBeUndefined();
    });

    it('preserves exact shared-secret rotation bytes, including an all-whitespace value', async () => {
        testState.sharedEnabled = true;
        testState.sharedEntries = [{
            ref: 'happier:shared-secret:v1:resource-a',
            source: 'shared_resource',
            relationship: 'owner',
            name: 'Shared token',
            kind: 'token',
            ownerAccountId: 'account-a',
            revision: 3,
            materialStatus: 'ready',
            capabilities: { use: true, rename: true, rotate: true, manageAccess: true, delete: true },
        }];
        testState.modalPrompt
            .mockResolvedValueOnce('  token\n')
            .mockResolvedValueOnce('   ');
        testState.updateSavedSecretResource.mockResolvedValue({ ok: true });
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-list' }).props;
        const entry = testState.sharedEntries[0];

        await props.onRotateShared(entry);
        await vi.waitFor(() => expect(testState.updateSavedSecretResource).toHaveBeenCalledTimes(1));
        expect(testState.updateSavedSecretResource).toHaveBeenLastCalledWith(expect.objectContaining({
            nextValue: '  token\n',
        }));

        await props.onRotateShared(entry);
        await vi.waitFor(() => expect(testState.updateSavedSecretResource).toHaveBeenCalledTimes(2));
        expect(testState.updateSavedSecretResource).toHaveBeenLastCalledWith(expect.objectContaining({
            nextValue: '   ',
        }));
    });

    it('confirms owner corrupt-row deletion and forwards its exact opaque identity and revision through the catalog callback', async () => {
        testState.sharedEnabled = true;
        const ownerCorrupt = {
            materialStatus: 'resource_corrupt', relationship: 'owner',
            repair: { kind: 'delete_resource', resourceId: 'opaque-corrupt-row', expectedRevision: -3 },
        } as const;
        testState.corruptEntries = [ownerCorrupt, {
            materialStatus: 'resource_corrupt', relationship: 'recipient', repair: null,
        }];
        testState.modalConfirm.mockResolvedValue(true);
        testState.deleteCorruptResource.mockResolvedValue(true);
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-list' }).props;

        expect(props.corruptEntries).toEqual(testState.corruptEntries);
        await props.onDeleteCorruptShared(ownerCorrupt);

        expect(testState.modalConfirm).toHaveBeenCalledWith(
            expect.any(String), expect.any(String),
            expect.objectContaining({ destructive: true }),
        );
        expect(testState.deleteCorruptResource).toHaveBeenCalledWith(ownerCorrupt);
    });
    it('prepares the envelopes this custodian owes when the surface is opened', async () => {
        testState.sharedEnabled = true;
        const decryptEncryptionKey = vi.fn(async () => new Uint8Array(32).fill(3));
        testState.encryption = { decryptEncryptionKey };
        const Screen = (await import('./secrets')).default;
        await renderScreen(<Screen />);

        expect(testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort).toHaveBeenCalledWith({
            scope: { serverId: 'home-a', accountId: 'account-a' },
            decryptDataKeyEnvelope: expect.any(Function),
        });
        // The sweep opens the resource key through this Account's own content
        // key; it never receives raw key material from the surface.
        const [{ decryptDataKeyEnvelope }] = testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort.mock.calls[0];
        await decryptDataKeyEnvelope('owner-envelope');
        expect(decryptEncryptionKey).toHaveBeenCalledWith('owner-envelope', { serverId: 'home-a', accountId: 'account-a' });
    });

    it('asks a plaintext Account for nothing, since it custodies no envelopes at all', async () => {
        testState.sharedEnabled = true;
        const Screen = (await import('./secrets')).default;
        await renderScreen(<Screen />);

        expect(testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort).not.toHaveBeenCalled();
    });
});
