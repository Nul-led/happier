import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The live adapter's contract is delegation to the canonical cli-common relay
// host engine; the engine facade is the genuine system boundary this adapter
// owns, so the tests observe the delegation seam instead of re-testing the
// engine's platform internals (those are covered by cli-common's own suite).
type RelayEngineStub = Readonly<{
  readStatus: ReturnType<typeof vi.fn>;
  installOrUpdate: ReturnType<typeof vi.fn>;
  control: ReturnType<typeof vi.fn>;
}>;

type AdapterHarness = Readonly<{
  engine: RelayEngineStub;
  engineFactoryDeps: unknown[];
  ensureLocalFirstPartyComponentCommand: ReturnType<typeof vi.fn>;
  checkRelayRuntimeHealth: ReturnType<typeof vi.fn>;
  createCanonicalPersonalHomeOperations: ReturnType<typeof vi.fn>;
  readPersonalHomeStartupReadiness: ReturnType<typeof vi.fn>;
  removePersonalHomeStartupReadiness: ReturnType<typeof vi.fn>;
  runCommandStreaming: ReturnType<typeof vi.fn>;
}>;

let harness: AdapterHarness;
let tempHomeDir: string;
const previousEnv = new Map<string, string | undefined>();

function patchEnv(key: string, value: string | undefined): void {
  if (!previousEnv.has(key)) {
    previousEnv.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function statusSnapshot() {
  return {
    installed: true,
    version: 'happier-server-v9',
    service: { active: true, enabled: true },
    baseUrl: 'http://127.0.0.1:4123',
    healthy: true,
    purpose: { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:4123' },
  };
}

function healthResult() {
  return {
    reachable: true,
    portOpen: true,
    pingOk: true,
    url: 'http://127.0.0.1:4123/health',
    statusCode: 200,
    version: null,
  };
}

function createHarness(): AdapterHarness {
  return {
    engine: {
      readStatus: vi.fn(async () => statusSnapshot()),
      installOrUpdate: vi.fn(async () => ({ relayUrl: 'http://127.0.0.1:4123', mode: 'system' as const })),
      control: vi.fn(async () => undefined),
    },
    engineFactoryDeps: [],
    ensureLocalFirstPartyComponentCommand: vi.fn(async (_params: Record<string, unknown>) => '/resolved/happier-server'),
    checkRelayRuntimeHealth: vi.fn(async (_params: Record<string, unknown>) => healthResult()),
    runCommandStreaming: vi.fn(async () => undefined),
    readPersonalHomeStartupReadiness: vi.fn(async () => ({
      authenticated: true as const,
      homeServerIdentityId: 'home-ready',
      accountCount: 1,
      sessionCount: 2,
    })),
    removePersonalHomeStartupReadiness: vi.fn(async () => undefined),
    createCanonicalPersonalHomeOperations: vi.fn(async () => ({
      inspect: async () => ({
        purpose: 'personal-home' as const,
        canonicalServerUrl: 'http://127.0.0.1:4123',
        layout: {},
        running: true,
        identity: null,
        masterSecret: { present: false, fingerprint: null },
        storage: {
          databasePresent: false,
          databaseBytes: null,
          publicFilesPresent: false,
          privateFilesPresent: false,
          backupsCount: 0,
        },
      }),
      backup: async () => ({}),
      verifyBackup: async () => ({}),
      restore: async () => ({}),
      erase: async () => ({}),
      relocate: async () => ({}),
    })),
  };
}

async function importAdapter(): Promise<typeof import('./liveRelayRuntime')> {
  vi.doMock('@happier-dev/cli-common/systemTasks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/cli-common/systemTasks')>();
    return {
      ...actual,
      createRelayHostEngine: ((deps: unknown) => {
        harness.engineFactoryDeps.push(deps);
        return harness.engine;
      }) as unknown as typeof actual.createRelayHostEngine,
      ensureLocalFirstPartyComponentCommand: harness.ensureLocalFirstPartyComponentCommand as unknown as typeof actual.ensureLocalFirstPartyComponentCommand,
    };
  });
  vi.doMock('@happier-dev/cli-common/firstPartyRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/cli-common/firstPartyRuntime')>();
    return {
      ...actual,
      checkRelayRuntimeHealth: harness.checkRelayRuntimeHealth as unknown as typeof actual.checkRelayRuntimeHealth,
      createCanonicalPersonalHomeOperations:
        harness.createCanonicalPersonalHomeOperations as unknown as typeof actual.createCanonicalPersonalHomeOperations,
      readPersonalHomeStartupReadiness:
        harness.readPersonalHomeStartupReadiness as unknown as typeof actual.readPersonalHomeStartupReadiness,
      removePersonalHomeStartupReadiness:
        harness.removePersonalHomeStartupReadiness as unknown as typeof actual.removePersonalHomeStartupReadiness,
    };
  });
  vi.doMock('@happier-dev/cli-common/process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/cli-common/process')>();
    return { ...actual, runCommandStreaming: harness.runCommandStreaming };
  });
  // Guard against accidental GitHub network access from any pre-existing
  // implementation path; the canonical engine resolves binaries through the
  // shared first-party component dependency instead.
  vi.doMock('@happier-dev/release-runtime/github', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/release-runtime/github')>();
    return {
      ...actual,
      fetchGitHubReleaseByTag: async () => {
        throw new Error('GitHub release fetch is disabled in relay runtime adapter tests');
      },
    };
  });
  return await import('./liveRelayRuntime');
}

