import type { ActionExecuteResult } from '@happier-dev/protocol';

import type { ActionCliDynamicOptionsRequest } from '@/cli/actions/commandCompletion';
import {
  normalizeActionExecuteResult,
  unwrapCliActionSuccessPayload,
} from '@/cli/commands/session/shared/normalizeActionExecuteResult';
import {
  readStoredCredentials,
  readStoredCredentialsForServerId,
  type StoredCredentials,
} from '@/persistence';
import { getServerProfile } from '@/server/serverProfiles';
import {
  readActionCliServerId,
  resolveActionCliCredentialTarget,
} from '@/cli/actions/actionServerTarget';
import type { createCliActionExecutorFromCredentials } from '@/session/actions/createCliActionExecutorFromCredentials';

type CompletionExecutor = Pick<
  ReturnType<typeof createCliActionExecutorFromCredentials>,
  'execute' | 'resolveSessionTarget'
>;
type CompletionExecutorParams = Parameters<typeof createCliActionExecutorFromCredentials>[0];

export type CompletionDynamicOptionsDeps = Readonly<{
  readCredentialsFn: () => Promise<StoredCredentials | null>;
  readCredentialsForServerIdFn: typeof readStoredCredentialsForServerId;
  getServerProfileFn: typeof getServerProfile;
  createExecutorFn: (
    params: CompletionExecutorParams,
  ) => CompletionExecutor | Promise<CompletionExecutor>;
}>;

const DEFAULT_DEPS: CompletionDynamicOptionsDeps = {
  readCredentialsFn: readStoredCredentials,
  readCredentialsForServerIdFn: readStoredCredentialsForServerId,
  getServerProfileFn: getServerProfile,
  createExecutorFn: async (params) => (
    await import('@/session/actions/createCliActionExecutorFromCredentials')
  ).createCliActionExecutorFromCredentials(params),
};

function readOptionValues(result: ActionExecuteResult): readonly string[] {
  const normalized = normalizeActionExecuteResult(result);
  if (!normalized.ok) return Object.freeze([]);
  const payload = unwrapCliActionSuccessPayload(normalized.data);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return Object.freeze([]);
  const options = (payload as Readonly<Record<string, unknown>>).options;
  if (!Array.isArray(options)) return Object.freeze([]);
  const values = options.flatMap((option) => {
    if (typeof option === 'string') return option ? [option] : [];
    if (!option || typeof option !== 'object' || Array.isArray(option)) return [];
    const value = (option as Readonly<Record<string, unknown>>).value;
    return typeof value === 'string' && value ? [value] : [];
  });
  return Object.freeze([...new Set(values)]);
}

/**
 * Authenticated dynamic completion through the canonical options Action. Shell
 * completion must remain best-effort: no credentials, ambiguity, a disconnected
 * runtime, denial, and malformed results all retain static compiler suggestions.
 */
export async function resolveActionDynamicOptionsForCliCompletion(
  request: ActionCliDynamicOptionsRequest,
  overrides: Partial<CompletionDynamicOptionsDeps> = {},
): Promise<readonly string[]> {
  try {
    const deps = { ...DEFAULT_DEPS, ...overrides };
    const requestedServerId = readActionCliServerId(
      request.committedArgv,
      request.acceptsServerId,
    );
    const { credentials, fixedServer } = await resolveActionCliCredentialTarget({
      requestedServerId,
      deps,
    });
    if (!credentials) return Object.freeze([]);
    const executor = await deps.createExecutorFn(fixedServer
      ? { credentials, ...fixedServer }
      : { credentials });

    let draftInput = request.draftInput;
    let sessionId: string | null = null;
    const draftSessionId = draftInput.sessionId;
    if (typeof draftSessionId === 'string') {
      const resolved = await executor.resolveSessionTarget(draftSessionId);
      if (!resolved.ok) return Object.freeze([]);
      sessionId = resolved.sessionId;
      draftInput = Object.freeze({ ...draftInput, sessionId });
    }

    const result = await executor.execute('action.options.resolve', {
      actionId: request.actionId,
      fieldPath: request.fieldPath,
      optionsSourceId: request.optionsSourceId,
      draftInput,
      query: request.query,
      ...(sessionId ? { sessionId } : {}),
    }, {
      surface: 'cli',
      defaultSessionId: sessionId,
    });
    return readOptionValues(result);
  } catch {
    return Object.freeze([]);
  }
}
