import type { AgentPreflightSessionControlsContributionV1 } from '@happier-dev/plugin-sdk/agents/runtime';

import { projectCopilotPreflightModels } from './modelControls.js';

const COMMAND = Object.freeze({ toolId: 'copilot-cli', args: Object.freeze(['--acp']) });

export const COPILOT_PREFLIGHT_SESSION_CONTROLS = Object.freeze({
  jsonRpcCommands: [COMMAND],
  probeModels: (context) => context.withDeclaredJsonRpcClient(COMMAND, async (client) => {
    await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    return projectCopilotPreflightModels(await client.request('session/new', { cwd: context.cwd, mcpServers: [] }));
  }),
} satisfies AgentPreflightSessionControlsContributionV1);
