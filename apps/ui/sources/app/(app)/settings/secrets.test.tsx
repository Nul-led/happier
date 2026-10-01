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
    modalAlert: vi.fn(),
    deleteCorruptResource: vi.fn(),
    updateSavedSecretResource: vi.fn(),
    promotePersonalSavedSecretResource: vi.fn(),
    repairCustodiedSavedSecretResourceEnvelopesBestEffort: vi.fn(async (_params: Readonly<{
        scope: Readonly<{ serverId: string; accountId: string }>;
        decryptDataKeyEnvelope: (envelope: string) => Promise<Uint8Array | null>;
    }>) => undefined),
    encryption: null as null | Readonly<{ decryptEncryptionKey: (value: string, scope: unknown) => Promise<Uint8Array | null> }>,
    plaintextStorageEnabled: true,
    featureRequests: [] as unknown[][],
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/settings/secrets/SecretsSettingsPage', () => ({
    SecretsSettingsPage: (props: Record<string, any>) => React.createElement('SecretsSettingsPage', {
        ...props,
        testID: 'secrets-page',
    }, props.accessEditor?.element ?? null, props.createEditor ?? null),
}));
vi.mock('@/components/secrets/SavedSecretAccessEditor', () => ({
    SavedSecretAccessEditor: (props: Record<string, unknown>) => React.createElement('SavedSecretAccessEditor', {
        ...props,
        testID: 'saved-secret-access-editor',
    }),
}));
vi.mock('@/components/secrets/SavedSecretCreateEditor', () => ({
    SavedSecretCreateEditor: (props: Record<string, unknown>) => React.createElement('SavedSecretCreateEditor', {
        ...props,
        testID: 'saved-secret-create-editor',
    }),
}));
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
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (...args: unknown[]) => {
        testState.featureRequests.push(args);
        return args[0] === 'encryption.plaintextStorage' ? testState.plaintextStorageEnabled : false;
    },
}));
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
    Modal: { alert: testState.modalAlert, confirm: testState.modalConfirm, prompt: testState.modalPrompt },
}));

function sharedOwnerEntry(encryptionMode: 'plain' | 'e2ee') {
    return {
        ref: 'happier:shared-secret:v1:resource-a',
        source: 'shared_resource',
        relationship: 'owner',
        name: 'Shared token',
        kind: 'token',
        encryptionMode,
        ownerAccountId: 'account-a',
        revision: 3,
        materialStatus: 'ready',
        capabilities: { use: true, rename: true, rotate: true, manageAccess: true, delete: true },
    };
}

