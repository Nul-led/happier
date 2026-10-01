import {
    ACP_HAPPIER_MCP_BRIDGE_STATIC_APPROVAL_TOOL_NAMES,
    resolveAcpToolPermissionPolicy,
} from '@happier-dev/plugin-sdk/agents/runtime';

import {
    createCodexInjectedMcpServerKey,
    isFirstPartyHappierMcpBridgeServerName,
} from '../../../mcp/serverKeys.js';
import { readCodexAppServerStartupRpcTimeoutMs } from '../client/timeout.js';

export type CodexAppServerMcpServerConfig = Readonly<{
    command: string;
    args?: readonly string[];
    env?: Readonly<Record<string, string>>;
}>;

const MAX_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS = 2_147_000_000;
// Happier execution waits may omit their deadline, but Codex requires a fixed positive
// tool_timeout_sec. Use the Node-safe maximum (~24.8 days) as the closest supported outer
// safety ceiling; this intentionally approximates rather than claims to be an unbounded wait.
const DEFAULT_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS = MAX_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS;
const MIN_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS = 60_000;

const CODEX_HAPPIER_MCP_STATIC_APPROVAL_TOOL_NAME_SET = new Set(
    ACP_HAPPIER_MCP_BRIDGE_STATIC_APPROVAL_TOOL_NAMES.filter((toolName) => (
        resolveAcpToolPermissionPolicy('plan')[toolName] === 'allow'
    )),
);

function readCodexHappierMcpToolCallTimeoutMs(
    processEnv: Readonly<Record<string, string | undefined>> | undefined,
): number {
    const parsed = Number.parseInt(
        String(processEnv?.HAPPIER_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS ?? '').trim(),
        10,
    );
    if (!Number.isFinite(parsed) || parsed < MIN_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS) {
        return DEFAULT_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS;
    }
    return Math.min(parsed, MAX_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS);
}

function quoteTomlString(value: string): string {
    return JSON.stringify(value);
}

function serializeTomlStringArray(values: readonly string[]): string {
    return `[${values.map((value) => quoteTomlString(value)).join(',')}]`;
}

function serializeTomlInlineTable(values: Readonly<Record<string, string>>): string {
    const entries = Object.entries(values)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${quoteTomlString(value)}`);
    return `{${entries.join(',')}}`;
}

function assignInjectedServerKeys(serverNames: readonly string[]): Map<string, string> {
    const assigned = new Map<string, string>();
    const usedKeys = new Set<string>();

    for (const serverName of [...serverNames].sort((left, right) => left.localeCompare(right))) {
        if ((serverName === 'happier' || serverName === 'happy') && !usedKeys.has(serverName)) {
            usedKeys.add(serverName);
            assigned.set(serverName, serverName);
            continue;
        }

        const baseKey = createCodexInjectedMcpServerKey(serverName);
        let candidate = baseKey;
        let suffix = 2;
        while (usedKeys.has(candidate)) {
            candidate = `${baseKey}_${suffix}`;
            suffix += 1;
        }
        usedKeys.add(candidate);
        assigned.set(serverName, candidate);
    }

    return assigned;
}

function appendHappierMcpStaticApprovalOverrides(overrides: string[], injectedKey: string): void {
    for (const toolName of ACP_HAPPIER_MCP_BRIDGE_STATIC_APPROVAL_TOOL_NAMES) {
        if (!CODEX_HAPPIER_MCP_STATIC_APPROVAL_TOOL_NAME_SET.has(toolName)) continue;
        overrides.push(`mcp_servers.${injectedKey}.tools.${toolName}.approval_mode=${quoteTomlString('approve')}`);
    }
}

export function buildCodexAppServerConfigOverrides(
    mcpServers: Readonly<Record<string, CodexAppServerMcpServerConfig>>,
    options: Readonly<{
        processEnv?: Readonly<Record<string, string | undefined>>;
    }> = {},
): string[] {
    const serverNames = Object.keys(mcpServers);
    if (serverNames.length === 0) {
        return [];
    }

    const injectedKeys = assignInjectedServerKeys(serverNames);
    const overrides: string[] = [];

    const hasFirstPartyHappierMcpServer = serverNames.some(isFirstPartyHappierMcpBridgeServerName);
    const happierMcpStartupTimeoutMs = readCodexAppServerStartupRpcTimeoutMs(options.processEnv ?? {});
    if (hasFirstPartyHappierMcpServer) {
        // Recent Codex versions otherwise give optional MCP servers only a short shared grace
        // while building the first turn's tool catalog. Keep Happier optional, but let its tools
        // use the same bounded startup budget as the app-server connection itself.
        overrides.push(`mcp_optional_startup_grace_ms=${happierMcpStartupTimeoutMs}`);
    }

    for (const serverName of [...serverNames].sort((left, right) => left.localeCompare(right))) {
        const config = mcpServers[serverName];
        const injectedKey = injectedKeys.get(serverName);
        if (!injectedKey) continue;

        overrides.push(`mcp_servers.${injectedKey}.command=${quoteTomlString(config.command)}`);
        if (Array.isArray(config.args) && config.args.length > 0) {
            overrides.push(`mcp_servers.${injectedKey}.args=${serializeTomlStringArray(config.args)}`);
        }
        if (config.env && Object.keys(config.env).length > 0) {
            overrides.push(`mcp_servers.${injectedKey}.env=${serializeTomlInlineTable(config.env)}`);
        }
        overrides.push(`mcp_servers.${injectedKey}.enabled=true`);
        if (isFirstPartyHappierMcpBridgeServerName(serverName)) {
            overrides.push(`mcp_servers.${injectedKey}.startup_timeout_sec=${happierMcpStartupTimeoutMs / 1_000}`);
            const timeoutMs = readCodexHappierMcpToolCallTimeoutMs(options.processEnv);
            overrides.push(`mcp_servers.${injectedKey}.tool_timeout_sec=${timeoutMs / 1_000}`);
            appendHappierMcpStaticApprovalOverrides(overrides, injectedKey);
        }
    }

    return overrides;
}