beforeEach(async () => {
  harness = createHarness();
  tempHomeDir = await mkdtemp(path.join(tmpdir(), 'happier-live-relay-adapter-'));
  patchEnv('HOME', tempHomeDir);
  patchEnv('USERPROFILE', tempHomeDir);
});

afterEach(async () => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previousEnv.clear();
  vi.resetModules();
  vi.clearAllMocks();
  await rm(tempHomeDir, { recursive: true, force: true });
});

const fullLocalParams = {
  target: { kind: 'local' as const },
  channel: 'preview' as const,
  mode: 'user' as const,
  env: { PORT: '4123' },
  purpose: { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:4123' },
  selfHostRelayBinaryOverride: '/tmp/happier-server-override',
};

describe('liveRelayRuntime adapter delegation', () => {
  it('composes default Personal Home task operations through the canonical facade and relay host engine lifecycle', { timeout: 60_000 }, async () => {
    const module = await importAdapter();
    const operations = await module.createLivePersonalHomeSystemTaskOperations();

    await expect(operations.inspect({
      requestedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:4123' },
      runtimeTarget: { channel: 'stable', mode: 'user' },
      progress: () => undefined,
    })).resolves.toMatchObject({ purpose: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:4123' });

    expect(harness.createCanonicalPersonalHomeOperations).toHaveBeenCalledTimes(1);
    const composition = harness.createCanonicalPersonalHomeOperations.mock.calls[0]?.[0] as {
      lifecycle: { isRunning(): Promise<boolean>; stop(): Promise<void>; start(): Promise<void>; healthCheck(): Promise<boolean> };
      attestActivatedHome(): Promise<Readonly<{ authenticated: true; homeServerIdentityId: string; accountCount: number; sessionCount: number }>>;
      readPurpose(): Promise<{ kind: 'personal-home'; canonicalServerUrl: string }>;
      readHappierVersion(): Promise<string>;
      runMigrationProcess(input: Readonly<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }>): Promise<void>;
    };
    await expect(composition.readHappierVersion()).resolves.toBe('happier-server-v9');
    await expect(composition.readPurpose()).resolves.toEqual({
      kind: 'personal-home',
      canonicalServerUrl: 'http://127.0.0.1:4123',
    });
    harness.engine.readStatus.mockResolvedValueOnce({
      ...statusSnapshot(),
      purpose: { kind: 'generic' },
    });
    await expect(composition.readPurpose()).rejects.toThrow(/Personal Home/u);
    await expect(operations.restore({
      archivePath: '/tmp/home.tar',
      requestedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:4123' },
      runtimeTarget: { channel: 'stable', mode: 'user' },
      progress: () => undefined,
    })).resolves.toEqual({});
    const migrationEnv = { DATABASE_URL: 'file:/tmp/staged.sqlite' };
    await composition.runMigrationProcess({
      command: '/installed/bin/happier-server',
      args: ['--migrate-only'],
      env: migrationEnv,
    });
    expect(harness.runCommandStreaming).toHaveBeenCalledWith({
      cmd: '/installed/bin/happier-server',
      args: ['--migrate-only'],
      env: migrationEnv,
      context: 'personal-home staged migration',
    });
    await expect(composition.lifecycle.isRunning()).resolves.toBe(true);
    await composition.lifecycle.stop();
    await composition.lifecycle.start();
    await expect(composition.lifecycle.healthCheck()).resolves.toBe(true);
    await expect(composition.attestActivatedHome()).resolves.toMatchObject({
      authenticated: true,
      homeServerIdentityId: 'home-ready',
    });
    expect(harness.removePersonalHomeStartupReadiness).toHaveBeenCalledTimes(1);
    expect(harness.readPersonalHomeStartupReadiness).toHaveBeenCalledTimes(1);
    expect(harness.engine.control).toHaveBeenCalledWith(expect.objectContaining({ action: 'stop' }));
    expect(harness.engine.control).toHaveBeenCalledWith(expect.objectContaining({ action: 'start' }));
  });

  it('composes Personal Home operations for the explicitly selected runtime channel and mode', async () => {
    const module = await importAdapter();
    const operations = await module.createLivePersonalHomeSystemTaskOperations({
      channel: 'preview',
      mode: 'system',
    });

    await operations.inspect({
      requestedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:4123' },
      runtimeTarget: { channel: 'stable', mode: 'user' },
      progress: () => undefined,
    });

    const composition = harness.createCanonicalPersonalHomeOperations.mock.calls[0]?.[0] as {
      channel: 'stable' | 'preview' | 'publicdev';
      mode: 'user' | 'system';
      readPurpose(): Promise<unknown>;
    };
    expect(composition.channel).toBe('preview');
    expect(composition.mode).toBe('system');
    await composition.readPurpose();
    expect(harness.engine.readStatus).toHaveBeenCalledWith({
      target: { kind: 'local' },
      channel: 'preview',
      mode: 'system',
    });
  });
  it('delegates readLiveRelayRuntimeStatus to the canonical engine with every parsed param field', async () => {
    const adapter = await importAdapter();

    const status = await adapter.readLiveRelayRuntimeStatus(fullLocalParams);

    expect(harness.engine.readStatus).toHaveBeenCalledTimes(1);
    expect(harness.engine.readStatus).toHaveBeenCalledWith(fullLocalParams);
    expect(status).toEqual(statusSnapshot());
  });

  it('rejects ssh targets because live relay runtime tasks are local-only', async () => {
    const adapter = await importAdapter();

    await expect(adapter.readLiveRelayRuntimeStatus({
      target: { kind: 'ssh', ssh: { target: 'relay.example.test', auth: 'agent' } },
    })).rejects.toThrow(/local/u);

    expect(harness.engine.readStatus).not.toHaveBeenCalled();
  });

  it('delegates start, restart, stop, and safe uninstall to engine control with the same full params', async () => {
    const adapter = await importAdapter();

    await adapter.startLiveRelayRuntime(fullLocalParams);
    await adapter.restartLiveRelayRuntime(fullLocalParams);
    await adapter.stopLiveRelayRuntime(fullLocalParams);
    await adapter.uninstallLiveRelayRuntime(fullLocalParams);

    expect(harness.engine.control).toHaveBeenCalledTimes(4);
    expect(harness.engine.control).toHaveBeenNthCalledWith(1, { ...fullLocalParams, action: 'start' });
    expect(harness.engine.control).toHaveBeenNthCalledWith(2, { ...fullLocalParams, action: 'restart' });
    expect(harness.engine.control).toHaveBeenNthCalledWith(3, { ...fullLocalParams, action: 'stop' });
    expect(harness.engine.control).toHaveBeenNthCalledWith(4, { ...fullLocalParams, action: 'uninstall' });
  });

  it('delegates installOrUpdate with the explicit server binary override intact', async () => {
    const adapter = await importAdapter();

    const result = await adapter.installOrUpdateLiveRelayRuntime(fullLocalParams);

    expect(harness.engine.installOrUpdate).toHaveBeenCalledTimes(1);
    expect(harness.engine.installOrUpdate).toHaveBeenCalledWith(fullLocalParams);
    expect(harness.ensureLocalFirstPartyComponentCommand).not.toHaveBeenCalled();
    expect(result).toEqual({ relayUrl: 'http://127.0.0.1:4123', mode: 'system' });
  });

  it('resolves the server binary through the shared first-party component dependency when no override is provided', async () => {
    const adapter = await importAdapter();

    await adapter.installOrUpdateLiveRelayRuntime({
      target: { kind: 'local' },
      channel: 'dev',
      mode: 'user',
      env: { PORT: '4123' },
    });

    expect(harness.ensureLocalFirstPartyComponentCommand).toHaveBeenCalledTimes(1);
    expect(harness.ensureLocalFirstPartyComponentCommand).toHaveBeenCalledWith(expect.objectContaining({
      componentId: 'happier-server',
      envVarNames: ['HAPPIER_SELF_HOST_SERVER_BINARY'],
      releaseRing: 'publicdev',
    }));
    expect(harness.engine.installOrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'local' },
      channel: 'dev',
      mode: 'user',
      env: { PORT: '4123' },
      selfHostRelayBinaryOverride: '/resolved/happier-server',
    }));
  });

  it('probes health at the engine-resolved base URL instead of reconstructed defaults', async () => {
    const adapter = await importAdapter();

    const health = await adapter.readLiveRelayRuntimeHealth({
      target: { kind: 'local' },
      channel: 'preview',
      mode: 'user',
    });

    expect(harness.engine.readStatus).toHaveBeenCalledTimes(1);
    expect(harness.checkRelayRuntimeHealth).toHaveBeenCalledTimes(1);
    expect(harness.checkRelayRuntimeHealth).toHaveBeenCalledWith(expect.objectContaining({
      host: '127.0.0.1',
      port: 4123,
    }));
    expect(health).toEqual(healthResult());
  });
});
