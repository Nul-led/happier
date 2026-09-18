import type {
  AgentExecutionRunOpenRequest,
  AgentExecutionRunConversationRuntimeV1,
  AgentSessionOpenRequest,
  AgentSessionRuntime,
  AgentSessionRuntimeContext,
} from '@happier-dev/plugin-sdk/agents/runtime';
import type {
  ManagedServiceHandle,
  ManagedServiceSnapshot,
  ManagedServiceSpec,
} from '@happier-dev/plugin-sdk/managed-services';

import type { OpenCodeServerEndpoint } from './endpoint.js';
import {
  detectOpenCodeServerDialect,
  resolveRequestedOpenCodeServerDialect,
  usesOpenCodeConnectedServiceRequestAuth,
  type OpenCodeServerDialect,
} from './dialect.js';
import { resolveOpenCodeManagedServerDialect } from './managedServerDialect.js';
import { buildOpenCodeManagedServerAttachSpec } from './attachSpec.js';
import { buildOpenCodeManagedServerSpawnSpec } from './spawnSpec.js';
import { readOpenCodeProviderConfigContent } from '../../providerBinding/runtime.js';
import { scheduleOpenCodeMcpServerRegistration } from './mcpRegistration.js';
import { createOpenCodeServerClient } from './openCodeServerClient.js';
import { createOpenCodeServerTransport } from './transport.js';
import { createOpenCodeServerRuntime } from './runtime.js';
import { createOpenCodeSessionRuntime } from './sessionRuntime.js';
import { createOpenCodeExecutionRunConversation } from './executionRunRuntime.js';
import { projectOpenCodeSessionConfiguration } from './promptConfig.js';
import {
  OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV,
} from './managedServerState.js';
import type { OpenCodeActiveSkillsReaderRegistrar } from '../controls.js';
import type { OpenCodeRuntimeContext } from './runtimeContext.js';
import { OPEN_CODE_MANAGED_SERVER_STARTUP_TIMEOUT_MS } from './timeoutPolicy.js';

type Disposable = Readonly<{ dispose?: () => void | Promise<void> }>;

export type OpenCodeServerRuntimeAssembly<Runtime = AgentSessionRuntime | AgentExecutionRunConversationRuntimeV1> = Readonly<{
  runtime: Runtime;
  dispose(): Promise<void>;
}>;

type ResolvedOpenCodeServer = Readonly<{
  managedService: ManagedServiceHandle;
  observation: Disposable;
  readSnapshot(): ManagedServiceSnapshot;
  /**
   * The generation of the executable Happier spawned for this session, or
   * `null` for a server it only attached to. Readiness and request routing both
   * derive from this one fact, so they cannot disagree.
   */
  managedServerDialect: OpenCodeServerDialect | null;
}>;

async function disposeBestEffort(ctx: OpenCodeRuntimeContext, label: string, disposable: Disposable | null): Promise<void> {
  if (typeof disposable?.dispose !== 'function') return;
  await Promise.resolve(disposable.dispose()).catch((error: unknown) => {
    ctx.logger.debug(`[OpenCodeServer] failed to dispose ${label}`, { error });
  });
}

async function observeHealthyManagedService(params: Readonly<{
  ctx: OpenCodeRuntimeContext;
  managedService: ManagedServiceHandle;
  signal?: AbortSignal;
  failureLabel: string;
  managedServerDialect: OpenCodeServerDialect | null;
}>): Promise<ResolvedOpenCodeServer> {
  let currentSnapshot = params.managedService.snapshot();
  const observation = params.managedService.observe((snapshot) => {
    currentSnapshot = snapshot;
  });
  try {
    currentSnapshot = await params.managedService.waitUntilHealthy({
      timeoutMs: OPEN_CODE_MANAGED_SERVER_STARTUP_TIMEOUT_MS,
      signal: params.signal,
    });
    return {
      managedService: params.managedService,
      observation,
      readSnapshot: () => currentSnapshot,
      managedServerDialect: params.managedServerDialect,
    };
  } catch (error) {
    await disposeBestEffort(params.ctx, `${params.failureLabel} observation`, observation);
    await disposeBestEffort(params.ctx, params.failureLabel, params.managedService);
    throw error;
  }
}

