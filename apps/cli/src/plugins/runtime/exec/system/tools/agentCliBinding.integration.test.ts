import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { create as createTar } from 'tar';

import { getAgentCliRuntimeSpec } from '@happier-dev/agents';
import { resolvePlatformFromNodePlatform } from '@happier-dev/cli-common/agents';
import { describe, expect, it, vi } from 'vitest';

import { bindAgentCliLaunchSpec } from '@/packagedRuntime/managedTools/agentCliLaunchSpec';
import { prepareManagedAgentCliLaunch } from '@/packagedRuntime/managedTools/prepareManagedAgentCliLaunch';

import { resolveExecutablePluginRuntimeRegistry } from '../../../resolveExecutablePluginRuntimeRegistry';
import { createRetainedAgentCliSystemToolService } from './agentCliBinding';

type AgentCliBindingFixture = Readonly<{
    agentId: 'claude' | 'codex' | 'opencode';
    pluginId: string;
    systemToolId: string;
    overrideEnvKey: 'HAPPIER_CLAUDE_PATH' | 'HAPPIER_CODEX_PATH' | 'HAPPIER_OPENCODE_PATH';
    readableJavaScriptOverride: boolean;
    invokeResolvedTool: boolean;
}>;

const fixtures: readonly AgentCliBindingFixture[] = Object.freeze([
    {
        agentId: 'claude',
        pluginId: 'happier.agent.claude',
        systemToolId: 'claude-cli',
        overrideEnvKey: 'HAPPIER_CLAUDE_PATH',
        readableJavaScriptOverride: true,
        invokeResolvedTool: true,
    },
    {
        agentId: 'opencode',
        pluginId: 'happier.agent.opencode',
        systemToolId: 'opencode-cli',
        overrideEnvKey: 'HAPPIER_OPENCODE_PATH',
        readableJavaScriptOverride: false,
        invokeResolvedTool: false,
    },
    {
        agentId: 'codex',
        pluginId: 'happier.agent.codex',
        systemToolId: 'codex-cli',
        overrideEnvKey: 'HAPPIER_CODEX_PATH',
        readableJavaScriptOverride: false,
        invokeResolvedTool: true,
    },
]);

