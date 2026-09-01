import { describe, expect, it } from 'vitest';

import { buildRemoteSshManageHostSystemTaskSpec } from './buildRemoteSshManageHostSystemTaskSpec';

describe('buildRemoteSshManageHostSystemTaskSpec', () => {
    it('builds a relocation task with only the exact runtime and opaque destination facts', () => {
        const spec = buildRemoteSshManageHostSystemTaskSpec({
            action: 'personalHome.relocate',
            channel: 'preview',
            sshTarget: 'ops@destination.test',
            sshAuth: 'agent',
            relayRuntime: { channel: 'preview', mode: 'user' },
            personalHomeRelocation: {
                operationId: 'relocation-1',
                destinationMachineId: 'managed-host-1',
                sourceDescriptorRevision: 7,
            },
        });

        expect(spec).toMatchObject({
            kind: 'remote.ssh.manageHost.v1',
            params: {
                action: 'personalHome.relocate',
                channel: 'preview',
                relayRuntime: { channel: 'preview', mode: 'user' },
                personalHomeRelocation: {
                    operationId: 'relocation-1',
                    destinationMachineId: 'managed-host-1',
                    sourceDescriptorRevision: 7,
                },
            },
        });
        expect(spec.params).not.toHaveProperty('destinationDataDir');
    });

    it('preserves the coordinator-selected recovery action without adding a second task kind', () => {
        const spec = buildRemoteSshManageHostSystemTaskSpec({
            action: 'personalHome.relocate',
            channel: 'preview',
            sshTarget: 'ops@destination.test',
            sshAuth: 'agent',
            relayRuntime: { channel: 'preview', mode: 'user' },
            personalHomeRelocation: {
                operationId: 'relocation-1',
                destinationMachineId: 'managed-host-1',
                sourceDescriptorRevision: 7,
                recoveryAction: 'finish_move',
            },
        });

        expect(spec).toMatchObject({
            kind: 'remote.ssh.manageHost.v1',
            params: {
                action: 'personalHome.relocate',
                personalHomeRelocation: {
                    operationId: 'relocation-1',
                    destinationMachineId: 'managed-host-1',
                    sourceDescriptorRevision: 7,
                    recoveryAction: 'finish_move',
                },
            },
        });
    });
});
