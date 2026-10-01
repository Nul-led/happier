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
        await screen.pressByTestIdAsync(`saved-secret:${entries[1]!.ref}:manageAccess`);
        expect(alert).toHaveBeenCalledOnce();
        const buttons = alert.mock.calls[0]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => buttons.find((button) => button.style === 'cancel')?.onPress?.());
        // A is still editing and B still offers Manage.
        expect(screen.findByTestId(`saved-secret:${entries[1]!.ref}:manageAccess`)).not.toBeNull();
        expect(screen.findByTestId(`saved-secret:${entries[0]!.ref}:manageAccess`)).toBeNull();
        await screen.pressByTestIdAsync(`saved-secret:${entries[1]!.ref}:manageAccess`);
        const discardButtons = alert.mock.calls[1]?.[2] as Array<{ style?: string; onPress?: () => void }>;
        await act(async () => discardButtons.find((button) => button.style === 'destructive')?.onPress?.());
        expect(screen.findByTestId(`saved-secret:${entries[0]!.ref}:manageAccess`)).not.toBeNull();
        expect(screen.findByTestId(`saved-secret:${entries[1]!.ref}:manageAccess`)).toBeNull();
        // The replacement starts clean; the same canonical guard also covers global navigation.
        const navigate = vi.fn();
        await act(async () => { await runGuardedNavigation(navigate); });
        expect(navigate).toHaveBeenCalledOnce();
    });
});
