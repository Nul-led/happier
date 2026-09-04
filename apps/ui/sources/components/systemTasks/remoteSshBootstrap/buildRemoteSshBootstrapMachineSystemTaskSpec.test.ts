import { describe, expect, it } from 'vitest';
import { parseRemoteBootstrapMachineParams } from '@happier-dev/cli-common/systemTasks';
import { resolveHomeTargetFromDescriptor } from '@happier-dev/cli-common/homeTarget';

import { buildRemoteSshBootstrapMachineSystemTaskSpec } from './buildRemoteSshBootstrapMachineSystemTaskSpec';

describe('buildRemoteSshBootstrapMachineSystemTaskSpec', () => {
    it('respects serviceMode=none', () => {
        const spec = buildRemoteSshBootstrapMachineSystemTaskSpec({
            relayUrl: 'http://localhost:53288',
            channel: 'stable',
            sshAuth: 'agent',
            sshUsername: 'root',
            sshHost: 'example.com',
            serviceMode: 'none',
        });

        const params = spec.params as Record<string, unknown>;
        expect(params.serviceMode).toBe('none');
        expect(params.channel).toBe('stable');
    });

    it('emits a canonical Home target that the remote task parser retains', () => {
        const homeTarget = resolveHomeTargetFromDescriptor({
            authority: 'current_connection',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_ui_home',
                canonicalServerUrl: 'https://home.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
            },
        });
        const spec = buildRemoteSshBootstrapMachineSystemTaskSpec({
            relayUrl: 'https://home.example.test',
            homeTarget,
            channel: 'dev',
            sshAuth: 'agent',
            sshUsername: 'dev',
            sshHost: 'remote.example.test',
        });

        expect(parseRemoteBootstrapMachineParams(spec.params).homeTarget).toEqual(homeTarget);
    });
});
