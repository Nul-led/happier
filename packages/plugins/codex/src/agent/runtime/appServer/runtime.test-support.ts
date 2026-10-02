import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import type { ExecService } from '@happier-dev/plugin-sdk/exec';
import type { HttpService } from '@happier-dev/plugin-sdk/http';
import { createCodexAppServerRuntime, type CodexAppServerRuntimeHost } from './runtime.js';
import { createCodexAppServerClient } from './client.js';
import { fetchCodexRateLimitResetCredits } from '../../auth/services/quota/rateLimitResetCreditsClient.js';

// One genuine external app-server boundary shared by plugin-local tests and the
// CLI-owned composed Session RPC regression; this helper never imports the host.
const clientState = vi.hoisted(() => {
  const handlers = new Map<string, (params: unknown) => void | Promise<void>>();
  const exitHandlers = new Set<(result: Readonly<{ exitCode: number | null; signal: string | null; stdout: string; stderr: string }>) => void>();
  const requestHandlers = new Map<string, (params: unknown) => unknown | Promise<unknown>>();
  const requests: Array<{
    method: string;
    params: unknown;
    options?: Readonly<{ timeoutMs?: number | null }>;
  }> = [];
  let turnStartCount = 0;
  let failNextSteer = false;
  let rejectNextInterrupt: Error | null = null;
  let rejectNextTurnStart: Error | null = null;
  let delayedTurnStartPrompt: string | null = null;
  let delayedTurnStart: {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  } | null = null;
  let deferNextSteer = false;
  let delayedSteer: {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
  } | null = null;
  let rateLimitsSnapshot: unknown = {
    rateLimits: {
      primary: { used_percent: 31, resets_at: 1779019200000 },
    },
    plan_type: 'pro',
  };
  let deferredRateLimitsRead: {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
  } | null = null;
  let deferNextRateLimitsRead = false;
  let accountReadResult: unknown = { account: null };
  let threadReadResult: unknown = { thread: { id: 'thread-1', turns: [] } };
  let rejectNextThreadResume: Error | null = null;
  let nextThreadResumeResult: unknown | null = null;
  let rejectNextThreadRead: Error | null = null;
  let rejectNextThreadRevert: Error | null = null;
  let deferNextLoginStart = false;
  let deferredLoginStart: {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  } | null = null;

  const createDeferred = (): {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  } => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };

  const readPromptText = (params: unknown): string | null => {
    const record = params && typeof params === 'object' && !Array.isArray(params)
      ? params as Readonly<Record<string, unknown>>
      : null;
    const input = Array.isArray(record?.input) ? record.input : [];
    for (const item of input) {
      const itemRecord = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Readonly<Record<string, unknown>>
        : null;
      if (typeof itemRecord?.text === 'string') return itemRecord.text;
    }
    return null;
  };

  return {
    handlers,
    exitHandlers,
    requestHandlers,
    requests,
    reset() {
      handlers.clear();
      exitHandlers.clear();
      requestHandlers.clear();
      requests.length = 0;
      turnStartCount = 0;
      failNextSteer = false;
      rejectNextInterrupt = null;
      rejectNextTurnStart = null;
      delayedTurnStartPrompt = null;
      delayedTurnStart = null;
      deferNextSteer = false;
      delayedSteer = null;
      rateLimitsSnapshot = {
        rateLimits: {
          primary: { used_percent: 31, resets_at: 1779019200000 },
        },
        plan_type: 'pro',
      };
      deferredRateLimitsRead = null;
      deferNextRateLimitsRead = false;
      accountReadResult = { account: null };
      threadReadResult = { thread: { id: 'thread-1', turns: [] } };
      rejectNextThreadResume = null;
      nextThreadResumeResult = null;
      rejectNextThreadRead = null;
      rejectNextThreadRevert = null;
      deferNextLoginStart = false;
      deferredLoginStart = null;
    },
    failNextSteer() {
      failNextSteer = true;
    },
    rejectNextInterruptAsAlreadyCompleted() {
      rejectNextInterrupt = Object.assign(
        new Error('no active turn to interrupt'),
        { code: -32600, method: 'turn/interrupt' },
      );
    },
    rejectNextInterruptWith(error: Error) {
      rejectNextInterrupt = error;
    },
    rejectNextTurnStart(failure: string | Error) {
      rejectNextTurnStart = typeof failure === 'string'
        ? new Error(failure)
        : failure;
    },
    deferTurnStartForPrompt(prompt: string) {
      delayedTurnStartPrompt = prompt;
    },
    rejectDeferredTurnStart(error: Error) {
      if (!delayedTurnStart) throw new Error('No deferred turn/start request is pending');
      delayedTurnStart.reject(error);
      delayedTurnStart = null;
      delayedTurnStartPrompt = null;
    },
    resolveDeferredTurnStartResult(response: unknown) {
      if (!delayedTurnStart) throw new Error('No deferred turn/start request is pending');
      delayedTurnStart.resolve(response);
      delayedTurnStart = null;
      delayedTurnStartPrompt = null;
    },
    resolveDeferredTurnStart(turnId: string) {
      if (!delayedTurnStart) throw new Error('No deferred turn/start request is pending');
      delayedTurnStart.resolve({ turnId });
      delayedTurnStart = null;
      delayedTurnStartPrompt = null;
    },
    deferNextSteer() {
      deferNextSteer = true;
    },
    resolveDeferredSteer() {
      if (!delayedSteer) throw new Error('No deferred turn/steer request is pending');
      delayedSteer.resolve({});
      delayedSteer = null;
    },
    setRateLimitsSnapshot(value: unknown) {
      rateLimitsSnapshot = value;
    },
    deferNextRateLimitsRead() {
      deferNextRateLimitsRead = true;
    },
    resolveDeferredRateLimitsRead(value: unknown) {
      if (!deferredRateLimitsRead) throw new Error('No deferred account/rateLimits/read request is pending');
      deferredRateLimitsRead.resolve(value);
      deferredRateLimitsRead = null;
    },
    setAccountReadResult(value: unknown) {
      accountReadResult = value;
    },
    setThreadReadResult(value: unknown) {
      threadReadResult = value;
    },
    rejectNextThreadResume(error: Error) {
      rejectNextThreadResume = error;
    },
    setNextThreadResumeResult(result: unknown) {
      nextThreadResumeResult = result;
    },
    rejectNextThreadRead(error: Error) {
      rejectNextThreadRead = error;
    },
    rejectNextThreadRevert(error: Error) {
      rejectNextThreadRevert = error;
    },
    deferNextLoginStart() {
      deferNextLoginStart = true;
    },
    resolveDeferredLoginStart() {
      if (!deferredLoginStart) throw new Error('No deferred account/login/start request is pending');
      deferredLoginStart.resolve({ ok: true });
      deferredLoginStart = null;
    },
    rejectDeferredLoginStart(error: Error) {
      if (!deferredLoginStart) throw new Error('No deferred account/login/start request is pending');
      deferredLoginStart.reject(error);
      deferredLoginStart = null;
    },
    async request(
      method: string,
      params?: unknown,
      options?: Readonly<{ timeoutMs?: number | null }>,
    ): Promise<unknown> {
      requests.push({ method, params, ...(options ? { options } : {}) });
      if (method === 'account/rateLimits/read') {
        if (deferNextRateLimitsRead) {
          deferNextRateLimitsRead = false;
          deferredRateLimitsRead = createDeferred();
          return await deferredRateLimitsRead.promise;
        }
        return rateLimitsSnapshot;
      }
      if (method === 'account/read') {
        return accountReadResult;
      }
      if (method === 'account/login/start') {
        if (deferNextLoginStart) {
          deferNextLoginStart = false;
          deferredLoginStart = createDeferred();
          return await deferredLoginStart.promise;
        }
        return { ok: true };
      }
      if (method === 'thread/start') {
        return { threadId: 'thread-1' };
      }
      if (method === 'thread/resume') {
        if (rejectNextThreadResume) {
          const error = rejectNextThreadResume;
          rejectNextThreadResume = null;
          throw error;
        }
        if (nextThreadResumeResult !== null) {
          const result = nextThreadResumeResult;
          nextThreadResumeResult = null;
          return result;
        }
        const record = params && typeof params === 'object'
          ? params as Readonly<Record<string, unknown>>
          : {};
        return { threadId: record.threadId ?? 'thread-resumed' };
      }
      if (method === 'thread/name/set') {
        return {};
      }
      if (method === 'thread/read') {
        if (rejectNextThreadRead) {
          const error = rejectNextThreadRead;
          rejectNextThreadRead = null;
          throw error;
        }
        return threadReadResult;
      }
      if (method === 'thread/revert') {
        if (rejectNextThreadRevert) {
          const error = rejectNextThreadRevert;
          rejectNextThreadRevert = null;
          throw error;
        }
        return {};
      }
      if (method === 'thread/rollback') {
        return {};
      }
      if (method === 'experimentalFeature/list') {
        return {
          data: [{ name: 'realtime_conversation', enabled: true }],
          nextCursor: null,
        };
      }
      if (method === 'thread/realtime/start' || method === 'thread/realtime/stop') {
        return {};
      }
      if (method === 'turn/start') {
        if (rejectNextTurnStart) {
          const error = rejectNextTurnStart;
          rejectNextTurnStart = null;
          throw error;
        }
        turnStartCount += 1;
        if (readPromptText(params) === delayedTurnStartPrompt) {
          delayedTurnStart = createDeferred();
          return await delayedTurnStart.promise;
        }
        return { turnId: `turn-${turnStartCount}` };
      }
      if (method === 'turn/steer') {
        if (failNextSteer) {
          failNextSteer = false;
          throw new Error('Codex app-server steer failed');
        }
        if (deferNextSteer) {
          deferNextSteer = false;
          delayedSteer = createDeferred();
          return await delayedSteer.promise;
        }
        return {};
      }
      if (method === 'turn/interrupt') {
        if (rejectNextInterrupt) {
          const error = rejectNextInterrupt;
          rejectNextInterrupt = null;
          throw error;
        }
        return {};
      }
      throw new Error(`Unexpected Codex app-server request: ${method}`);
    },
    async notify(): Promise<void> {
      return undefined;
    },
    emitExit(result: Readonly<{ exitCode: number | null; signal: string | null; stdout: string; stderr: string }>) {
      for (const handler of [...exitHandlers]) handler(result);
    },
    onExit(handler: (result: Readonly<{ exitCode: number | null; signal: string | null; stdout: string; stderr: string }>) => void): () => void {
      exitHandlers.add(handler);
      return () => exitHandlers.delete(handler);
    },
    async invokeRequestHandler(method: string, params?: unknown): Promise<unknown> {
      const handler = requestHandlers.get(method);
      if (!handler) throw new Error(`Missing request handler for ${method}`);
      return await handler(params);
    },
    registerRequestHandler(method: string, handler: (params: unknown) => unknown | Promise<unknown>): () => void {
      requestHandlers.set(method, handler);
      return () => {
        requestHandlers.delete(method);
      };
    },
    registerNotificationHandler(method: string, handler: (params: unknown) => void | Promise<void>): () => void {
      handlers.set(method, handler);
      return () => {
        handlers.delete(method);
      };
    },
  };
});

