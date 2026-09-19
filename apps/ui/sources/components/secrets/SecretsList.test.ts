import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import {
    changeTextTestInstance,
    findTestInstanceByTypeContainingText,
    findTestInstanceByTypeWithProps,
    pressTestInstanceAsync,
    renderScreen,
} from '@/dev/testkit';
import type { SavedSecret } from '@/sync/domains/settings/savedSecretTypes';
import type { SavedSecretCatalogCorruptEntryV1, SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';
import { SecretsList } from './SecretsList';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                text: '#000',
                textSecondary: '#666',
                divider: '#ddd',
                surface: '#fff',
                button: { primary: { background: '#00f', tint: '#fff' }, secondary: { tint: '#00f' } },
                input: { background: '#fff', placeholder: '#999', text: '#000' },
                groupped: { sectionTitle: '#333' },
                state: { warning: { foreground: '#a60' } },
            },
        },
    });
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                                    Platform: {
                                        OS: 'ios',
                                        select: <T,>(obj: { ios?: T; default?: T }) => obj.ios ?? obj.default,
                                    },
                                    AppState: {
                                        addEventListener: () => ({ remove: () => {} }),
                                    },
                                    Pressable: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                                        React.createElement('Pressable', props, props.children),
                                    Text: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                                        React.createElement('Text', props, props.children),
                                    View: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                                        React.createElement('View', props, props.children),
                                    TextInput: React.forwardRef<{ focus: () => void }, Record<string, unknown>>((props, ref) => {
                                        if (ref && typeof ref === 'object') {
                                            ref.current = { focus: () => {} };
                                        }
                                        return React.createElement('TextInput', props);
                                    }),
                                }
    );
});

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/ui/lists/ItemGroup')>();
    return {
        ...actual,
        ItemGroup: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    };
});

vi.mock('@/components/ui/lists/ItemRowActions', () => ({
    ItemRowActions: (props: Record<string, unknown>) => React.createElement('ItemRowActions', props),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            show: vi.fn(),
            prompt: vi.fn(),
            confirm: vi.fn(),
            alert: vi.fn(),
        },
    }).module;
});

async function renderSecretsList(params?: {
    secrets?: SavedSecret[];
    allowAdd?: boolean;
    includeNoneRow?: boolean;
    defaultId?: string | null;
    sharedEntries?: readonly SavedSecretCatalogEntryV1[];
    corruptEntries?: readonly SavedSecretCatalogCorruptEntryV1[];
    onDeleteCorruptShared?: (entry: Extract<SavedSecretCatalogCorruptEntryV1, { relationship: 'owner' }>) => void;
    onRenameShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onRotateShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onManageAccessShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onDeleteShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onSharePersonal?: (secret: SavedSecret) => void;
    onCreateShared?: () => void;
    sharedCatalogStale?: boolean;
    onRetrySharedCatalog?: () => void;
}) {
    const onCreatePersonal = vi.fn(async () => 'uuid-1');
    const onRenamePersonal = vi.fn(async () => true);
    const onRotatePersonal = vi.fn(async () => true);
    const onDeletePersonal = vi.fn(async () => true);
    const onAfterAddSelectId = vi.fn<(id: string) => void>();
    const onSelectId = vi.fn<(id: string) => void>();

    const screen = await renderScreen(
        React.createElement(SecretsList, {
            secrets: params?.secrets ?? [],
            onCreatePersonal,
            onRenamePersonal,
            onRotatePersonal,
            onDeletePersonal,
            onAfterAddSelectId,
            onSelectId,
            defaultId: params?.defaultId,
            includeNoneRow: params?.includeNoneRow,
            allowAdd: params?.allowAdd,
            sharedEntries: params?.sharedEntries,
            corruptEntries: params?.corruptEntries,
            onDeleteCorruptShared: params?.onDeleteCorruptShared,
            onRenameShared: params?.onRenameShared,
            onRotateShared: params?.onRotateShared,
            onManageAccessShared: params?.onManageAccessShared,
            onDeleteShared: params?.onDeleteShared,
            onSharePersonal: params?.onSharePersonal,
            onCreateShared: params?.onCreateShared,
            sharedCatalogStale: params?.sharedCatalogStale,
            onRetrySharedCatalog: params?.onRetrySharedCatalog,
        }),
    );

    return {
        screen,
        onCreatePersonal,
        onAfterAddSelectId,
        onSelectId,
    };
}