async function resolveOpenCodeServer(params: Readonly<{
  ctx: OpenCodeRuntimeContext;
  directory: string;
  endpoint: OpenCodeServerEndpoint;
  env?: Readonly<Record<string, string>>;
  providerConfigContent?: string;
  permissionMode?: string | null;
  signal?: AbortSignal;
}>): Promise<ResolvedOpenCodeServer> {
  if (params.endpoint.mode === 'external-attach') {
    if (params.providerConfigContent !== undefined) {
      throw new Error('OpenCode Provider binding requires a managed server');
    }
    if (
      typeof params.env?.[OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV] === 'string'
      && params.env[OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV].trim().length > 0
    ) {
      throw new Error('OpenCode isolated authentication requires a managed server');
    }
    const spec: ManagedServiceSpec = buildOpenCodeManagedServerAttachSpec({
      id: 'opencode-server',
      baseUrl: params.endpoint.baseUrl,
    });
    const managedService = await params.ctx.managedServices.supervise(
      spec,
      { signal: params.signal ?? params.ctx.abort.signal },
    );
    return await observeHealthyManagedService({
      ctx: params.ctx,
      managedService,
      signal: params.signal,
      failureLabel: 'external managed server after startup failure',
      managedServerDialect: null,
    });
  }

  const managedServerDialect = await resolveOpenCodeManagedServerDialect({
    exec: params.ctx.exec,
    cwd: params.directory,
    logger: params.ctx.logger,
  });
  const spec: ManagedServiceSpec = buildOpenCodeManagedServerSpawnSpec({
    id: 'opencode-server',
    dialect: managedServerDialect,
    ...(params.env ? { env: params.env } : {}),
    ...(params.permissionMode === undefined
      ? {}
      : { permissionMode: params.permissionMode }),
    ...(params.providerConfigContent === undefined
      ? {}
      : { providerConfigContent: params.providerConfigContent }),
  });
  const managedService = await params.ctx.managedServices.supervise(
    spec,
    { signal: params.signal ?? params.ctx.abort.signal },
  );
  return await observeHealthyManagedService({
    ctx: params.ctx,
    managedService,
    signal: params.signal,
    failureLabel: 'managed server after startup failure',
    managedServerDialect,
  });
}

type OpenCodeServerRuntimeAssemblyCommon = Readonly<{
  ctx: OpenCodeRuntimeContext;
  directory: string;
  endpoint: OpenCodeServerEndpoint;
  env?: Readonly<Record<string, string>>;
  permissionMode?: string | null;
  mcpServers?: unknown;
  signal?: AbortSignal;
  models?: AgentSessionRuntimeContext['session']['services']['models'];
  bindActiveSkillsReader?: OpenCodeActiveSkillsReaderRegistrar;
}>;

type OpenCodeServerSessionRuntimeAssemblyParams = OpenCodeServerRuntimeAssemblyCommon & Readonly<{
      happierSessionId: string;
      executionRunId?: never;
      request: AgentSessionOpenRequest;
    }>;
type OpenCodeServerExecutionRunAssemblyParams = OpenCodeServerRuntimeAssemblyCommon & Readonly<{
      executionRunId: string;
      happierSessionId?: never;
      request: AgentExecutionRunOpenRequest;
    }>;
type OpenCodeServerRuntimeAssemblyParams =
  | OpenCodeServerSessionRuntimeAssemblyParams
  | OpenCodeServerExecutionRunAssemblyParams;

export function createOpenCodeServerRuntimeAssembly(
  params: OpenCodeServerSessionRuntimeAssemblyParams,
): Promise<OpenCodeServerRuntimeAssembly<AgentSessionRuntime>>;
export function createOpenCodeServerRuntimeAssembly(
  params: OpenCodeServerExecutionRunAssemblyParams,
): Promise<OpenCodeServerRuntimeAssembly<AgentExecutionRunConversationRuntimeV1>>;