vi.mock('./client.js', () => ({
  createCodexAppServerClient: vi.fn(async () => ({
    launchFeatures: {
      realtimeConversationAdvertised: true,
    },
    request: clientState.request,
    notify: clientState.notify,
    registerRequestHandler: clientState.registerRequestHandler,
    registerNotificationHandler: clientState.registerNotificationHandler,
    onExit: clientState.onExit,
    dispose: vi.fn(async () => undefined),
  })),
  isCodexAppServerOversizedJsonFrameError: vi.fn(() => false),
  resolveCodexHome: (env: Readonly<Record<string, string | undefined>>) => env.CODEX_HOME ?? '/home/test/.codex',
}));

export const providerBindingMaterialization = {
  v: 1,
  kind: 'engineConfig',
  engineConfig: {
    v: 1,
    modelProvider: 'happier_0123456789abcdef0123456789abcdef',
    config: {
      model_reasoning_effort: 'none',
      'model_providers.happier_0123456789abcdef0123456789abcdef': {
        name: 'Happier provider',
        base_url: 'https://provider.example/v1',
        wire_api: 'responses',
        env_key: 'HAPPIER_CODEX_PROVIDER_API_KEY',
        requires_openai_auth: false,
        supports_websockets: false,
      },
    },
  },
} as const;

