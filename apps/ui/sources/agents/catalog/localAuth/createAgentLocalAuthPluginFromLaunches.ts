import type { AgentLocalAuthLaunchKind, AgentLocalAuthPlugin, AgentLocalAuthSupport } from './agentLocalAuthPlugin';
import { createStaticAgentLocalAuthPlugin } from './createStaticAgentLocalAuthPlugin';

export type AgentLocalAuthLaunchDeclaration = Readonly<{
    kind: AgentLocalAuthLaunchKind;
    target?: 'provider_cli' | 'agent_acp';
    args: readonly string[];
    initialInput?: string | null;
}>;

export function createAgentLocalAuthPluginFromLaunches(params: Readonly<{
    agentId: string;
    support: AgentLocalAuthSupport;
    docsUrl?: string | null;
    loginLaunches: readonly AgentLocalAuthLaunchDeclaration[];
}>): AgentLocalAuthPlugin {
    return createStaticAgentLocalAuthPlugin({
        agentId: params.agentId,
        support: params.support,
        ...(params.docsUrl !== undefined ? { docsUrl: params.docsUrl } : {}),
        ...(params.loginLaunches.length > 0
            ? {
                loginLaunchKinds: params.loginLaunches.map((launch) => launch.kind),
                buildLoginLaunch: ({ kind = 'primary' }) => {
                    const launch = params.loginLaunches.find((candidate) => candidate.kind === kind);
                    if (!launch) return null;
                    return {
                        launch: { kind: 'agent_login', agentId: params.agentId, launchId: kind },
                    };
                },
            }
            : {}),
    });
}
