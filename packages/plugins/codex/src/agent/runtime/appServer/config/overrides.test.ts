import { describe, expect, it } from 'vitest';

import { buildCodexAppServerConfigOverrides } from './overrides';

describe('buildCodexAppServerConfigOverrides', () => {
    it('translates materialized Happier MCP servers into additive app-server config overrides', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            happier: {
                command: '/tmp/happier-mcp-bridge',
                args: ['--url', 'http://127.0.0.1:0'],
                env: {
                    HAPPIER_MCP_REMOTE_BRIDGE_CONFIG_FILE: '/tmp/bridge-config.json',
                },
            },
        });

        expect(overrides).toEqual([
            'mcp_optional_startup_grace_ms=60000',
            'mcp_servers.happier.command="/tmp/happier-mcp-bridge"',
            'mcp_servers.happier.args=["--url","http://127.0.0.1:0"]',
            'mcp_servers.happier.env={HAPPIER_MCP_REMOTE_BRIDGE_CONFIG_FILE="/tmp/bridge-config.json"}',
            'mcp_servers.happier.enabled=true',
            'mcp_servers.happier.startup_timeout_sec=60',
            'mcp_servers.happier.tool_timeout_sec=2147000',
            'mcp_servers.happier.tools.action_options_resolve.approval_mode="approve"',
            'mcp_servers.happier.tools.action_spec_get.approval_mode="approve"',
            'mcp_servers.happier.tools.action_spec_search.approval_mode="approve"',
            'mcp_servers.happier.tools.change_title.approval_mode="approve"',
            'mcp_servers.happier.tools.execution_run_get.approval_mode="approve"',
            'mcp_servers.happier.tools.execution_run_list.approval_mode="approve"',
            'mcp_servers.happier.tools.execution_run_wait.approval_mode="approve"',
            'mcp_servers.happier.tools.session_title_set.approval_mode="approve"',
        ]);
    });

    it('uses the app-server startup budget for optional Happier MCP discovery without making it required', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            happier: { command: 'happier-mcp' },
        }, {
            processEnv: {
                HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '90000',
            },
        });

        expect(overrides).toContain('mcp_optional_startup_grace_ms=90000');
        expect(overrides).toContain('mcp_servers.happier.startup_timeout_sec=90');
        expect(overrides.some((override) => override.includes('.required='))).toBe(false);
    });

    it('prefixes configured server names so user Codex MCP entries cannot collide with Happier-injected ones', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            context7: {
                command: 'echo',
                args: ['hello'],
            },
            'server.with spaces': {
                command: 'node',
            },
        });

        expect(overrides).toContain('mcp_servers.happier__context7.command="echo"');
        expect(overrides).toContain('mcp_servers.happier__server_with_spaces.command="node"');
        expect(overrides).not.toContain('mcp_servers.context7.command="echo"');
        expect(overrides.some((override) => override.includes('.tool_timeout_sec='))).toBe(false);
        expect(overrides.some((override) => override.includes('.tools.change_title.approval_mode'))).toBe(false);
    });

    it('uses the bounded configured timeout only for the first-party Happier MCP bridge', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            happier: { command: 'happier-mcp' },
            context7: { command: 'context7-mcp' },
        }, {
            processEnv: {
                HAPPIER_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS: '7230500',
            },
        });

        expect(overrides).toContain('mcp_servers.happier.tool_timeout_sec=7230.5');
        expect(overrides.some((override) => (
            override.startsWith('mcp_servers.happier__context7.')
            && override.includes('tool_timeout_sec')
        ))).toBe(false);
    });

    it('falls back to the safe default and caps oversized configured timeouts', () => {
        const servers = { happier: { command: 'happier-mcp' } };

        expect(buildCodexAppServerConfigOverrides(servers, {
            processEnv: { HAPPIER_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS: 'not-a-number' },
        })).toContain('mcp_servers.happier.tool_timeout_sec=2147000');
        expect(buildCodexAppServerConfigOverrides(servers, {
            processEnv: { HAPPIER_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS: '59999' },
        })).toContain('mcp_servers.happier.tool_timeout_sec=2147000');
        expect(buildCodexAppServerConfigOverrides(servers, {
            processEnv: { HAPPIER_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS: '999999999999' },
        })).toContain('mcp_servers.happier.tool_timeout_sec=2147000');
    });

    it('does not generate ambiguous injected server keys with namespace separators in the sanitized fragment', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            'foo__bar': {
                command: 'echo',
            },
        });

        expect(overrides).toContain('mcp_servers.happier__foo_bar.command="echo"');
        expect(overrides).not.toContain('mcp_servers.happier__foo__bar.command="echo"');
    });
});
