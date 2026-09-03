import { readFileSync } from 'node:fs';
import path from 'node:path';

import { accountSettingsParse } from '@happier-dev/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentSessionRuntimeContext,
  AgentSessionRuntimeEvent,
} from '@happier-dev/plugin-sdk/agents/runtime';
import type { PluginServices } from '@happier-dev/plugin-sdk';

import { writeAcpTestAgentScript } from '@/agent/acp/testkit/subprocessHarness';
import { createPublicAcpRuntimeProtocols } from '@/agent/acp/runtime/publicSession/createPublicAcpRuntimeProtocols';
import type { Credentials } from '@/persistence';
import { setActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { waitForCondition } from '@/testkit/async/waitFor';
import { withTempDir } from '@/testkit/fs/tempDir';

const mocks = vi.hoisted(() => ({
  readStoredCredentials: vi.fn(),
  resolveBackendRuntimeCore: vi.fn(),
}));

vi.mock('@/persistence', () => ({
  readStoredCredentials: mocks.readStoredCredentials,
}));

// The composed journey needs the exact arguments the Account-configured
// resolver hands to the canonical runtime-core composer. The real
// implementation still runs; this only observes the one production seam so the
// test can drive the same runtime and the same host launch custody the daemon
// would.
vi.mock('./runtimeCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtimeCore')>();
  return {
    ...actual,
    resolveBackendRuntimeCore: async (params: Parameters<typeof actual.resolveBackendRuntimeCore>[0]) => {
      mocks.resolveBackendRuntimeCore(params);
      return await actual.resolveBackendRuntimeCore(params);
    },
  };
});

const { resolveAccountConfiguredAcpBackend } = await import('./accountConfiguredAcp');

const BACKEND_ID = 'review-bot';
const PROVIDER_SESSION_ID = 'configured-provider-session';

function createCredentials(): Credentials {
  return {
    token: 'token-1',
    encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
  };
}

function writeConfiguredAcpAgentScript(dir: string): string {
  return writeAcpTestAgentScript({
    dir,
    fileName: 'configured-acp-agent.mjs',
    source: `
      import { writeFileSync } from 'node:fs';
      import path from 'node:path';
      import { fileURLToPath } from 'node:url';

      const here = path.dirname(fileURLToPath(import.meta.url));
      const observed = { pid: process.pid, env: { ...process.env }, methods: [], loadedSessionIds: [] };
      const persist = () => writeFileSync(
        path.join(here, 'observed.json'),
        JSON.stringify(observed),
        'utf8',
      );
      persist();

      const decoder = new TextDecoder();
      let buffer = '';
      const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
      const ok = (id, result) => send({ jsonrpc: '2.0', id, result });

      process.stdin.on('data', (chunk) => {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const request = JSON.parse(line);
          if (typeof request.method !== 'string') continue;
          observed.methods.push(request.method);
          persist();
          if (request.method === 'initialize') {
            ok(request.id, {
              protocolVersion: 1,
              agentCapabilities: { loadSession: true },
              authMethods: [],
            });
          } else if (request.method === 'session/new') {
            ok(request.id, { sessionId: '${PROVIDER_SESSION_ID}' });
          } else if (request.method === 'session/load') {
            observed.loadedSessionIds.push(request.params.sessionId);
            persist();
            ok(request.id, {});
          } else if (request.method === 'session/prompt') {
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: request.params.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: 'configured reply' },
                },
              },
            });
            ok(request.id, { stopReason: 'end_turn' });
          } else if (request.id !== undefined && request.id !== null) {
            ok(request.id, {});
          }
        }
      });
    `,
  });
}