type CodexTestAccountUsageService = CodexAppServerRuntimeHost['accountUsage'];
type CodexTestLogger = Readonly<{
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}>;
type CodexTestRuntimeAuthRefresh = (request: unknown) => Promise<unknown> | unknown;
type CodexTestContextOverrides = Readonly<{
  logger?: CodexTestLogger;
  writeStateField?: (request: unknown) => Promise<void>;
  auth?: Readonly<{ services: Readonly<{ refreshRuntimeAuth: CodexTestRuntimeAuthRefresh }> }>;
  sessions?: Readonly<{
    current: Readonly<{
      auth: Readonly<{ services: Readonly<{ refreshRuntimeAuth: CodexTestRuntimeAuthRefresh }> }>;
    }>;
  }>;
}>;

export function createCodexTestContextFixture(params: Readonly<{
  sessionId?: string;
  overrides?: CodexTestContextOverrides;
  accountUsage?: CodexTestAccountUsageService;
}> = {}) {
  const sessionStateFieldWrites: unknown[] = [];
  const defaultRefreshRuntimeAuth: CodexTestRuntimeAuthRefresh = async () => ({
    status: 'unavailable' as const,
    reason: 'runtime_auth_selection_unavailable',
  });
  const refreshRuntimeAuth = params.overrides?.auth?.services.refreshRuntimeAuth
    ?? params.overrides?.sessions?.current.auth.services.refreshRuntimeAuth
    ?? defaultRefreshRuntimeAuth;
  const logger = params.overrides?.logger ?? {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  // The app-server client is mocked at this external boundary; no process method is reached.
  const exec = Object.freeze({}) as unknown as ExecService;
  const runtimeFetch: HttpService = {
    request: vi.fn(async () => ({
      status: 200,
      finalUrl: 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      headers: {},
      body: new TextEncoder().encode('{}'),
    })),
  };
  return {
    context: {
      logger,
      env: { list: () => ({}) },
      exec,
      runtimeFetch,
      accountUsage: params.accountUsage ?? createAccountUsageService({}),
      refreshRuntimeAuth,
      writeStateField: params.overrides?.writeStateField ?? (async (request: unknown) => {
        sessionStateFieldWrites.push(request);
      }),
      sessionId: params.sessionId ?? 'session-1',
    },
    records: { sessionStateFieldWrites },
  };
}

export function createRuntime(overrides: Readonly<{
  ctx?: CodexTestContextOverrides;
  accountUsage?: CodexTestAccountUsageService;
  happierSessionId?: string;
  processEnv?: Readonly<Record<string, string | undefined>>;
  initialModelId?: string;
  initialProviderBinding?: typeof providerBindingMaterialization.engineConfig;
  disposeHost?: () => Promise<void>;
  publishGeneratedMedia?: (candidate: import('./media/generatedMedia.js').CodexGeneratedMediaCandidate) => Promise<void>;
}> = {}) {
  const fixture = createCodexTestContextFixture({
    sessionId: overrides.happierSessionId ?? 'session-1',
    overrides: overrides.ctx,
    accountUsage: overrides.accountUsage,
  });
  const ctx = fixture.context;
  const codexHome = overrides.processEnv?.CODEX_HOME;
  return createCodexAppServerRuntime({
    host: {
      ...(overrides.disposeHost ? { dispose: overrides.disposeHost } : {}),
      baseProcessEnv: ctx.env.list(),
      ...(codexHome ? {
        nativeHome: {
          root: codexHome,
          async readFiles(fileIds: readonly string[]) {
            const files: Record<string, Uint8Array> = {};
            for (const fileId of fileIds) {
              try {
                files[fileId] = new Uint8Array(await readFile(join(codexHome, fileId)));
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              }
            }
            return files;
          },
        },
      } : {}),
      logger: ctx.logger,
      createClient: async (request) => await createCodexAppServerClient({
        exec: ctx.exec,
        cwd: request.cwd,
        processEnv: request.processEnv,
        configOverrides: request.configOverrides,
        disableUserMcpServers: request.disableUserMcpServers,
      }),
      fetchRateLimitResetCredits: async ({ accessToken, accountId }) => await fetchCodexRateLimitResetCredits({
        accessToken,
        accountId,
        runtimeFetch: ctx.runtimeFetch,
      }),
      accountUsage: ctx.accountUsage,
      setTitle: async (title) => await ctx.writeStateField({
        fieldId: 'display.title',
        value: title,
        reason: 'provider_update',
      }),
      refreshRuntimeAuth: async (request) => await ctx.refreshRuntimeAuth(request),
      reportCapacityFailure: async (classification) => {
        await ctx.refreshRuntimeAuth({
          agentId: 'codex',
          serviceId: 'openai-codex',
          targetId: overrides.happierSessionId ?? 'session-1',
          classification,
          reason: 'provider_session_capacity_failure',
        });
      },
      ...(overrides.publishGeneratedMedia ? { publishGeneratedMedia: overrides.publishGeneratedMedia } : {}),
    },
    directory: '/workspace',
    happierSessionId: overrides.happierSessionId ?? 'session-1',
    processEnv: overrides.processEnv,
    initialModelId: overrides.initialModelId,
    initialProviderBinding: overrides.initialProviderBinding,
  });
}

export function buildConnectedCodexCredential(profileId = 'target') {
  return buildConnectedServiceCredentialRecord({
    now: 1000,
    serviceId: 'openai-codex',
    profileId,
    kind: 'oauth',
    expiresAt: 2000,
    oauth: {
      accessToken: 'target-access',
      refreshToken: 'target-refresh',
      idToken: 'target-id',
      scope: null,
      tokenType: null,
      providerAccountId: 'acct_target',
      providerEmail: 'target@example.test',
    },
  });
}

export function createAccountUsageService(
  overrides: Partial<CodexTestAccountUsageService>,
): CodexTestAccountUsageService {
  return {
    resolveSourceContext: async () => null,
    recordSnapshot: async () => ({ status: 'recorded' }),
    adoptProvisionalRecord: async () => ({
      status: 'adopted',
      fromRecordId: 'paug_v1_from',
      toRecordId: 'paug_v1_to',
    }),
    ...overrides,
  };
}


export { clientState };
