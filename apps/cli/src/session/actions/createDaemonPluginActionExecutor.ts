import {
  ACTION_IDS,
  type ActionExecuteResult,
  type ActionExecutorContext,
  type ActionId,
} from '@happier-dev/protocol';

import { requestDaemonPluginActionExecution } from '@/daemon/controlClient';
import type { PluginActionExecutionAttempt } from '@/plugins/runtime/invocation/actions/executeContributedAction';

type OccurrenceBoundActionExecutorContext = ActionExecutorContext & Readonly<{
  /** Host-stamped turn admission fence; never Action input or SDK surface. */
  expectedContributorOccurrenceId?: string;
}>;

type ActionExecutorLike = Readonly<{
  execute: (
    actionId: ActionId,
    input: unknown,
    context?: OccurrenceBoundActionExecutorContext,
  ) => Promise<ActionExecuteResult>;
}>;

const DAEMON_OWNED_PLUGIN_META_ACTION_IDS = new Set<string>([
  'action.spec.search',
  'action.spec.get',
  'action.options.resolve',
  'action.invoke',
]);
const BUILT_IN_ACTION_IDS = new Set<string>(ACTION_IDS);

/**
 * Extends an existing first-party executor with the daemon's final external
 * action owner. The daemon route acquires the current runtime-registry lease,
 * activates the owning plugin when needed, and enforces target-action policy.
 */
export function createDaemonPluginActionExecutor(params: Readonly<{
  base: ActionExecutorLike;
  requestPluginActionExecution?: PluginActionExecutionRequestOwner;
}>): ActionExecutorLike {
  return createPluginActionExecutor({
    base: params.base,
    requestPluginActionExecution: params.requestPluginActionExecution
      ?? requestDaemonPluginActionExecution,
  });
}

export type PluginActionExecutionRequestOwner = (request: Readonly<{
    actionId: string;
    input: unknown;
    surface: 'cli' | 'mcp' | 'agent';
    defaultSessionId?: string;
    expectedContributorOccurrenceId?: string;
  }>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<PluginActionExecutionAttempt>;

/** Routes dynamic/meta Actions to one explicit execution owner before the built-in executor. */
export function createPluginActionExecutor(params: Readonly<{
  base: ActionExecutorLike;
  requestPluginActionExecution: PluginActionExecutionRequestOwner;
}>): ActionExecutorLike {
  return {
    execute: async (actionId, input, context) => {
      const normalizedActionId = String(actionId);
      if (!BUILT_IN_ACTION_IDS.has(normalizedActionId)
        || DAEMON_OWNED_PLUGIN_META_ACTION_IDS.has(normalizedActionId)) {
        const surface: 'cli' | 'mcp' | 'agent' = context?.surface === 'mcp'
          ? 'mcp'
          : context?.surface === 'agent'
            ? 'agent'
            : 'cli';
        const request = {
          actionId: normalizedActionId,
          input,
          surface,
          ...(typeof context?.defaultSessionId === 'string'
            ? { defaultSessionId: context.defaultSessionId }
            : {}),
          ...(typeof context?.expectedContributorOccurrenceId === 'string'
            && context.expectedContributorOccurrenceId.trim().length > 0
            ? {
                expectedContributorOccurrenceId:
                  context.expectedContributorOccurrenceId.trim(),
              }
            : {}),
        };
        const attempt = context?.signal
          ? await params.requestPluginActionExecution(request, { signal: context.signal })
          : await params.requestPluginActionExecution(request);
        if (attempt.matched) {
          return attempt.result;
        }
      }
      return await params.base.execute(actionId, input, context);
    },
  };
}