describe('SecretsList', () => {
    beforeEach(() => {
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('exposes only server-projected capabilities for owner resource rows', async () => {
        const entry = {
            ref: 'happier:shared-secret:v1:shared-a', source: 'shared_resource', relationship: 'owner',
            name: 'Shared key', kind: 'apiKey', encryptionMode: null, owner: null, accessSources: [], audience: null,
            ownerAccountId: 'owner-a', revision: 2, materialStatus: 'ready',
            capabilities: { use: true, rename: true, rotate: true, manageAccess: true, delete: true },
        } as const satisfies SavedSecretCatalogEntryV1;
        const callbacks = {
            onRenameShared: vi.fn(), onRotateShared: vi.fn(), onManageAccessShared: vi.fn(), onDeleteShared: vi.fn(),
        };
        const { screen } = await renderSecretsList({ sharedEntries: [entry], ...callbacks });
        const actions = findTestInstanceByTypeWithProps(screen, 'ItemRowActions', {
            overflowTriggerTestID: `saved-secret:${entry.ref}:more`,
        })!;

        expect(actions.props.actions.map((action: { id: string }) => action.id))
            .toEqual(['rename', 'rotate', 'manageAccess', 'delete']);
    });

    it('offers a working refresh action when the shared catalog is stale', async () => {
        const onRetrySharedCatalog = vi.fn();
        const { screen } = await renderSecretsList({ sharedCatalogStale: true, onRetrySharedCatalog });

        await screen.pressByTestIdAsync('saved-secret-catalog-retry');

        expect(onRetrySharedCatalog).toHaveBeenCalledOnce();
    });

    it('renders corrupt owner and recipient rows as nonselectable information and only offers owner repair', async () => {
        const owner = {
            materialStatus: 'resource_corrupt', relationship: 'owner',
            repair: { kind: 'delete_resource', resourceId: 'opaque-owner-row', expectedRevision: 9 },
        } as const satisfies SavedSecretCatalogCorruptEntryV1;
        const recipient = {
            materialStatus: 'resource_corrupt', relationship: 'recipient', repair: null,
        } as const satisfies SavedSecretCatalogCorruptEntryV1;
        const onDeleteCorruptShared = vi.fn();
        const { screen, onSelectId } = await renderSecretsList({
            corruptEntries: [owner, recipient],
            onDeleteCorruptShared,
        });

        expect(screen.findByTestId('saved-secret-corrupt:owner:0')).toBeTruthy();
        expect(screen.findByTestId('saved-secret-corrupt:recipient:0')).toBeTruthy();
        expect(onSelectId).not.toHaveBeenCalled();
        const ownerActions = findTestInstanceByTypeWithProps(screen, 'ItemRowActions', {
            overflowTriggerTestID: 'saved-secret-corrupt:owner:0:more',
        })!;
        expect(ownerActions.props.actions.map((action: { id: string }) => action.id)).toEqual(['delete']);
        ownerActions.props.actions[0].onPress();
        expect(onDeleteCorruptShared).toHaveBeenCalledWith(owner);
        expect(screen.findAllByType('ItemRowActions').some((row) => (
            row.props.overflowTriggerTestID === 'saved-secret-corrupt:recipient:0:more'
        ))).toBe(false);
    });

    it('adds a secret via the inline expander without modal prompts', async () => {
        const { screen, onCreatePersonal, onAfterAddSelectId } = await renderSecretsList();

        const addItem = findTestInstanceByTypeContainingText(screen, 'Pressable', 'common.add');
        expect(addItem).toBeTruthy();

        await pressTestInstanceAsync(addItem, 'common.add row');

        const nameInput = findTestInstanceByTypeWithProps(screen, 'TextInput', {
            placeholder: 'secrets.placeholders.nameExample',
        });
        const valueInput = findTestInstanceByTypeWithProps(screen, 'TextInput', {
            placeholder: 'secrets.placeholders.valueExample',
        });
        expect(nameInput).toBeTruthy();
        expect(valueInput).toBeTruthy();

        act(() => {
            changeTextTestInstance(nameInput, 'My Key', 'secret name input');
            changeTextTestInstance(valueInput, '  sk-test\n', 'secret value input');
        });

        const saveButton = findTestInstanceByTypeWithProps(screen, 'Pressable', {
            accessibilityLabel: 'common.save',
        });
        expect(saveButton).toBeTruthy();
        expect(saveButton?.props.disabled).toBe(false);

        await pressTestInstanceAsync(saveButton, 'common.save button');

        expect(onCreatePersonal).toHaveBeenCalledWith({
            name: 'My Key',
            value: '  sk-test\n',
        });
        expect(onAfterAddSelectId).toHaveBeenCalledWith('uuid-1');
    });

    it('keeps save disabled until both name and value are provided', async () => {
        const { screen } = await renderSecretsList();

        const addItem = findTestInstanceByTypeContainingText(screen, 'Pressable', 'common.add');
        expect(addItem).toBeTruthy();

        await pressTestInstanceAsync(addItem, 'common.add row');

        const nameInput = findTestInstanceByTypeWithProps(screen, 'TextInput', {
            placeholder: 'secrets.placeholders.nameExample',
        });
        const valueInput = findTestInstanceByTypeWithProps(screen, 'TextInput', {
            placeholder: 'secrets.placeholders.valueExample',
        });
        const saveButton = findTestInstanceByTypeWithProps(screen, 'Pressable', {
            accessibilityLabel: 'common.save',
        });

        expect(saveButton?.props.disabled).toBe(true);

        act(() => {
            changeTextTestInstance(nameInput, 'ONLY_NAME', 'secret name input');
        });
        expect(findTestInstanceByTypeWithProps(screen, 'Pressable', { accessibilityLabel: 'common.save' })?.props.disabled).toBe(true);

        act(() => {
            changeTextTestInstance(valueInput, 'has-value', 'secret value input');
        });
        expect(findTestInstanceByTypeWithProps(screen, 'Pressable', { accessibilityLabel: 'common.save' })?.props.disabled).toBe(false);
    });

    it('does not expose add control when adding is disabled', async () => {
        const { screen } = await renderSecretsList({ allowAdd: false });
        expect(findTestInstanceByTypeContainingText(screen, 'Pressable', 'common.add')).toBeUndefined();
    });

    it('exposes direct shared-resource creation separately from personal add', async () => {
        const onCreateShared = vi.fn();
        const { screen } = await renderSecretsList({ onCreateShared });

        await screen.pressByTestIdAsync('saved-secret-create-shared');

        expect(onCreateShared).toHaveBeenCalledOnce();
        expect(screen.findByTestId('saved-secret-add')).toBeTruthy();
    });

    it('moves default secret to the first rendered position', async () => {
        const secrets: SavedSecret[] = [
            {
                id: 'secret-a',
                name: 'Primary',
                kind: 'apiKey',
                encryptedValue: { _isSecretValue: true, value: 'a' },
                createdAt: 1,
                updatedAt: 1,
            },
            {
                id: 'secret-b',
                name: 'Secondary',
                kind: 'apiKey',
                encryptedValue: { _isSecretValue: true, value: 'b' },
                createdAt: 2,
                updatedAt: 2,
            },
        ];

        const { screen } = await renderSecretsList({ secrets, defaultId: 'secret-b', allowAdd: false });
        const textContent = screen.getTextContent();
        expect(textContent.indexOf('Secondary')).toBeGreaterThanOrEqual(0);
        expect(textContent.indexOf('Primary')).toBeGreaterThanOrEqual(0);
        expect(textContent.indexOf('Secondary')).toBeLessThan(textContent.indexOf('Primary'));
    });

    it('exposes stable automation identities for Saved Secret rows and mutation actions', async () => {
        const secret: SavedSecret = {
            id: 'secret-a',
            name: 'Primary',
            kind: 'apiKey',
            encryptedValue: { _isSecretValue: true, value: 'a' },
            createdAt: 1,
            updatedAt: 1,
        };
        const onSharePersonal = vi.fn();
        const { screen } = await renderSecretsList({ secrets: [secret], onSharePersonal });

        expect(screen.findByTestId('saved-secret:secret-a')).toBeTruthy();
        expect(screen.findByTestId('saved-secret-add')).toBeTruthy();
        const editActions = screen.findAllByType('ItemRowActions')
            .find((row) => row.props.title === secret.name);
        expect(editActions?.props.overflowTriggerTestID).toBe('saved-secret:secret-a:more');
        expect(editActions?.props.actions.map((action: { inlineTestID?: string }) => action.inlineTestID))
            .toEqual([
                'saved-secret:secret-a:rename',
                'saved-secret:secret-a:replace',
                'saved-secret:secret-a:share',
                'saved-secret:secret-a:delete',
            ]);
        const share = editActions?.props.actions.find((action: { id: string }) => action.id === 'share');
        share?.onPress();
        expect(onSharePersonal).toHaveBeenCalledWith(secret);
    });

    it('selects none row when include-none entry is pressed', async () => {
        const { screen, onSelectId } = await renderSecretsList({ includeNoneRow: true, allowAdd: false });
        const noneItem = findTestInstanceByTypeContainingText(screen, 'Pressable', 'secrets.noneTitle');
        expect(noneItem).toBeTruthy();

        await pressTestInstanceAsync(noneItem, 'secrets.none row');

        expect(onSelectId).toHaveBeenCalledWith('');
    });
});
