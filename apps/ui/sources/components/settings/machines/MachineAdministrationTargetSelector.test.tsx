import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import {
    resolveMachineAdministrationTargetState,
    type MachineAdministrationCandidateV1,
} from '@/sync/domains/machines/administration/targetSelection';
import type { MachineAdministrationTargetSelectionV1 } from '@/sync/domains/machines/administration/useTargetSelection';
import { clearActiveUnsavedChangesGuard, setActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';

import { installNewSessionComponentsCommonModuleMocks } from '../../sessions/new/components/newSessionComponentsTestHelpers';

installNewSessionComponentsCommonModuleMocks({
    storage: (importOriginal) => importOriginal(),
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
});

function createSelection(availability: MachineAdministrationCandidateV1['availability'] = 'online', observation: 'live' | 'stale' = 'live') {
    const target = { serverIdentityId: 'portable-server-b', machineId: 'machine-b' };
    const candidate: MachineAdministrationCandidateV1 = {
        target, displayName: 'Machine B', serverLabel: 'Server B', availability, observation, observedAt: 100,
    };
    const machine: MachineDisplayRenderable = {
        id: target.machineId, updatedAt: 100, active: availability === 'online',
        activeAt: 100, metadataVersion: 1, metadata: { displayName: 'Machine B', host: 'host-b' },
    };
    const selectTarget = vi.fn();
    const clearTarget = vi.fn();
    const state = resolveMachineAdministrationTargetState({ storedTarget: target, candidates: [candidate] });
    const selection: MachineAdministrationTargetSelectionV1 = {
        candidates: [candidate],
        pickerRows: [{ candidate, serverId: 'local-profile-b', serverName: 'Server B', machine }],
        state,
        selectedTarget: target,
        selectedTargetServerMatchesActiveAccount: false,
        canExecute: state.kind === 'online',
        selectTarget,
        clearTarget,
        resolveExecutionTarget: () => null,
    };
    return { selection, selectTarget, clearTarget };
}

afterEach(clearActiveUnsavedChangesGuard);

describe('MachineAdministrationTargetSelector', () => {
    it('opens the real picker on demand and preserves the exact portable target on selection', async () => {
        const { MachineAdministrationTargetSelector } = await import('./MachineAdministrationTargetSelector');
        const { selection, selectTarget } = createSelection();
        const screen = await renderScreen(<MachineAdministrationTargetSelector selection={selection} testIDPrefix="administration.target" />);
        const option = 'administration.target.picker-option:machine-b';
        expect(screen.findHostByTestId(option)).toBeNull();
        await screen.pressByTestIdAsync('administration.target.current');
        expect(screen.findHostByTestId(option)).not.toBeNull();
        expect(selectTarget).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync(option);
        expect(selectTarget).toHaveBeenCalledWith({ serverIdentityId: 'portable-server-b', machineId: 'machine-b' });
        expect(screen.findHostByTestId(option)).toBeNull();
    });

    it('preserves the draft and open picker when the real unsaved-change guard rejects a target change', async () => {
        const { MachineAdministrationTargetSelector } = await import('./MachineAdministrationTargetSelector');
        const { selection, selectTarget } = createSelection();
        setActiveUnsavedChangesGuard({
            isDirtyRef: { current: true }, requestDecision: async () => 'keepEditing', tag: 'target-test',
        });
        const screen = await renderScreen(<MachineAdministrationTargetSelector selection={selection} testIDPrefix="administration.target" />);
        await screen.pressByTestIdAsync('administration.target.current');
        await screen.pressByTestIdAsync('administration.target.picker-option:machine-b');
        expect(selectTarget).not.toHaveBeenCalled();
        expect(screen.findHostByTestId('administration.target.picker-option:machine-b')).not.toBeNull();
    });

    it.each(['offline', 'locked', 'missing', 'replaced', 'revoked'] as const)('keeps the %s target visible and unavailable in the real picker', async (availability) => {
        const { MachineAdministrationTargetSelector } = await import('./MachineAdministrationTargetSelector');
        const { selection, selectTarget, clearTarget } = createSelection(availability);
        const screen = await renderScreen(<MachineAdministrationTargetSelector selection={selection} testIDPrefix="administration.target" />);
        const current = screen.findHostByTestId('administration.target.current');
        expect(current?.props.accessibilityLabel ?? current?.props['aria-label']).toContain('Machine B');
        const reason = availability === 'offline' ? 'settingsProviders.detail.machineOffline' : 'settingsPlugins.targetSelection.' + availability;
        expect(current?.props.accessibilityLabel ?? current?.props['aria-label']).toContain(reason);
        await screen.pressByTestIdAsync('administration.target.current');
        const option = screen.findHostByTestId('administration.target.picker-option:machine-b');
        expect(option?.props.disabled ?? option?.props.accessibilityState?.disabled ?? option?.props['aria-disabled']).toBe(true);
        expect(selectTarget).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('administration.target.clear');
        expect(clearTarget).toHaveBeenCalledOnce();
        expect(selectTarget).not.toHaveBeenCalled();
    });

    it('does not allow a stale online snapshot to become an execution target', async () => {
        const { MachineAdministrationTargetSelector } = await import('./MachineAdministrationTargetSelector');
        const { selection, selectTarget } = createSelection('online', 'stale');
        const screen = await renderScreen(<MachineAdministrationTargetSelector selection={selection} testIDPrefix="administration.target" />);
        await screen.pressByTestIdAsync('administration.target.current');
        const option = screen.findHostByTestId('administration.target.picker-option:machine-b');
        expect(option?.props.disabled ?? option?.props.accessibilityState?.disabled ?? option?.props['aria-disabled']).toBe(true);
        expect(selectTarget).not.toHaveBeenCalled();
    });

    it('lets a consuming domain keep an offline eligible machine selectable while disabling update-required with its reason', async () => {
        const { MachineAdministrationTargetSelector } = await import('./MachineAdministrationTargetSelector');
        const offline = createSelection('offline');
        const screen = await renderScreen(
            <MachineAdministrationTargetSelector
                selection={offline.selection}
                testIDPrefix="broker.target"
                resolveCandidateAvailability={(candidate) => candidate.availability === 'offline'
                    ? { detail: 'offline but selectable', selectable: true }
                    : { detail: 'update required', selectable: false }}
                resolveCandidatePresentation={() => ({ title: 'Safe machine name', subtitle: 'Server B' })}
            />,
        );

        await screen.pressByTestIdAsync('broker.target.current');
        const option = screen.findHostByTestId('broker.target.picker-option:machine-b');
        expect(option?.props.disabled ?? option?.props.accessibilityState?.disabled).not.toBe(true);
        expect(`${String(option?.props.title)} ${String(option?.props.subtitle)}`).not.toContain('machine-b');
        await screen.pressByTestIdAsync('broker.target.picker-option:machine-b');
        expect(offline.selectTarget).toHaveBeenCalledWith({ serverIdentityId: 'portable-server-b', machineId: 'machine-b' });
    });

    it('closes a controlled picker without changing the selected draft', async () => {
        const { MachineAdministrationTargetSelector } = await import('./MachineAdministrationTargetSelector');
        const { selection, selectTarget } = createSelection();
        const screen = await renderScreen(
            <MachineAdministrationTargetSelector selection={selection} testIDPrefix="broker.target" />,
        );

        await screen.pressByTestIdAsync('broker.target.current');
        expect(screen.findHostByTestId('broker.target.picker-option:machine-b')).not.toBeNull();
        await screen.pressByTestIdAsync('broker.target.current');
        expect(screen.findHostByTestId('broker.target.picker-option:machine-b')).toBeNull();
        expect(selectTarget).not.toHaveBeenCalled();
        expect(screen.findHostByTestId('broker.target.current')?.props.accessibilityLabel).toContain('Machine B');
    });

    it('lets a consuming domain suppress opaque ids for a selected target missing from canonical inventory', async () => {
        const { MachineAdministrationTargetSelector } = await import('./MachineAdministrationTargetSelector');
        const fixture = createSelection();
        const target = fixture.selection.selectedTarget!;
        const selection: MachineAdministrationTargetSelectionV1 = {
            ...fixture.selection,
            candidates: [],
            pickerRows: [],
            state: resolveMachineAdministrationTargetState({ storedTarget: target, candidates: [] }),
        };
        const screen = await renderScreen(
            <MachineAdministrationTargetSelector
                selection={selection}
                testIDPrefix="broker.target"
                missingTargetTitle="Unavailable Machine"
                missingTargetSubtitle={null}
            />,
        );

        const current = screen.findHostByTestId('broker.target.current');
        const presentation = `${String(current?.props.title)} ${String(current?.props.subtitle)} ${String(current?.props.accessibilityLabel)}`;
        expect(presentation).toContain('Unavailable Machine');
        expect(presentation).not.toContain(target.machineId);
        expect(presentation).not.toContain(target.serverIdentityId);
    });
});
