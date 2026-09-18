import {
  type AgentAcpRuntimeDefinition,
  type AgentExecutionRunOpenRequest,
  type AgentExecutionRunRuntime,
  type AgentExecutionRunRuntimeContextV1,
  type AgentRuntimeFactory,
  type AgentRuntimeContext,
  type AgentSessionOpenRequest,
  type AgentSessionRuntime,
  type AgentSessionRuntimeContext,
} from '@happier-dev/plugin-sdk/agents/runtime';

import {
  resolveOpenCodeBackendMode,
} from './mode.js';
import { OPEN_CODE_SYSTEM_TOOL_ID } from '../systemTool.js';
import { openOpenCodeServerSession } from './server/nativeSession.js';
import { openOpenCodeServerExecutionRun } from './server/nativeExecutionRun.js';
import {
  createOpenCodeNativeSessionControls,
  type OpenCodeActiveSkillsReaderRegistrar,
} from './controls.js';
import { withOpenCodeProviderConfigLaunchEnvironment } from '../providerBinding/runtime.js';
import { prepareOpenCodeQualifiedConnectedAccounts } from '../auth/services/qualifiedPurposeLaunch.js';
import { openCodeHandoffSurface } from '../surfaces/sessions/handoff/descriptor.js';
import { resolveOpenCodeReplayChildLaunch } from '../surfaces/sessions/fork/descriptor.js';

export {
  openCodeExternalSessionsContribution,
} from '../surfaces/sessions/external/contribution.js';

const OPEN_CODE_ACP_RUNTIME_DEFINITION = {
  mcp: { policy: 'pass_through' },
  timeouts: {
    initMs: 60_000,
    toolCallMs: 120_000,
    idleMs: 1_500,
    idleWithoutAssistantMessageMs: 10_000,
  },
} satisfies AgentAcpRuntimeDefinition;

function readOpenCodeNativeMode(
  request: AgentSessionOpenRequest | AgentExecutionRunOpenRequest,
): 'server' | 'acp' {
  const modeOption = request.configuration?.options.opencodeBackendMode?.value;
  return resolveOpenCodeBackendMode({
    env: request.launchEnvironment?.values,
    accountSettings: typeof modeOption === 'string'
      ? { opencodeBackendMode: modeOption }
      : null,
  });
}

async function openOpenCodeAcpExecutionRun(
  request: AgentExecutionRunOpenRequest,
  context: AgentExecutionRunRuntimeContextV1,
): Promise<AgentExecutionRunRuntime> {
  const launchRequest = await withOpenCodeProviderConfigLaunchEnvironment(request);
  return await context.protocols.acp.openExecutionRunV1(launchRequest, {
    transport: {
      kind: 'stdio',
      executable: { kind: 'systemTool', id: OPEN_CODE_SYSTEM_TOOL_ID },
      args: ['acp'],
      env: { NODE_ENV: 'production', DEBUG: '' },
      timeouts: { initializeMs: 60_000, toolCallMs: 120_000, idleMs: 1_500 },
    },
    definition: OPEN_CODE_ACP_RUNTIME_DEFINITION,
  });
}

async function openOpenCodeExecutionRun(
  request: AgentExecutionRunOpenRequest,
  context: AgentExecutionRunRuntimeContextV1,
): Promise<AgentExecutionRunRuntime> {
  const prepared = await prepareOpenCodeQualifiedConnectedAccounts(request, context);
  try {
    if (prepared.isInvalidated()) {
      throw new Error('OpenCode qualified Connected Account launch was invalidated before opening the runtime.');
    }
    const runtime = readOpenCodeNativeMode(prepared.request) === 'acp'
      ? await openOpenCodeAcpExecutionRun(prepared.request, context)
      : await openOpenCodeServerExecutionRun(prepared.request, context);
    if (prepared.isInvalidated()) {
      await runtime.dispose();
      throw new Error('OpenCode qualified Connected Account launch was invalidated while opening the runtime.');
    }
    return prepared.bindExecutionRun(runtime);
  } catch (error) {
    await prepared.dispose();
    throw error;
  }
}