export async function createOpenCodeServerRuntimeAssembly(
  params: OpenCodeServerRuntimeAssemblyParams,
): Promise<OpenCodeServerRuntimeAssembly> {
  let managedService: ManagedServiceHandle | null = null;
  let managedServiceObservation: Disposable | null = null;
  let disposed = false;
  try {
    const providerConfigContent = await readOpenCodeProviderConfigContent(params.request);
    const server = await resolveOpenCodeServer({
      ctx: params.ctx,
      directory: params.directory,
      endpoint: params.endpoint,
      env: params.env,
      providerConfigContent,
      permissionMode: params.permissionMode,
      signal: params.signal,
    });
    managedService = server.managedService;
    managedServiceObservation = server.observation;
    const transport = createOpenCodeServerTransport({
      managedService: server.managedService,
      signal: params.signal ?? params.ctx.abort.signal,
    });
    // One dialect decision per server, taken after the managed service is
    // healthy and before any operation runs, so every call in this session
    // agrees on which OpenCode surface it is talking to.
    const launchValues: Readonly<Record<string, unknown>> = {
      ...(params.ctx.config?.values ?? {}),
      ...(params.env ?? {}),
    };
    const dialectDetection = await detectOpenCodeServerDialect({
      fetch: transport.request,
      // Same resolution order as the server-URL override in `endpoint.ts`:
      // the session's own launch environment wins over the launch-environment
      // defaults the runtime context carries. A server Happier spawned itself
      // additionally asks for the generation of the binary it resolved, so an
      // owned `opencode2` child is not left requesting V1 root routes it never
      // mounts.
      requested: resolveRequestedOpenCodeServerDialect({
        values: launchValues,
        managedServerDialect: server.managedServerDialect,
      }),
    });
    params.ctx.logger.info('[OpenCodeServer] resolved OpenCode server dialect', {
      dialect: dialectDetection.dialect,
      requested: dialectDetection.requested,
      ...(dialectDetection.probe === null
        ? {}
        : {
            probePath: dialectDetection.probe.path,
            probeStatus: dialectDetection.probe.status,
            ...(dialectDetection.probe.error === undefined
              ? {}
              : { probeError: dialectDetection.probe.error }),
          }),
    });
    if (
      dialectDetection.dialect === 'v2'
      && usesOpenCodeConnectedServiceRequestAuth(launchValues)
    ) {
      // Happier's request-auth plugin is written against OpenCode's V1 plugin
      // contract, which has no counterpart in the V2 plugin context. Report the
      // exact unproven combination on a default-on signal instead of letting it
      // surface later as an opaque upstream 401.
      params.ctx.logger.warn(
        '[OpenCodeServer] connected-account request auth is unproven on the OpenCode V2 beta transport',
        {
          dialect: dialectDetection.dialect,
          reason: 'v1_auth_plugin_contract_has_no_v2_counterpart',
        },
      );
    }
    const client = createOpenCodeServerClient({
      transport,
      directory: params.directory,
      dialect: dialectDetection.dialect,
    });
    const mcpRegistration = scheduleOpenCodeMcpServerRegistration({
      ctx: params.ctx,
      client,
      directory: params.directory,
      mcpServers: params.mcpServers,
    });
    const operations = createOpenCodeServerRuntime({
      ctx: params.ctx,
      directory: params.directory,
      ...(params.executionRunId === undefined
        ? { happierSessionId: params.happierSessionId }
        : { executionRunId: params.executionRunId }),
      client,
      env: params.env,
      readManagedServiceSnapshot: () => server.readSnapshot(),
      mcpRegistration,
    });
    await operations.openSession(params.executionRunId === undefined
      ? params.request.kind === 'create'
        ? { kind: 'create' }
        : params.request.kind === 'resume'
          ? { kind: 'resume', providerSessionId: params.request.providerSessionId }
          : {
              kind: 'fork',
              source: {
                providerSessionId: params.request.source.providerSessionId,
                ...(params.request.source.target?.providerCheckpoint === undefined
                  ? {}
                  : { providerCheckpoint: params.request.source.target.providerCheckpoint }),
              },
            }
      : params.request.kind === 'create'
        ? { kind: 'create' }
        : params.request.kind === 'resume'
          ? { kind: 'resume', providerSessionId: params.request.checkpointId }
          : params.request.checkpointId
            ? { kind: 'fork', source: { providerSessionId: params.request.checkpointId } }
            : (() => { throw new Error('OpenCode execution-run fork requires a provider checkpoint'); })());
    if (params.request.configuration) {
      const projection = projectOpenCodeSessionConfiguration(params.request.configuration);
      for (const update of projection.updates) {
        await operations.updateSessionRuntimeConfig(update);
      }
    }
    const dispose = async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      await operations.resetOrDisposeRuntime();
      await disposeBestEffort(params.ctx, 'managed service observation', managedServiceObservation);
      await disposeBestEffort(params.ctx, 'managed service', managedService);
    };
    const runtime = params.executionRunId === undefined
      ? createOpenCodeSessionRuntime({
          operations,
          request: params.request,
          disposeOperations: dispose,
          ...(params.models ? { models: params.models } : {}),
          ...(params.bindActiveSkillsReader
            ? { bindActiveSkillsReader: params.bindActiveSkillsReader }
            : {}),
        })
      : createOpenCodeExecutionRunConversation({
          operations,
          executionRunId: params.executionRunId,
          disposeOperations: dispose,
        });

    return {
      runtime,
      dispose,
    };
  } catch (error) {
    await disposeBestEffort(params.ctx, 'managed service observation', managedServiceObservation);
    await disposeBestEffort(params.ctx, 'managed service', managedService);
    throw error;
  }
}
