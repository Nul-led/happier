import { afterEach, describe, expect, it, vi } from 'vitest';

import { installRepositoryScmCommonModuleMocks } from './repositoryScmTestHelpers';
import { createPartialStorageModuleMock } from '@/dev/testkit/mocks/storage';

const storageGetStateMock = vi.hoisted(() => vi.fn());

installRepositoryScmCommonModuleMocks({
    storage: async (importOriginal) => createPartialStorageModuleMock(importOriginal, {
        storage: {
            getState: storageGetStateMock,
        },
    }),
});

describe('resolveRepoScmMachinePathRequest', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('trims machine/path input and resolves tilde paths against the machine home directory', async () => {
        storageGetStateMock.mockReturnValue({
            machines: {
                'machine-a': {
                    id: 'machine-a',
                    metadata: {
                        homeDir: '/Users/tester',
                    },
                },
            },
        } as any);

        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');
        expect(resolveRepoScmMachinePathRequest({
            machineId: '  machine-a  ',
            path: '  ~/repo  ',
        })).toEqual({
            machineId: 'machine-a',
            resolvedPath: '/Users/tester/repo',
            repoIdentityPrefix: 'machine-a',
            repoIdentityKey: 'machine-a:/Users/tester/repo',
        });
    });

    it('returns null when machine or path is blank after trimming', async () => {
        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');

        expect(resolveRepoScmMachinePathRequest({
            machineId: '   ',
            path: '/repo',
        })).toBeNull();
        expect(resolveRepoScmMachinePathRequest({
            machineId: 'machine-a',
            path: '   ',
        })).toBeNull();
    });

    it('uses the explicitly selected Home and keeps identical machine ids in different servers distinct', async () => {
        storageGetStateMock.mockReturnValue({
            machines: {
                'machine-a': {
                    id: 'machine-a',
                    metadata: { homeDir: '/wrong-active-home' },
                },
            },
        } as any);

        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');
        const serverA = resolveRepoScmMachinePathRequest({
            serverId: 'server-a',
            machineId: 'machine-a',
            path: '~/repo',
            homeDir: '/Users/server-a',
        });
        const serverB = resolveRepoScmMachinePathRequest({
            serverId: 'server-b',
            machineId: 'machine-a',
            path: '~/repo',
            homeDir: '/Users/server-b',
        });

        expect(serverA?.resolvedPath).toBe('/Users/server-a/repo');
        expect(serverB?.resolvedPath).toBe('/Users/server-b/repo');
        expect(serverA?.repoIdentityKey).not.toBe(serverB?.repoIdentityKey);
    });

    it('does not fall back to the active server when the selected server is unresolved', async () => {
        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');
        expect(resolveRepoScmMachinePathRequest({
            serverId: null,
            machineId: 'machine-a',
            path: '/repo',
            homeDir: '/Users/server-a',
        })).toBeNull();
    });
});
