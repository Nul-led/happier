import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createNativeAgentExecutionRunHostServices } from './nativeAgentSessionHostServiceOwners';

describe('createNativeAgentExecutionRunHostServices', () => {
    it('exposes only scope-neutral services and never projects a Run as a Session', async () => {
        const previous = process.env.HAPPIER_FEATURE_EXECUTION_RUNS__ENABLED;
        const controller = new AbortController();
        const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-agent-run-host-services-'));
        const services = createNativeAgentExecutionRunHostServices({
            signal: controller.signal,
            executionRunId: 'run-shared-host-services',
            directory: '/repo',
            machineId: 'machine-1',
            accountSettings: null,
            runtimeRegistry: null,
            runtimeAuthority: { runtimeCapabilities: ['sessionHooks'] },
            pluginId: 'happier.agent.acme',
            agentId: 'acme',
            happyHomeDir,
        });

        try {
            expect(Object.keys(services).sort()).toEqual([
                'dispose',
                'features',
                'fileFollow',
                'hooks',
                'mcp',
                'toolExecution',
            ]);
            delete process.env.HAPPIER_FEATURE_EXECUTION_RUNS__ENABLED;
            expect(services.features.isEnabled('execution.runs')).toBe(true);
            process.env.HAPPIER_FEATURE_EXECUTION_RUNS__ENABLED = '0';
            expect(services.features.isEnabled('execution.runs')).toBe(false);
            await expect(services.mcp.resolveServers()).resolves.toEqual([]);
            await expect(services.toolExecution.before({
                callId: 'call-1',
                name: 'Read',
                input: { path: '/repo/README.md' },
            })).resolves.toEqual({
                status: 'continue',
                input: { path: '/repo/README.md' },
            });

            const forwarderAssets = await services.hooks.resolveForwarderAssets();
            expect(forwarderAssets.sessionForwarderScript).toContain('session_hook_forwarder.cjs');
            const pluginDir = await services.hooks.createPluginDir({
                files: [{ path: 'settings.json', json: { detached: true } }],
            });
            expect((await stat(pluginDir)).isDirectory()).toBe(true);
            const hookServer = await services.hooks.startServer({});
            expect(hookServer.port).toBeGreaterThan(0);
            await hookServer.dispose();

            expect(services.hooks).not.toHaveProperty('publishProviderTranscript');
            expect(services).not.toHaveProperty('transcripts');
            expect(services).not.toHaveProperty('accountUsage');
            expect(services).not.toHaveProperty('terminalHost');
            expect(services).not.toHaveProperty('workflowActivity');
            expect(services).not.toHaveProperty('subagents');
            controller.abort();
            expect(services.features.isEnabled('execution.runs')).toBe(false);
            await services.dispose();
            await expect(stat(pluginDir)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            controller.abort();
            await services.dispose();
            if (previous === undefined) {
                delete process.env.HAPPIER_FEATURE_EXECUTION_RUNS__ENABLED;
            } else {
                process.env.HAPPIER_FEATURE_EXECUTION_RUNS__ENABLED = previous;
            }
            await rm(happyHomeDir, { recursive: true, force: true });
        }
    });
});
