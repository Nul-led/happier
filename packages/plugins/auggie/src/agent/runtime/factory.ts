import type {
  AgentAcpRuntimeOptions,
  AgentRuntimeFactory,
  AgentSessionConfigurationSnapshot,
} from '@happier-dev/plugin-sdk/agents/runtime';

import { buildAuggieAcpArgvFromSessionConfiguration } from '../acp/callbacks.js';
import { AUGGIE_ACP_RUNTIME_DEFINITION } from '../acp/definition.js';

function createAuggieAcpOptions(configuration: AgentSessionConfigurationSnapshot | undefined): AgentAcpRuntimeOptions {
  if (!configuration) throw new Error('Auggie requires the host-projected Agent session configuration');
  return {
    transport: {
      kind: 'stdio',
      executable: { kind: 'systemTool', id: 'auggie-cli' },
      args: buildAuggieAcpArgvFromSessionConfiguration({
        baseArgs: ['--acp'],
        configuration,
      }),
    },
    definition: AUGGIE_ACP_RUNTIME_DEFINITION,
  };
}

export const createAuggieAgentRuntime: AgentRuntimeFactory = () => ({
  sessions: {
    open(request, context) {
      return context.protocols.acp.open(request, createAuggieAcpOptions(request.configuration));
    },
    executionRunContextV1: {
      open: (request, context) => context.protocols.acp.openExecutionRunV1(
        request,
        createAuggieAcpOptions(request.configuration),
      ),
    },
  },
});