function readObserved(dir: string): Readonly<{
  pid: number;
  env: Record<string, string>;
  methods: string[];
  loadedSessionIds: string[];
}> {
  return JSON.parse(readFileSync(path.join(dir, 'observed.json'), 'utf8'));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Host disposal owns the configured ACP child process. Proving the exact pid is
 * gone keeps this composed journey from passing while leaking the very process
 * the retired parallel runtime used to own.
 */
async function expectAcpChildExited(pid: number): Promise<void> {
  await waitForCondition(
    () => !isProcessAlive(pid),
    { timeoutMs: 10_000, intervalMs: 25, label: `configured ACP child ${pid} exit` },
  );
}

function setConfiguredAcpAccountSettings(scriptPath: string): void {
  setActiveAccountSettingsSnapshot({
    source: 'network',
    settings: accountSettingsParse({
      schemaVersion: 6,
      secrets: [{
        id: 'secret-acp',
        name: 'ACP token',
        kind: 'token',
        encryptedValue: { _isSecretValue: true, value: 'plain-runtime-secret' },
        createdAt: 1,
        updatedAt: 1,
      }],
      acpCatalogSettingsV1: {
        v: 2,
        backends: [{
          id: BACKEND_ID,
          name: BACKEND_ID,
          title: 'Review Bot',
          command: process.execPath,
          args: [scriptPath],
          env: {
            CONFIGURED_ACP_LITERAL: { t: 'literal', v: 'from-account-declaration' },
            CONFIGURED_ACP_SECRET: { t: 'savedSecret', secretId: 'secret-acp' },
          },
          transportProfile: 'generic',
          capabilities: {
            supportsLoadSession: true,
            supportsModes: 'unknown',
            supportsModels: 'unknown',
            supportsConfigOptions: 'unknown',
            promptImageSupport: 'no',
          },
          createdAt: 1,
          updatedAt: 2,
        }],
      },
    }),
    settingsVersion: 1,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
  });
}

type CapturedRuntimeCoreParams = Readonly<{
  nativeAgentRuntime?: Parameters<
    typeof import('./runtimeCore').resolveBackendRuntimeCore
  >[0]['nativeAgentRuntime'];
  resolveNativeAgentAcpHostLaunch?: Parameters<
    typeof import('./runtimeCore').resolveBackendRuntimeCore
  >[0]['resolveNativeAgentAcpHostLaunch'];
  nativeAgentSessionCapabilities?: Parameters<
    typeof import('./runtimeCore').resolveBackendRuntimeCore
  >[0]['nativeAgentSessionCapabilities'];
}>;

function capturedRuntimeCoreParams(): CapturedRuntimeCoreParams {
  const call = mocks.resolveBackendRuntimeCore.mock.calls.at(-1);
  if (!call) throw new Error('Expected the configured resolver to compose one canonical runtime core');
  return call[0] as CapturedRuntimeCoreParams;
}

function createComposedContext(params: Readonly<{
  signal: AbortSignal;
  resolveHostLaunch: NonNullable<CapturedRuntimeCoreParams['resolveNativeAgentAcpHostLaunch']>;
  resolveSystemTool: () => never;
}>): AgentSessionRuntimeContext {
  const services = {
    exec: {
      // A configured launch must never reach plugin exec custody: the sentinel
      // transport id exists only so the strict declarative transport parses.
      resolveSystemTool: params.resolveSystemTool,
      resolveManagedDependency: params.resolveSystemTool,
    },
    sessions: {},
    interactions: {
      requestApproval: async () => ({ requestId: 'r', kind: 'approval', status: 'approved' }),
      askQuestions: async () => ({ requestId: 'r', kind: 'questions', answers: [] }),
      confirm: async () => ({ requestId: 'r', kind: 'confirmation', status: 'confirmed' }),
    },
  } as unknown as PluginServices;

  return {
    protocols: createPublicAcpRuntimeProtocols({
      pluginId: 'happier.host.configured-acp',
      agentId: `acp:${BACKEND_ID}`,
      signal: params.signal,
      isCurrent: () => true,
      services,
      resolveHostLaunch: params.resolveHostLaunch,
    }),
  } as unknown as AgentSessionRuntimeContext;
}

describe('Account-configured ACP composed Session journey', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveBackendRuntimeCore.mockReset();
    mocks.readStoredCredentials.mockReset();
    mocks.readStoredCredentials.mockResolvedValue(createCredentials());
  });

  it('creates, streams, and terminates one configured ACP turn through the canonical composer and host launch custody', async () => {
    await withTempDir('happier-configured-acp-composed-create-', async (dir) => {
      setConfiguredAcpAccountSettings(writeConfiguredAcpAgentScript(dir));

      const resolution = await resolveAccountConfiguredAcpBackend(BACKEND_ID);
      expect(resolution?.provenance).toBe('configured');

      const captured = capturedRuntimeCoreParams();
      expect(captured.nativeAgentSessionCapabilities?.open).toEqual(['create', 'resume']);
      const runtime = captured.nativeAgentRuntime;
      const resolveHostLaunch = captured.resolveNativeAgentAcpHostLaunch;
      if (!runtime?.sessions || !resolveHostLaunch) {
        throw new Error('Expected the configured resolver to publish one Session runtime and host launch owner');
      }

      const resolveSystemTool = vi.fn(() => {
        throw new Error('Account-configured ACP must not resolve plugin exec custody');
      });
      const controller = new AbortController();
      const context = createComposedContext({
        signal: controller.signal,
        resolveHostLaunch,
        resolveSystemTool: resolveSystemTool as unknown as () => never,
      });

      const session = await runtime.sessions.open({
        kind: 'create',
        sessionId: 'configured-host-session',
        cwd: dir,
      }, context);
      const events: AgentSessionRuntimeEvent[] = [];
      const subscription = session.watch((event) => { events.push(event); });
      try {
        await session.send({
          inputIds: ['configured-input-1'],
          input: { text: 'hello configured backend' },
          delivery: { kind: 'newTurn', turnId: 'configured-turn-1' },
        });
        await waitForCondition(
          () => events.some((event) => event.kind === 'turn-complete'),
          { timeoutMs: 15_000, intervalMs: 10, label: 'configured ACP turn-complete' },
        );

        const observed = readObserved(dir);
        expect(observed.env.CONFIGURED_ACP_LITERAL).toBe('from-account-declaration');
        expect(observed.env.CONFIGURED_ACP_SECRET).toBe('plain-runtime-secret');
        expect(observed.methods).toContain('session/new');
        expect(observed.methods).not.toContain('session/load');
        expect(resolveSystemTool).not.toHaveBeenCalled();

        const terminals = events.filter((event) => (
          event.kind === 'turn-complete'
          || event.kind === 'turn-failed'
          || event.kind === 'turn-cancelled'
        ));
        expect(terminals).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'turn-start')).toHaveLength(1);
        expect(
          events.filter((event) => event.kind === 'provider-session-id'),
        ).toEqual([expect.objectContaining({ providerSessionId: PROVIDER_SESSION_ID })]);
        expect(
          events
            .filter((event): event is Extract<AgentSessionRuntimeEvent, { kind: 'message-delta' }> => (
              event.kind === 'message-delta'
            ))
            .map((event) => event.text)
            .join(''),
        ).toContain('configured reply');
      } finally {
        subscription.dispose();
        await session.dispose();
      }
      await expectAcpChildExited(readObserved(dir).pid);
    });
  }, 40_000);

  it('resumes a configured ACP Session natively through one provider load and no replay re-import', async () => {
    await withTempDir('happier-configured-acp-composed-resume-', async (dir) => {
      setConfiguredAcpAccountSettings(writeConfiguredAcpAgentScript(dir));

      await resolveAccountConfiguredAcpBackend(BACKEND_ID);
      const captured = capturedRuntimeCoreParams();
      const runtime = captured.nativeAgentRuntime;
      const resolveHostLaunch = captured.resolveNativeAgentAcpHostLaunch;
      if (!runtime?.sessions || !resolveHostLaunch) {
        throw new Error('Expected the configured resolver to publish one Session runtime and host launch owner');
      }

      const controller = new AbortController();
      const session = await runtime.sessions.open({
        kind: 'resume',
        sessionId: 'configured-host-session',
        cwd: dir,
        providerSessionId: PROVIDER_SESSION_ID,
      }, createComposedContext({
        signal: controller.signal,
        resolveHostLaunch,
        resolveSystemTool: (() => {
          throw new Error('Account-configured ACP must not resolve plugin exec custody');
        }) as () => never,
      }));
      try {
        const observed = readObserved(dir);
        expect(observed.loadedSessionIds).toEqual([PROVIDER_SESSION_ID]);
        expect(observed.methods).not.toContain('session/new');
      } finally {
        await session.dispose();
      }
      await expectAcpChildExited(readObserved(dir).pid);
    });
  }, 40_000);
});