async function openOpenCodeAcpSession(
  request: AgentSessionOpenRequest,
  context: AgentRuntimeContext,
) {
  const launchRequest = await withOpenCodeProviderConfigLaunchEnvironment(request);
  return context.protocols.acp.open(launchRequest, {
    transport: {
      kind: 'stdio',
      executable: {
        kind: 'systemTool',
        id: OPEN_CODE_SYSTEM_TOOL_ID,
      },
      args: ['acp'],
      env: {
        NODE_ENV: 'production',
        DEBUG: '',
      },
      timeouts: {
        initializeMs: 60_000,
        toolCallMs: 120_000,
        idleMs: 1_500,
      },
    },
    definition: OPEN_CODE_ACP_RUNTIME_DEFINITION,
  });
}

async function openOpenCodeSession(
  request: AgentSessionOpenRequest,
  context: AgentRuntimeContext,
  bindActiveSkillsReader: OpenCodeActiveSkillsReaderRegistrar,
): Promise<AgentSessionRuntime> {
  const prepared = await prepareOpenCodeQualifiedConnectedAccounts(request, context);
  try {
    if (prepared.isInvalidated()) {
      throw new Error('OpenCode qualified Connected Account launch was invalidated before opening the runtime.');
    }
    const mode = readOpenCodeNativeMode(prepared.request);
    const session = mode === 'acp'
      ? await openOpenCodeAcpSession(prepared.request, context)
      : await openOpenCodeServerSession(
          prepared.request,
          context,
          (context as Partial<AgentSessionRuntimeContext>).workState,
          bindActiveSkillsReader,
        );
    if (prepared.isInvalidated()) {
      await session.dispose('runtime_recovery');
      throw new Error('OpenCode qualified Connected Account launch was invalidated while opening the runtime.');
    }
    const boundSession = prepared.bindSession(session);
    return {
      ...boundSession,
      ...(mode === 'acp' && typeof boundSession.compact !== 'function'
        ? {
            compact: async () => ({
              status: 'unsupported' as const,
              diagnostic: {
                code: 'opencode_acp_compaction_unsupported',
                severity: 'error' as const,
              },
              retryable: false,
            }),
          }
        : {}),
      runtimeCapabilities: {
        ...boundSession.runtimeCapabilities,
        localControl: mode === 'server'
          ? {
            supported: true,
            topology: 'shared',
            attachStrategy: 'provider_attach',
            remoteWritable: true,
          }
          : null,
        sessionCapabilities: {
          ...boundSession.runtimeCapabilities?.sessionCapabilities,
          sessionListing: 'supported',
          sessionFork: {
            conversation: 'supported',
            fromMessage: mode === 'server' ? 'supported' : 'unsupported',
            ...(mode === 'acp' ? { protocol: 'acp' as const } : {}),
          },
          sessionRollback: { conversation: 'unsupported' },
        },
      },
    };
  } catch (error) {
    await prepared.dispose();
    throw error;
  }
}

export const createOpenCodeAgentRuntime: AgentRuntimeFactory = () => {
  const controlsOwner = createOpenCodeNativeSessionControls();
  return {
    toolExecution: { capability: 'observable' },
    sessions: {
      ...controlsOwner.sessions,
      open: (request, context) => openOpenCodeSession(
        request,
        context,
        controlsOwner.bindActiveSkillsReader,
      ),
      executionRunContextV1: {
        open: (request, context) => openOpenCodeExecutionRun(request, context),
      },
    },
    surfaces: {
      handoff: openCodeHandoffSurface,
      fork: {
        resolveReplayChildLaunch: async ({ parentMetadata }) =>
          await resolveOpenCodeReplayChildLaunch({ parentMetadata }),
      },
    },
  };
};
