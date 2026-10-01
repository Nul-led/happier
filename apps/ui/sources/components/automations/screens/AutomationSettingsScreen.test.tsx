import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderScreen } from '@/dev/testkit';
import { createPassThroughComponent, createPassThroughModule } from '@/dev/testkit/mocks/components';

import { installAutomationScreensCommonModuleMocks } from './automationScreensTestHelpers';

const syncSpies = vi.hoisted(() => ({
    getAutomationSettings: vi.fn(),
    updateAutomationSettings: vi.fn(),
}));
const modalPromptSpy = vi.hoisted(() => vi.fn());
const modalAlertSpy = vi.hoisted(() => vi.fn());
const activeAccountState = vi.hoisted(() => ({
    scope: { serverId: 'server-1', accountId: 'account-a' } as { serverId: string; accountId: string } | null,
    lifetime: null as null | Readonly<{
        scope: { serverId: string; accountId: string };
        isCurrent: () => boolean;
        onRetire: (cancel: () => void) => Readonly<{ dispose(): void }>;
    }>,
}));

function installActiveAccount(accountId: string) {
    const scope = { serverId: 'server-1', accountId };
    let current = true;
    const retirementCallbacks = new Set<() => void>();
    const lifetime = {
        scope,
        isCurrent: () => current,
        onRetire: (cancel: () => void) => {
            retirementCallbacks.add(cancel);
            return { dispose: () => retirementCallbacks.delete(cancel) };
        },
    };
    activeAccountState.scope = scope;
    activeAccountState.lifetime = lifetime;
    return {
        retire() {
            current = false;
            for (const callback of retirementCallbacks) callback();
            retirementCallbacks.clear();
        },
    };
}

installAutomationScreensCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                prompt: modalPromptSpy,
                alert: modalAlertSpy,
            },
        }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useActiveServerAccountScope: () => activeAccountState.scope,
        });
    },
});

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => activeAccountState.lifetime,
}));

vi.mock('@/sync/sync', () => ({ sync: syncSpies }));
vi.mock('@/components/ui/lists/Item', () => createPassThroughModule(['Item']));
vi.mock('@/components/ui/lists/ItemGroup', () => createPassThroughModule(['ItemGroup']));
vi.mock('@/components/ui/lists/ItemList', () => createPassThroughModule(['ItemList']));
vi.mock('@/components/ui/forms/Switch', () => createPassThroughModule(['Switch']));
vi.mock('@/components/ui/surfaces/SurfaceStateCard', () => ({
    SurfaceStateCard: createPassThroughComponent('SurfaceStateCard'),
}));

/** The limit's field: the `rightElement` the `FieldValueItem` row hands to `Item` (a pass-through here). */
function maxActiveRunsField(screen: { root: { findAll: (predicate: (node: any) => boolean) => any[] } }): React.ReactElement<Record<string, any>> {
    const row = screen.root.findAll((node) => node.props?.testID === 'automation-settings-max-active-runs' && node.props?.rightElement)[0];
    return row.props.rightElement as React.ReactElement<Record<string, any>>;
}

describe('AutomationSettingsScreen', () => {
    beforeEach(() => {
        installActiveAccount('account-a');
        syncSpies.getAutomationSettings.mockReset();
        syncSpies.getAutomationSettings.mockResolvedValue({
            maxActiveRunsPerMachine: 4,
            runRetention: 'thirtyDays',
        });
        syncSpies.updateAutomationSettings.mockReset();
        syncSpies.updateAutomationSettings.mockImplementation(async (settings) => settings);
        modalPromptSpy.mockReset();
        modalPromptSpy.mockResolvedValue('2');
        modalAlertSpy.mockReset();
    });

    it('loads the server settings projection and applies both controls through the canonical Sync owner', async () => {
        const { AutomationSettingsScreen } = await import('./AutomationSettingsScreen');

        const screen = await renderScreen(<AutomationSettingsScreen />);
        await flushHookEffects();

        expect(syncSpies.getAutomationSettings).toHaveBeenCalledOnce();
        // The limit is typed in place (no prompt) and commits on blur through the same writer.
        const field = () => maxActiveRunsField(screen);
        expect(field().props.value).toBe('4');

        await act(async () => {
            field().props.onChangeText('2');
        });
        await act(async () => {
            field().props.onBlur();
            await Promise.resolve();
        });

        expect(modalPromptSpy).not.toHaveBeenCalled();
        expect(syncSpies.updateAutomationSettings).toHaveBeenCalledWith({
            maxActiveRunsPerMachine: 2,
            runRetention: 'thirtyDays',
        });

        // The row renders through its search declaration (`SettingRow`), which hands its props to `Item`.
        const retentionItem = screen.root.findAll((node) => node.props?.testID === 'automation-settings-run-retention' && node.props?.rightElement)[0]!;
        const retentionSwitch = retentionItem.props.rightElement as React.ReactElement<{ onValueChange: (value: boolean) => void }>;
        await act(async () => {
            retentionSwitch.props.onValueChange(true);
            await Promise.resolve();
        });

        expect(syncSpies.updateAutomationSettings).toHaveBeenLastCalledWith({
            maxActiveRunsPerMachine: 2,
            runRetention: 'keepForever',
        });
    });

    it('refuses a limit the settings contract rejects, says why in place, and keeps the saved value', async () => {
        const { AutomationSettingsScreen } = await import('./AutomationSettingsScreen');

        const screen = await renderScreen(<AutomationSettingsScreen />);
        await flushHookEffects();
        const field = () => maxActiveRunsField(screen);

        await act(async () => {
            field().props.onChangeText('0');
        });
        await act(async () => {
            field().props.onSubmitEditing();
            await Promise.resolve();
        });

        expect(syncSpies.updateAutomationSettings).not.toHaveBeenCalled();
        expect(field().props.error).toBe('automations.settings.maxActiveRunsPerMachineInvalid');
        expect(field().props.value).toBe('0');

        // Correcting the draft clears the refusal before anything is written.
        await act(async () => {
            field().props.onChangeText('3');
        });
        expect(field().props.error).toBeNull();
    });

    it('retires stale Account work and reloads settings for the newly active Account', async () => {
        const accountASettings = createDeferred<{ maxActiveRunsPerMachine: number; runRetention: 'thirtyDays' }>();
        const accountBSettings = { maxActiveRunsPerMachine: 2, runRetention: 'keepForever' as const };
        syncSpies.getAutomationSettings
            .mockReset()
            .mockReturnValueOnce(accountASettings.promise)
            .mockResolvedValueOnce(accountBSettings);
        const accountA = installActiveAccount('account-a');
        const { AutomationSettingsScreen } = await import('./AutomationSettingsScreen');

        const screen = await renderScreen(<AutomationSettingsScreen />);
        await flushHookEffects();
        expect(syncSpies.getAutomationSettings).toHaveBeenCalledTimes(1);

        accountA.retire();
        installActiveAccount('account-b');
        await screen.update(<AutomationSettingsScreen />);
        await flushHookEffects();

        expect(syncSpies.getAutomationSettings).toHaveBeenCalledTimes(2);
        expect(maxActiveRunsField(screen).props.value).toBe('2');

        accountASettings.resolve({ maxActiveRunsPerMachine: 9, runRetention: 'thirtyDays' });
        await act(async () => {
            await accountASettings.promise;
            await Promise.resolve();
        });
        expect(maxActiveRunsField(screen).props.value).toBe('2');
    });
});
