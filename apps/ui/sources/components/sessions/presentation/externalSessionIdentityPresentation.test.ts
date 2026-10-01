import { describe, expect, it } from 'vitest';

import {
    resolveExternalSessionBrowseCandidateIdentityPresentation,
    resolveExternalSessionIdentityPresentation,
} from './externalSessionIdentityPresentation';

describe('resolveExternalSessionIdentityPresentation', () => {
    it('owns Browse candidate title, identity, and home-relative path presentation', () => {
        expect(resolveExternalSessionBrowseCandidateIdentityPresentation({
            remoteSessionId: 'native-session-1',
            title: '  Improve browse UX  ',
            path: '/Users/alice/projects/happier',
            homeDir: '/Users/alice',
            agentLabel: 'Codex',
            machineLabel: 'MacBook Pro',
        })).toEqual({
            title: 'Improve browse UX',
            pathLabel: '~/projects/happier',
            identityLabel: 'Codex · MacBook Pro',
            threadLabel: null,
            secondaryLabel: 'Codex · MacBook Pro · ~/projects/happier',
        });

        expect(resolveExternalSessionBrowseCandidateIdentityPresentation({
            remoteSessionId: 'native-session-2',
            title: 'native-session-2',
            path: 'C:\\Users/alice\\projects/happier',
            homeDir: 'C:\\Users\\alice',
            agentLabel: 'Codex',
            machineLabel: 'Windows PC',
        })).toEqual({
            // No title of its own: named like any untitled session, with its project as the hint.
            title: 'Untitled session',
            pathLabel: '~/projects/happier',
            identityLabel: 'Codex · Windows PC',
            threadLabel: null,
            secondaryLabel: 'Codex · Windows PC · ~/projects/happier',
        });
    });

    it('never makes a raw session id the title: an id-shaped title reads as untitled, hinted by a short id suffix', () => {
        expect(resolveExternalSessionBrowseCandidateIdentityPresentation({
            remoteSessionId: '01a0e20b-bc71-7101-bf10-b9dc423c85c1',
            title: '01a0e20b-bc71-7101-bf10-b9dc423c85c1',
            path: null,
            agentLabel: 'Codex',
            machineLabel: 'MacBook Pro',
        })).toMatchObject({
            title: 'Untitled session',
            secondaryLabel: 'Codex · MacBook Pro · …3c85c1',
        });
        // Another thread's id as the title (a sub-agent's parent) is still an id, not a name.
        expect(resolveExternalSessionBrowseCandidateIdentityPresentation({
            remoteSessionId: 'thread-a',
            title: '01a0e233-5d3d-7c62-a12f-58b5ed998f96',
            path: '/Users/alice/work/api',
            homeDir: '/Users/alice',
        }).title).toBe('Untitled session');
    });

    it('labels an internal thread by kind and, when its title is known, by its parent', () => {
        expect(resolveExternalSessionBrowseCandidateIdentityPresentation({
            remoteSessionId: 'thread-a',
            title: 'Review the migration',
            path: '/Users/alice/work/api',
            homeDir: '/Users/alice',
            agentLabel: 'Codex',
            thread: { kind: 'reviewer', parentRemoteSessionId: 'parent-a', parentTitle: 'Ship the API' },
        })).toMatchObject({
            title: 'Review the migration',
            threadLabel: 'Reviewer of Ship the API',
            secondaryLabel: 'Reviewer of Ship the API · Codex · ~/work/api',
        });
        // An unknown or id-shaped parent title names only the kind.
        expect(resolveExternalSessionBrowseCandidateIdentityPresentation({
            remoteSessionId: 'thread-b',
            path: null,
            thread: {
                kind: 'subagent',
                parentRemoteSessionId: '01a0e233-5d3d-7c62-a12f-58b5ed998f96',
                parentTitle: '01a0e233-5d3d-7c62-a12f-58b5ed998f96',
            },
        }).threadLabel).toBe('Sub-agent');
        expect(resolveExternalSessionBrowseCandidateIdentityPresentation({
            remoteSessionId: 'top-level',
            path: null,
        }).threadLabel).toBeNull();
    });

    it('omits the machine from shared identity only for the exact current machine', () => {
        expect(resolveExternalSessionIdentityPresentation({
            host: 'MacBook Pro',
            externalSessionV1: {
                v: 1,
                agentId: 'codex',
                machineId: 'machine-a',
                remoteSessionId: 'native-session-1',
                source: {
                    kind: 'codexHome',
                    home: 'user',
                    homePath: '/Users/test/.codex',
                },
            },
        }, 'machine-a', (key) => key)).toEqual({
            agentId: 'codex',
            agentLabel: 'Codex',
            machineLabel: 'MacBook Pro',
            storageLabel: 'sessionsList.storageExternalFilter',
            identityLabel: 'Codex',
            rowMetadataLabel: 'sessionsList.storageExternalFilter · Codex',
        });
    });

    it.each([
        ['another machine', 'machine-b'],
        ['a whitespace-different machine identity', ' machine-a '],
        ['missing current-machine identity', null],
        ['malformed current-machine identity', { id: 'machine-a' }],
    ])('keeps the machine for %s', (_name, currentMachineId) => {
        const presentation = resolveExternalSessionIdentityPresentation({
            host: 'MacBook Pro',
            externalSessionV1: {
                v: 1,
                agentId: 'codex',
                machineId: 'machine-a',
                remoteSessionId: 'native-session-1',
                source: {
                    kind: 'codexHome',
                    home: 'user',
                    homePath: '/Users/test/.codex',
                },
            },
        }, currentMachineId, (key) => key);

        expect(presentation).toMatchObject({
            identityLabel: 'Codex · MacBook Pro',
            rowMetadataLabel: 'sessionsList.storageExternalFilter · Codex · MacBook Pro',
        });
    });

    it('does not suppress an other-machine label merely because it equals the Agent label', () => {
        expect(resolveExternalSessionIdentityPresentation({
            host: 'Codex',
            externalSessionV1: {
                v: 1,
                agentId: 'codex',
                machineId: 'machine-a',
                remoteSessionId: 'native-session-1',
                source: { kind: 'customArchive' },
            },
        }, 'machine-b', (key) => key)).toMatchObject({
            identityLabel: 'Codex · Codex',
            rowMetadataLabel: 'sessionsList.storageExternalFilter · Codex · Codex',
        });
    });

    it('keeps hosted identity on the same presentation owner', () => {
        expect(resolveExternalSessionIdentityPresentation({
            host: 'MacBook Pro',
        }, 'machine-a', (key) => key)).toEqual({
            agentId: null,
            agentLabel: null,
            machineLabel: null,
            storageLabel: 'sessionsList.storagePersistedTab',
            identityLabel: null,
            rowMetadataLabel: null,
        });
    });

    it('fails closed for malformed external-session metadata', () => {
        expect(resolveExternalSessionIdentityPresentation({
            host: 'MacBook Pro',
            externalSessionV1: {
                v: 1,
                agentId: 'codex',
                machineId: '',
                remoteSessionId: 'native-session-1',
                source: { kind: 'customArchive' },
            },
        }, 'machine-a', (key) => key)).toEqual({
            agentId: null,
            agentLabel: null,
            machineLabel: null,
            storageLabel: 'sessionsList.storagePersistedTab',
            identityLabel: null,
            rowMetadataLabel: null,
        });
    });

    it('formats an opaque projected Agent id without consulting the static Agent core', () => {
        expect(resolveExternalSessionIdentityPresentation({
            host: 'Remote host',
            externalSessionV1: {
                v: 1,
                agentId: 'customAcp',
                machineId: 'machine-a',
                remoteSessionId: 'native-session-1',
                source: { kind: 'customArchive' },
            },
        }, 'machine-b', (key) => key)).toMatchObject({
            agentId: 'customAcp',
            agentLabel: 'Custom Acp',
            identityLabel: 'Custom Acp · Remote host',
            rowMetadataLabel: 'sessionsList.storageExternalFilter · Custom Acp · Remote host',
        });
    });
});
