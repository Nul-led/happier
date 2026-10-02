import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';

import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { createHomeGovernanceHarness, installHomeGovernanceBoundaries } from '@/dev/testkit/harness/homeGovernanceHarness';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';
import { applySavedSecretCatalogPage, resetSavedSecretCatalogSnapshotsForTests } from '@/sync/store/settings/savedSecretCatalogSnapshot';
import { clearActiveUnsavedChangesGuard, runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const alert = vi.hoisted(() => vi.fn());
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
installSettingsViewCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { alert } }).module;
    },
});
// Keep the store and its selectors real; the settings helper defaults to a stub.
vi.doUnmock('@/sync/domains/state/storage');
const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);
await loadSyncSingletonForTests();

function entry(id: string): SavedSecretCatalogEntryV1 {
    return {
        ref: `happier:shared-secret:v1:${id}`, source: 'shared_resource', relationship: 'owner',
        name: id, kind: 'apiKey', encryptionMode: 'plain', owner: null, accessSources: [],
        audience: { accounts: [{ kind: 'account', accountId: 'recipient', firstName: 'Recipient', lastName: null, username: null, avatarUrl: null }], teams: [], groups: [] },
        ownerAccountId: 'account-owner', revision: 3, materialStatus: 'ready',
        capabilities: { use: true, rename: true, rotate: true, manageAccess: true, delete: true },
    };
}

beforeEach(async () => {
    await harness.reset();
    const { resetSavedSecretCatalogEngineForTests } = await import('@/sync/engine/settings/savedSecretCatalogEngine');
    const { resetTeamActionClientForTests } = await import('@/sync/ops/teams/teamActionClient');
    resetSavedSecretCatalogEngineForTests();
    resetSavedSecretCatalogSnapshotsForTests();
    resetTeamActionClientForTests();
    clearActiveUnsavedChangesGuard();
    alert.mockReset();
});
afterEach(() => { standardCleanup(); clearActiveUnsavedChangesGuard(); });

async function mount(editAccess = true) {
    const serverId = await harness.addHome({ name: 'Secrets Home', serverUrl: 'https://secret-editor.test', accountId: 'account-owner', teamsEnabled: true });
    await harness.selectHomes([serverId]);
    const scope = { serverId, accountId: 'account-owner' };
    const entries = [entry('secret-a'), entry('secret-b')];
    const { storage } = await import('@/sync/domains/state/storage');
    storage.setState({ settingsScope: scope, profileScope: scope, settingsVersion: 1 });
    applySavedSecretCatalogPage({ scope, entries, observedAt: 1 });
    const { SecretsSettingsScreen } = await import('./SecretsSettingsScreen');
    const screen = await renderScreen(<SecretsSettingsScreen />);
    if (editAccess) {
        await screen.pressByTestIdAsync(`saved-secret:${entries[0]!.ref}:header`);
        await screen.pressByTestIdAsync(`saved-secret:${entries[0]!.ref}:manageAccess`);
        // Removing the recipient from the draft makes the editor dirty; nothing is written yet.
        await screen.pressByTestIdAsync('saved-secret-access-grant-account:recipient');
        await screen.pressByTestIdAsync('saved-secret-access-remove:account:recipient');
    }
    return { screen, scope, entries };
}

