import { describe, expect, it } from 'vitest';

import {
    applyMachineAdministrationSelectionMutationToAccountSettings,
    clearMachineAdministrationTargetPreference,
    setMachineAdministrationTargetPreference,
    setPluginMachineExecutionOriginPreference,
} from './selectionPreferences';

describe('machine administration selection preferences', () => {
    it('updates one device-local target entry without dropping another target', () => {
        const current = {
            agents: { serverIdentityId: 'srv_one', machineId: 'machine-a' },
        };

        expect(setMachineAdministrationTargetPreference(
            current,
            'plugins.home',
            { serverIdentityId: 'srv_two', machineId: 'machine-b' },
        )).toEqual({
            ...current,
            'plugins.home': { serverIdentityId: 'srv_two', machineId: 'machine-b' },
        });
    });

    it('updates and clears only the named entry through the domain schema', () => {
        const withTarget = setMachineAdministrationTargetPreference(
            {},
            'plugins.home',
            { serverIdentityId: 'srv_one', machineId: 'machine-a' },
        );
        expect(clearMachineAdministrationTargetPreference(withTarget, 'plugins.home')).toEqual({});
    });

    it('rejects device-local profile ids before they can enter Account settings', () => {
        expect(() => setMachineAdministrationTargetPreference(
            {},
            'plugins.home',
            { serverIdentityId: 'profile-local-1', machineId: 'machine-a' },
        )).toThrow();
    });

    it('replays a named mutation without dropping a concurrent Account Settings winner', () => {
        const next = applyMachineAdministrationSelectionMutationToAccountSettings({
            unrelatedRoot: { preserved: true },
            machineAdministrationSelectionsV1: {
                v: 1,
                pluginExecutionOriginsByPluginId: {
                    'other.plugin': {
                        serverIdentityId: 'srv_one',
                        materializationRef: {
                            machineId: 'machine-a',
                            materializationId: 'mat-other',
                            pluginId: 'other.plugin',
                        },
                    },
                },
            },
        }, (current) => setPluginMachineExecutionOriginPreference(
            current,
            'acme.plugin',
            { serverIdentityId: 'srv_two', materializationRef: {
                machineId: 'machine-b', materializationId: 'mat-b', pluginId: 'acme.plugin',
            } },
        ));

        expect(next).toEqual({
            unrelatedRoot: { preserved: true },
            machineAdministrationSelectionsV1: {
                v: 1,
                pluginExecutionOriginsByPluginId: {
                    'acme.plugin': { serverIdentityId: 'srv_two', materializationRef: {
                        machineId: 'machine-b', materializationId: 'mat-b', pluginId: 'acme.plugin',
                    } },
                    'other.plugin': {
                        serverIdentityId: 'srv_one',
                        materializationRef: {
                            machineId: 'machine-a',
                            materializationId: 'mat-other',
                            pluginId: 'other.plugin',
                        },
                    },
                },
            },
        });
    });
});
