import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  getActionSpec,
  isActionSpecSurfacedOn,
  PublicActionIdSchema,
  type ActionId,
} from '@happier-dev/protocol';

import type { StoredCredentials } from '@/persistence';
import { registerHappierMcpResources } from '@/mcp/resources/registerHappierMcpResources';
import { createActionToolExecutorBridge } from '@/agent/tools/happierTools/createActionToolExecutorBridge';
import { createChangeTitleToolHandler } from '@/agent/tools/happierTools/createChangeTitleToolHandler';
import { isActionEnabledByEnv, readActionsSettingsFromEnv } from '@/settings/actionsSettings';
import { registerHappierMcpBuiltInTools } from '@/mcp/server/registerHappierMcpBuiltInTools';
import { createCliActionExecutorHarness } from '@/session/actions/createCliActionExecutorHarness';
import { createCliActionExecutorFromCredentials } from '@/session/actions/createCliActionExecutorFromCredentials';
import { resolveSessionEncryptionContextFromCredentials } from '@/session/transport/encryption/sessionEncryptionContext';
import { createDaemonPluginActionExecutor } from '@/session/actions/createDaemonPluginActionExecutor';
import {
  requestDaemonPluginActionExecution,
  type DaemonControlRequestOptions,
} from '@/daemon/controlClient';
import type { ProjectedPluginToolCatalogEntry } from '@/plugins/runtime/toolCatalog';
import { createAccountServerActionDeps } from '@/api/accountServerActionDeps';
import {
  resolveServerHttpBaseUrl,
  runWithServerHttpBaseUrl,
} from '@/api/client/serverHttpBaseUrl';

function normalizeId(raw: unknown): string {
  return String(raw ?? '').trim();
}

function readSessionIdFromToolArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const sessionId = normalizeId((args as any).sessionId);
  return sessionId || null;
}

export function createExternalMcpServer(params: Readonly<{
  credentials: StoredCredentials;
  defaultSessionId?: string | null;
  pluginToolCatalog?: readonly ProjectedPluginToolCatalogEntry[];
  /**
   * `undefined` preserves the ordinary ambient daemon lifecycle owner. A
   * concrete target pins an explicit Home; `null` means that Home has no live
   * daemon and must never fall back to another lifecycle scope.
   */
  daemonControlTarget?: DaemonControlRequestOptions['target'] | null;
}>): Readonly<{ mcp: McpServer; toolNames: string[] }> {
  const serverHttpBaseUrl = resolveServerHttpBaseUrl();
  const toolSurface = 'mcp' as const;
  const usesApiToken = params.credentials.credentialProvenance === 'api_token';
  // A PAT has no Account E2EE material. Keep its MCP presentation narrowed to
  // Actions the public API can admit, then delegate their execution to the
  // daemon that owns the selected machine/Session. Plugin tools have no public
  // Action-id admission path yet, so do not advertise a local PAT bypass.
  const pluginToolCatalog = usesApiToken ? Object.freeze([]) : params.pluginToolCatalog;
  const isActionEnabled = (id: ActionId): boolean => (
    (!usesApiToken || PublicActionIdSchema.safeParse(id).success)
    && isActionEnabledByEnv(id, { surface: toolSurface })
  );

  let defaultSessionId: string | null = normalizeId(params.defaultSessionId) || null;
  const executor = usesApiToken
    ? createCliActionExecutorFromCredentials({
        credentials: params.credentials,
        serverApiUrl: serverHttpBaseUrl,
      })
    : (() => {
        const ctx = resolveSessionEncryptionContextFromCredentials(params.credentials);
        const cryptoContext = ctx
          ? { mode: 'e2ee' as const, ctx }
          : { mode: 'plain' as const, ctx: null };
        const { executor: baseExecutor } = createCliActionExecutorHarness(
          {
            ...cryptoContext,
            token: params.credentials.token,
            credentials: params.credentials,
            sessionId: 'cli-global',
          },
          {
            ...createAccountServerActionDeps({
              token: params.credentials.token,
              serverHttpBaseUrl,
            }),
            sessionTargetPrimarySet: async ({ sessionId }) => {
              const normalized = typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : null;
              defaultSessionId = normalized;
              return { ok: true, sessionId: normalized };
            },
            sessionTargetTrackedSet: async ({ sessionIds }) => {
              const trackedSessionIds = Array.isArray(sessionIds)
                ? sessionIds.map((id) => String(id ?? '').trim()).filter(Boolean)
                : [];
              return { ok: true, sessionIds: trackedSessionIds };
            },
          },
        );
        const pinnedBaseExecutor = {
          execute: async (...args: Parameters<typeof baseExecutor.execute>) =>
            await runWithServerHttpBaseUrl(
              serverHttpBaseUrl,
              async () => await baseExecutor.execute(...args),
            ),
        };
        const daemonControlTarget = params.daemonControlTarget;
        const requestPluginActionExecution = daemonControlTarget === undefined
          ? undefined
          : daemonControlTarget
            ? async (
                request: Parameters<typeof requestDaemonPluginActionExecution>[0],
                options?: Readonly<{ signal?: AbortSignal }>,
              ) => await requestDaemonPluginActionExecution(request, {
                ...options,
                target: daemonControlTarget,
              })
            : async () => ({
                matched: true as const,
                result: {
                  ok: false as const,
                  errorCode: 'daemon_unavailable',
                  error: 'daemon_unavailable',
                },
              });
        return createDaemonPluginActionExecutor({
          base: pinnedBaseExecutor,
          ...(requestPluginActionExecution ? { requestPluginActionExecution } : {}),
        });
      })();

  const mcp = new McpServer({
    name: 'Happier MCP',
    version: '1.0.0',
  });

  registerHappierMcpResources(mcp as any, {
    surface: toolSurface,
    isActionEnabled,
  });

  const actionsSettings = readActionsSettingsFromEnv();
  const actionToolBridge = createActionToolExecutorBridge({
    executor,
    isActionEnabled: (id) => {
      const spec = getActionSpec(id);
      return isActionSpecSurfacedOn(spec, toolSurface) && isActionEnabled(id);
    },
    surface: toolSurface,
    actionsSettings,
    pluginToolCatalog,
  });

  const { toolNames } = registerHappierMcpBuiltInTools(mcp as any, {
    sessionId: 'cli-global',
    surface: toolSurface,
    actionsSettings,
    pluginToolCatalog,
    resolveSessionId: (toolArgs) => readSessionIdFromToolArgs(toolArgs) ?? defaultSessionId ?? 'cli-global',
    deps: {
      changeTitle: createChangeTitleToolHandler({
        executor,
        surface: toolSurface,
      }),
      executeActionByToolName: actionToolBridge.executeActionByToolName,
      resolveActionOptions: async (resolverArgs) =>
        await actionToolBridge.resolveActionOptions(
          resolverArgs,
          readSessionIdFromToolArgs(resolverArgs) ?? defaultSessionId ?? 'cli-global',
        ),
      isActionEnabled: actionToolBridge.isActionEnabled,
    },
  });

  return { mcp, toolNames };
}