describe('Saved Secrets editor continuity through the settings screen', () => {
    it('commits inline names and exact replacement bytes through the canonical shared resource writer', async () => {
        const { screen, scope, entries } = await mount(false);
        const secret = entries[0]!;
        const resourceId = 'secret-a';
        const path = '/v1/account/saved-secrets/resources/update';
        const materials = '/v1/account/saved-secrets/resources/materials';
        harness.answer(scope.serverId, materials, { body: { resources: [{
            resourceId, encryptionMode: 'plain', entry: secret,
            storedContent: { t: 'plain', v: { v: 1, name: 'secret-a', kind: 'apiKey', value: 'original-secret' } },
            recipientEnvelope: null,
        }] } });
        harness.answer(scope.serverId, path, { body: { resourceId, revision: 4 } });
        await screen.pressByTestIdAsync(`saved-secret:${secret.ref}:header`);
        await screen.pressByTestIdAsync(`saved-secret:${secret.ref}:rename`);
        expect(harness.requestsFor(path)).toHaveLength(0);
        await act(async () => screen.changeTextByTestId(`saved-secret:${secret.ref}:edit-input`, '  Renamed key  '));
        await screen.pressByTestIdAsync(`saved-secret:${secret.ref}:edit-save`);
        await vi.waitFor(() => expect(harness.requestsFor(path)).toHaveLength(1));
        expect(harness.requestsFor(path)[0]?.input).toEqual(expect.objectContaining({
            resourceId, expectedRevision: 3, displayName: 'Renamed key',
            storedContent: { t: 'plain', v: { v: 1, name: 'Renamed key', kind: 'apiKey', value: 'original-secret' } },
        }));
        await vi.waitFor(() => expect(screen.findByTestId(`saved-secret:${secret.ref}:edit-input`)).toBeNull());

        await screen.pressByTestIdAsync(`saved-secret:${secret.ref}:rotate`);
        const input = screen.findAllByTestId(`saved-secret:${secret.ref}:edit-input`).find((node) => typeof node.props.onChangeText === 'function');
        expect(input?.props.secureTextEntry).toBe(true);
        expect(input?.props.value).toBe('');
        await act(async () => screen.changeTextByTestId(`saved-secret:${secret.ref}:edit-input`, '  exact replacement\n'));
        await screen.pressByTestIdAsync(`saved-secret:${secret.ref}:edit-save`);
        await vi.waitFor(() => expect(harness.requestsFor(path)).toHaveLength(2));
        expect(harness.requestsFor(path)[1]?.input).toEqual(expect.objectContaining({
            resourceId, expectedRevision: 3,
            storedContent: { t: 'plain', v: { v: 1, name: 'secret-a', kind: 'apiKey', value: '  exact replacement\n' } },
        }));
        await vi.waitFor(() => expect(screen.findByTestId(`saved-secret:${secret.ref}:edit-input`)).toBeNull());
    });

    it('preserves a new secret when collapse is declined and discards only after confirmation', async () => {
        const { screen } = await mount(false);
        await screen.pressByTestIdAsync('saved-secret-add');
        await act(async () => screen.changeTextByTestId('saved-secret-create-name', 'Draft key'));
        const draft = screen.findAllByTestId('saved-secret-draft').find((node) => typeof node.props.onExpandedChange === 'function');
        await act(async () => draft?.props.onExpandedChange(false));
        expect(alert).toHaveBeenCalledOnce();
        const buttons = alert.mock.calls[0]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => buttons.find((button) => button.style === 'cancel')?.onPress?.());
        expect(screen.findByTestId('saved-secret-create-name')?.props.value).toBe('Draft key');
        await act(async () => draft?.props.onExpandedChange(false));
        const discardButtons = alert.mock.calls[1]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => discardButtons.find((button) => button.style === 'destructive')?.onPress?.());
        expect(screen.findByTestId('saved-secret-create-name')).toBeNull();
    });

    it.each([false, true])('settles a save whose catalog revision changed and leaves reload and cancel usable (lost response: %s)', async (dispatchThenFail) => {
        const { screen, scope, entries } = await mount();
        const response = createDeferred<void>();
        const path = '/v1/account/saved-secrets/resources/grants';
        harness.answer(scope.serverId, path, { body: { resourceId: 'secret-a', revision: 4 }, respondAfter: response.promise, dispatchThenFail });
        await screen.pressByTestIdAsync('saved-secret-access-save');
        await vi.waitFor(() => expect(harness.requestsFor(path)).toHaveLength(1));
        act(() => applySavedSecretCatalogPage({ scope, entries: [{ ...entries[0]!, revision: 4 }, entries[1]!], observedAt: 2 }));
        await act(async () => { response.resolve(); await response.promise; });
        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-reload')?.props.disabled).not.toBe(true));
        expect(screen.findByTestId('saved-secret-access-reload')).not.toBeNull();
        expect(screen.findByTestId('saved-secret-access-cancel')?.props.disabled).not.toBe(true);
        await screen.pressByTestIdAsync('saved-secret-access-reload');
        expect(screen.findByTestId('saved-secret-access-save')?.props.disabled).not.toBe(true);
        const navigate = vi.fn();
        await act(async () => { await runGuardedNavigation(navigate); });
        expect(navigate).toHaveBeenCalledOnce();
        expect(alert).not.toHaveBeenCalled();
    });

    it('keeps a dirty recipient draft until the person confirms switching to another secret', async () => {
        const { screen, entries } = await mount();
        await screen.pressByTestIdAsync(`saved-secret:${entries[1]!.ref}:header`);
        expect(alert).toHaveBeenCalledOnce();
        const buttons = alert.mock.calls[0]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => buttons.find((button) => button.style === 'cancel')?.onPress?.());
        // A is still editing and B's attempted expansion was declined.
        expect(screen.findByTestId(`saved-secret:${entries[1]!.ref}:manageAccess`)).toBeNull();
        expect(screen.findByTestId(`saved-secret:${entries[0]!.ref}:manageAccess`)).toBeNull();
        await screen.pressByTestIdAsync(`saved-secret:${entries[1]!.ref}:header`);
        const discardButtons = alert.mock.calls[1]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => discardButtons.find((button) => button.style === 'destructive')?.onPress?.());
        expect(screen.findByTestId(`saved-secret:${entries[1]!.ref}:manageAccess`)).not.toBeNull();
        await screen.pressByTestIdAsync(`saved-secret:${entries[1]!.ref}:manageAccess`);
        expect(screen.findByTestId(`saved-secret:${entries[1]!.ref}:manageAccess`)).toBeNull();
        // The replacement starts clean; the same canonical guard also covers global navigation.
        const navigate = vi.fn();
        await act(async () => { await runGuardedNavigation(navigate); });
        expect(navigate).toHaveBeenCalledOnce();
    });

    it('keeps a typed name when switching editor is declined, then retires it before access opens', async () => {
        const { screen, entries } = await mount(false);
        const ref = entries[0]!.ref;
        await screen.pressByTestIdAsync(`saved-secret:${ref}:header`);
        await screen.pressByTestIdAsync(`saved-secret:${ref}:rename`);
        await act(async () => screen.changeTextByTestId(`saved-secret:${ref}:edit-input`, 'Unsaved name'));
        await screen.pressByTestIdAsync(`saved-secret:${ref}:manageAccess`);
        expect(alert).toHaveBeenCalledOnce();
        const buttons = alert.mock.calls[0]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => buttons.find((button) => button.style === 'cancel')?.onPress?.());
        expect(screen.findByTestId(`saved-secret:${ref}:edit-input`)?.props.value).toBe('Unsaved name');
        expect(screen.findByTestId('saved-secret-access-save')).toBeNull();
        await screen.pressByTestIdAsync(`saved-secret:${ref}:manageAccess`);
        const discard = alert.mock.calls[1]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => discard.find((button) => button.style === 'destructive')?.onPress?.());
        expect(screen.findByTestId(`saved-secret:${ref}:edit-input`)).toBeNull();
        expect(screen.findByTestId('saved-secret-access-save')).not.toBeNull();
    });
});
