import type { McpServerConfig } from '@/agent';
import { createHappierMcpBridge } from '@/agent/runtime/createHappierMcpBridge';
import type { ExecutionRunOccurrenceWitnessV1 } from '@/agent/runtime/bridges/executionRun/runOccurrenceWitness';
import type { AgentInvocationTurnAdmissionWitness } from '@/plugins/runtime/invocation/services/types';
import type { StoredCredentials } from '@/persistence';
import { logger } from '@/ui/logger';
import {
  readSessionMcpSelectionV1FromMetadata,
  SESSION_RUN_PROMPT_READ_ACTION_IDS_V1,
  type AccountSettings,
  type ActionExecutorDeps,
  type SessionRunPromptReadActionIdV1,
} from '@happier-dev/protocol';

import { readMcpServersSettingsFromAccountSettings } from '../servers/readMcpServersSettingsFromAccountSettings';
import { resolveManagedSessionMcpSelectionForDirectory } from '../servers/resolveManagedSessionMcpSelectionForDirectory';
import {
  deriveSettingsSecretsKeyForCredentials,
  deriveSettingsSecretsReadKeysForCredentials,
} from '../servers/resolveMcpValueRefPlaintext';
import { materializeMcpServerConfigRecord } from '../servers/materializeMcpServerConfigRecord';
import { mergeWithBuiltInHappierMcpServer } from '../servers/mergeWithBuiltInHappierMcpServer';
import {
  createSavedSecretMaterializerV1,
  type SavedSecretCatalogResourceInputV1,
} from '@/settings/secrets/savedSecretCatalog';

import type { HappyMcpSessionClient } from '../startHappyServer';
import type { RuntimeActionSettingsProvider } from '@/settings/actionsSettingsProvider';
import type { PluginRuntimeRegistryLease } from '@/plugins/runtime/reload/controller';

/**
 * The exact Session-owned Run whose authority this MCP profile serves.
 *
 * `readCurrentRunOccurrence` projects the bridge's canonical controller entry,
 * deliberately read per request: the built-in Happier server is rebuilt for each
 * MCP call, so a resumed or replaced controller occurrence must stop supplying
 * authority without rebuilding the server.
 */
export type ExecutionRunMcpBinding = Readonly<{
  runId: string;
  /** The Run's working location; the parent Session remains the resource scope. */
  cwd: string;
  /** The Run runtime's own lifetime, not the parent Session's. */
  signal: AbortSignal;
  isCurrent: () => boolean;
  getPermissionMode?: NonNullable<HappyMcpSessionClient['getPermissionMode']>;
  /** This Run's own admitted turn; `null` between turns and once superseded. */
  readActiveTurnAdmissionWitness: () => AgentInvocationTurnAdmissionWitness | null;
  readCurrentRunOccurrence: (runId: string) => ExecutionRunOccurrenceWitnessV1 | null;
}>;

function createRunScopedMcpSessionView(
  session: HappyMcpSessionClient,
  run: ExecutionRunMcpBinding,
): HappyMcpSessionClient {
  const readWitness = (): AgentInvocationTurnAdmissionWitness | null => {
    // Currentness is the occurrence owner's answer, never the caller's guess.
    if (!run.readCurrentRunOccurrence(run.runId)) return null;
    return run.readActiveTurnAdmissionWitness();
  };
  return {
    ...session,
    // Class prototype methods are not preserved by object spread. Forward the
    // admitted Session transport's immutable Home binding explicitly so a
    // Run-scoped MCP view cannot fall back to ambient Home configuration.
    getServerBinding: () => session.getServerBinding(),
    ...(session.getStoredContentEncryptionContext
      ? { getStoredContentEncryptionContext: () => session.getStoredContentEncryptionContext!() }
      : {}),
    getPermissionMode: run.getPermissionMode ?? session.getPermissionMode,
    getActiveTurnPermissionWitness: () => {
      const witness = readWitness();
      return witness
        ? {
          turnId: witness.turnId,
          ...(witness.causalPermissionAuthority
            ? { causalPermissionAuthority: witness.causalPermissionAuthority }
            : {}),
        }
        : null;
    },
    getRuntimeLifetimeSignal: () => run.signal,
    getSessionActionConfirmationBinding: () => {
      const occurrence = run.readCurrentRunOccurrence(run.runId);
      const witness = occurrence ? run.readActiveTurnAdmissionWitness() : null;
      if (!occurrence || !witness) return null;
      const { occurrenceId, sidechainId } = occurrence;
      return {
        turnId: witness.turnId,
        lifetimeSignal: run.signal,
        // A superseded occurrence, a retired turn, or a cancelled controller all
        // retire an already issued confirmation without a second decision owner.
        isCurrent: () => {
          const current = run.readCurrentRunOccurrence(run.runId);
          return current?.occurrenceId === occurrenceId
            && run.isCurrent()
            && run.readActiveTurnAdmissionWitness()?.turnId === witness.turnId;
        },
        run: { runId: run.runId, occurrenceId, sidechainId },
      };
    },
    getCurrentSessionLocation: () => ({
      ...(session.getCurrentSessionLocation?.() ?? {}),
      path: run.cwd,
    }),
  };
}

