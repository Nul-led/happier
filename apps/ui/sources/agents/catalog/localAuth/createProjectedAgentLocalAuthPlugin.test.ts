import { describe, expect, it } from 'vitest';

import { createProjectedAgentLocalAuthPlugin } from './createProjectedAgentLocalAuthPlugin';

describe('createProjectedAgentLocalAuthPlugin', () => {
    it('exposes ordered native login intents for daemon resolution', () => {
        const plugin = createProjectedAgentLocalAuthPlugin({
            agentId: 'acme',
            cli: {
                executable: {
                    binaryName: 'acme',
                    sourcePreference: 'system-first',
                },
                install: {
                    manual: { kind: 'none' },
                    docsUrl: 'https://example.com/acme/auth',
                },
                auth: {
                    support: 'login_terminal',
                    loginLaunches: [
                        { kind: 'primary', args: ['login'] },
                        { kind: 'device_code', args: ['login', '--device-code'] },
                    ],
                },
            },
        });

        expect(plugin.loginLaunchKinds).toEqual(['primary', 'device_code']);
        expect(plugin.docsUrl).toBe('https://example.com/acme/auth');
        expect(plugin.buildLoginLaunch?.({
            kind: 'primary',
            resolvedCommand: "'/opt/runtime/bun' '/opt/acme/acme.js'",
            platform: 'darwin',
        })).toEqual({
            launch: { kind: 'agent_login', agentId: 'acme', launchId: 'primary' },
        });
        expect(plugin.buildLoginLaunch?.({
            kind: 'device_code',
            resolvedPath: '/Applications/Acme CLI/bin/acme',
            platform: 'darwin',
        })).toEqual({
            launch: { kind: 'agent_login', agentId: 'acme', launchId: 'device_code' },
        });
    });

    it('does not copy executable paths or manifest arguments into a UI shell command', () => {
        const plugin = createProjectedAgentLocalAuthPlugin({
            agentId: 'acme',
            cli: {
                executable: {
                    binaryName: 'acme',
                    sourcePreference: 'system-first',
                },
                install: {
                    manual: { kind: 'none' },
                },
                auth: {
                    support: 'login_terminal',
                    loginLaunches: [{
                        kind: 'primary',
                        args: ['login', '--account', 'Jane Doe', '$(touch /tmp/not-run)', "O'Brien"],
                    }],
                },
            },
        });

        expect(plugin.buildLoginLaunch?.({
            kind: 'primary',
            resolvedPath: '/opt/acme',
            platform: 'darwin',
        })).toEqual({
            launch: { kind: 'agent_login', agentId: 'acme', launchId: 'primary' },
        });
    });

    it('projects ACP login through the same daemon-owned intent', () => {
        const plugin = createProjectedAgentLocalAuthPlugin({
            agentId: 'antigravity',
            cli: {
                executable: {
                    binaryName: 'agy',
                    sourcePreference: 'system-first',
                },
                install: { manual: { kind: 'none' } },
                auth: {
                    support: 'login_terminal',
                    loginLaunches: [{ kind: 'primary', target: 'agent_acp', args: [] }],
                },
            },
        });

        expect(plugin.buildLoginLaunch?.({ kind: 'primary' })).toEqual({
            launch: {
                kind: 'agent_login',
                agentId: 'antigravity',
                launchId: 'primary',
            },
        });
    });
});
