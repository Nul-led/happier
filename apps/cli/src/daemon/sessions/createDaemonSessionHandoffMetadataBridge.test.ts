import { homedir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createDaemonSessionHandoffMetadataBridge } from './createDaemonSessionHandoffMetadataBridge';
import type { TrackedSession } from '../types';

describe('createDaemonSessionHandoffMetadataBridge', () => {
    it('resolves an attachment directory only for an exact currently hosted Happier Session', async () => {
        const tracked: TrackedSession = {
            startedBy: 'daemon', pid: 301, happySessionId: 'session-a', vendorResumeId: 'vendor-a',
            spawnOptions: {
                directory: '/repo-session-a',
                backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
                transcriptStorage: 'direct',
            },
        };
        const pidToTrackedSession = new Map([[tracked.pid, tracked]]);
        const bridge = createDaemonSessionHandoffMetadataBridge({ pidToTrackedSession, getMachineId: () => 'machine-a' });
        expect(bridge).toHaveProperty('resolveHostedSessionWorkingDirectory');
        // This owner gains the exact Session-only resolver before transfer consumers use it.
        const resolveDirectory = (bridge as unknown as Readonly<{
            resolveHostedSessionWorkingDirectory: (sessionId: string) => Promise<string | null>;
        }>).resolveHostedSessionWorkingDirectory;
        await expect(resolveDirectory('session-a')).resolves.toBe('/repo-session-a');
        await expect(resolveDirectory('vendor-a')).resolves.toBeNull();
        await expect(resolveDirectory('foreign-session')).resolves.toBeNull();
        pidToTrackedSession.delete(tracked.pid);
        await expect(resolveDirectory('session-a')).resolves.toBeNull();
    });

    it('reads the current machine id when loading current tracked-session metadata', async () => {
        let currentMachineId = 'machine-initial';
        const trackedSession: TrackedSession = {
            startedBy: 'daemon',
            pid: 101,
            happySessionId: 'sess-live-machine',
            vendorResumeId: 'vendor-live-machine',
            spawnOptions: {
                directory: '/repo-source-current',
                backendTarget: {
                    kind: 'backend',
                    backendId: 'claude',
                    sourceKind: 'built_in',
                },
                transcriptStorage: 'direct',
                environmentVariables: {
                    HOME: '/Users/target',
                    CLAUDE_CONFIG_DIR: '/tmp/claude-config',
                },
            },
        };

        const bridge = createDaemonSessionHandoffMetadataBridge({
            pidToTrackedSession: new Map([[trackedSession.pid, trackedSession]]),
            getMachineId: () => currentMachineId,
        });

        currentMachineId = 'machine-rotated';

        await expect(bridge.loadLocalSessionMetadataForHandoff('sess-live-machine')).resolves.toEqual({
            exportMetadata: {
                machineId: 'machine-rotated',
                path: '/repo-source-current',
                homeDir: homedir(),
                flavor: 'claude',
            },
        });

    });

    it('matches provider-only handoff ids exactly while keeping Happier id normalization', async () => {
        const opaqueVendorResumeId = ' provider-only-session\n';
        const opaqueSpawnResumeId = '\tspawn-only-session ';
        const providerOnlySession: TrackedSession = {
            startedBy: 'daemon',
            pid: 202,
            vendorResumeId: opaqueVendorResumeId,
            spawnOptions: {
                directory: '/repo-provider-only',
                backendTarget: {
                    kind: 'backend',
                    backendId: 'claude',
                    sourceKind: 'built_in',
                },
                transcriptStorage: 'direct',
                environmentVariables: {
                    HOME: '/Users/target',
                    CLAUDE_CONFIG_DIR: '/tmp/claude-config',
                },
            },
        };
        const happierIdentifiedSession: TrackedSession = {
            startedBy: 'daemon',
            pid: 203,
            happySessionId: 'happier-session-id',
            happySessionMetadataFromLocalWebhook: {
                machineId: 'machine-source',
                path: '/repo-happier-id',
                host: 'localhost',
                homeDir: '/Users/target',
                happyHomeDir: '/Users/target/.happier',
                happyLibDir: '/Users/target/.happier/lib',
                happyToolsDir: '/Users/target/.happier/tools',
                flavor: 'claude',
            },
        };
        const spawnResumeOnlySession: TrackedSession = {
            startedBy: 'daemon',
            pid: 204,
            spawnOptions: {
                directory: '/repo-spawn-resume-only',
                backendTarget: {
                    kind: 'backend',
                    backendId: 'claude',
                    sourceKind: 'built_in',
                },
                resume: opaqueSpawnResumeId,
                transcriptStorage: 'direct',
                environmentVariables: {
                    HOME: '/Users/target',
                    CLAUDE_CONFIG_DIR: '/tmp/claude-config',
                },
            },
        };
        const bridge = createDaemonSessionHandoffMetadataBridge({
            pidToTrackedSession: new Map([
                [providerOnlySession.pid, providerOnlySession],
                [happierIdentifiedSession.pid, happierIdentifiedSession],
                [spawnResumeOnlySession.pid, spawnResumeOnlySession],
            ]),
            getMachineId: () => 'machine-current',
        });
        await expect(bridge.loadLocalSessionMetadataForHandoff(opaqueVendorResumeId)).resolves.toEqual(
            expect.objectContaining({
                exportMetadata: expect.objectContaining({
                    path: '/repo-provider-only',
                }),
            }),
        );
        await expect(
            bridge.loadLocalSessionMetadataForHandoff(opaqueVendorResumeId.trim()),
        ).resolves.toBeNull();
        await expect(bridge.loadLocalSessionMetadataForHandoff(' \n\t ')).resolves.toBeNull();
        await expect(
            bridge.loadLocalSessionMetadataForHandoff(opaqueSpawnResumeId),
        ).resolves.toEqual(
            expect.objectContaining({
                exportMetadata: expect.objectContaining({
                    path: '/repo-spawn-resume-only',
                }),
            }),
        );
        await expect(
            bridge.loadLocalSessionMetadataForHandoff(opaqueSpawnResumeId.trim()),
        ).resolves.toBeNull();
        await expect(
            bridge.loadLocalSessionMetadataForHandoff('  happier-session-id\n'),
        ).resolves.toEqual(
            expect.objectContaining({
                exportMetadata: expect.objectContaining({
                    path: '/repo-happier-id',
                }),
            }),
        );
    });
});
