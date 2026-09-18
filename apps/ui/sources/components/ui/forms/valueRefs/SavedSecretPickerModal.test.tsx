import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SavedSecret } from '@/sync/domains/settings/savedSecretTypes';
import { installValueRefsCommonModuleMocks } from './valueRefsTestHelpers';
import { renderScreen } from '@/dev/testkit';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storedSecrets: SavedSecret[] = [{
    id: 'secret-1',
    name: 'qa_saved_secret',
    kind: 'apiKey',
    encryptedValue: { _isSecretValue: true, value: 'sk-stored' },
    createdAt: 1,
    updatedAt: 1,
}];

const catalogHarness = vi.hoisted(() => {
    const state = { stale: false };
    return {
        state,
        reload: vi.fn(async () => {
            state.stale = false;
        }),
    };
});

installValueRefsCommonModuleMocks();

vi.mock('@/sync/store/hooks', () => ({
    useSetting: () => storedSecrets,
    useSettingsVersion: () => 1,
}));

vi.mock('@/sync/store/settingsWriters', () => ({
    useAccountSettingsScope: () => ({ serverId: 'home-a', accountId: 'account-a' }),
}));

vi.mock('@/components/secrets/useSavedSecretCatalog', () => ({
    useSavedSecretCatalog: () => ({
        personalSecrets: storedSecrets,
        personalMutations: {
            create: vi.fn(async () => null),
            rename: vi.fn(async () => true),
            rotate: vi.fn(async () => true),
            delete: vi.fn(async () => true),
        },
        entries: [
            {
                ref: 'happier:shared-secret:v1:shared-ready', source: 'shared_resource', relationship: 'recipient',
                name: 'Team key', kind: 'apiKey', ownerAccountId: 'owner-a', revision: 1, materialStatus: 'ready',
                capabilities: { use: true, rename: false, rotate: false, manageAccess: false, delete: false },
            },
            {
                ref: 'happier:shared-secret:v1:shared-preparing', source: 'shared_resource', relationship: 'recipient',
                name: 'Preparing key', kind: 'apiKey', ownerAccountId: 'owner-a', revision: 1,
                materialStatus: 'preparing_encrypted_access',
                capabilities: { use: false, rename: false, rotate: false, manageAccess: false, delete: false },
            },
        ],
        sharedEntries: [
            {
                ref: 'happier:shared-secret:v1:shared-ready', source: 'shared_resource', relationship: 'recipient',
                name: 'Team key', kind: 'apiKey', ownerAccountId: 'owner-a', revision: 1, materialStatus: 'ready',
                capabilities: { use: true, rename: false, rotate: false, manageAccess: false, delete: false },
            },
            {
                ref: 'happier:shared-secret:v1:shared-preparing', source: 'shared_resource', relationship: 'recipient',
                name: 'Preparing key', kind: 'apiKey', ownerAccountId: 'owner-a', revision: 1,
                materialStatus: 'preparing_encrypted_access',
                capabilities: { use: false, rename: false, rotate: false, manageAccess: false, delete: false },
            },
        ],
        corruptEntries: [{
            materialStatus: 'resource_corrupt',
            relationship: 'owner',
            repair: { kind: 'delete_resource', resourceId: 'opaque-corrupt-row', expectedRevision: 4 },
        }],
        resolveReference: (ref: string) => ({
            ref,
            kind: 'shared_resource',
            status: catalogHarness.state.stale ? 'temporarily_unavailable' : 'ready',
            entry: null,
            secret: catalogHarness.state.stale ? null : storedSecrets[0],
            revision: 1,
            fingerprint: `shared:${ref}:1`,
        }),
        status: catalogHarness.state.stale ? 'error' : 'ready',
        stale: catalogHarness.state.stale,
        error: catalogHarness.state.stale,
        reload: catalogHarness.reload,
    }),
}));

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({ mutateAccountSettings: vi.fn() }),
}));

vi.mock('@/components/ui/text/Text', () => createPassThroughModule(['Text', 'TextInput']));
vi.mock('@/components/ui/lists/ItemList', () => createPassThroughModule(['ItemList']));
vi.mock('@/components/ui/lists/ItemGroup', () => createPassThroughModule(['ItemGroup']));
vi.mock('@/components/ui/lists/ItemRowActions', () => createPassThroughModule(['ItemRowActions']));
vi.mock('@/components/ui/forms/InlineAddExpander', () => createPassThroughModule(['InlineAddExpander']));
vi.mock('@/constants/Typography', () => ({
    Typography: new Proxy({}, { get: () => () => ({}) }),
    FontWeights: { regular: '400' },
}));

// `Item` renders its right-hand affordances through a prop rather than children, so the row slot has
// to be mounted for the mutation controls to be observable at all.
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown> & { rightElement?: React.ReactNode }) => React.createElement(
        'Item',
        props,
        props.rightElement,
    ),
}));

