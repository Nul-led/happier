import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error -- this compatibility suite's Vitest config maps @/ to UI source; the package-wide TS program maps it to CLI source.
import { scopedStorageId } from '@/utils/system/storageScope';

const RELEASED_CLIENT_V0_2_1_COMMIT = 'b1d15a8a9c241737d1ca9b167459901e6259173a';

function installWebStorage(initial: Readonly<Record<string, string>>): void {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
  vi.stubGlobal('window', {
    location: { origin: 'https://app.happier.dev', hostname: 'app.happier.dev' },
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {});
}

describe(`released client v0.2.1 reader compatibility (${RELEASED_CLIENT_V0_2_1_COMMIT})`, () => {
  const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
    else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
  });

  it('reads the exact historical server-state-v1 profile shape with newer additive fields absent', async () => {
    const scope = `released-v0-2-1-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;
    const historicalState = {
      activeServerIdIsExplicit: true,
      activeServerId: 'stack.example.test',
      servers: {
        'stack.example.test': {
          id: 'stack.example.test',
          name: 'Released Home',
          serverUrl: 'https://stack.example.test',
          createdAt: 1_713_123_456_000,
          updatedAt: 1_713_123_456_000,
          lastUsedAt: 1_713_123_456_000,
          source: 'manual',
        },
      },
    } as const;
    installWebStorage({
      [`${scopedStorageId('server-profiles', scope)}:server-state-v1`]: JSON.stringify(historicalState),
    });
    vi.resetModules();

    // @ts-expect-error -- runtime Vitest alias resolves the current UI reader; see the package alias note above.
    const profiles = await import('@/sync/domains/server/serverProfiles');
    expect(profiles.getActiveServerSnapshot()).toMatchObject({
      serverId: 'stack.example.test',
      serverUrl: 'https://stack.example.test',
    });
    expect(profiles.getServerProfileById('stack.example.test')).toEqual({
      ...historicalState.servers['stack.example.test'],
      source: 'manual',
    });
  });

  it('accepts the independently released V1 QR writer output through the current reader', async () => {
    // @ts-expect-error -- runtime Vitest alias resolves the current UI reader; see the package alias note above.
    const { parsePairingDeepLink } = await import('@/auth/pairing/pairingUrl');

    // Exact golden output asserted by cli-v0.2.1's pairingUrl.scheme.test.ts.
    const releasedV1Link =
      'happier-dev:///pair?v=1&pairId=pid123&secret=sec_abc&server=https%3A%2F%2Fstack.example.test%2Fpath%3Fx%3D1';
    expect(parsePairingDeepLink(releasedV1Link)).toEqual({
      pairId: 'pid123',
      secret: 'sec_abc',
      serverUrl: 'https://stack.example.test/path?x=1',
    });
  });
});
