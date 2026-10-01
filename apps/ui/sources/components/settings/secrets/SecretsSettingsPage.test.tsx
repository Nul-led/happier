import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedSecretCatalogCorruptEntryV1, SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '@/components/settings/settingsViewTestHelpers';
import type { SavedSecret } from '@/sync/domains/settings/savedSecretTypes';

import type { SecretsSettingsPageProps } from './SecretsSettingsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installSettingsViewCommonModuleMocks();

afterEach(() => {
    standardCleanup();
});

const PERSONAL: SavedSecret = {
    id: 'personal-a',
    name: 'Work OpenAI',
    kind: 'apiKey',
    encryptedValue: { _isSecretValue: true, value: 'sk-never-rendered' },
    createdAt: 1,
    updatedAt: 1,
};

function ownedEntry(overrides: Partial<SavedSecretCatalogEntryV1> = {}): SavedSecretCatalogEntryV1 {
    return {
        ref: 'happier:shared-secret:v1:shared-a', source: 'shared_resource', relationship: 'owner',
        name: 'Deploy key', kind: 'token', encryptionMode: 'e2ee', owner: null, accessSources: [],
        audience: { accounts: [{ accountId: 'b' } as never], teams: [], groups: [] },
        ownerAccountId: 'owner-a', revision: 2, materialStatus: 'ready',
        capabilities: { use: true, rename: true, rotate: true, manageAccess: true, delete: true },
        ...overrides,
    } as SavedSecretCatalogEntryV1;
}

async function renderPage(overrides: Partial<SecretsSettingsPageProps> = {}) {
    const { SecretsSettingsPage } = await import('./SecretsSettingsPage');
    const props: SecretsSettingsPageProps = {
        personalSecrets: [PERSONAL],
        sharedEntries: [] as SavedSecretCatalogEntryV1[],
        corruptEntries: [] as SavedSecretCatalogCorruptEntryV1[],
        // The page reads only the resolved status; the rest of a resolution is irrelevant here.
        resolveSharedReference: (ref: string) => ({ ref, kind: 'shared_resource', status: 'ready' }) as unknown as ReturnType<SecretsSettingsPageProps['resolveSharedReference']>,
        sharedCatalogStale: false,
        onRenamePersonal: vi.fn(async () => true),
        onRotatePersonal: vi.fn(async () => true),
        onDeletePersonal: vi.fn(async () => true),
        sharedMutationsDisabled: false,
        approvalId: null,
        onAdd: vi.fn(),
        onCancelAdd: vi.fn(),
        createEditor: null,
        accessEditor: null,
        ...overrides,
    };
    const screen = await renderScreen(<SecretsSettingsPage {...props} />);
    return { screen, props };
}

