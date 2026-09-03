import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRelayRuntimeDefaults } from '../firstPartyRuntime/relayRuntime.js';
import { createLocalPersonalHomeHost } from './localPersonalHomeHost.js';

// The RelayHostEngine is the host-owned service/process boundary this composition
// exists to sit on top of, so it is the only thing stubbed here. Every Personal
// Home owner below the composition (layout resolution, operations, lifecycle
// policy, relocation destination) runs for real against a temporary Home.
type EngineStub = Readonly<{
  readStatus: ReturnType<typeof vi.fn>;
  installOrUpdate: ReturnType<typeof vi.fn>;
  control: ReturnType<typeof vi.fn>;
}>;

let homeDir: string;
let canonicalServerUrl: string;

function statusSnapshot() {
  return {
    installed: true,
    version: 'happier-server-v9',
    service: { active: false, enabled: true },
    baseUrl: canonicalServerUrl,
    healthy: true,
    canonicalServerUrl,
    purpose: { kind: 'personal-home' as const, canonicalServerUrl },
  };
}

function createEngine(): EngineStub {
  return {
    readStatus: vi.fn(async () => statusSnapshot()),
    installOrUpdate: vi.fn(async () => ({ relayUrl: canonicalServerUrl, mode: 'user' as const })),
    control: vi.fn(async () => undefined),
  };
}

function createHost(engine: EngineStub, overrides: Partial<{ channel: 'stable' | 'preview' | 'dev'; mode: 'user' | 'system' }> = {}) {
  return createLocalPersonalHomeHost({
    engine: engine as never,
    homeDir,
    channel: overrides.channel ?? 'stable',
    mode: overrides.mode ?? 'user',
  });
}

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'local-personal-home-host-'));
  canonicalServerUrl = 'http://127.0.0.1:43123';
  const defaults = resolveRelayRuntimeDefaults({ homeDir, mode: 'user', channel: 'stable' });
  await mkdir(defaults.configDir, { recursive: true });
  await mkdir(defaults.dataDir, { recursive: true });
  await writeFile(join(defaults.configDir, 'server.env'), [
    'HAPPIER_SERVER_HOST=127.0.0.1',
    'PORT=43123',
    `HAPPIER_CANONICAL_SERVER_URL=${canonicalServerUrl}`,
    'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
    'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
    '',
  ].join('\n'));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('local Personal Home host composition', () => {
  it('drives the canonical Personal Home operations owner from the host engine snapshot', async () => {
    const engine = createEngine();
    const operations = await createHost(engine).createOperations();

    await expect(operations.inspect({ expectedCanonicalServerUrl: canonicalServerUrl })).resolves.toMatchObject({
      purpose: 'personal-home',
      canonicalServerUrl,
      running: false,
    });
    expect(engine.readStatus).toHaveBeenCalledWith({
      target: { kind: 'local' },
      channel: 'stable',
      mode: 'user',
    });
  });

  it('requires a fresh personal-home runtime purpose before any operation touches the Home', async () => {
    const engine = createEngine();
    engine.readStatus.mockResolvedValue({ ...statusSnapshot(), purpose: { kind: 'generic' } });
    const operations = await createHost(engine).createOperations();

    await expect(operations.inspect({ expectedCanonicalServerUrl: canonicalServerUrl }))
      .rejects.toMatchObject({ code: 'purpose_not_personal_home' });
  });

  it('composes the relocation destination owner against the same layout and release ring', async () => {
    const engine = createEngine();
    const host = createHost(engine);

    expect(host.releaseRing).toBe('stable');
    await expect(host.createRelocationDestinationOwner()).resolves.toEqual(expect.objectContaining({
      stage: expect.any(Function),
    }));
  });

  it('normalizes the public channel label onto one release ring for the whole composition', () => {
    expect(createHost(createEngine(), { channel: 'dev' }).releaseRing).toBe('publicdev');
    expect(createHost(createEngine(), { channel: 'preview' }).releaseRing).toBe('preview');
    expect(createHost(createEngine()).releaseRing).toBe('stable');
  });
});
