import { rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const inventory = vi.hoisted(() => ({ socketPath: '', inheritedSpawns: 0, startedServers: [] as string[] }));
// Only executable inventory and child spawning are substituted; sockets, adapters,
// current-pane verification, and attachment persistence use their real owners.
vi.mock('node:child_process', async (importOriginal) => {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    return {
        ...await importOriginal<typeof import('node:child_process')>(),
        spawn: vi.fn((_command: string, args: readonly string[], options: { stdio?: unknown }) => {
            if (args.includes('server')) {
                inventory.startedServers.push(args[0] === '--session' ? args[1]! : 'default');
                return Object.assign(new EventEmitter(), { unref() {} });
            }
            if (Array.isArray(options?.stdio) && options.stdio.slice(0, 3).every((stream) => stream === 'inherit')) {
                inventory.inheritedSpawns += 1;
                return new EventEmitter();
            }
            const child = Object.assign(new EventEmitter(), {
                stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true,
            });
            setImmediate(() => child.emit('error', Object.assign(new Error('not installed'), { code: 'ENOENT' })));
            return child;
        }),
        execFile: Object.assign(vi.fn((binary: string, args: readonly string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
            const child = Object.assign(new EventEmitter(), {
                stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, signalCode: null,
                kill: () => true,
            });
            setImmediate(() => {
                const error = binary === 'tmux' ? Object.assign(new Error('not installed'), { code: 'ENOENT' }) : null;
                const stdout = binary === 'herdr' && args[0] === '--version'
                    ? 'herdr 0.9.2'
                    : JSON.stringify({ sessions: ['default', 'work', 'explicit', ...inventory.startedServers].map((name) => ({
                        name, socket_path: inventory.socketPath, running: true,
                    })) });
                child.exitCode = error ? 1 : 0;
                child.emit('exit', child.exitCode, null);
                callback(error, error ? '' : stdout, '');
                child.emit('close', child.exitCode, null);
            });
            return child;
        }), {
            [Symbol.for('nodejs.util.promisify.custom')]: async (binary: string, args: readonly string[]) => {
                if (binary === 'tmux') throw Object.assign(new Error('not installed'), { code: 'ENOENT' });
                return {
                    stdout: binary === 'herdr' && args[0] === '--version'
                        ? 'herdr 0.9.2'
                        : JSON.stringify({ sessions: ['default', 'work', 'explicit', ...inventory.startedServers].map((name) => ({
                            name, socket_path: inventory.socketPath, running: true,
                        })) }),
                    stderr: '',
                };
            },
        }),
    };
});

import { createHerdrTerminalHostAdapter } from '@/integrations/herdr/adapter';
import { withHerdrApi } from '@/integrations/herdr/herdrApi.testkit';
import { resolveTerminalHost } from '@/integrations/terminal/host/resolveTerminalHost';
import { requireAgentCliLaunchSpec } from '@/packagedRuntime/managedTools/requireAgentCliLaunchSpec';
import { readTerminalHostAttachmentInfo, writeTerminalHostAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';
import { withTempDir } from '@/testkit/fs/tempDir';
import { resolveInheritedHerdrRuntime } from '@/terminal/runtime/inheritedHerdrRuntime';
import { buildTerminalMetadataFromRuntimeFlags } from '@/terminal/runtime/terminalMetadata';
import { createEventsFixture, createPluginContextFixture } from '../../../../../../packages/plugins/claude/src/agent/runtime/engine.testkit';
import { createClaudeUnifiedTerminalTurnOperations } from '../../../../../../packages/plugins/claude/src/agent/runtime/terminal/unified/turnOperations';

import { createDefaultPluginTerminalHostService, createPluginTerminalHostService } from './terminalHost';

describe('plugin terminal-host creation rollback', () => {
    it.skipIf(process.platform === 'win32').each(['borrowed', 'owned'] as const)(
        'refuses a metadata-recovered %s Herdr host on an unsupported running server before launching',
        async (lifecycle) => {
            await withTempDir('plugin-current-herdr-version-', async (happyHomeDir) => await withHerdrApi(async (api) => {
                inventory.socketPath = api.socketPath;
                inventory.inheritedSpawns = 0;
                inventory.startedServers = [];
                api.setServerVersion('0.9.1');
                api.panes.add('original-pane');
                const sessionId = 'session-recovered-version';
                const attachment = await writeTerminalHostAttachmentInfo({
                    happyHomeDir, sessionId, lifecycle,
                    handle: {
                        kind: 'herdr', sessionName: 'work', socketPath: api.socketPath,
                        terminalId: 'original-pane', paneId: 'original-pane',
                        attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared', locality: 'same_machine', liveProbe: 'required' },
                    },
                });
                const service = createDefaultPluginTerminalHostService({
                    happyHomeDir, hasCapability: (capability) => capability === 'terminalHost', readSessionId: () => sessionId,
                    currentTerminalMetadata: {
                        terminal: buildTerminalMetadataFromRuntimeFlags({
                            mode: 'herdr', herdrSessionName: 'work', herdrSocketPath: api.socketPath,
                            herdrTerminalId: 'original-pane', herdrPaneId: 'original-pane', attachmentId: attachment.attachmentId,
                        }),
                        startedBy: 'terminal',
                    },
                });
                await expect(service.createOrAttachHost({
                    preference: 'herdr', sessionName: 'recovered-agent-label', workingDirectory: tmpdir(), isolatedEnv: true,
                    launch: { kind: 'agent-cli', agentId: 'claude', args: ['--version'], env: { HAPPIER_CLAUDE_PATH: process.execPath } },
                })).rejects.toMatchObject({ code: 'unsupported_server_version' });
                expect(inventory.inheritedSpawns).toBe(0);
                expect(inventory.startedServers).toEqual([]);
                expect(api.requests.some((request) => request.method === 'layout.apply' || request.method === 'pane.close')).toBe(false);
                expect([...api.panes]).toEqual(['original-pane']);
                await expect(readTerminalHostAttachmentInfo({ happyHomeDir, sessionId })).resolves.toEqual(attachment);
            }));
        },
    );

    it.skipIf(process.platform === 'win32').each([
        { hasCurrentFlags: false, requestedSessionName: 'default', expectedSessionName: 'work' },
        { hasCurrentFlags: false, requestedSessionName: 'explicit', expectedSessionName: 'explicit' },
        { hasCurrentFlags: true, requestedSessionName: 'default', expectedSessionName: 'work' },
    ])('uses verified placement and namespace precedence for $requestedSessionName with inherited flags=$hasCurrentFlags', async ({ hasCurrentFlags, requestedSessionName, expectedSessionName }) => {
        await withTempDir('plugin-current-terminal-', async (happyHomeDir) => await withHerdrApi(async (api) => {
            inventory.socketPath = api.socketPath;
            inventory.inheritedSpawns = 0;
            inventory.startedServers = [];
            const originalPane = hasCurrentFlags ? 'managed' : 'old-user-pane';
            api.panes.add(originalPane);
            const attachment = await writeTerminalHostAttachmentInfo({
                happyHomeDir, sessionId: 'session-existing-terminal', lifecycle: 'borrowed',
                handle: {
                    kind: 'herdr', sessionName: 'work', socketPath: api.socketPath,
                    terminalId: hasCurrentFlags ? 'terminal_1' : originalPane, paneId: originalPane,
                    attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared', locality: 'same_machine', liveProbe: 'required' },
                },
            });
            const currentRuntime = hasCurrentFlags ? await resolveInheritedHerdrRuntime({
                terminalRuntime: { mode: 'herdr', herdrSessionName: 'work', attachmentId: attachment.attachmentId },
                env: { HERDR_ENV: '1', HERDR_SOCKET_PATH: api.socketPath, HERDR_PANE_ID: originalPane },
            }) : null;
            const service = createDefaultPluginTerminalHostService({
                happyHomeDir, hasCapability: (capability) => capability === 'terminalHost',
                readSessionId: () => 'session-existing-terminal',
                ...(currentRuntime ? { currentTerminalMetadata: {
                    terminal: buildTerminalMetadataFromRuntimeFlags(currentRuntime), startedBy: 'terminal' as const,
                } } : {}),
            });
            let handle: Awaited<ReturnType<typeof service.createOrAttachHost>> | null = null;
            try {
                const request = {
                    preference: 'herdr' as const, sessionName: requestedSessionName, label: 'happier-claude-recovered', workingDirectory: tmpdir(), isolatedEnv: true,
                    launch: { kind: 'agent-cli' as const, agentId: 'claude', args: ['--version'], env: { HAPPIER_CLAUDE_PATH: process.execPath } },
                };
                handle = await service.createOrAttachHost(request);
                expect(handle.sessionName).toBe(expectedSessionName);
                expect(inventory.startedServers).toEqual([]);
                expect(inventory.inheritedSpawns).toBe(hasCurrentFlags ? 1 : 0);
                expect(api.requests.filter((request) => request.method === 'layout.apply')).toHaveLength(hasCurrentFlags ? 0 : 1);
                expect(api.panes.has(originalPane)).toBe(true);
                await expect(readTerminalHostAttachmentInfo({ happyHomeDir, sessionId: 'session-existing-terminal' })).resolves.toMatchObject({
                    version: hasCurrentFlags ? 3 : 2,
                });
            } finally {
                if (handle) await service.dispose(handle, { kind: 'destroy_owned_host', reason: 'session_closed' });
                const layout = api.requests.find((request) => request.method === 'layout.apply');
                const root = layout?.params.root as { command?: string[] } | undefined;
                const specPath = root?.command?.[2];
                if (specPath) {
                    await unlink(specPath).catch(() => {});
                    await rmdir(dirname(specPath)).catch(() => {});
                }
            }
        }));
    });

    it.skipIf(process.platform === 'win32')('creates standalone Claude panes in the default Herdr server with the generated agent label', async () => {
        await withTempDir('plugin-default-herdr-', async (happyHomeDir) => await withHerdrApi(async (api) => {
            inventory.socketPath = api.socketPath;
            inventory.startedServers = [];
            const sessionId = 'standalone-claude-grouping';
            const service = createDefaultPluginTerminalHostService({
                happyHomeDir, hasCapability: (capability) => capability === 'terminalHost', readSessionId: () => sessionId,
            });
            const operations = createClaudeUnifiedTerminalTurnOperations({
                ctx: createPluginContextFixture(service, createEventsFixture().service),
                directory: tmpdir(), happierSessionId: sessionId, hostPreference: 'herdr',
                launchEnv: { HAPPIER_CLAUDE_PATH: process.execPath }, permissionMode: 'default',
            });
            try {
                await expect(operations.startProviderSession()).resolves.toMatchObject({ hostKind: 'herdr', hostSessionName: 'default' });
                expect(inventory.startedServers).toEqual([]);
                expect(api.requests.find((request) => request.method === 'layout.apply')?.params).toMatchObject({
                    tab_label: `happier-claude-${sessionId}`, root: { label: `happier-claude-${sessionId}` },
                });
                await expect(readTerminalHostAttachmentInfo({ happyHomeDir, sessionId })).resolves.toMatchObject({
                    version: 2, handle: { kind: 'herdr', sessionName: 'default' },
                });
            } finally {
                await operations.disposeProviderSession('session_closed');
                const layout = api.requests.find((request) => request.method === 'layout.apply');
                const root = layout?.params.root as { command?: string[] } | undefined;
                const specPath = root?.command?.[2];
                if (specPath) {
                    await unlink(specPath).catch(() => {});
                    await rmdir(dirname(specPath)).catch(() => {});
                }
            }
        }));
    });

    it('retains persistence and host cleanup failures when a created pane cannot be stopped', async () => {
        await withHerdrApi(async (api) => {
            inventory.socketPath = api.socketPath;
            api.faults.set('pane.close', 'error');
            const adapter = createHerdrTerminalHostAdapter({
                binary: 'herdr', sessionName: 'work', actionTimeoutMs: 500, startupTimeoutMs: 500,
            });
            const service = createPluginTerminalHostService({
                hasCapability: (capability) => capability === 'terminalHost',
                resolveTerminalHost: (preference) => resolveTerminalHost({
                    preference, platform: { os: 'linux', arch: process.arch }, adapters: { herdr: adapter },
                    tmuxAvailable: false, zellijAvailable: false,
                }),
                resolveAgentCliLaunch: (launch) => requireAgentCliLaunchSpec(launch.agentId, {
                    processEnv: { HAPPIER_CLAUDE_PATH: process.execPath },
                }),
                // The socket cannot be a directory: exercise the real attachment filesystem owner.
                onHostCreated: async (handle) => {
                    await writeTerminalHostAttachmentInfo({ happyHomeDir: api.socketPath, sessionId: 'test-session', handle });
                },
                disposeHost: async ({ handle }) => await adapter.dispose(handle),
            });
            try {
                const error = await service.createOrAttachHost({
                    preference: 'herdr', sessionName: 'work', workingDirectory: tmpdir(), isolatedEnv: true,
                    launch: { kind: 'agent-cli', agentId: 'claude', args: ['--version'] },
                }).catch((failure: unknown) => failure);
                expect(error).toBeInstanceOf(AggregateError);
                expect(error).toMatchObject({
                    errors: [expect.objectContaining({ code: 'ENOTDIR' }), expect.objectContaining({ code: 'pane.close_failed' })],
                });
                expect([...api.panes]).toEqual(['managed']);
            } finally {
                const layout = api.requests.find((request) => request.method === 'layout.apply');
                const root = layout?.params.root as { command?: string[] } | undefined;
                const specPath = root?.command?.[2];
                if (specPath) {
                    await unlink(specPath).catch(() => {});
                    await rmdir(dirname(specPath)).catch(() => {});
                }
            }
        });
    });
});