describe('SecretsSettingsPage', () => {
    it('never renders a secret value, and runs each personal operation from the expanded row', async () => {
        const { screen, props } = await renderPage({ onSharePersonal: vi.fn() });

        expect(screen.getTextContent()).not.toContain('sk-never-rendered');
        await screen.pressByTestIdAsync('saved-secret:personal-a:header');
        await screen.pressByTestIdAsync('saved-secret:personal-a:replace');
        await screen.pressByTestIdAsync('saved-secret:personal-a:rename');
        await screen.pressByTestIdAsync('saved-secret:personal-a:share');
        await screen.pressByTestIdAsync('saved-secret:personal-a:delete');

        expect(props.onRotatePersonal).toHaveBeenCalledWith(PERSONAL);
        expect(props.onRenamePersonal).toHaveBeenCalledWith(PERSONAL);
        expect(props.onSharePersonal).toHaveBeenCalledWith(PERSONAL);
        expect(props.onDeletePersonal).toHaveBeenCalledWith(PERSONAL);
        expect(screen.getTextContent()).not.toContain('sk-never-rendered');
    });

    it('offers only the operations an owned shared secret\'s projected capabilities allow', async () => {
        const handlers = {
            onRenameShared: vi.fn(), onRotateShared: vi.fn(), onManageAccessShared: vi.fn(), onDeleteShared: vi.fn(),
        };
        const full = ownedEntry();
        const limited = ownedEntry({
            ref: 'happier:shared-secret:v1:shared-b',
            capabilities: { use: true, rename: false, rotate: false, manageAccess: false, delete: false },
        });
        const { screen } = await renderPage({ personalSecrets: [], sharedEntries: [full, limited], ...handlers });
        await screen.pressByTestIdAsync(`saved-secret:${full.ref}:header`);
        await screen.pressByTestIdAsync(`saved-secret:${limited.ref}:header`);

        for (const id of ['rotate', 'rename', 'manageAccess', 'delete']) {
            expect(screen.findByTestId(`saved-secret:${full.ref}:${id}`)).toBeTruthy();
            expect(screen.findByTestId(`saved-secret:${limited.ref}:${id}`)).toBeFalsy();
        }
        await screen.pressByTestIdAsync(`saved-secret:${full.ref}:manageAccess`);
        expect(handlers.onManageAccessShared).toHaveBeenCalledWith(full);
    });

    it('offers the one conversion out of each secret\'s current mode, and only where the screen allows it', async () => {
        const e2ee = ownedEntry({ ref: 'happier:shared-secret:v1:e2ee', encryptionMode: 'e2ee' });
        const plain = ownedEntry({ ref: 'happier:shared-secret:v1:plain', encryptionMode: 'plain' });
        const onMakeSharedHomeManaged = vi.fn();
        const { screen } = await renderPage({ personalSecrets: [], sharedEntries: [e2ee, plain], onMakeSharedHomeManaged });
        await screen.pressByTestIdAsync(`saved-secret:${e2ee.ref}:header`);
        await screen.pressByTestIdAsync(`saved-secret:${plain.ref}:header`);

        // No handler for the other direction, so the Home-managed secret offers no conversion.
        expect(screen.findByTestId(`saved-secret:${plain.ref}:convertMode`)).toBeFalsy();
        await screen.pressByTestIdAsync(`saved-secret:${e2ee.ref}:convertMode`);
        expect(onMakeSharedHomeManaged).toHaveBeenCalledWith(e2ee);
    });

    it('shows corrupt secrets as information and offers the owner\'s delete as the only repair', async () => {
        const owner = {
            materialStatus: 'resource_corrupt', relationship: 'owner',
            repair: { kind: 'delete_resource', resourceId: 'opaque-owner-row', expectedRevision: 9 },
        } as const satisfies SavedSecretCatalogCorruptEntryV1;
        const recipient = {
            materialStatus: 'resource_corrupt', relationship: 'recipient', repair: null,
        } as const satisfies SavedSecretCatalogCorruptEntryV1;
        const onDeleteCorruptShared = vi.fn();
        const { screen } = await renderPage({ corruptEntries: [owner, recipient], onDeleteCorruptShared });

        expect(screen.findByTestId('saved-secret-corrupt:owner:0')).toBeTruthy();
        expect(screen.findByTestId('saved-secret-corrupt:recipient:0')).toBeTruthy();
        expect(screen.findByTestId('saved-secret-corrupt:recipient:0:delete')).toBeFalsy();
        await screen.pressByTestIdAsync('saved-secret-corrupt:owner:0:delete');
        expect(onDeleteCorruptShared).toHaveBeenCalledWith(owner);
    });

    it('opens the access editor inside the secret\'s own row, and the create editor in a draft row', async () => {
        const accessElement = <React.Fragment key="access"><AccessProbe /></React.Fragment>;
        const { screen } = await renderPage({
            onSharePersonal: vi.fn(),
            accessEditor: { key: PERSONAL.id, element: accessElement },
            createEditor: <CreateProbe />,
        });

        // The row with the open access editor is expanded without being pressed.
        expect(screen.findByTestId('access-probe')).toBeTruthy();
        expect(screen.findByTestId('saved-secret-draft')).toBeTruthy();
        expect(screen.findByTestId('create-probe')).toBeTruthy();
        // While adding, the section's Add is not offered a second time.
        expect(screen.findByTestId('saved-secret-add')?.props.disabled).toBe(true);
    });
});

function AccessProbe() {
    return React.createElement('View', { testID: 'access-probe' });
}

function CreateProbe() {
    return React.createElement('View', { testID: 'create-probe' });
}