type PickerScreen = Awaited<ReturnType<typeof renderScreen>>;

function rowActionIds(screen: PickerScreen): string[] {
    return screen.findAllByType('ItemRowActions' as never)
        .flatMap((node) => ((node.props.actions ?? []) as ReadonlyArray<{ id: string }>).map((action) => action.id));
}

/**
 * The picker is shared between callers that own the secret list (MCP value refs, provider
 * connections) and callers whose own flow carries the disclosure for writing a credential. Only the
 * first group may mutate a stored record from inside the picker.
 */
describe('SavedSecretPickerModal', () => {
    beforeEach(() => {
        catalogHarness.state.stale = false;
        catalogHarness.reload.mockClear();
    });

    it('keeps rename, replace, delete and add for consumers that own the secret list', async () => {
        const { SavedSecretPickerModal } = await import('./SavedSecretPickerModal');

        const screen = await renderScreen(React.createElement(SavedSecretPickerModal, {
            onClose: vi.fn(),
            selectedId: null,
            onSelectId: vi.fn(),
        }));

        expect(rowActionIds(screen)).toEqual(['edit', 'replace', 'delete']);
        expect(screen.findAllByType('InlineAddExpander' as never)).toHaveLength(1);
        expect(screen.findByTestId('saved-secret:none')).toBeTruthy();
    });

    it('is a pure selector when the caller owns the credential write: select an existing id or dismiss', async () => {
        const { SavedSecretPickerModal } = await import('./SavedSecretPickerModal');
        const onSelectId = vi.fn();
        const onClose = vi.fn();

        const screen = await renderScreen(React.createElement(SavedSecretPickerModal, {
            onClose,
            selectedId: null,
            onSelectId,
            includeNoneRow: false,
            allowAdd: false,
            allowEdit: false,
        }));

        // Nothing in the tree can create, replace, rename or delete a stored record.
        expect(rowActionIds(screen)).toEqual([]);
        expect(screen.findAllByType('InlineAddExpander' as never)).toHaveLength(0);
        expect(screen.findByTestId('saved-secret:none')).toBeNull();

        // Selecting an already-stored record stays the whole point of the surface.
        screen.pressByTestId('saved-secret:secret-1');
        expect(onSelectId).toHaveBeenCalledWith('secret-1');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('selects ready shared resources and keeps preparing access visible but disabled', async () => {
        const { SavedSecretPickerModal } = await import('./SavedSecretPickerModal');
        const onSelectId = vi.fn();
        const onClose = vi.fn();
        const screen = await renderScreen(React.createElement(SavedSecretPickerModal, {
            onClose, selectedId: null, onSelectId,
        }));

        screen.pressByTestId('saved-secret:happier:shared-secret:v1:shared-ready');
        expect(onSelectId).toHaveBeenCalledWith('happier:shared-secret:v1:shared-ready');
        expect(onClose).toHaveBeenCalledTimes(1);

        const preparing = screen.findByTestId('saved-secret:happier:shared-secret:v1:shared-preparing');
        expect(preparing?.props.disabled).toBe(true);
        expect(preparing?.props.onPress).toBeUndefined();
        expect(screen.findByTestId('saved-secret-corrupt:owner:0')).toBeNull();
    });

    it('keeps retained stale metadata visible but unavailable, then restores selection after reload', async () => {
        catalogHarness.state.stale = true;
        const { SavedSecretPickerModal } = await import('./SavedSecretPickerModal');
        const onSelectId = vi.fn();
        const onClose = vi.fn();
        const pickerProps = {
            onClose,
            selectedId: 'happier:shared-secret:v1:shared-ready',
            onSelectId,
        };
        const screen = await renderScreen(React.createElement(SavedSecretPickerModal, pickerProps));

        const staleRow = screen.findByTestId('saved-secret:happier:shared-secret:v1:shared-ready');
        expect(staleRow?.props.subtitle).toBe('secrets.catalog.status.temporarily_unavailable');
        expect(staleRow?.props.selected).toBe(true);
        expect(staleRow?.props.disabled).toBe(true);
        expect(staleRow?.props.onPress).toBeUndefined();
        expect(onClose).not.toHaveBeenCalled();

        await screen.pressByTestIdAsync('saved-secret-catalog-retry');
        expect(catalogHarness.reload).toHaveBeenCalledOnce();
        await screen.update(React.createElement(SavedSecretPickerModal, { ...pickerProps }));

        const restoredRow = screen.findByTestId('saved-secret:happier:shared-secret:v1:shared-ready');
        expect(restoredRow?.props.selected).toBe(true);
        expect(restoredRow?.props.disabled).toBe(false);
        screen.pressByTestId('saved-secret:happier:shared-secret:v1:shared-ready');
        expect(onSelectId).toHaveBeenCalledWith('happier:shared-secret:v1:shared-ready');
        expect(onClose).toHaveBeenCalledOnce();
    });
});
