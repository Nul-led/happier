import type {
  AgentAcpRuntimeOptions,
  AgentRuntimeFactory,
  AgentSessionConfigurationSnapshot,
} from '@happier-dev/plugin-sdk/agents/runtime';

import { buildQwenAcpArgv } from '../acp/approvalMode.js';
import { QWEN_ACP_RUNTIME_DEFINITION } from '../acp/definition.js';

function createQwenAcpOptions(
  configuration: AgentSessionConfigurationSnapshot | undefined,
): AgentAcpRuntimeOptions {
  if (!configuration) {
    throw new Error('Qwen requires the host-projected Agent session configuration');
  }
  return {
    transport: {
      kind: 'stdio',
      executable: { kind: 'systemTool', id: 'qwen-cli' },
      args: buildQwenAcpArgv({
        baseArgs: ['--acp'],
        permissionIntent: configuration.permissionIntent.value,
      }),
    },
    definition: QWEN_ACP_RUNTIME_DEFINITION,
  };
}

export const createQwenAgentRuntime: AgentRuntimeFactory = () => ({
  sessions: {
    open(request, context) {
      return context.protocols.acp.open(request, createQwenAcpOptions(request.configuration));
    },
    executionRunContextV1: {
      open: (request, context) => context.protocols.acp.openExecutionRunV1(
        request,
        createQwenAcpOptions(request.configuration),
      ),
    },
  },
});