describe('Agent CLI system-tool binding (integration)', () => {
    it('uses the retained exact launch only for the bound Agent CLI tool', async () => {
        if (process.platform === 'win32') return;

        const toolRoot = await mkdtemp(join(tmpdir(), 'happier-retained-agent-cli-'));
        const retainedPath = join(toolRoot, 'claude-retained.js');
        const delegatedGrant = Object.freeze({
            grantId: 'system-tool:delegated',
            toolId: 'macos-security',
            displayName: 'macOS Keychain security',
            source: 'system' as const,
            executablePath: '/usr/bin/security',
            launch: Object.freeze({
                kind: 'binary' as const,
                executablePath: '/usr/bin/security',
                cwd: toolRoot,
                args: Object.freeze([]),
                env: Object.freeze({ PATH: '' }),
            }),
        });
        const delegate = Object.freeze({
            resolve: vi.fn(async () => delegatedGrant),
        });

        await writeFile(retainedPath, 'process.stdout.write("retained");\n', 'utf8');
        await chmod(retainedPath, 0o644);
        try {
            const systemTools = createRetainedAgentCliSystemToolService({
                agentId: 'claude',
                binding: { toolId: 'claude-cli' },
                definition: {
                    toolId: 'claude-cli',
                    displayName: 'Claude Code CLI',
                    lookupNames: ['claude'],
                },
                launch: {
                    source: 'override',
                    resolvedPath: retainedPath,
                    command: process.execPath,
                    args: [retainedPath, '--retained-session'],
                },
                delegate,
            });

            await expect(systemTools.resolve({
                toolId: 'claude-cli',
                purpose: 'Run retained Claude Agent runtime',
                cwd: toolRoot,
            })).resolves.toMatchObject({
                executablePath: retainedPath,
                launch: {
                    executablePath: process.execPath,
                    args: [retainedPath, '--retained-session'],
                },
            });
            expect(delegate.resolve).not.toHaveBeenCalled();

            await expect(systemTools.resolve({
                toolId: 'macos-security',
                purpose: 'Run an unrelated declared system tool',
                cwd: toolRoot,
            })).resolves.toBe(delegatedGrant);
            expect(delegate.resolve).toHaveBeenCalledTimes(1);
        } finally {
            await rm(toolRoot, { recursive: true, force: true });
        }
    });

    it('executes the exact managed_only Codex preparation despite a later override', async () => {
        if (process.platform === 'win32') return;
        const platform = resolvePlatformFromNodePlatform(process.platform);
        if (!platform || (process.arch !== 'arm64' && process.arch !== 'x64')) return;
        const runtimeSpec = getAgentCliRuntimeSpec('codex');
        if (!runtimeSpec || runtimeSpec.managedInstall?.kind !== 'github_release_binary') {
            throw new Error('Expected the bundled Codex managed release descriptor');
        }
        const assetName = runtimeSpec.managedInstall.assetNameByPlatform?.[platform][process.arch];
        const archiveEntries = runtimeSpec.managedInstall.archiveEntriesByPlatform?.[platform];
        if (!assetName || !archiveEntries) throw new Error('Expected the Codex package archive layout');

        const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-runner-managed-binding-home-'));
        const toolRoot = await mkdtemp(join(tmpdir(), 'happier-runner-managed-binding-tools-'));
        const previousOverride = process.env.HAPPIER_CODEX_PATH;
        try {
            const archiveRoot = join(toolRoot, 'archive');
            for (const entry of archiveEntries) {
                const path = join(archiveRoot, entry.archivePath);
                await mkdir(dirname(path), { recursive: true });
                await writeFile(path, '#!/bin/sh\nprintf %s managed-codex\n', 'utf8');
                await chmod(path, 0o755);
            }
            const prepared = await prepareManagedAgentCliLaunch({
                runtimeSpec,
                platform,
                processEnv: { ...process.env, HAPPIER_HOME_DIR: happyHomeDir, PATH: '' },
                // GitHub is the external boundary; install, archive extraction,
                // executable resolution and plugin execution remain real.
                deps: {
                    fetchGitHubLatestRelease: async () => ({
                        tag_name: 'v0.0.0-fixture',
                        assets: [{
                            name: assetName,
                            browser_download_url: `https://example.test/${assetName}`,
                            digest: 'sha256:fixture',
                        }],
                    }),
                    downloadGitHubReleaseAsset: async ({ destinationPath }) => {
                        await createTar({ gzip: true, cwd: archiveRoot, file: destinationPath },
                            archiveEntries.map((entry) => entry.archivePath));
                    },
                },
            });
            expect(prepared.ok).toBe(true);
            if (!prepared.ok) throw new Error(prepared.errorMessage);
            const managedCommand = join(happyHomeDir, 'tools', 'providers', 'codex', 'current', 'bin', 'codex');
            expect(prepared.resolution.command).toBe(managedCommand);

            const overridePath = join(toolRoot, 'codex-override');
            await writeFile(overridePath, '#!/bin/sh\nprintf %s substituted-override\n', 'utf8');
            await chmod(overridePath, 0o755);
            process.env.HAPPIER_CODEX_PATH = overridePath;

            const bound = bindAgentCliLaunchSpec({ localAgentId: 'codex', spec: prepared.launch });
            const systemTools = createRetainedAgentCliSystemToolService({
                agentId: bound.localAgentId,
                binding: { toolId: 'codex-cli' },
                definition: { toolId: 'codex-cli', displayName: 'Codex CLI', lookupNames: ['codex'] },
                launch: bound.spec,
                delegate: { resolve: async () => { throw new Error('Unexpected system fallback'); } },
            });
            const resolved = await systemTools.resolve({
                toolId: 'codex-cli', purpose: 'Run the prepared Agent', cwd: toolRoot,
            });
            const result = spawnSync(resolved.launch.executablePath, [...(resolved.launch.args ?? [])], {
                cwd: resolved.launch.cwd,
                env: resolved.launch.env,
                encoding: 'utf8',
            });
            expect(result.error).toBeUndefined();
            expect(result.status).toBe(0);
            expect(result.stdout).toBe('managed-codex');
        } finally {
            if (previousOverride === undefined) delete process.env.HAPPIER_CODEX_PATH;
            else process.env.HAPPIER_CODEX_PATH = previousOverride;
            await rm(happyHomeDir, { recursive: true, force: true });
            await rm(toolRoot, { recursive: true, force: true });
        }
    });

    it.each(fixtures)(
        'keeps the canonical $agentId override ahead of a different PATH executable through activated runtime services',
        async (fixture) => {
            if (fixture.readableJavaScriptOverride && process.platform === 'win32') {
                return;
            }

            const happyHomeDir = await mkdtemp(join(tmpdir(), `happier-${fixture.agentId}-binding-home-`));
            const toolRoot = await mkdtemp(join(tmpdir(), `happier-${fixture.agentId}-binding-tools-`));
            const overridePath = join(
                toolRoot,
                fixture.readableJavaScriptOverride
                    ? `${fixture.agentId}-override.js`
                    : `${fixture.agentId}-override`,
            );
            const pathExecutable = join(
                toolRoot,
                process.platform === 'win32' ? `${fixture.agentId}.cmd` : fixture.agentId,
            );
            const previousPath = process.env.PATH;
            const previousOverride = process.env[fixture.overrideEnvKey];
            const previousJavaScriptRuntime = process.env.HAPPIER_JS_RUNTIME_PATH;
            const expectedOutput = `override-${fixture.agentId}`;

            await writeFile(
                overridePath,
                fixture.readableJavaScriptOverride
                    ? `process.stdout.write(${JSON.stringify(expectedOutput)});\n`
                    : process.platform === 'win32'
                        ? `@echo off\r\n<nul set /p "=${expectedOutput}"\r\n`
                        : `#!/bin/sh\nprintf %s ${JSON.stringify(expectedOutput)}\n`,
                'utf8',
            );
            await chmod(overridePath, fixture.readableJavaScriptOverride ? 0o644 : 0o755);
            await writeFile(
                pathExecutable,
                process.platform === 'win32'
                    ? '@echo off\r\n<nul set /p "=path-executable"\r\n'
                    : '#!/bin/sh\nprintf %s path-executable\n',
                'utf8',
            );
            await chmod(pathExecutable, 0o755);
            process.env.PATH = `${toolRoot}${delimiter}${previousPath ?? ''}`;
            process.env[fixture.overrideEnvKey] = overridePath;
            process.env.HAPPIER_JS_RUNTIME_PATH = process.execPath;

            const runtimeRegistry = await resolveExecutablePluginRuntimeRegistry({
                happyHomeDir,
                pluginIds: [fixture.pluginId],
            });
            try {
                await runtimeRegistry.activateContributionsOnDemand([{
                    pluginId: fixture.pluginId,
                    family: 'agents',
                    localId: fixture.agentId,
                }]);
                const services = await runtimeRegistry.createAgentInvocationServices({
                    pluginId: fixture.pluginId,
                    pluginVersion: '0.0.0',
                    agentId: fixture.agentId,
                    generation: String(runtimeRegistry.generation),
                    correlationId: `${fixture.agentId}-binding`,
                    cwd: toolRoot,
                    signal: new AbortController().signal,
                    isGenerationCurrent: () => true,
                });

                const resolved = await services.exec.systemTools.resolve({
                    toolId: fixture.systemToolId,
                    purpose: `Launch ${fixture.agentId}`,
                    cwd: toolRoot,
                });
                expect(resolved).toMatchObject({
                    executablePath: overridePath,
                });
                if (fixture.invokeResolvedTool) {
                    const result = await services.exec.run({
                        executable: resolved.executable,
                        args: [],
                        cwd: { root: 'workspace', relativePath: '' },
                    });
                    expect(result.termination.observed).toMatchObject({
                        kind: 'exit',
                        exitCode: 0,
                    });
                    expect(new TextDecoder().decode(result.stdout)).toBe(expectedOutput);
                }
            } finally {
                await runtimeRegistry.dispose();
                if (previousPath === undefined) delete process.env.PATH;
                else process.env.PATH = previousPath;
                if (previousOverride === undefined) delete process.env[fixture.overrideEnvKey];
                else process.env[fixture.overrideEnvKey] = previousOverride;
                if (previousJavaScriptRuntime === undefined) delete process.env.HAPPIER_JS_RUNTIME_PATH;
                else process.env.HAPPIER_JS_RUNTIME_PATH = previousJavaScriptRuntime;
                await rm(happyHomeDir, { recursive: true, force: true });
                await rm(toolRoot, { recursive: true, force: true });
            }
        },
    );
});
