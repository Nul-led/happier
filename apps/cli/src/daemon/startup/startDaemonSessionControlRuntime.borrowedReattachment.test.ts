import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configuration, reloadConfiguration } from '@/configuration';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { readSessionMarkerForPid, writeSessionMarker } from '../sessionRegistry';
import { buildTrackedSessionFromMarker } from '../sessions/trackedSessionFromMarker';
import {
    readTerminalHostAttachmentInfo,
    removeTerminalHostAttachmentInfo,
    writeTerminalHostAttachmentInfo,
} from '@/terminal/attachment/terminalAttachmentInfo';
import { startDaemonSessionControlRuntime } from './startDaemonSessionControlRuntime';

const boundary = vi.hoisted(() => ({
    metadata: {} as Record<string, unknown>,
    version: 1,
    sessionId: 'session-reattached-borrowed',
}));

// Home HTTP transport only: the metadata updater/CAS and exact retirement are real.
vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>(),
    fetchSessionByIdCompat: vi.fn(async () => ({
        id: boundary.sessionId, encryptionMode: 'plain',
        metadata: JSON.stringify(boundary.metadata), metadataVersion: boundary.version,
    })),
    patchSessionMetadata: vi.fn(async ({ expectedVersion, ciphertext }: { expectedVersion: number; ciphertext: string }) => {
        expect(expectedVersion).toBe(boundary.version);
        boundary.metadata = JSON.parse(ciphertext) as Record<string, unknown>;
        boundary.version += 1;
        return { success: true, version: boundary.version };
    }),
}));
vi.mock('@/api/client/connectedServiceCredentialApi', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/api/client/connectedServiceCredentialApi')>(),
    fetchAccountEncryptionCurrentness: vi.fn(async () => ({
        mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
    })),
}));
// Loopback HTTP is outside the lifecycle owner; no incoming requests are needed here.
vi.mock('@/daemon/controlServer', () => ({
    startDaemonControlServer: vi.fn(async () => ({ port: 44_321, stop: async () => {} })),
}));

const envScope = createEnvKeyScope(['HAPPIER_HOME_DIR']);
afterEach(() => {
    envScope.restore();
    reloadConfiguration();
    vi.restoreAllMocks();
});

describe('startup borrowed-terminal reattachment', () => {
    it.each(['released', 'replaced'] as const)('retires only its exact borrowed attachment after the descriptor is %s', async (descriptorCase) => {
        const fixtureHome = await mkdtemp(join(tmpdir(), 'happier-03-borrowed-reattach-'));
        envScope.patch({ HAPPIER_HOME_DIR: fixtureHome });
        reloadConfiguration();
        const pid = 2_147_482_911;
        const sessionId = boundary.sessionId;
        const attachment = await writeTerminalHostAttachmentInfo({
            happyHomeDir: fixtureHome, sessionId, lifecycle: 'borrowed',
            handle: { kind: 'tmux', sessionName: 'user-shell', paneId: 'user-pane',
                attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared', locality: 'same_machine', liveProbe: 'required' } },
        });
        const terminal = {
            mode: 'tmux' as const, tmux: { target: 'user-shell:user-pane' },
            controlServiceabilityV1: {
                v: 1 as const, attachmentId: attachment.attachmentId, state: 'servable' as const, observedAt: 1,
            },
        };
        const metadata = {
            path: '/tmp/project', host: 'test-host', homeDir: '/tmp/home', happyHomeDir: fixtureHome,
            happyLibDir: '/tmp/lib', happyToolsDir: '/tmp/tools', terminal,
        };
        boundary.metadata = metadata;
        boundary.version = 1;
        await writeSessionMarker({ pid, happySessionId: sessionId, startedBy: 'terminal', metadata });
        const marker = await readSessionMarkerForPid(pid);
        expect(marker).not.toBeNull();
        const trackedSessions = new Map([[pid, buildTrackedSessionFromMarker({
            marker: marker!, startedByFallback: 'reattached', reattachedFromDiskMarker: true,
        })]]);
        const dispose = vi.fn(async () => {});
        const runtime = await startDaemonSessionControlRuntime({
            machineId: 'machine-borrowed-reattachment', serverId: configuration.activeServerId,
            serverBaseUrl: configuration.apiServerUrl,
            credentials: { token: 'token-daemon', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } },
            api: {} as never,
            daemonSessionMutationCustody: { stageTranscriptMessage: async () => { throw new Error('Unexpected recording attachment in this fixture'); }, stageTranscriptEvent: async () => ({ persisted: true, delivered: false }), stage: async () => {} },
            connectedServicesMaterializationBaseDir: join(fixtureHome, 'connected-services'),
            getConnectedServiceRefreshCoordinator: () => null, getConnectedServiceQuotasCoordinator: () => null,
            pidToTrackedSession: trackedSessions, pidToAwaiter: new Map(),
            pidToSpawnResultResolver: new Map(), pidToSpawnWebhookTimeout: new Map(),
            getApiMachineForSessions: () => null,
            spawnResourceCleanupByPid: new Map(), sessionAttachCleanupByPid: new Map(),
            connectedServicesRestartRequestedPids: new Set(),
            loadTerminalHostAdapters: async () => ({ tmux: {
                kind: 'tmux', createOrAttachHost: vi.fn(), injectUserPrompt: vi.fn(), interruptTurn: vi.fn(),
                evaluateLiveness: async () => ({ paneAlive: true, observedAt: 1 }), dispose,
            } }),
            startupTerminalRecovery: { disconnectedTerminalHostCandidates: [], unresolvedTerminalHostSessionIds: [] },
            beforeShutdown: async () => {}, onHappySessionWebhook: async () => {}, requestShutdown: () => {}, processEnv: {},
        });
        try {
            await removeTerminalHostAttachmentInfo({ happyHomeDir: fixtureHome, sessionId, expectedAttachmentId: attachment.attachmentId });
            const replacement = descriptorCase === 'replaced' ? await writeTerminalHostAttachmentInfo({
                happyHomeDir: fixtureHome, sessionId, lifecycle: 'borrowed',
                handle: { ...attachment.handle, attachmentId: undefined, paneId: 'replacement-pane' },
            }) : null;
            if (replacement) boundary.metadata = { ...metadata, terminal: {
                ...terminal, controlServiceabilityV1: { ...terminal.controlServiceabilityV1, attachmentId: replacement.attachmentId, observedAt: 2 },
            } };
            const metadataBeforeExit = boundary.metadata;
            await runtime.onChildExited(pid, { reason: 'process-exited', code: 0, signal: null });
            if (replacement) expect(boundary.metadata).toEqual(metadataBeforeExit);
            else expect(boundary.metadata).toMatchObject({ terminal: { controlServiceabilityV1: {
                attachmentId: attachment.attachmentId, retired: true, state: 'unknown', reason: 'attachment_retired',
            } } });
            expect(await readSessionMarkerForPid(pid)).toBeNull();
            expect(await readTerminalHostAttachmentInfo({ happyHomeDir: fixtureHome, sessionId })).toEqual(replacement);
            expect(trackedSessions.has(pid)).toBe(false);
            expect(dispose).not.toHaveBeenCalled();
        } finally {
            await runtime.stopControlServer();
            await rm(fixtureHome, { recursive: true, force: true });
        }
    });
});
