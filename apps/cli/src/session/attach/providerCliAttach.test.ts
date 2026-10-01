import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createManagedServiceDurabilityOwner } from '@/plugins/runtime/invocation/services/managedServiceDurability';
import { createDaemonManagedServiceEndpointReadOwner } from '@/plugins/runtime/invocation/services/daemonManagedServiceEndpointReadOwner';
import { ManagedServiceEndpointReadOpenRequestV1Schema } from '@/agent/runtime/session/process/managedServiceEndpointReadProtocol';
import {
    resolveOpenCodeAttachTarget,
    createOpenCodeAttachArgs,
    resolveOpenCodeAttachReachability,
} from '../../../../../packages/plugins/opencode/src/agent/surfaces/sessions/attach/descriptor';

import { createProviderCliAttachSurface, probeLocalSocket } from './providerCliAttach';

type SpawnExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void;
type SpawnErrorHandler = (error: Error) => void;

describe('createProviderCliAttachSurface', () => {
    it('rejects unavailable exact managed-service access before ambient probing or child launch', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'happier-attach-access-'));
        const durability = createManagedServiceDurabilityOwner({ rootDir });
        const baseUrl = 'http://127.0.0.1:4312';
        await durability.publishEndpointProjection({
            sessionId: 'session-one', pluginId: 'happier.agent.opencode',
            contributionId: 'happier.agent.opencode/agents/opencode',
            serverId: 'opencode-server', instanceId: 'server-one',
            sourceCustody: { kind: 'managed', immutableGenerationId: 'opencode-occurrence', installSource: 'localPath' },
            custodyOwner: 'sessionRunner', mode: 'externalAttach',
            endpoint: { baseUrl, host: '127.0.0.1', port: 4312 },
            process: null, createdAtMs: 1,
        });
        // The runner RPC transport reports a real closed-protocol unavailable outcome.
        const owner = createDaemonManagedServiceEndpointReadOwner({
            credentials: { token: 'fixture-token', encryption: { type: 'none' } },
            resolveProjection: (query) => durability.resolveEndpointProjection(query),
            resolveRunnerEndpointReadRpc: async (sessionId) => ({
                sessionId,
                call: async ({ request }) => {
                    const parsed = ManagedServiceEndpointReadOpenRequestV1Schema.parse(request);
                    return { v: 1, requestId: parsed.requestId, status: 'unavailable' };
                },
            }),
        });
        const fetchFn = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
        const spawnProcess = vi.fn(() => ({
            once: (event: 'exit' | 'error', handler: SpawnExitHandler | SpawnErrorHandler) => {
                if (event === 'exit') (handler as SpawnExitHandler)(0, null);
            },
        }));
        const surface = createProviderCliAttachSurface({
            agentId: 'opencode', resolveTarget: resolveOpenCodeAttachTarget,
            createArgs: createOpenCodeAttachArgs, resolveReachability: resolveOpenCodeAttachReachability,
            managedServiceTargetBaseUrl: (target) => target.baseUrl,
            managedServiceCredentialEnvironmentKey: 'OPENCODE_SERVER_PASSWORD',
            managedServiceCredentialEnvironmentAliases: ['OPENCODE_PASSWORD'],
            resolveManagedServiceAccess: (input) => owner.resolveSessionClientAccess({
                ...input, pluginId: 'happier.agent.opencode',
                contributionId: 'happier.agent.opencode/agents/opencode',
                environmentKey: 'OPENCODE_SERVER_PASSWORD',
            }),
            resolveLaunchSpec: () => ({ source: 'managed', resolvedPath: '/fixture/opencode', command: '/fixture/opencode', args: [] }),
            env: { OPENCODE_SERVER_PASSWORD: 'ambient-wrong', OPENCODE_PASSWORD: 'ambient-wrong' },
            fetchFn,
            spawnProcess: spawnProcess as unknown as Parameters<typeof createProviderCliAttachSurface>[0]['spawnProcess'],
        });
        const metadata = {
            path: '/repo',
            runtimeDescriptorV1: { v: 1 as const, agentId: 'opencode' as const,
                agent: { backendMode: 'server', providerSessionId: 'native-one', serverBaseUrl: baseUrl, serverBaseUrlExplicit: true } },
        };
        try {
            expect(await surface.evaluateAvailability?.({ operation: 'attach', sessionId: 'session-one', metadata, depth: 'live' }))
                .toMatchObject({ available: false, reasonCode: 'agent_unavailable' });
            expect(await surface.attach({ sessionId: 'session-one', metadata })).toMatchObject({ ok: false, code: 'attach_failed' });
            expect(fetchFn).not.toHaveBeenCalled();
            expect(spawnProcess).not.toHaveBeenCalled();
        } finally {
            await owner.dispose();
        }
    });

    it('launches provider-native attach with descriptor args and inherited stdio', async () => {
        const exitHandlers: SpawnExitHandler[] = [];
        const errorHandlers: SpawnErrorHandler[] = [];
        const spawnProcess = vi.fn(() => ({
            once: (event: 'exit' | 'error', handler: SpawnExitHandler | SpawnErrorHandler) => {
                if (event === 'exit') exitHandlers.push(handler as SpawnExitHandler);
                if (event === 'error') errorHandlers.push(handler as SpawnErrorHandler);
            },
        }));
        const readFallbackServerBaseUrl = vi.fn(async (
            input: Readonly<{ sessionId: string }>,
        ) => input.sessionId === 'happier-session-1'
            ? 'https://fallback-opencode.example.test'
            : null);

        const surface = createProviderCliAttachSurface<{
            providerSessionId: string;
            directory: string;
            baseUrl: string;
        }>({
            agentId: 'opencode',
            resolveTarget: ({ metadata, fallbackServerBaseUrl }) => {
                const runtimeHandle = metadata.runtimeDescriptorV1?.agent;
                return {
                    ok: true,
                    value: {
                        providerSessionId: String(runtimeHandle?.providerSessionId),
                        directory: String(metadata.path),
                        baseUrl: fallbackServerBaseUrl ?? String(runtimeHandle?.serverBaseUrl),
                    },
                };
            },
            createArgs: (target) => [
                'attach',
                target.baseUrl,
                '--dir',
                target.directory,
                '--session',
                target.providerSessionId,
            ],
            readFallbackServerBaseUrl,
            resolveLaunchSpec: () => ({
                source: 'managed',
                resolvedPath: '/managed/opencode',
                command: 'opencode',
                args: ['--managed'],
            }),
            spawnProcess: spawnProcess as unknown as Parameters<typeof createProviderCliAttachSurface>[0]['spawnProcess'],
        });

        const attachPromise = surface.attach({
            sessionId: 'happier-session-1',
            metadata: {
                path: '/repo',
                runtimeDescriptorV1: {
                    v: 1,
                    agentId: 'opencode',
                    agent: {
                        providerSessionId: 'oc-session-1',
                        serverBaseUrl: 'https://metadata-opencode.example.test',
                    },
                },
            },
        });

        await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
        expect(spawnProcess).toHaveBeenCalledWith(
            'opencode',
            [
                '--managed',
                'attach',
                'https://fallback-opencode.example.test',
                '--dir',
                '/repo',
                '--session',
                'oc-session-1',
            ],
            expect.objectContaining({
                shell: false,
                stdio: 'inherit',
            }),
        );
        expect(errorHandlers).toHaveLength(1);
        expect(exitHandlers).toHaveLength(1);
        expect(readFallbackServerBaseUrl).toHaveBeenCalledWith({
            sessionId: 'happier-session-1',
        });

        exitHandlers[0]?.(0, null);
        await expect(attachPromise).resolves.toEqual({
            ok: true,
            value: { exitCode: 0 },
        });
    });

    it.each([false, true])('stops the exact attach child and reports signal failures (killFails=%s)', async (killFails) => {
        vi.stubEnv('HAPPIER_LOG_LEVEL', 'info');
        vi.resetModules();
        const { createProviderCliAttachSurface: createSurface } = await import('./providerCliAttach');
        const { logger } = await import('@/ui/logger');
        logger.infoFile('Provider attach cleanup regression started');
        const exitHandlers: SpawnExitHandler[] = [];
        const kill = vi.fn(() => {
            if (killFails) throw new Error('attach signal failed');
            return true;
        });
        const spawnProcess = vi.fn(() => ({
            exitCode: null,
            kill,
            once: (event: 'exit' | 'error', handler: SpawnExitHandler | SpawnErrorHandler) => {
                if (event === 'exit') exitHandlers.push(handler as SpawnExitHandler);
            },
        }));
        const controller = new AbortController();
        const surface = createSurface<Record<string, never>>({
            agentId: 'codex',
            resolveTarget: () => ({ ok: true, value: {} }),
            createArgs: () => ['attach'],
            resolveLaunchSpec: () => ({
                source: 'managed',
                resolvedPath: '/managed/codex',
                command: 'codex',
                args: [],
            }),
            spawnProcess: spawnProcess as unknown as Parameters<typeof createProviderCliAttachSurface>[0]['spawnProcess'],
        });

        const attachPromise = surface.attach({
            sessionId: 'session-1',
            metadata: {},
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));

        try {
            vi.useFakeTimers();
            controller.abort();
            expect(kill).toHaveBeenCalledWith('SIGINT');
            if (killFails) {
                await vi.runOnlyPendingTimersAsync();
                expect(kill).toHaveBeenCalledWith('SIGKILL');
                logger.flushSync();
                const log = await readFile(logger.logFilePath, 'utf8');
                expect(log).toContain('provider_attach_cleanup_signal_failed');
                expect(log).toContain('SIGINT');
                expect(log).toContain('SIGKILL');
            }
            exitHandlers[0]?.(0, 'SIGINT');
            await expect(attachPromise).resolves.toEqual({
                ok: true,
                value: { exitCode: 0 },
            });
        } finally {
            exitHandlers[0]?.(0, 'SIGINT');
            vi.useRealTimers();
            vi.unstubAllEnvs();
        }
    });

    it('probes descriptor health URL with a bounded request', async () => {
        const fetchFn = vi.fn(async () => ({ ok: true }));
        const surface = createProviderCliAttachSurface<{ healthUrl: string }>({
            agentId: 'opencode',
            resolveTarget: () => ({ ok: true, value: { healthUrl: 'https://opencode.example.test/global/health' } }),
            createArgs: () => [],
            resolveReachability: (target) => ({ kind: 'http', url: target.healthUrl }),
            fetchFn: fetchFn as unknown as typeof fetch,
            reachabilityTimeoutMs: 25,
        });

        await expect(surface.evaluateAvailability?.({
            operation: 'attach',
            sessionId: 'session-1',
            metadata: {},
            depth: 'live',
        })).resolves.toEqual({ available: true });
        expect(fetchFn).toHaveBeenCalledWith(
            'https://opencode.example.test/global/health',
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('passes the exact selected CLI version to provider-owned argv and reachability', async () => {
        const createArgs = vi.fn(() => []);
        const resolveReachability = vi.fn(() => ({
            kind: 'http' as const,
            url: 'https://opencode.example.test/api/info',
        }));
        const fetchFn = vi.fn(async () => ({ ok: true }));
        const surface = createProviderCliAttachSurface<{ baseUrl: string }>({
            agentId: 'opencode',
            resolveTarget: () => ({ ok: true, value: { baseUrl: 'https://opencode.example.test' } }),
            createArgs,
            resolveReachability,
            cliVersionArgs: ['--version'],
            resolveCliVersion: async () => '2.0.15',
            fetchFn: fetchFn as unknown as typeof fetch,
        });

        await expect(surface.evaluateAvailability?.({
            operation: 'attach',
            sessionId: 'session-1',
            metadata: {},
            depth: 'live',
        })).resolves.toEqual({ available: true });
        expect(resolveReachability).toHaveBeenCalledWith(
            { baseUrl: 'https://opencode.example.test' },
            { cliVersion: '2.0.15' },
        );
    });

    it('reuses one selected launch for the attach version probe and child spawn', async () => {
        const exitHandlers: SpawnExitHandler[] = [];
        const spawnProcess = vi.fn(() => ({
            once: (event: 'exit' | 'error', handler: SpawnExitHandler | SpawnErrorHandler) => {
                if (event === 'exit') exitHandlers.push(handler as SpawnExitHandler);
            },
        }));
        const selectedLaunch = Object.freeze({
            source: 'system' as const,
            resolvedPath: '/tools/opencode-v2',
            command: '/tools/opencode-v2',
            args: Object.freeze(['--selected-v2']),
        });
        const resolveLaunchSpec = vi.fn(async () => selectedLaunch);
        const resolveCliVersion = vi.fn(async ({ launch }) => {
            expect(launch).toBe(selectedLaunch);
            return '2.0.15';
        });
        const surface = createProviderCliAttachSurface<Record<string, never>>({
            agentId: 'opencode',
            resolveTarget: () => ({ ok: true, value: {} }),
            cliVersionArgs: ['--version'],
            resolveLaunchSpec,
            resolveCliVersion,
            createArgs: (_target, host) => ['attach', `--version=${host.cliVersion ?? ''}`],
            spawnProcess: spawnProcess as unknown as Parameters<typeof createProviderCliAttachSurface>[0]['spawnProcess'],
        });

        const attachPromise = surface.attach({ sessionId: 'session-v2', metadata: {} });
        await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
        expect(resolveLaunchSpec).toHaveBeenCalledTimes(1);
        expect(resolveCliVersion).toHaveBeenCalledWith({
            launch: selectedLaunch,
            args: ['--version'],
            env: expect.any(Object),
        });
        expect(spawnProcess).toHaveBeenCalledWith(
            '/tools/opencode-v2',
            ['--selected-v2', 'attach', '--version=2.0.15'],
            expect.objectContaining({ shell: false, stdio: 'inherit' }),
        );
        exitHandlers[0]?.(0, null);
        await expect(attachPromise).resolves.toEqual({ ok: true, value: { exitCode: 0 } });
    });

    it('uses exact managed-service access for authenticated health and child credentials', async () => {
        const exitHandlers: SpawnExitHandler[] = [];
        const spawnProcess = vi.fn(() => ({
            once: (event: 'exit' | 'error', handler: SpawnExitHandler | SpawnErrorHandler) => {
                if (event === 'exit') exitHandlers.push(handler as SpawnExitHandler);
            },
        }));
        const request = vi.fn(async () => ({ ok: true }));
        const resolveManagedServiceAccess = vi.fn(async () => ({
            baseUrl: 'http://127.0.0.1:4096/',
            request,
            childEnvironment: Object.freeze({
                OPENCODE_SERVER_PASSWORD: 'exact-host-owned-password',
                OPENCODE_PASSWORD: 'wrong-returned-alias',
                PATH: '/wrong-returned-path',
            }),
        }));
        const ambientEnv = Object.freeze({
            PATH: '/bin',
            OPENCODE_PASSWORD: 'wrong-canonical-ambient-password',
            OPENCODE_SERVER_PASSWORD: 'wrong-ambient-password',
        });
        const surface = createProviderCliAttachSurface<{ baseUrl: string }>({
            agentId: 'opencode',
            resolveTarget: () => ({
                ok: true,
                value: { baseUrl: 'http://127.0.0.1:4096/' },
            }),
            createArgs: () => [
                '--server',
                'http://127.0.0.1:4096/',
                '--session',
                'opencode-session-1',
                '/repo',
            ],
            resolveReachability: () => ({
                kind: 'http',
                url: 'http://127.0.0.1:4096/api/info',
            }),
            resolveManagedServiceAccess,
            managedServiceTargetBaseUrl: (target) => target.baseUrl,
            managedServiceCredentialEnvironmentKey: 'OPENCODE_SERVER_PASSWORD',
            managedServiceCredentialEnvironmentAliases: ['OPENCODE_PASSWORD'],
            resolveLaunchSpec: () => ({
                source: 'managed',
                resolvedPath: '/managed/opencode',
                command: 'opencode',
                args: [],
            }),
            env: ambientEnv,
            spawnProcess: spawnProcess as unknown as Parameters<typeof createProviderCliAttachSurface>[0]['spawnProcess'],
        });

        await expect(surface.evaluateAvailability?.({
            operation: 'attach',
            sessionId: 'session-1',
            metadata: {},
            depth: 'live',
        })).resolves.toEqual({ available: true });
        expect(request).toHaveBeenCalledWith({
            pathAndQuery: '/api/info',
            signal: expect.any(AbortSignal),
        });

        const attachPromise = surface.attach({ sessionId: 'session-1', metadata: {} });
        await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
        expect(spawnProcess).toHaveBeenCalledWith(
            'opencode',
            [
                '--server',
                'http://127.0.0.1:4096/',
                '--session',
                'opencode-session-1',
                '/repo',
            ],
            expect.objectContaining({
                env: {
                    PATH: '/bin',
                    OPENCODE_PASSWORD: 'exact-host-owned-password',
                    OPENCODE_SERVER_PASSWORD: 'exact-host-owned-password',
                },
            }),
        );
        expect(ambientEnv.OPENCODE_SERVER_PASSWORD).toBe('wrong-ambient-password');
        exitHandlers[0]?.(0, null);
        await attachPromise;
    });

    it('never applies managed-service credentials to a different attach target', async () => {
        const spawnProcess = vi.fn(() => ({
            once: (event: 'exit' | 'error', handler: SpawnExitHandler | SpawnErrorHandler) => {
                if (event === 'exit') (handler as SpawnExitHandler)(0, null);
            },
        }));
        const surface = createProviderCliAttachSurface<{ baseUrl: string }>({
            agentId: 'opencode',
            resolveTarget: () => ({
                ok: true,
                value: { baseUrl: 'https://operator.example.test/' },
            }),
            createArgs: () => [],
            resolveManagedServiceAccess: async () => ({
                baseUrl: 'http://127.0.0.1:4096/',
                request: async () => ({ ok: true }),
                childEnvironment: Object.freeze({ SECRET: 'must-not-leak' }),
            }),
            managedServiceTargetBaseUrl: (target) => target.baseUrl,
            managedServiceCredentialEnvironmentKey: 'SECRET',
            managedServiceCredentialEnvironmentAliases: ['SECRET_ALIAS'],
            env: {
                PATH: '/bin',
                SECRET: 'external-target-password',
                SECRET_ALIAS: 'external-target-password',
            },
            resolveLaunchSpec: () => ({
                source: 'managed',
                resolvedPath: '/managed/opencode',
                command: 'opencode',
                args: [],
            }),
            spawnProcess: spawnProcess as unknown as Parameters<typeof createProviderCliAttachSurface>[0]['spawnProcess'],
        });

        await surface.attach({ sessionId: 'session-1', metadata: {} });
        expect(spawnProcess).toHaveBeenCalledWith(
            'opencode',
            [],
            expect.objectContaining({
                env: {
                    PATH: '/bin',
                    SECRET: 'external-target-password',
                    SECRET_ALIAS: 'external-target-password',
                },
            }),
        );
    });

    it('probes a provider-owned local socket through the canonical attach reachability seam', async () => {
        const probeSocket = vi.fn(async () => true);
        const surface = createProviderCliAttachSurface<{ socketPath: string }>({
            agentId: 'codex',
            resolveTarget: () => ({ ok: true, value: { socketPath: '/tmp/codex.sock' } }),
            createArgs: () => [],
            resolveReachability: (target) => ({ kind: 'localSocket', path: target.socketPath }),
            probeSocket,
            reachabilityTimeoutMs: 25,
        });

        await expect(surface.evaluateAvailability?.({
            operation: 'attach',
            sessionId: 'session-1',
            metadata: {},
            depth: 'live',
        })).resolves.toEqual({ available: true });
        expect(probeSocket).toHaveBeenCalledWith('/tmp/codex.sock', 25);
    });

    it('uses the Codex rendezvous path as the Windows local-socket liveness signal', async () => {
        const statPath = vi.fn(async () => ({}) as never);

        await expect(probeLocalSocket('C:\\Temp\\codex.sock', 25, {
            platform: 'win32',
            statPath,
        })).resolves.toBe(true);
        expect(statPath).toHaveBeenCalledWith('C:\\Temp\\codex.sock');
    });

    it('does not use local managed-server fallback when evaluating a remote provider attach target', async () => {
        const resolveTarget = vi.fn(({ fallbackServerBaseUrl }: { fallbackServerBaseUrl?: string | null }) =>
            fallbackServerBaseUrl
                ? { ok: true as const, value: { baseUrl: fallbackServerBaseUrl } }
                : { ok: false as const, reason: 'missing explicit remote server URL' },
        );
        const surface = createProviderCliAttachSurface<{ baseUrl: string }>({
            agentId: 'opencode',
            resolveTarget,
            createArgs: () => [],
            readFallbackServerBaseUrl: async () => 'http://127.0.0.1:4096/',
        });

        await expect(surface.evaluateAvailability?.({
            operation: 'attach',
            sessionId: 'session-1',
            metadata: {},
            currentMachineId: 'machine-local',
            sessionMachineId: 'machine-remote',
            hasLocalAttachmentInfo: false,
        })).resolves.toEqual({
            available: false,
            reasonCode: 'missing_metadata',
            safeMessage: 'missing explicit remote server URL',
        });
        expect(resolveTarget).toHaveBeenCalledWith({ metadata: {}, fallbackServerBaseUrl: null });
    });

    it('spawns the resolved platform invocation instead of the raw provider command', async () => {
        const exitHandlers: SpawnExitHandler[] = [];
        const spawnProcess = vi.fn(() => ({
            once: (event: 'exit' | 'error', handler: SpawnExitHandler | SpawnErrorHandler) => {
                if (event === 'exit') exitHandlers.push(handler as SpawnExitHandler);
            },
        }));
        const surface = createProviderCliAttachSurface<{ providerSessionId: string }>({
            agentId: 'opencode',
            resolveTarget: () => ({ ok: true, value: { providerSessionId: 'oc-session-1' } }),
            createArgs: (target) => ['attach', '--session', target.providerSessionId],
            resolveLaunchSpec: () => ({
                source: 'managed',
                resolvedPath: 'opencode.cmd',
                command: 'opencode.cmd',
                args: ['--managed'],
            }),
            resolveCommandInvocation: ({ command, args }) => ({
                command: 'cmd.exe',
                args: ['/d', '/s', '/c', `"${command} ${args.join(' ')}"`],
                windowsVerbatimArguments: true,
            }),
            spawnProcess: spawnProcess as unknown as Parameters<typeof createProviderCliAttachSurface>[0]['spawnProcess'],
        });

        const attachPromise = surface.attach({ sessionId: 'session-1', metadata: {} });

        await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
        expect(spawnProcess).toHaveBeenCalledWith(
            'cmd.exe',
            ['/d', '/s', '/c', '"opencode.cmd --managed attach --session oc-session-1"'],
            expect.objectContaining({
                shell: false,
                stdio: 'inherit',
                windowsVerbatimArguments: true,
            }),
        );

        exitHandlers[0]?.(0, null);
        await expect(attachPromise).resolves.toEqual({
            ok: true,
            value: { exitCode: 0 },
        });
    });
});
