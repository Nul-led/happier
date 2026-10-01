import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { createMachineFixture, renderHook, standardCleanup } from '@/dev/testkit';
import {
    removeServerProfile,
    setServerProfileIdentityForUrl,
    upsertServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storageStore';

import { MACHINE_ADMINISTRATION_SELECTION_KEYS_V1 } from './selectionPreferences';
import { useMachineAdministrationExecutionTargetBinding } from './useExecutionTargetBinding';
import { useMachineAdministrationTargetSelection } from './useTargetSelection';

afterEach(() => {
    standardCleanup();
});

describe('machine administration target demand', () => {
    it('uses this device target independently of the Account policy document', async () => {
        const previous = storage.getState();
        const local = { serverIdentityId: 'srv_one', machineId: 'local-machine' };
        try {
            storage.setState((state) => ({ settings: {
                ...state.settings,
                machineAdministrationTargetsLocalV1: { agents: local },
                machineAdministrationSelectionsV1: {
                    v: 1, pluginExecutionOriginsByPluginId: {},
                },
            } }));
            const hook = await renderHook(() => useMachineAdministrationTargetSelection('agents', {
                enabled: false, allowSoleCandidate: false,
            }));
            expect(hook.getCurrent().selectedTarget).toEqual(local);
            await act(async () => storage.setState((state) => ({ settings: {
                ...state.settings, machineAdministrationTargetsLocalV1: {},
            } })));
            expect(hook.getCurrent().selectedTarget).toBeNull();
            await hook.unmount();
        } finally { storage.setState(previous); }
    });

    it('rejects captured work after exact selection, daemon lifetime, or live inventory changes', async () => {
        const previousState = storage.getState();
        const serverUrl = 'https://administration-currentness.example.test';
        await upsertServerProfile({ serverUrl, name: 'Administration currentness' });
        const profile = await setServerProfileIdentityForUrl(serverUrl, 'srv_administration_currentness');
        if (!profile) throw new Error('Test profile was not created');
        const selectionKey = MACHINE_ADMINISTRATION_SELECTION_KEYS_V1.promptAssets;
        const targetA = { serverIdentityId: profile.serverIdentityId!, machineId: 'machine-a' };
        const targetB = { serverIdentityId: profile.serverIdentityId!, machineId: 'machine-b' };
        const machineA = createMachineFixture({ id: targetA.machineId, activeAt: Date.now(), daemonStateVersion: 1 });
        const machineB = createMachineFixture({ id: targetB.machineId, activeAt: Date.now(), daemonStateVersion: 1 });

        try {
            storage.setState((state) => ({
                isDataReady: true,
                machineListByServerId: { [profile.id]: [machineA, machineB] },
                machineListStatusByServerId: { [profile.id]: 'idle' },
                settings: {
                    ...state.settings,
                    machineAdministrationTargetsLocalV1: { [selectionKey]: targetA },
                },
            }));
            const hook = await renderHook(
                ({ enabled }: { enabled: boolean }) => {
                    const selection = useMachineAdministrationTargetSelection(
                        selectionKey, { enabled, allowSoleCandidate: false },
                    );
                    return useMachineAdministrationExecutionTargetBinding(selection);
                },
                { initialProps: { enabled: true } },
            );
            const initialBinding = hook.getCurrent();
            const requestedSelection = initialBinding.selectionKey;
            const capturedA = initialBinding.resolveExactExecutionTarget(targetA);
            if (!capturedA) throw new Error('Initial target did not resolve');
            expect(capturedA.target).toEqual(targetA);
            expect(initialBinding.resolveExactExecutionTarget(targetB)).toBeNull();
            expect(initialBinding.resolveExactExecutionTarget({ ...targetA, serverIdentityId: 'another-server' })).toBeNull();
            expect(initialBinding.resolveExactExecutionTarget(null)).toBeNull();
            expect(initialBinding.isExecutionTargetCurrent(requestedSelection, capturedA)).toBe(true);

            for (const target of [targetB, targetA]) {
                await act(async () => {
                    storage.setState((state) => ({
                        settings: {
                            ...state.settings,
                            machineAdministrationTargetsLocalV1: { [selectionKey]: target },
                        },
                    }));
                });
                expect(initialBinding.resolveExactExecutionTarget(target)?.target).toEqual(target);
                expect(initialBinding.isSelectionCurrent(requestedSelection)).toBe(target === targetA);
                expect(initialBinding.isExecutionTargetCurrent(requestedSelection, capturedA)).toBe(false);
                expect(hook.getCurrent().resolveExactExecutionTarget).toBe(initialBinding.resolveExactExecutionTarget);
                expect(hook.getCurrent().isExecutionTargetCurrent).toBe(initialBinding.isExecutionTargetCurrent);
            }

            const returnedA = initialBinding.resolveExactExecutionTarget(targetA);
            if (!returnedA) throw new Error('Returned target did not resolve');
            expect(returnedA.selectionRevision).toBeGreaterThan(capturedA.selectionRevision ?? -1);
            await act(async () => {
                storage.setState({
                    machineListByServerId: {
                        [profile.id]: [{ ...machineA, daemonStateVersion: 2 }, machineB],
                    },
                });
            });
            expect(initialBinding.isExecutionTargetCurrent(requestedSelection, returnedA)).toBe(false);

            await act(async () => {
                storage.setState({ machineListStatusByServerId: { [profile.id]: 'loading' } });
            });
            expect(initialBinding.resolveExactExecutionTarget(targetA)).toBeNull();
            await act(async () => {
                storage.setState({ machineListStatusByServerId: { [profile.id]: 'idle' } });
            });
            expect(initialBinding.resolveExactExecutionTarget(targetA)?.machine.daemonStateVersion).toBe(2);
            await hook.rerender({ enabled: false });
            expect(initialBinding.resolveExactExecutionTarget(targetA)).toBeNull();
            await hook.unmount();
        } finally {
            storage.setState(previousState);
            await removeServerProfile(profile.id);
        }
    });

    it('suspends detailed inventory while idle and resumes with the current exact target', async () => {
        const previousState = storage.getState();
        const serverUrl = 'https://memory-demand.example.test';
        await upsertServerProfile({ serverUrl, name: 'Memory demand' });
        const profile = await setServerProfileIdentityForUrl(serverUrl, 'srv_memory_demand');
        if (!profile) throw new Error('Test profile was not created');
        const target = { serverIdentityId: 'srv_memory_demand', machineId: 'memory-machine' };
        const machine = createMachineFixture({ id: target.machineId, activeAt: Date.now() });
        const selectionKey = MACHINE_ADMINISTRATION_SELECTION_KEYS_V1.memory;

        try {
            storage.setState((state) => ({
                isDataReady: true,
                machineListByServerId: { [profile.id]: [machine] },
                machineListStatusByServerId: { [profile.id]: 'idle' },
                settings: {
                    ...state.settings,
                    machineAdministrationTargetsLocalV1: { [selectionKey]: target },
                },
            }));
            let renders = 0;
            const hook = await renderHook(({ enabled }: { enabled: boolean }) => {
                renders += 1;
                return useMachineAdministrationTargetSelection(selectionKey, { enabled, allowSoleCandidate: false });
            }, { initialProps: { enabled: true }, flushOptions: { cycles: 1, turns: 4 } });
            expect(hook.getCurrent().canExecute).toBe(true);
            expect(hook.getCurrent().resolveExecutionTarget()?.machine.id).toBe(machine.id);

            await hook.rerender({ enabled: false });
            const settledRenders = renders;
            const latest = { ...machine, updatedAt: 2, activeAt: Date.now() + 1 };
            await act(async () => {
                storage.setState({
                    machineListByServerId: { [profile.id]: [latest] },
                    machineListStatusByServerId: { [profile.id]: 'loading' },
                });
            });
            expect(renders).toBe(settledRenders);
            expect(hook.getCurrent().pickerRows).toEqual([]);
            expect(hook.getCurrent().canExecute).toBe(false);
            expect(hook.getCurrent().resolveExecutionTarget()).toBeNull();

            await act(async () => {
                storage.setState({ machineListStatusByServerId: { [profile.id]: 'idle' } });
            });
            await hook.rerender({ enabled: true });
            expect(hook.getCurrent().selectedTarget).toEqual(target);
            expect(hook.getCurrent().canExecute).toBe(true);
            expect(hook.getCurrent().resolveExecutionTarget()?.machine).toBe(latest);
            expect(hook.getCurrent().pickerRows[0]?.machine.updatedAt).toBe(2);
            await hook.unmount();
        } finally {
            storage.setState(previousState);
            await removeServerProfile(profile.id);
        }
    });
});
