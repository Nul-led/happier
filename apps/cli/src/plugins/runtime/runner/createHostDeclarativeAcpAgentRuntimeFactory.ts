import type {
    AgentExecutionRunOpenRequest,
    AgentExecutionRunRuntimeContextV1,
    AgentRuntimeFactory,
    AgentSessionOpenRequest,
    AgentSessionRuntimeContext,
} from '@happier-dev/plugin-sdk/agents/runtime';

import type {
    NormalizedPluginDeclarativeAcpRuntime,
} from '@/agent/acp/runtime/definition/plugin';

export function createHostDeclarativeAcpAgentRuntimeFactory(
    runtime: NormalizedPluginDeclarativeAcpRuntime,
    options: Readonly<{ executionRunContextV1: boolean }>,
): AgentRuntimeFactory {
    return async () => Object.freeze({
        sessions: Object.freeze({
            async open(
                request: AgentSessionOpenRequest,
                context: AgentSessionRuntimeContext,
            ) {
                return await context.protocols.acp.open(request, runtime);
            },
            ...(options.executionRunContextV1
                ? {
                    executionRunContextV1: Object.freeze({
                        async open(
                            request: AgentExecutionRunOpenRequest,
                            context: AgentExecutionRunRuntimeContextV1,
                        ) {
                            return await context.protocols.acp.openExecutionRunV1(request, runtime);
                        },
                    }),
                }
                : {}),
        }),
    });
}