export async function resolveRunnerMcpServers(params: Readonly<{
  session: HappyMcpSessionClient;
  credentials: StoredCredentials;
  /** Account-wide Action authority; explicit null keeps the runtime Session-scoped. */
  accountCredentials?: StoredCredentials | null;
  sessionList?: ActionExecutorDeps['sessionList'];
  accountSettings: AccountSettings | null;
  /** Exact runtime policy when ambient Account settings are intentionally unavailable. */
  actionsSettingsProvider?: RuntimeActionSettingsProvider;
  /** Exact caller-owned registry lease for daemonless scoped runtimes. */
  pluginRuntimeRegistryLease?: PluginRuntimeRegistryLease;
  machineId: string;
  directory: string;
  sessionMetadata?: Readonly<Record<string, unknown>> | null;
  env?: NodeJS.ProcessEnv;
  tmpDir?: string | null;
  commandMode?: NonNullable<Parameters<typeof createHappierMcpBridge>[1]>['commandMode'];
  resolvedMcpServers?: Record<string, McpServerConfig>;
  /**
   * Binds this resolution to one Session-owned Execution Run occurrence.
   *
   * The parent Session stays the resource scope and keeps its own configured
   * server profile; only permission mode, working location, runtime lifetime and
   * turn authority come from the Run. The Run's concurrently active parent turn
   * is never substituted for it.
   */
  executionRun?: ExecutionRunMcpBinding;
  savedSecretResources?: readonly SavedSecretCatalogResourceInputV1[];
}>): Promise<Readonly<{
  happierMcpServer: {
    url: string;
    supportedSessionReadActions: readonly SessionRunPromptReadActionIdV1[];
    stop: () => void;
  };
  mcpServers: Record<string, McpServerConfig>;
  }>> {
  const env = params.env ?? process.env;
  const accountCredentials = Object.hasOwn(params, 'accountCredentials')
    ? params.accountCredentials ?? null
    : params.credentials;
  const accountSettings = accountCredentials ? params.accountSettings ?? null : null;

  const run = params.executionRun;
  const scopedSession: HappyMcpSessionClient = run
    ? createRunScopedMcpSessionView(params.session, run)
    : params.session;
  const builtIn = await createHappierMcpBridge(scopedSession, {
    commandMode: params.commandMode,
    sessionCredentials: params.credentials,
    credentials: accountCredentials,
    authorityScope: accountCredentials ? 'account' : 'session',
    ...(params.sessionList ? { sessionList: params.sessionList } : {}),
    accountSettings,
    ...(params.actionsSettingsProvider
      ? { actionsSettingsProvider: params.actionsSettingsProvider }
      : {}),
    ...(params.pluginRuntimeRegistryLease
      ? { pluginRuntimeRegistryLease: params.pluginRuntimeRegistryLease }
      : {}),
    requiredDirectActionIds: run ? SESSION_RUN_PROMPT_READ_ACTION_IDS_V1 : undefined,
  });

  if (!accountSettings || !accountCredentials) {
    return { happierMcpServer: builtIn.happierMcpServer, mcpServers: params.resolvedMcpServers ? mergeWithBuiltInHappierMcpServer({ builtIn: builtIn.mcpServers, extra: params.resolvedMcpServers }) : builtIn.mcpServers };
  }

  const mcpSettings = readMcpServersSettingsFromAccountSettings(accountSettings);
  const resolvedSelection = resolveManagedSessionMcpSelectionForDirectory({
    settings: mcpSettings,
    machineId: params.machineId,
    directory: params.directory,
    selection: readSessionMcpSelectionV1FromMetadata(params.sessionMetadata ?? null),
  });

  const settingsSecretsKey = accountCredentials.encryption
    ? deriveSettingsSecretsKeyForCredentials(accountCredentials)
    : null;
  const settingsSecretsReadKeys = deriveSettingsSecretsReadKeysForCredentials(accountCredentials);
  const savedSecretMaterializer = createSavedSecretMaterializerV1({
    accountSettings,
    settingsSecretsReadKeys,
    resources: params.savedSecretResources,
  });

  const materialized = await materializeMcpServerConfigRecord({
    resolved: {
      directory: params.directory,
      strictMode: resolvedSelection.strictMode,
      serversByName: resolvedSelection.selectedServersByName,
    },
    savedSecretsById: new Map(),
    savedSecretMaterializer,
    settingsSecretsKey,
    settingsSecretsReadKeys,
    processEnv: env,
    tmpDir: params.tmpDir ?? null,
    strictMode: mcpSettings.strictMode,
  });

  if (materialized.warnings.length > 0) {
    logger.debug('[mcp] Materialization warnings', {
      warningCount: materialized.warnings.length,
      warnings: materialized.warnings.map((w) => ({ serverName: w.serverName, code: w.code, detail: w.detail })),
    });
  }

  const merged = mergeWithBuiltInHappierMcpServer({ builtIn: builtIn.mcpServers, extra: params.resolvedMcpServers ?? materialized.mcpServers });
  return {
    happierMcpServer: {
      ...builtIn.happierMcpServer,
      stop: () => {
        try { builtIn.happierMcpServer.stop(); } finally { materialized.cleanup(); }
      },
    },
    mcpServers: merged,
  };
}
