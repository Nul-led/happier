import type {
  AgentAcpRuntimeOptions,
  AgentRuntimeFactory,
  AgentSessionConfigurationSnapshot,
  AgentSessionOpenRequest,
} from '@happier-dev/plugin-sdk/agents/runtime';

import { buildKiloAcpEnv } from '../acp/callbacks.js';
import { KILO_ACP_RUNTIME_DEFINITION } from '../acp/definition.js';

function createKiloAcpOptions(
  request: Pick<AgentSessionOpenRequest, 'launchEnvironment'> & Readonly<{
    configuration?: AgentSessionConfigurationSnapshot;
  }>,
): AgentAcpRuntimeOptions {
  if (!request.configuration) throw new Error('Kilo requires the host-projected Agent session configuration');
  return {
    transport: {
      kind: 'stdio',
      executable: { kind: 'systemTool', id: 'kilo-cli' },
      args: ['acp'],
      env: buildKiloAcpEnv({
        launchEnvironment: request.launchEnvironment,
        permissionIntent: request.configuration.permissionIntent.value,
      }),
    },
    definition: KILO_ACP_RUNTIME_DEFINITION,
  };
}

export const createKiloAgentRuntime: AgentRuntimeFactory = () => ({
  sessions: {
    open(request, context) {
      return context.protocols.acp.open(request, createKiloAcpOptions(request));
    },
    executionRunContextV1: {
      open: (request, context) => context.protocols.acp.openExecutionRunV1(
        request,
        createKiloAcpOptions(request),
      ),
    },
  },
});
