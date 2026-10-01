import type { MachineAgent } from './machineAgentTypes';
import type { CapabilitiesDetectResponse, CliAuthStatusData } from '@/sync/api/capabilities/capabilitiesProtocol';
import { resolveTmuxAvailable } from '@/capabilities/tmuxAvailability';

/** Retained New Session display shape: Agent facts come from inventory, tools from system capabilities. */
export type CLIAvailability = Readonly<{
    available: Readonly<Record<string, boolean | null>>;
    login: Readonly<Record<string, boolean | null>>;
    authStatus: Readonly<Record<string, CliAuthStatusData | null>>;
    resolvedPath: Readonly<Record<string, string | null>>;
    resolvedCommand?: Readonly<Record<string, string | null>>;
    resolutionSource: Readonly<Record<string, 'override' | 'system' | 'managed' | null>>;
    version?: Readonly<Record<string, string | null>>;
    tmux: boolean | null;
    isDetecting: boolean;
    timestamp: number;
    error?: string;
    refresh: (next?: { bypassCache?: boolean; includeLoginStatusForAgentIds?: readonly string[] }) => void;
}>;

/** Legacy display-shape adapter only. No probing or readiness decisions belong here. */
export function projectMachineAgentsToCliAvailability(input: Readonly<{ agents: readonly MachineAgent[]; status: string; lastCheckedAt: number | null; refresh(): Promise<void>; agentIds?: readonly string[]; systemToolCapabilities?: CapabilitiesDetectResponse }>): CLIAvailability {
    const available: Record<string, boolean | null> = {};
    const login: Record<string, boolean | null> = {};
    const authStatus: Record<string, CLIAvailability['authStatus'][string]> = {};
    const version: Record<string, string | null> = {};
    const rows = new Map(input.agents.map((agent) => [agent.agentId, agent]));
    for (const id of input.agentIds ?? rows.keys()) {
        const agent = rows.get(id);
        available[id] = agent && agent.state !== 'checking' && agent.state !== 'unknown' ? agent.installed : null;
        login[id] = !agent || agent.signIn.status === 'unknown' ? null : agent.signIn.status === 'signedIn';
        authStatus[id] = agent ? {
            state: agent.signIn.status === 'signedIn' ? 'logged_in' : agent.signIn.status === 'signedOut' ? 'logged_out' : 'unknown',
            checkedAt: input.lastCheckedAt ?? 0,
            accountLabel: agent.signIn.via?.kind === 'native' ? agent.signIn.via.accountLabel : agent.signIn.via?.profileLabel ?? null,
        } : null;
        version[id] = agent?.version ?? null;
    }
    return { available, login, authStatus, version, resolvedPath: {}, resolvedCommand: {}, resolutionSource: {}, tmux: resolveTmuxAvailable(input.systemToolCapabilities),
        isDetecting: input.status === 'loading', timestamp: input.lastCheckedAt ?? 0,
        ...(input.status === 'error' ? { error: 'Detection error' } : {}), refresh: () => { void input.refresh(); } };
}