describe('SecretsSettingsScreen shared feature decision', () => {
    beforeEach(() => {
        testState.sharedEnabled = false;
        testState.collisionMigrationStatus = 'not_required';
        testState.sharedEntries = [];
        testState.corruptEntries = [];
        testState.modalPrompt.mockReset();
        testState.modalConfirm.mockReset();
        testState.modalAlert.mockReset();
        testState.deleteCorruptResource.mockReset();
        testState.updateSavedSecretResource.mockReset();
        testState.promotePersonalSavedSecretResource.mockReset();
        testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort.mockReset();
        testState.repairCustodiedSavedSecretResourceEnvelopesBestEffort.mockResolvedValue(undefined);
        testState.encryption = null;
        testState.plaintextStorageEnabled = true;
        testState.featureRequests = [];
    });

    it('opens the grant picker for a still-personal secret and converts nothing until it is saved', async () => {
        testState.sharedEnabled = true;
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const list = tree.root.findByProps({ testID: 'secrets-page' }).props;
        const secret = list.personalSecrets[0];

        await act(async () => { list.onSharePersonal(secret); });

        expect(testState.promotePersonalSavedSecretResource).not.toHaveBeenCalled();
        const editor = tree.root.findByProps({ testID: 'saved-secret-access-editor' }).props;
        expect(editor.target).toEqual({ kind: 'personal', secret, expectedSettingsVersion: 1 });
        expect(editor.scope).toEqual({ serverId: 'home-a', accountId: 'account-a' });
        // The editor opens inside that secret's own row; the collection stays on the page.
        expect(tree.root.findByProps({ testID: 'secrets-page' }).props.accessEditor.key).toBe(secret.id);

        await act(async () => { editor.onClose(); });
        expect(tree.root.findByProps({ testID: 'secrets-page' }).props.accessEditor).toBeNull();
        expect(tree.root.findAllByProps({ testID: 'saved-secret-access-editor' })).toHaveLength(0);
        expect(testState.promotePersonalSavedSecretResource).not.toHaveBeenCalled();
    });

    it('keeps personal editing available while hiding every shared mutation when disabled', async () => {
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-page' }).props;

        expect(props.onRenamePersonal).toBeTypeOf('function');
        expect(props.onRotatePersonal).toBeTypeOf('function');
        expect(props.onDeletePersonal).toBeTypeOf('function');
        await act(async () => { props.onAdd(); });
        // Adding still works, as a personal secret only: the create editor offers no shared storage.
        const editor = tree.root.findByProps({ testID: 'saved-secret-create-editor' }).props;
        expect(editor.onCreatePersonal).toBeTypeOf('function');
        expect(editor.sharedAvailable).toBe(false);
        expect(props.onSharePersonal).toBeUndefined();
        expect(props.onRenameShared).toBeUndefined();
        expect(props.onRotateShared).toBeUndefined();
        expect(props.onManageAccessShared).toBeUndefined();
        expect(props.onDeleteShared).toBeUndefined();
        expect(props.onRetrySharedCatalog).toBeUndefined();
        expect(props.approvalId).toBeNull();
    });

    it('exposes shared mutations when the exact Home decision is enabled', async () => {
        testState.sharedEnabled = true;
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-page' }).props;

        await act(async () => { props.onAdd(); });
        expect(tree.root.findByProps({ testID: 'saved-secret-create-editor' }).props.sharedAvailable).toBe(true);
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
        const props = tree.root.findByProps({ testID: 'secrets-page' }).props;

        expect(props.onRetrySharedCatalog).toBeTypeOf('function');
        await act(async () => { props.onAdd(); });
        expect(tree.root.findByProps({ testID: 'saved-secret-create-editor' }).props.sharedAvailable).toBe(false);
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
        const props = tree.root.findByProps({ testID: 'secrets-page' }).props;
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

    // Plan 10.08 §18.3(3): an end-to-end encrypted value is decrypted and handed
    // to the Home only after a confirmation that names the trust change; raising
    // protection needs no such disclosure.
    it('confirms the trust change before an end-to-end encrypted secret becomes Home-managed', async () => {
        testState.sharedEnabled = true;
        testState.encryption = { decryptEncryptionKey: vi.fn(async () => new Uint8Array(32)) };
        testState.sharedEntries = [sharedOwnerEntry('e2ee')];
        testState.updateSavedSecretResource.mockResolvedValue({ ok: true });
        testState.modalConfirm.mockResolvedValue(false);
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-page' }).props;

        await props.onMakeSharedHomeManaged(testState.sharedEntries[0]);
        expect(testState.modalConfirm).toHaveBeenCalledTimes(1);
        expect(testState.updateSavedSecretResource).not.toHaveBeenCalled();

        testState.modalConfirm.mockResolvedValue(true);
        await props.onMakeSharedHomeManaged(testState.sharedEntries[0]);
        await vi.waitFor(() => expect(testState.updateSavedSecretResource).toHaveBeenCalledTimes(1));
        expect(testState.updateSavedSecretResource).toHaveBeenLastCalledWith(expect.objectContaining({
            resourceId: 'resource-a',
            expectedRevision: 3,
            toMode: 'plain',
        }));

        testState.sharedEntries = [sharedOwnerEntry('plain')];
        const plainScreen = await renderScreen(<Screen />);
        const plainProps = plainScreen.tree.root.findByProps({ testID: 'secrets-page' }).props;
        await plainProps.onEncryptShared(testState.sharedEntries[0]);
        await vi.waitFor(() => expect(testState.updateSavedSecretResource).toHaveBeenCalledTimes(2));
        expect(testState.updateSavedSecretResource).toHaveBeenLastCalledWith(expect.objectContaining({
            resourceId: 'resource-a',
            expectedRevision: 3,
            toMode: 'e2ee',
        }));
        expect(testState.modalConfirm).toHaveBeenCalledTimes(2);
    });

    // A conversion is offered only in a direction that can succeed: Plain to
    // E2EE needs this Account's content key, and E2EE to Plain needs a Home
    // whose storage policy admits Plain content (plan 10.08 §10.5 "subject to
    // Home policy").
    it('offers each conversion direction only where the Account and the Home policy allow it', async () => {
        testState.sharedEnabled = true;
        const Screen = (await import('./secrets')).default;

        testState.encryption = null;
        testState.plaintextStorageEnabled = true;
        const plainAccount = (await renderScreen(<Screen />)).tree.root.findByProps({ testID: 'secrets-page' }).props;
        expect(plainAccount.onEncryptShared).toBeUndefined();
        expect(testState.featureRequests).toContainEqual([
            'encryption.plaintextStorage',
            { scopeKind: 'spawn', serverId: 'home-a' },
        ]);

        testState.encryption = { decryptEncryptionKey: vi.fn(async () => new Uint8Array(32)) };
        testState.plaintextStorageEnabled = false;
        const requiredE2ee = (await renderScreen(<Screen />)).tree.root.findByProps({ testID: 'secrets-page' }).props;
        expect(requiredE2ee.onMakeSharedHomeManaged).toBeUndefined();
        expect(requiredE2ee.onEncryptShared).toEqual(expect.any(Function));

        testState.plaintextStorageEnabled = true;
        const both = (await renderScreen(<Screen />)).tree.root.findByProps({ testID: 'secrets-page' }).props;
        expect(both.onMakeSharedHomeManaged).toEqual(expect.any(Function));
        expect(both.onEncryptShared).toEqual(expect.any(Function));
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
        testState.deleteCorruptResource.mockResolvedValue({ ok: true });
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);
        const props = tree.root.findByProps({ testID: 'secrets-page' }).props;

        expect(props.corruptEntries).toEqual(testState.corruptEntries);
        await props.onDeleteCorruptShared(ownerCorrupt);

        expect(testState.modalConfirm).toHaveBeenCalledWith(
            expect.any(String), expect.any(String),
            expect.objectContaining({ destructive: true }),
        );
        expect(testState.deleteCorruptResource).toHaveBeenCalledWith(ownerCorrupt);
    });

    // A corrupt row the owner's own Settings still bind cannot be repaired by
    // deleting it, and the person must learn which bindings hold it rather than
    // a nameless failure.
    it('names the bindings when the owner reference census refuses a corrupt-row deletion', async () => {
        testState.sharedEnabled = true;
        const ownerCorrupt = {
            materialStatus: 'resource_corrupt', relationship: 'owner',
            repair: { kind: 'delete_resource', resourceId: 'opaque-corrupt-row', expectedRevision: -3 },
        } as const;
        testState.corruptEntries = [ownerCorrupt];
        testState.modalConfirm.mockResolvedValue(true);
        testState.deleteCorruptResource.mockResolvedValue({
            ok: false,
            reason: 'in_use',
            references: [{ owner: 'mcp', path: 'mcpServersSettingsV1.servers.srv.env.TOKEN' }],
        });
        const Screen = (await import('./secrets')).default;
        const { tree } = await renderScreen(<Screen />);

        await act(async () => {
            tree.root.findByProps({ testID: 'secrets-page' }).props.onDeleteCorruptShared(ownerCorrupt);
        });
        await vi.waitFor(() => expect(testState.modalAlert).toHaveBeenCalled());

        expect(testState.deleteCorruptResource).toHaveBeenCalledWith(ownerCorrupt);
        expect(testState.modalAlert).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('mcpServersSettingsV1.servers.srv.env.TOKEN'),
        );
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
